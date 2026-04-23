import type { DatabaseSync } from "node:sqlite";
import { buildIndexedSearchText } from "../../search/normalize.js";
import type { Migration } from "../migrator.js";

function parseJsonArray(input: string): string[] {
  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
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

export const ftsMigration: Migration = {
  id: "005-fts",
  description: "Ensure the FTS schema exists and rebuild search text from canonical pages.",
  up(db: DatabaseSync) {
    ensureFtsSchema(db);
    rebuildPagesFts(db);
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_page_links_unique
      ON page_links(project, from_slug, to_slug, relation)
    `);
  }
};
