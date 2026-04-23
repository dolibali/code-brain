import path from "node:path";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import type { CodeBrainConfig } from "../config/schema.js";
import { createContentHash, type EmbeddingProvider } from "../embedding/provider.js";
import { EmbeddingIndexRepository } from "../embedding/repository.js";
import { singleValidationError, ValidationError } from "../errors/validation-error.js";
import { resolveProject } from "../projects/resolve-project.js";
import { buildIndexedSearchText } from "../search/normalize.js";
import type { IndexDatabase } from "../storage/index-db.js";
import { runInTransaction } from "../storage/transaction.js";
import { storageWriteQueue } from "../storage/write-queue.js";
import { parsePageMarkdown } from "./parse-page.js";
import { markdownPathToSlug, normalizePageRef, slugToMarkdownPath, validatePageSlug } from "./page-ref.js";
import { renderPageMarkdown } from "./render-page.js";
import type { PageFrontmatter, PageType, ScopeRef } from "./schema.js";

export type PutPageInput = {
  project?: string;
  slug: string;
  content: string;
  contextPath?: string;
};

export type StoredPage = {
  frontmatter: PageFrontmatter;
  body: string;
  content: string;
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
  scopeRefs?: ScopeRef[];
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

type EmbeddingSyncOptions = {
  enabled: boolean;
  provider?: EmbeddingProvider;
  repository?: EmbeddingIndexRepository;
};

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
    throw new Error(`Unknown project '${projectId}'. Register it first with 'codebrain project register'.`);
  }

  return project;
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
  const summary = buildSummary(page.compiledTruth, page.frontmatter.title);
  const indexedCompiledTruth = buildIndexedSearchText(page.compiledTruth);
  const indexedTimelineText = buildIndexedSearchText(page.timelineText);
  const indexedAliases = buildIndexedSearchText(page.frontmatter.aliases.join(" "));
  const indexedTags = buildIndexedSearchText(page.frontmatter.tags.join(" "));
  const indexedScopeText = buildIndexedSearchText(scopeText);

  runInTransaction(db, () => {
    db.prepare(`
      INSERT INTO pages (
        project, slug, type, title, summary, markdown_path, status,
        lifecycle_stage, change_kind, source_type, source_agent,
        tags_json, aliases_json, see_also_json, compiled_truth, timeline_text,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      JSON.stringify(page.frontmatter.tags),
      JSON.stringify(page.frontmatter.aliases),
      JSON.stringify(page.frontmatter.seeAlso),
      page.compiledTruth,
      page.timelineText,
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
    content: source,
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

function resolveStoredProject(
  config: CodeBrainConfig,
  frontmatterProject: string,
  inputProject?: string,
  contextPath?: string
): string {
  if (inputProject && inputProject !== frontmatterProject) {
    throw singleValidationError(
      "project",
      `project '${inputProject}' does not match frontmatter project '${frontmatterProject}'.`
    );
  }

  const resolvedFromContext = contextPath
    ? resolveProject(config, {
        contextPath,
        cwd: process.cwd()
      })
    : null;

  if (resolvedFromContext && resolvedFromContext.projectId !== frontmatterProject) {
    throw singleValidationError(
      "project",
      `context_path resolves to project '${resolvedFromContext.projectId}', but frontmatter project is '${frontmatterProject}'.`
    );
  }

  findProject(config, frontmatterProject);
  return frontmatterProject;
}

function selectProjectForRead(config: CodeBrainConfig, project?: string): string {
  const resolved = resolveProject(config, {
    project,
    cwd: process.cwd()
  });

  if (!resolved) {
    throw new Error("Unable to resolve project. Pass --project.");
  }

  return resolved.projectId;
}

export class PageRepository {
  constructor(
    private readonly config: CodeBrainConfig,
    private readonly index: IndexDatabase,
    private readonly embedding?: EmbeddingSyncOptions
  ) {}

  private async syncEmbedding(page: StoredPage): Promise<void> {
    if (!this.embedding?.enabled || !this.embedding.provider || !this.embedding.repository) {
      return;
    }

    try {
      const text = [page.frontmatter.title, page.compiledTruth, page.timelineText].filter(Boolean).join("\n\n");
      const response = await this.embedding.provider.embedTexts([text]);
      this.embedding.repository.upsertPageEmbedding({
        project: page.frontmatter.project,
        slug: page.slug,
        contentHash: createContentHash(page.content),
        model: response.model,
        vector: response.vectors[0] ?? []
      });
    } catch {
      // Embedding refresh is best-effort and must not block canonical markdown writes.
    }
  }

  async putPage(input: PutPageInput): Promise<StoredPage> {
    return storageWriteQueue.runExclusive(async () => {
      const normalizedSlug = validatePageSlug(input.slug);
      const parsed = parsePageMarkdown(input.content);
      const project = resolveStoredProject(
        this.config,
        parsed.frontmatter.project,
        input.project,
        input.contextPath
      );

      validatePageSlug(normalizedSlug, parsed.frontmatter.type);
      if (parsed.frontmatter.slug && normalizePageRef(parsed.frontmatter.slug) !== normalizedSlug) {
        throw singleValidationError(
          "slug",
          `frontmatter slug '${parsed.frontmatter.slug}' does not match put_page slug '${normalizedSlug}'.`
        );
      }

      const projectPagesRoot = path.join(this.config.brain.repo, "projects", project, "pages");
      const markdownPath = slugToMarkdownPath(projectPagesRoot, normalizedSlug);
      const markdown = renderPageMarkdown(parsed.frontmatter, parsed.body);
      await writeMarkdownAtomically(markdownPath, markdown);

      const storedPage = await parseStoredPage(markdownPath, normalizedSlug);
      upsertPageIndex(this.index.db, storedPage);
      await this.syncEmbedding(storedPage);
      return storedPage;
    });
  }

  async getPage(project: string | undefined, slug: string): Promise<StoredPage | null> {
    const normalizedSlug = validatePageSlug(slug);

    if (project) {
      const row = this.index.db
        .prepare("SELECT markdown_path FROM pages WHERE project = ? AND slug = ?")
        .get(project, normalizedSlug) as { markdown_path: string } | undefined;

      if (!row) {
        return null;
      }

      return parseStoredPage(row.markdown_path, normalizedSlug);
    }

    const rows = this.index.db
      .prepare("SELECT project, markdown_path FROM pages WHERE slug = ? ORDER BY project ASC")
      .all(normalizedSlug) as Array<{ project: string; markdown_path: string }>;

    if (rows.length === 0) {
      return null;
    }

    if (rows.length > 1) {
      throw new Error(`Page '${normalizedSlug}' exists in multiple projects. Pass --project.`);
    }

    return parseStoredPage(rows[0]!.markdown_path, normalizedSlug);
  }

  listPages(input: ListPagesInput): ListedPage[] {
    const conditions: string[] = [];
    const values: Array<string | number> = [];

    if (input.project) {
      conditions.push("pages.project = ?");
      values.push(selectProjectForRead(this.config, input.project));
    }

    if (input.types && input.types.length > 0) {
      conditions.push(`pages.type IN (${input.types.map(() => "?").join(", ")})`);
      values.push(...input.types);
    }

    if (input.status) {
      conditions.push("pages.status = ?");
      values.push(input.status);
    }

    if (input.tags && input.tags.length > 0) {
      for (const tag of input.tags) {
        conditions.push("pages.tags_json LIKE ?");
        values.push(`%\"${tag}\"%`);
      }
    }

    if (input.scopeRefs && input.scopeRefs.length > 0) {
      for (const scope of input.scopeRefs) {
        conditions.push(`
          EXISTS (
            SELECT 1
            FROM page_scopes
            WHERE page_scopes.page_id = pages.id
              AND page_scopes.scope_kind = ?
              AND page_scopes.scope_value = ?
          )
        `);
        values.push(scope.kind, scope.value);
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
          : [selectProjectForRead(this.config, input.project)];

      runInTransaction(this.index.db, () => {
        if (projectIds.length === 0) {
          this.index.db.prepare("DELETE FROM pages").run();
          this.index.db.prepare("DELETE FROM page_scopes").run();
          this.index.db.prepare("DELETE FROM pages_fts").run();
          this.embedding?.repository?.deleteEmbeddingsForProjects([]);
          return;
        }

        const placeholders = projectIds.map(() => "?").join(", ");
        this.index.db.prepare(`DELETE FROM pages WHERE project IN (${placeholders})`).run(...projectIds);
        this.index.db.prepare(`
          DELETE FROM page_scopes
          WHERE page_id NOT IN (SELECT id FROM pages)
        `).run();
        this.index.db.prepare(`DELETE FROM pages_fts WHERE project IN (${placeholders})`).run(...projectIds);
        this.embedding?.repository?.deleteEmbeddingsForProjects(projectIds);
      });

      let pageCount = 0;
      for (const projectId of projectIds) {
        findProject(this.config, projectId);
        const projectPagesRoot = path.join(this.config.brain.repo, "projects", projectId, "pages");
        const markdownFiles = await walkMarkdownFiles(projectPagesRoot);

        for (const markdownPath of markdownFiles) {
          const slug = markdownPathToSlug(projectPagesRoot, markdownPath);
          const page = await parseStoredPage(markdownPath, slug);
          if (page.frontmatter.project !== projectId) {
            throw new ValidationError("frontmatter validation failed", [
              {
                field: "project",
                message: `frontmatter project '${page.frontmatter.project}' does not match project directory '${projectId}'.`
              }
            ]);
          }

          upsertPageIndex(this.index.db, page);
          await this.syncEmbedding(page);
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
