import type { EmbeddingProvider } from "../embedding/provider.js";
import type { EmbeddingIndexRepository } from "../embedding/repository.js";
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

export type ReindexInput = {
  project?: string;
  full?: boolean;
};

export type ReindexResult = {
  projects: number;
  pages: number;
};

export type EmbeddingSyncOptions = {
  enabled: boolean;
  provider?: EmbeddingProvider;
  repository?: EmbeddingIndexRepository;
};

export interface PageService {
  putPage(input: PutPageInput): Promise<StoredPage>;
  getPage(project: string | undefined, slug: string): Promise<StoredPage | null>;
  listPages(input: ListPagesInput): ListedPage[];
  reindex(input: ReindexInput): Promise<ReindexResult>;
}
