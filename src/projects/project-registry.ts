import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { CodeBrainConfig, ProjectRegistration } from "../config/schema.js";
import { loadConfig, upsertProject, writeConfig, type LoadedConfig } from "../config/load-config.js";

export type RegisterProjectInput = {
  id: string;
  root: string;
  remotes: string[];
  title?: string;
  mainBranch?: string;
  configPath?: string;
};

export async function ensureBrainDirectories(config: CodeBrainConfig): Promise<void> {
  await mkdir(config.brain.repo, { recursive: true });
  await mkdir(path.dirname(config.brain.indexDb), { recursive: true });
}

export async function loadProjectRegistry(configPath?: string): Promise<LoadedConfig> {
  return loadConfig(configPath);
}

export async function registerProject(input: RegisterProjectInput): Promise<LoadedConfig> {
  const loaded = await loadConfig(input.configPath);
  const nextProject: ProjectRegistration = {
    id: input.id,
    title: input.title,
    mainBranch: input.mainBranch ?? "main",
    roots: [input.root],
    gitRemotes: input.remotes
  };

  const nextConfig = upsertProject(loaded.config, nextProject);
  const savedPath = await writeConfig({
    path: input.configPath,
    config: nextConfig
  });

  const nextLoaded = await loadConfig(savedPath);
  await ensureBrainDirectories(nextLoaded.config);
  return nextLoaded;
}

