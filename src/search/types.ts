import type { PageType, ScopeRef } from "../pages/schema.js";

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

export type SearchStrategy = {
  queryExpansionUsed: boolean;
  reranked: boolean;
  embeddingUsed: boolean;
  degraded: boolean;
};

export type SearchResponse = {
  results: SearchResult[];
  strategy: SearchStrategy;
};

export interface SearchServicePort {
  search(input: SearchInput): Promise<SearchResponse>;
}
