import path from "node:path";
import { mkdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import type { CodeBrainConfig } from "../config/schema.js";
import { buildIndexedSearchText } from "../search/normalize.js";
import { INDEX_SCHEMA_SQL } from "./index-schema.js";

export type IndexDatabase = {
  db: DatabaseSync;
  initialize: () => void;
  syncProjects: () => void;
  getJournalMode: () => string;
  close: () => void;
};

export async function openIndexDatabase(config: CodeBrainConfig): Promise<IndexDatabase> {
  await mkdir(path.dirname(config.brain.indexDb), { recursive: true });
  const db = new DatabaseSync(config.brain.indexDb);

  const initialize = (): void => {
    db.exec(INDEX_SCHEMA_SQL);
    migrateDerivedSchema(db);
  };

  const syncProjects = (): void => {
    const statement = db.prepare(`
      INSERT INTO projects (id, title, main_branch, roots_json, git_remotes_json, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        main_branch = excluded.main_branch,
        roots_json = excluded.roots_json,
        git_remotes_json = excluded.git_remotes_json,
        updated_at = CURRENT_TIMESTAMP
    `);

    for (const project of config.projects) {
      statement.run(
        project.id,
        project.title ?? null,
        project.mainBranch,
        JSON.stringify(project.roots),
        JSON.stringify(project.gitRemotes)
      );
    }
  };

  const getJournalMode = (): string => {
    const row = db.prepare("PRAGMA journal_mode;").get() as Record<string, string>;
    return row.journal_mode;
  };

  const close = (): void => {
    db.close();
  };

  return {
    db,
    initialize,
    syncProjects,
    getJournalMode,
    close
  };
}

function migrateDerivedSchema(db: DatabaseSync): void {
  ensureProjectsColumns(db);
  ensurePagesColumns(db);
  ensureEmbeddingSchema(db);
  ensureFtsSchema(db);
  rebuildPagesFts(db);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_page_links_unique
    ON page_links(project, from_slug, to_slug, relation)
  `);
}

function ensureProjectsColumns(db: DatabaseSync): void {
  const columnRows = db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
  const columns = new Set(columnRows.map((row) => row.name));
  const additions: Array<{ name: string; sql: string }> = [
    { name: "title", sql: "ALTER TABLE projects ADD COLUMN title TEXT" },
    { name: "main_branch", sql: "ALTER TABLE projects ADD COLUMN main_branch TEXT NOT NULL DEFAULT 'main'" },
    {
      name: "roots_json",
      sql: "ALTER TABLE projects ADD COLUMN roots_json TEXT NOT NULL DEFAULT '[]'"
    },
    {
      name: "git_remotes_json",
      sql: "ALTER TABLE projects ADD COLUMN git_remotes_json TEXT NOT NULL DEFAULT '[]'"
    }
  ];

  for (const addition of additions) {
    if (!columns.has(addition.name)) {
      db.exec(addition.sql);
    }
  }

  if (columns.has("root") && !columns.has("roots_json")) {
    db.exec("UPDATE projects SET roots_json = json_array(root) WHERE COALESCE(roots_json, '[]') = '[]'");
  }

  if (columns.has("remotes_json") && !columns.has("git_remotes_json")) {
    db.exec(`
      UPDATE projects
      SET git_remotes_json = remotes_json
      WHERE COALESCE(git_remotes_json, '[]') = '[]'
    `);
  }
}

function ensurePagesColumns(db: DatabaseSync): void {
  const columnRows = db.prepare("PRAGMA table_info(pages)").all() as Array<{ name: string }>;
  const columns = new Set(columnRows.map((row) => row.name));
  const additions: Array<{ name: string; sql: string }> = [
    { name: "lifecycle_stage", sql: "ALTER TABLE pages ADD COLUMN lifecycle_stage TEXT" },
    { name: "change_kind", sql: "ALTER TABLE pages ADD COLUMN change_kind TEXT" },
    {
      name: "tags_json",
      sql: "ALTER TABLE pages ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'"
    },
    {
      name: "aliases_json",
      sql: "ALTER TABLE pages ADD COLUMN aliases_json TEXT NOT NULL DEFAULT '[]'"
    },
    {
      name: "see_also_json",
      sql: "ALTER TABLE pages ADD COLUMN see_also_json TEXT NOT NULL DEFAULT '[]'"
    },
    {
      name: "compiled_truth",
      sql: "ALTER TABLE pages ADD COLUMN compiled_truth TEXT NOT NULL DEFAULT ''"
    },
    {
      name: "timeline_text",
      sql: "ALTER TABLE pages ADD COLUMN timeline_text TEXT NOT NULL DEFAULT ''"
    }
  ];

  for (const addition of additions) {
    if (!columns.has(addition.name)) {
      db.exec(addition.sql);
    }
  }
}

function ensureEmbeddingSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS page_embeddings (
      project TEXT NOT NULL REFERENCES projects(id),
      slug TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (project, slug)
    )
  `);
}

function ensureFtsSchema(db: DatabaseSync): void {
  const expectedColumns = [
    "project",
    "slug",
    "type",
    "title",
    "compiled_truth",
    "timeline_text",
    "aliases",
    "tags",
    "scope_text"
  ];
  const existing = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pages_fts'")
    .get() as { name?: string } | undefined;

  let shouldRecreate = false;
  if (existing) {
    const currentColumns = (
      db.prepare("PRAGMA table_info(pages_fts)").all() as Array<{ name: string }>
    ).map((row) => row.name);
    shouldRecreate = currentColumns.join(",") !== expectedColumns.join(",");
  }

  if (shouldRecreate) {
    db.exec("DROP TABLE IF EXISTS pages_fts");
  }

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
      project,
      slug,
      type,
      title,
      compiled_truth,
      timeline_text,
      aliases,
      tags,
      scope_text
    );
  `);
}

function rebuildPagesFts(db: DatabaseSync): void {
  db.prepare("DELETE FROM pages_fts").run();

  const pageRows = db.prepare(`
    SELECT id, project, slug, type, title, compiled_truth, timeline_text, aliases_json, tags_json
    FROM pages
  `).all() as Array<{
    id: number;
    project: string;
    slug: string;
    type: string;
    title: string;
    compiled_truth: string;
    timeline_text: string;
    aliases_json: string;
    tags_json: string;
  }>;

  const scopeStatement = db.prepare(`
    SELECT scope_kind, scope_value
    FROM page_scopes
    WHERE page_id = ?
  `);
  const insertStatement = db.prepare(`
    INSERT INTO pages_fts (
      project, slug, type, title, compiled_truth, timeline_text, aliases, tags, scope_text
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const row of pageRows) {
    const scopes = (scopeStatement.all(row.id) as Array<{ scope_kind: string; scope_value: string }>).map(
      (scope) => `${scope.scope_kind}:${scope.scope_value} ${scope.scope_value}`
    );
    const aliases = parseJsonArray(row.aliases_json).join(" ");
    const tags = parseJsonArray(row.tags_json).join(" ");

    insertStatement.run(
      row.project,
      row.slug,
      row.type,
      row.title,
      buildIndexedSearchText(row.compiled_truth),
      buildIndexedSearchText(row.timeline_text),
      buildIndexedSearchText(aliases),
      buildIndexedSearchText(tags),
      buildIndexedSearchText(scopes.join(" "))
    );
  }
}

function parseJsonArray(input: string): string[] {
  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}
