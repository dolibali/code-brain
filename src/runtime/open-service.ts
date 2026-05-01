import type { BrainCodeConfig, ProjectRegistration } from "../config/schema.js";
import { loadConfig, upsertProject, writeConfig } from "../config/load-config.js";
import { OpenAiCompatibleEmbeddingProvider } from "../embedding/provider.js";
import { EmbeddingIndexRepository } from "../embedding/repository.js";
import { LinkRepository, type LinkService } from "../links/index.js";
import { OpenAiCompatibleClient } from "../llm/openai-compatible-client.js";
import { resolveSearchEmbeddingProvider, resolveSearchLlmProvider } from "../llm/provider-config.js";
import { PageRepository, type PageService } from "../pages/index.js";
import { ensureBrainDirectories } from "../projects/project-registry.js";
import { LlmSearchAugmentor } from "../search/augmentor.js";
import { SearchService, type SearchServicePort } from "../search/index.js";
import { openIndexDatabase } from "../storage/index-db.js";

export type ServiceContext = {
  configPath: string;
  config: BrainCodeConfig;
  pages: PageService;
  links: LinkService;
  search: SearchServicePort;
  upsertProjectMetadata: (project: ProjectRegistration) => Promise<void>;
  close: () => void;
};

export async function openService(configPath?: string): Promise<ServiceContext> {
  const loaded = await loadConfig(configPath);
  await ensureBrainDirectories(loaded.config);
  const index = await openIndexDatabase(loaded.config);
  index.initialize();
  index.syncProjects();

  const embeddingRepository = new EmbeddingIndexRepository(index);
  let searchAugmentor: LlmSearchAugmentor | undefined;
  let embeddingProvider: OpenAiCompatibleEmbeddingProvider | undefined;

  if (loaded.config.llm.enabled) {
    try {
      searchAugmentor = new LlmSearchAugmentor(
        new OpenAiCompatibleClient(resolveSearchLlmProvider(loaded.config))
      );
    } catch {
      searchAugmentor = undefined;
    }
  }

  if (loaded.config.embedding.enabled) {
    try {
      embeddingProvider = new OpenAiCompatibleEmbeddingProvider(
        new OpenAiCompatibleClient(resolveSearchEmbeddingProvider(loaded.config)),
        loaded.config.embedding
      );
    } catch {
      embeddingProvider = undefined;
    }
  }

  const pages = new PageRepository(loaded.config, index, {
    enabled: loaded.config.embedding.enabled,
    provider: embeddingProvider,
    repository: embeddingRepository
  });
  const links = new LinkRepository(index);
  const search = new SearchService(loaded.config, index, {
    augmentor: searchAugmentor,
    embeddingProvider,
    embeddingRepository
  });

  const upsertProjectMetadata = async (project: ProjectRegistration): Promise<void> => {
    const nextConfig = upsertProject(loaded.config, project);
    const savedPath = await writeConfig({
      path: loaded.path,
      config: nextConfig
    });
    const nextLoaded = await loadConfig(savedPath);
    Object.assign(loaded.config, nextLoaded.config);
    await ensureBrainDirectories(loaded.config);
    index.syncProjects();
  };

  return {
    configPath: loaded.path,
    config: loaded.config,
    pages,
    links,
    search,
    upsertProjectMetadata,
    close: () => index.close()
  };
}
