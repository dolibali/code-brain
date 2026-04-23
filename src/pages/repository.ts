import { createContentHash } from "../embedding/provider.js";
import { ValidationError, singleValidationError } from "../errors/validation-error.js";
import type { IndexDatabase } from "../storage/index-db.js";
import { storageWriteQueue } from "../storage/write-queue.js";
import { markdownPathToSlug, normalizePageRef, slugToMarkdownPath, validatePageSlug } from "./page-ref.js";
import { writeMarkdownAtomically, parseStoredPage, walkMarkdownFiles } from "./page-filesystem.js";
import { upsertPageIndex } from "./page-indexer.js";
import { findProject, resolveProjectPagesRoot, resolveStoredProject, selectProjectForRead } from "./page-project.js";
import { parsePageMarkdown } from "./parse-page.js";
import { renderPageMarkdown } from "./render-page.js";
import type {
  EmbeddingSyncOptions,
  ListPagesInput,
  ListedPage,
  PageService,
  PutPageInput,
  ReindexInput,
  ReindexResult,
  StoredPage
} from "./types.js";
import type { CodeBrainConfig } from "../config/schema.js";
import type { PageType } from "./schema.js";

function listProjectRows(
  index: IndexDatabase,
  input: ListPagesInput,
  resolvedProjectId?: string
): Array<{
  project: string;
  slug: string;
  type: PageType;
  title: string;
  status: string | null;
  updated_at: string;
  markdown_path: string;
}> {
  const conditions: string[] = [];
  const values: Array<string | number> = [];

  if (resolvedProjectId) {
    conditions.push("pages.project = ?");
    values.push(resolvedProjectId);
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

  return index.db
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
}

export class PageRepository implements PageService {
  constructor(
    private readonly config: CodeBrainConfig,
    private readonly index: IndexDatabase,
    private readonly embedding?: EmbeddingSyncOptions
  ) {}

  async putPage(input: PutPageInput): Promise<StoredPage> {
    return storageWriteQueue.runExclusive(async () => {
      const normalizedSlug = validatePageSlug(input.slug);
      const parsed = parsePageMarkdown(input.content);
      const project = resolveStoredProject({
        config: this.config,
        frontmatterProject: parsed.frontmatter.project,
        project: input.project,
        contextPath: input.contextPath
      });

      validatePageSlug(normalizedSlug, parsed.frontmatter.type);
      if (parsed.frontmatter.slug && normalizePageRef(parsed.frontmatter.slug) !== normalizedSlug) {
        throw singleValidationError(
          "slug",
          `frontmatter slug '${parsed.frontmatter.slug}' does not match put_page slug '${normalizedSlug}'.`
        );
      }

      const projectPagesRoot = resolveProjectPagesRoot(this.config, project);
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
    const resolvedProjectId = input.project ? selectProjectForRead(this.config, input.project) : undefined;

    return listProjectRows(this.index, input, resolvedProjectId).map((row) => ({
      project: row.project,
      slug: row.slug,
      type: row.type,
      title: row.title,
      status: row.status,
      updatedAt: row.updated_at,
      markdownPath: row.markdown_path
    }));
  }

  async reindex(input: ReindexInput): Promise<ReindexResult> {
    return storageWriteQueue.runExclusive(async () => {
      const projectIds =
        input.full || !input.project
          ? this.config.projects.map((project) => project.id)
          : [selectProjectForRead(this.config, input.project)];

      this.clearProjectIndex(projectIds);

      let pageCount = 0;
      for (const projectId of projectIds) {
        const projectPagesRoot = resolveProjectPagesRoot(this.config, projectId);
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

  private clearProjectIndex(projectIds: string[]): void {
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
  }

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
}
