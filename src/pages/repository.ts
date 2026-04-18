import path from "node:path";
import { mkdir, open, readFile, rename, rm, readdir } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import type { CodeBrainConfig } from "../config/schema.js";
import { buildIndexedSearchText } from "../search/normalize.js";
import type { IndexDatabase } from "../storage/index-db.js";
import { runInTransaction } from "../storage/transaction.js";
import { storageWriteQueue } from "../storage/write-queue.js";
import { parsePageMarkdown } from "./parse-page.js";
import { normalizePageRef } from "./page-ref.js";
import { renderPageMarkdown } from "./render-page.js";
import {
  type ChangeKind,
  type LifecycleStage,
  type PageFrontmatter,
  type PageType,
  type ScopeRef,
  type SourceAgent,
  type SourceType
} from "./schema.js";

type PagePathInfo = {
  slug: string;
  markdownPath: string;
};

export type UpsertPageInput = {
  project: string;
  type: PageType;
  title: string;
  body: string;
  slug?: string;
  tags?: string[];
  aliases?: string[];
  scopeRefs?: ScopeRef[];
  status: string;
  sourceType: SourceType;
  sourceAgent: SourceAgent;
  createdAt?: string;
  updatedAt?: string;
  lifecycleStage?: LifecycleStage;
  changeKind?: ChangeKind;
  confidence?: number;
  seeAlso?: string[];
};

export type StoredPage = {
  frontmatter: PageFrontmatter;
  body: string;
  slug: string;
  markdownPath: string;
  compiledTruth: string;
  timelineText: string;
};

export type ListPagesInput = {
  project?: string;
  types?: PageType[];
  status?: string;
  tags?: string[];
  limit?: number;
};

export type ListedPage = {
  project: string;
  slug: string;
  type: PageType;
  title: string;
  status: string | null;
  updatedAt: string;
  markdownPath: string;
};

function slugifySegment(input: string): string {
  const normalized = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .toLowerCase();

  return normalized.length > 0 ? normalized : "untitled";
}

function typeDirectory(type: PageType): string {
  switch (type) {
    case "issue":
      return "issues";
    case "architecture":
      return "architecture";
    case "decision":
      return "decisions";
    case "practice":
      return "practices";
    case "change":
      return "changes";
    default: {
      const exhaustive: never = type;
      throw new Error(`Unhandled page type: ${exhaustive}`);
    }
  }
}

function extractCompiledTruthAndTimeline(body: string): {
  compiledTruth: string;
  timelineText: string;
} {
  const timelineMarker = /^## Timeline\s*$/m;
  const marker = timelineMarker.exec(body);
  if (!marker || marker.index === undefined) {
    return {
      compiledTruth: body.trim(),
      timelineText: ""
    };
  }

  const compiledTruth = body.slice(0, marker.index).trim();
  const timelineText = body.slice(marker.index).replace(/^## Timeline\s*$/m, "").trim();
  return {
    compiledTruth,
    timelineText
  };
}

function buildSummary(compiledTruth: string, fallbackTitle: string): string {
  const lines = compiledTruth
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("## "));

  return lines[0] ?? fallbackTitle;
}

function buildScopeText(scopeRefs: ScopeRef[]): string {
  return scopeRefs.map((scope) => `${scope.kind}:${scope.value} ${scope.value}`).join(" ");
}

function findProject(config: CodeBrainConfig, projectId: string): { id: string } {
  const project = config.projects.find((entry) => entry.id === projectId);
  if (!project) {
    throw new Error(`Unknown project '${projectId}'. Register it first with 'code-brain project register'.`);
  }

  return project;
}

function buildPagePath(config: CodeBrainConfig, frontmatter: PageFrontmatter, slug?: string): PagePathInfo {
  findProject(config, frontmatter.project);

  const resolvedSlug = slug ?? slugifySegment(frontmatter.title);
  const projectRoot = path.join(config.brain.repo, "projects", frontmatter.project, "pages");

  if (frontmatter.type === "change") {
    const date = frontmatter.createdAt.slice(0, 10);
    const year = frontmatter.createdAt.slice(0, 4);
    const finalSlug = slug ?? `${date}-${slugifySegment(frontmatter.title)}`;
    return {
      slug: finalSlug,
      markdownPath: path.join(projectRoot, typeDirectory(frontmatter.type), year, `${finalSlug}.md`)
    };
  }

  return {
    slug: resolvedSlug,
    markdownPath: path.join(projectRoot, typeDirectory(frontmatter.type), `${resolvedSlug}.md`)
  };
}

