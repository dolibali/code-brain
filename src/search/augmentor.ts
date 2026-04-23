import { z } from "zod";
import { OpenAiCompatibleClient } from "../llm/openai-compatible-client.js";
import type { SearchInput, SearchResult } from "./types.js";

const ScopeKindSchema = z.enum(["repo", "module", "file", "symbol"]);

const QueryExpansionSchema = z.object({
  queries: z.array(z.string().min(1)).default([]),
  preferred_types: z
    .array(z.enum(["issue", "architecture", "decision", "practice", "change"]))
    .default([]),
  scope_refs: z
    .array(
      z.object({
        kind: ScopeKindSchema,
        value: z.string().min(1)
      })
    )
    .default([])
});

const RerankSchema = z.object({
  ordered_slugs: z.array(z.string().min(1)).default([])
});

export type QueryExpansion = z.infer<typeof QueryExpansionSchema>;

export type SearchAugmentor = {
  expandQuery: (input: SearchInput) => Promise<QueryExpansion>;
  rerankResults: (
    input: SearchInput,
    results: SearchResult[],
    expansion: QueryExpansion
  ) => Promise<SearchResult[]>;
};

function extractJsonObject(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("LLM did not return a JSON object.");
  }

  return raw.slice(start, end + 1);
}

function dedupeQueries(input: string, queries: string[]): string[] {
  return [...new Set([input, ...queries.map((entry) => entry.trim()).filter((entry) => entry.length > 0)])];
}

export class LlmSearchAugmentor implements SearchAugmentor {
  constructor(private readonly client: OpenAiCompatibleClient) {}

  async expandQuery(input: SearchInput): Promise<QueryExpansion> {
    const raw = await this.client.createChatCompletion({
      messages: [
        {
          role: "system",
          content:
            "You help a code knowledge search engine. Return only one JSON object with keys queries, preferred_types, and scope_refs. Expand the search query without changing user intent."
        },
        {
          role: "user",
          content: JSON.stringify({
            query: input.query,
            project: input.project,
            types: input.types ?? [],
            scope_refs: input.scopeRefs ?? []
          })
        }
      ]
    });

    const parsed = QueryExpansionSchema.parse(JSON.parse(extractJsonObject(raw)));
    return {
      ...parsed,
      queries: dedupeQueries(input.query, parsed.queries)
    };
  }

  async rerankResults(
    input: SearchInput,
    results: SearchResult[],
    expansion: QueryExpansion
  ): Promise<SearchResult[]> {
    if (results.length <= 1) {
      return results;
    }

    const raw = await this.client.createChatCompletion({
      messages: [
        {
          role: "system",
          content:
            "You rerank code knowledge search results. Return only one JSON object with ordered_slugs. Prefer stable long-lived knowledge pages over change pages when both are relevant."
        },
        {
          role: "user",
          content: JSON.stringify({
            query: input.query,
            expanded_queries: expansion.queries,
            preferred_types: expansion.preferred_types,
            candidates: results.map((result) => ({
              slug: result.slug,
              type: result.type,
              title: result.title,
              summary: result.summary,
              related_changes: result.relatedChanges
            }))
          })
        }
      ]
    });

    const parsed = RerankSchema.parse(JSON.parse(extractJsonObject(raw)));
    if (parsed.ordered_slugs.length === 0) {
      return results;
    }

    const ranking = new Map(parsed.ordered_slugs.map((slug, index) => [slug, index]));
    return [...results].sort((left, right) => {
      const leftRank = ranking.get(left.slug);
      const rightRank = ranking.get(right.slug);

      if (leftRank !== undefined && rightRank !== undefined) {
        return leftRank - rightRank;
      }

      if (leftRank !== undefined) {
        return -1;
      }

      if (rightRank !== undefined) {
        return 1;
      }

      return left.score - right.score;
    });
  }
}
