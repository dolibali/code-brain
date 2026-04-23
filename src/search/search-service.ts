import type { CodeBrainConfig } from "../config/schema.js";
import type { EmbeddingProvider } from "../embedding/provider.js";
import type { EmbeddingIndexRepository } from "../embedding/repository.js";
import type { PageType, ScopeRef } from "../pages/schema.js";
import { resolveProject } from "../projects/resolve-project.js";
import type { IndexDatabase } from "../storage/index-db.js";
import { buildFtsQuery } from "./normalize.js";
import type { QueryExpansion, SearchAugmentor } from "./augmentor.js";

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

export type SearchResponse = {
  results: SearchResult[];
  strategy: {
    queryExpansionUsed: boolean;
    reranked: boolean;
    embeddingUsed: boolean;
    degraded: boolean;
  };
};

type LocalRow = {
  project: string;
  slug: string;
  type: PageType;
  title: string;
  summary: string;
  markdown_path: string;
  score: number;
};

function stableSort(results: SearchResult[]): SearchResult[] {
  return [...results].sort((left, right) => {
    const leftChange = left.type === "change" ? 1 : 0;
    const rightChange = right.type === "change" ? 1 : 0;

    if (leftChange !== rightChange) {
      return leftChange - rightChange;
    }

    if (left.score !== right.score) {
      return left.score - right.score;
    }

    return left.slug.localeCompare(right.slug);
  });
}

function mergeResults(primary: SearchResult[], secondary: SearchResult[]): SearchResult[] {
  const merged = new Map<string, SearchResult>();

  for (const result of [...primary, ...secondary]) {
    const key = `${result.project}:${result.slug}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, result);
      continue;
    }

    merged.set(key, {
      ...existing,
      score: Math.min(existing.score, result.score),
      relatedChanges: [...new Set([...existing.relatedChanges, ...result.relatedChanges])]
    });
  }

  return stableSort([...merged.values()]);
}

export class SearchService {
  constructor(
    private readonly config: CodeBrainConfig,
    private readonly index: IndexDatabase,
    private readonly options?: {
      augmentor?: SearchAugmentor;
      embeddingProvider?: EmbeddingProvider;
      embeddingRepository?: EmbeddingIndexRepository;
    }
  ) {}

  async search(input: SearchInput): Promise<SearchResponse> {
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

    const strategy = {
      queryExpansionUsed: false,
      reranked: false,
      embeddingUsed: false,
      degraded: false
    };

    let expansion: QueryExpansion = {
      queries: [input.query],
      preferred_types: [],
      scope_refs: []
    };

    if (this.config.llm.enabled && !this.options?.augmentor) {
      strategy.degraded = true;
    } else if (this.config.llm.enabled && this.options?.augmentor) {
      try {
        expansion = await this.options.augmentor.expandQuery(input);
        strategy.queryExpansionUsed = expansion.queries.some((query) => query.trim() !== input.query.trim());
      } catch {
        strategy.degraded = true;
      }
    }

    const queryVariants = [...new Set([input.query, ...expansion.queries])];
    let results = queryVariants.reduce<SearchResult[]>(
      (accumulator, query) =>
        mergeResults(accumulator, this.runLocalSearch(query, input, resolvedProject?.projectId ?? null)),
      []
    );

    if (
      this.config.embedding.enabled &&
      (!this.options?.embeddingProvider || !this.options.embeddingRepository)
    ) {
      strategy.degraded = true;
    } else if (
      this.config.embedding.enabled &&
      this.options?.embeddingProvider &&
      this.options.embeddingRepository
    ) {
      try {
        const embeddingResponse = await this.options.embeddingProvider.embedTexts([input.query]);
        const embeddingMatches = this.options.embeddingRepository.searchSimilar({
          project: resolvedProject?.projectId ?? null,
          types: input.types,
          queryVector: embeddingResponse.vectors[0] ?? [],
          limit: Math.max(input.limit ?? 10, 20)
        });

        const embeddingResults = embeddingMatches.map((match) => ({
          project: match.project,
          slug: match.slug,
          type: match.type,
          title: match.title,
          summary: match.summary,
          markdownPath: match.markdownPath,
          score: 1 - match.similarity,
          relatedChanges: this.getRelatedChanges(match.project, match.slug)
        }));

        if (embeddingResults.length > 0) {
          strategy.embeddingUsed = true;
          results = mergeResults(results, embeddingResults);
        }
      } catch {
        strategy.degraded = true;
      }
    }

    if (this.config.llm.enabled && this.options?.augmentor && results.length > 1) {
      try {
        results = await this.options.augmentor.rerankResults(input, results, expansion);
        strategy.reranked = true;
      } catch {
        strategy.degraded = true;
      }
    }

    return {
      results: results.slice(0, input.limit ?? 10),
      strategy
    };
  }

  private runLocalSearch(
    query: string,
    input: SearchInput,
    resolvedProjectId: string | null
  ): SearchResult[] {
    const conditions = ["pages_fts MATCH ?"];
    const values: Array<string | number> = [buildFtsQuery(query)];

    if (!input.global && resolvedProjectId) {
      conditions.push("pages.project = ?");
      values.push(resolvedProjectId);
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

    const localLimit = Math.max(input.limit ?? 10, 20);
    values.push(localLimit);

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
        WHERE ${conditions.join(" AND ")}
        ORDER BY
          CASE WHEN pages.type = 'change' THEN 1 ELSE 0 END,
          score ASC,
          pages.updated_at DESC
        LIMIT ?
      `)
      .all(...values) as LocalRow[];

    return rows.map((row) => ({
      project: row.project,
      slug: row.slug,
      type: row.type,
      title: row.title,
      summary: row.summary,
      markdownPath: row.markdown_path,
      score: row.score,
      relatedChanges: this.getRelatedChanges(row.project, row.slug)
    }));
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