async function writeMarkdownAtomically(markdownPath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(markdownPath), { recursive: true });
  const temporaryPath = `${markdownPath}.${process.pid}.${Date.now()}.tmp`;
  const fileHandle = await open(temporaryPath, "w");

  try {
    await fileHandle.writeFile(contents, "utf8");
    await fileHandle.sync();
  } finally {
    await fileHandle.close();
  }

  try {
    await rename(temporaryPath, markdownPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

function upsertPageIndex(db: DatabaseSync, page: StoredPage): void {
  const scopeText = buildScopeText(page.frontmatter.scopeRefs);
  const { compiledTruth, timelineText } = page;
  const summary = buildSummary(compiledTruth, page.frontmatter.title);
  const indexedCompiledTruth = buildIndexedSearchText(compiledTruth);
  const indexedTimelineText = buildIndexedSearchText(timelineText);
  const indexedAliases = buildIndexedSearchText(page.frontmatter.aliases.join(" "));
  const indexedTags = buildIndexedSearchText(page.frontmatter.tags.join(" "));
  const indexedScopeText = buildIndexedSearchText(scopeText);

  runInTransaction(db, () => {
    db.prepare(`
      INSERT INTO pages (
        project, slug, type, title, summary, markdown_path, status,
        lifecycle_stage, change_kind, source_type, source_agent, confidence,
        tags_json, aliases_json, see_also_json, compiled_truth, timeline_text,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project, slug) DO UPDATE SET
        type = excluded.type,
        title = excluded.title,
        summary = excluded.summary,
        markdown_path = excluded.markdown_path,
        status = excluded.status,
        lifecycle_stage = excluded.lifecycle_stage,
        change_kind = excluded.change_kind,
        source_type = excluded.source_type,
        source_agent = excluded.source_agent,
        confidence = excluded.confidence,
        tags_json = excluded.tags_json,
        aliases_json = excluded.aliases_json,
        see_also_json = excluded.see_also_json,
        compiled_truth = excluded.compiled_truth,
        timeline_text = excluded.timeline_text,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `).run(
      page.frontmatter.project,
      page.slug,
      page.frontmatter.type,
      page.frontmatter.title,
      summary,
      page.markdownPath,
      page.frontmatter.status,
      page.frontmatter.lifecycleStage ?? null,
      page.frontmatter.changeKind ?? null,
      page.frontmatter.sourceType,
      page.frontmatter.sourceAgent,
      page.frontmatter.confidence ?? null,
      JSON.stringify(page.frontmatter.tags),
      JSON.stringify(page.frontmatter.aliases),
      JSON.stringify(page.frontmatter.seeAlso),
      compiledTruth,
      timelineText,
      page.frontmatter.createdAt,
      page.frontmatter.updatedAt
    );

    const pageRow = db
      .prepare("SELECT id FROM pages WHERE project = ? AND slug = ?")
      .get(page.frontmatter.project, page.slug) as { id: number };

    db.prepare("DELETE FROM page_scopes WHERE page_id = ?").run(pageRow.id);
    for (const scope of page.frontmatter.scopeRefs) {
      db.prepare(
        "INSERT INTO page_scopes (page_id, scope_kind, scope_value) VALUES (?, ?, ?)"
      ).run(pageRow.id, scope.kind, scope.value);
    }

    db.prepare("DELETE FROM pages_fts WHERE project = ? AND slug = ?").run(
      page.frontmatter.project,
      page.slug
    );
    db.prepare(`
      INSERT INTO pages_fts (
        project, slug, type, title, compiled_truth, timeline_text, aliases, tags, scope_text
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      page.frontmatter.project,
      page.slug,
      page.frontmatter.type,
      page.frontmatter.title,
      indexedCompiledTruth,
      indexedTimelineText,
      indexedAliases,
      indexedTags,
      indexedScopeText
    );
  });
}

async function parseStoredPage(markdownPath: string, slug: string): Promise<StoredPage> {
  const source = await readFile(markdownPath, "utf8");
  const parsed = parsePageMarkdown(source);
  const textParts = extractCompiledTruthAndTimeline(parsed.body);

  return {
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    slug,
    markdownPath,
    compiledTruth: textParts.compiledTruth,
    timelineText: textParts.timelineText
  };
}

async function walkMarkdownFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });

  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkMarkdownFiles(absolutePath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(absolutePath);
    }
  }

  return files;
}

export class PageRepository {
  constructor(
    private readonly config: CodeBrainConfig,
    private readonly index: IndexDatabase
  ) {}

  async upsertPage(input: UpsertPageInput): Promise<StoredPage> {
    return storageWriteQueue.runExclusive(async () => {
      const now = new Date().toISOString();
      const frontmatter: PageFrontmatter = {
        project: input.project,
        type: input.type,
        title: input.title,
        tags: input.tags ?? [],
        aliases: input.aliases ?? [],
        scopeRefs: input.scopeRefs ?? [],
        status: input.status,
        sourceType: input.sourceType,
        sourceAgent: input.sourceAgent,
        createdAt: input.createdAt ?? now,
        updatedAt: input.updatedAt ?? now,
        lifecycleStage: input.lifecycleStage,
        changeKind: input.changeKind,
        confidence: input.confidence,
        seeAlso: input.seeAlso ?? []
      };

      const pagePath = buildPagePath(this.config, frontmatter, input.slug);
      const markdown = renderPageMarkdown(frontmatter, input.body);
      await writeMarkdownAtomically(pagePath.markdownPath, markdown);
      const storedPage = await parseStoredPage(pagePath.markdownPath, pagePath.slug);
      upsertPageIndex(this.index.db, storedPage);
      return storedPage;
    });
  }

  async getPage(project: string, slug: string): Promise<StoredPage | null> {
    const row = this.index.db
      .prepare("SELECT markdown_path FROM pages WHERE project = ? AND slug = ?")
      .get(project, normalizePageRef(slug)) as { markdown_path: string } | undefined;

    if (!row) {
      return null;
    }

    return parseStoredPage(row.markdown_path, normalizePageRef(slug));
  }

  listPages(input: ListPagesInput): ListedPage[] {
    const conditions: string[] = [];
    const values: Array<string | number> = [];

    if (input.project) {
      conditions.push("project = ?");
      values.push(input.project);
    }

    if (input.types && input.types.length > 0) {
      conditions.push(`type IN (${input.types.map(() => "?").join(", ")})`);
      values.push(...input.types);
    }

    if (input.status) {
      conditions.push("status = ?");
      values.push(input.status);
    }

    if (input.tags && input.tags.length > 0) {
      for (const tag of input.tags) {
        conditions.push("tags_json LIKE ?");
        values.push(`%\"${tag}\"%`);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = input.limit ?? 20;
    values.push(limit);

    const rows = this.index.db
      .prepare(`
        SELECT project, slug, type, title, status, updated_at, markdown_path
        FROM pages
        ${whereClause}
        ORDER BY updated_at DESC, slug ASC
        LIMIT ?
      `)
      .all(...values) as Array<{
      project: string;
      slug: string;
      type: PageType;
      title: string;
      status: string | null;
      updated_at: string;
      markdown_path: string;
    }>;

    return rows.map((row) => ({
      project: row.project,
      slug: row.slug,
      type: row.type,
      title: row.title,
      status: row.status,
      updatedAt: row.updated_at,
      markdownPath: row.markdown_path
    }));
  }

  async reindex(input: { project?: string; full?: boolean }): Promise<{ projects: number; pages: number }> {
    return storageWriteQueue.runExclusive(async () => {
      const projectIds =
        input.full || !input.project
          ? this.config.projects.map((project) => project.id)
          : [input.project];

      runInTransaction(this.index.db, () => {
        if (projectIds.length === 0) {
          this.index.db.prepare("DELETE FROM pages").run();
          this.index.db.prepare("DELETE FROM page_scopes").run();
          this.index.db.prepare("DELETE FROM pages_fts").run();
          return;
        }

        const placeholders = projectIds.map(() => "?").join(", ");
        this.index.db.prepare(`DELETE FROM pages WHERE project IN (${placeholders})`).run(...projectIds);
        this.index.db.prepare(`
          DELETE FROM page_scopes
          WHERE page_id NOT IN (SELECT id FROM pages)
        `).run();
        this.index.db.prepare(`DELETE FROM pages_fts WHERE project IN (${placeholders})`).run(...projectIds);
      });

      let pageCount = 0;
      for (const projectId of projectIds) {
        findProject(this.config, projectId);
        const projectPagesRoot = path.join(this.config.brain.repo, "projects", projectId, "pages");
        const markdownFiles = await walkMarkdownFiles(projectPagesRoot);

        for (const markdownPath of markdownFiles) {
          const source = await readFile(markdownPath, "utf8");
          const parsed = parsePageMarkdown(source);
          const derivedSlug = path.basename(markdownPath, ".md");
          const page = {
            frontmatter: parsed.frontmatter,
            body: parsed.body,
            slug: derivedSlug,
            markdownPath,
            ...extractCompiledTruthAndTimeline(parsed.body)
          } satisfies StoredPage;

          upsertPageIndex(this.index.db, page);
          pageCount += 1;
        }
      }

      this.index.db.prepare(`
        DELETE FROM page_scopes
        WHERE page_id NOT IN (SELECT id FROM pages)
      `).run();

      return {
        projects: projectIds.length,
        pages: pageCount
      };
    });
  }
}
