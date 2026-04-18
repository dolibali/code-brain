import type { CodeBrainConfig } from "../config/schema.js";
import type { PageType, ScopeRef } from "../pages/schema.js";
import { resolveProject } from "../projects/resolve-project.js";
import type { IndexDatabase } from "../storage/index-db.js";
import { buildFtsQuery } from "./normalize.js";

export type SearchInput = {
  query: string;
  project?: string;
  contextPath?: string;
  global?: boolean;
  types?: PageType[];
  scopeRefs?: ScopeRef[];
  limit?: number;
};

export type SearchResult = {
  project: string;
  slug: string;
  type: PageType;
  title: string;
  summary: string;
  markdownPath: string;
  score: number;
  relatedChanges: string[];
};

export type SearchReranker = (input: SearchInput, results: SearchResult[]) => SearchResult[];

export class SearchService {
  constructor(
    private readonly config: CodeBrainConfig,
    private readonly index: IndexDatabase,
    private readonly options?: {
      rerank?: SearchReranker;
    }
  ) {}

  search(input: SearchInput): SearchResult[] {
    const resolvedProject = input.global
      ? null
      : resolveProject(this.config, {
          project: input.project,
          contextPath: input.contextPath,
          cwd: process.cwd()
        });

    if (!input.global && !resolvedProject) {
      throw new Error("Unable to resolve project. Pass --project or --context-path.");
    }

    const conditions = ["pages_fts MATCH ?"];
    const values: Array<string | number> = [buildFtsQuery(input.query)];

    if (!input.global && resolvedProject) {
      conditions.push("pages.project = ?");
      values.push(resolvedProject.projectId);
    }

    if (input.types && input.types.length > 0) {
      conditions.push(`pages.type IN (${input.types.map(() => "?").join(", ")})`);
      values.push(...input.types);
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

    const limit = input.limit ?? 10;
    values.push(limit);

    const whereClause = conditions.join(" AND ");
    const rows = this.index.db
      .prepare(`
        SELECT
          pages.project,
          pages.slug,
          pages.type,
          pages.title,
          pages.summary,
          pages.markdown_path,
          bm25(pages_fts) AS score
        FROM pages_fts
        JOIN pages
          ON pages.project = pages_fts.project
         AND pages.slug = pages_fts.slug
        WHERE ${whereClause}
        ORDER BY
          CASE WHEN pages.type = 'change' THEN 1 ELSE 0 END,
          score ASC,
          pages.updated_at DESC
        LIMIT ?
      `)
      .all(...values) as Array<{
      project: string;
      slug: string;
      type: PageType;
      title: string;
      summary: string;
      markdown_path: string;
      score: number;
    }>;

    const localResults = rows.map((row) => ({
      project: row.project,
      slug: row.slug,
      type: row.type,
      title: row.title,
      summary: row.summary,
      markdownPath: row.markdown_path,
      score: row.score,
      relatedChanges: this.getRelatedChanges(row.project, row.slug)
    }));

    if (this.config.llm.enabled && this.options?.rerank) {
      try {
        return this.options.rerank(input, localResults);
      } catch {
        return localResults;
      }
    }

    return localResults;
  }

  private getRelatedChanges(project: string, slug: string): string[] {
    if (slug.startsWith("change/")) {
      return [];
    }

    const outgoing = this.index.db.prepare(`
      SELECT to_slug AS slug
      FROM page_links
      WHERE project = ? AND from_slug = ? AND to_slug LIKE 'change/%'
      ORDER BY to_slug ASC
    `).all(project, slug) as Array<{ slug: string }>;

    const incoming = this.index.db.prepare(`
      SELECT from_slug AS slug
      FROM page_links
      WHERE project = ? AND to_slug = ? AND from_slug LIKE 'change/%'
      ORDER BY from_slug ASC
    `).all(project, slug) as Array<{ slug: string }>;

    return [...new Set([...incoming, ...outgoing].map((row) => row.slug))];
  }
}

