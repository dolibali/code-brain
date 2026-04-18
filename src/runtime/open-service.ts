import { LinkRepository } from "../links/repository.js";
import type { CodeBrainConfig } from "../config/schema.js";
import { loadConfig } from "../config/load-config.js";
import { PageRepository } from "../pages/repository.js";
import { ensureBrainDirectories } from "../projects/project-registry.js";
import { SearchService } from "../search/search-service.js";
import { openIndexDatabase } from "../storage/index-db.js";

export type ServiceContext = {
  configPath: string;
  config: CodeBrainConfig;
  pages: PageRepository;
  links: LinkRepository;
  search: SearchService;
  close: () => void;
};

export async function openService(configPath?: string): Promise<ServiceContext> {
  const loaded = await loadConfig(configPath);
  await ensureBrainDirectories(loaded.config);
  const index = await openIndexDatabase(loaded.config);
  index.initialize();
  index.syncProjects();

  const pages = new PageRepository(loaded.config, index);
  const links = new LinkRepository(index);
  const search = new SearchService(loaded.config, index);

  return {
    configPath: loaded.path,
    config: loaded.config,
    pages,
    links,
    search,
    close: () => index.close()
  };
}

