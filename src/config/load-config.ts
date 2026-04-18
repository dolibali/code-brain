import os from "node:os";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import YAML from "yaml";
import { CodeBrainConfigSchema, type CodeBrainConfig, type ProjectRegistration } from "./schema.js";

export const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".code-brain", "config.yaml");

export type LoadedConfig = {
  path: string;
  exists: boolean;
  config: CodeBrainConfig;
};

type ConfigWriteInput = {
  path?: string;
  config: CodeBrainConfig;
};

export function getDefaultConfig(): CodeBrainConfig {
  const home = os.homedir();
  return {
    brain: {
      repo: path.join(home, ".code-brain", "brain"),
      indexDb: path.join(home, ".code-brain", "index.sqlite")
    },
    projects: [],
    llm: {
      enabled: false,
      providers: {},
      routing: {}
    }
  };
}

export function resolveConfigPath(explicitPath?: string): string {
  return explicitPath ?? process.env.CODE_BRAIN_CONFIG ?? DEFAULT_CONFIG_PATH;
}

function expandHome(inputPath: string): string {
  if (inputPath === "~") {
    return os.homedir();
  }

  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  return inputPath;
}

function resolvePathValue(value: string, configFilePath: string): string {
  const expanded = expandHome(value);
  if (path.isAbsolute(expanded)) {
    return expanded;
  }

  return path.resolve(path.dirname(configFilePath), expanded);
}

function toCamelCase(key: string): string {
  return key.replace(/[_-]([a-z])/g, (_, character: string) => character.toUpperCase());
}

function normalizeKeysDeep(value: unknown, pathSegments: string[] = []): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeKeysDeep(item, pathSegments));
  }

  if (value instanceof Date) {
    return value;
  }

  if (value !== null && typeof value === "object") {
    const preserveChildKeys = pathSegments.at(-1) === "providers";
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        preserveChildKeys ? key : toCamelCase(key),
        normalizeKeysDeep(entry, [...pathSegments, preserveChildKeys ? key : toCamelCase(key)])
      ])
    );
  }

  return value;
}

function normalizeConfigPaths(config: CodeBrainConfig, configFilePath: string): CodeBrainConfig {
  return {
    ...config,
    brain: {
      repo: resolvePathValue(config.brain.repo, configFilePath),
      indexDb: resolvePathValue(config.brain.indexDb, configFilePath)
    },
    projects: config.projects.map((project) => ({
      ...project,
      root: resolvePathValue(project.root, configFilePath)
    }))
  };
}

export async function loadConfig(explicitPath?: string): Promise<LoadedConfig> {
  const resolvedPath = resolveConfigPath(explicitPath);
  const defaults = getDefaultConfig();

  try {
    const raw = await readFile(resolvedPath, "utf8");
    const normalized = normalizeKeysDeep(YAML.parse(raw) ?? {});
    const normalizedRecord =
      normalized !== null && typeof normalized === "object"
        ? (normalized as Record<string, unknown>)
        : {};
    const normalizedBrain =
      normalizedRecord.brain !== null && typeof normalizedRecord.brain === "object"
        ? (normalizedRecord.brain as Record<string, unknown>)
        : {};
    const parsed = CodeBrainConfigSchema.parse({
      ...defaults,
      ...normalizedRecord,
      brain: {
        ...defaults.brain,
        ...normalizedBrain
      }
    });

    return {
      path: resolvedPath,
      exists: true,
      config: normalizeConfigPaths(parsed, resolvedPath)
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        path: resolvedPath,
        exists: false,
        config: defaults
      };
    }

    throw error;
  }
}

export async function writeConfig({ path: explicitPath, config }: ConfigWriteInput): Promise<string> {
  const resolvedPath = resolveConfigPath(explicitPath);
  await mkdir(path.dirname(resolvedPath), { recursive: true });
  const serialized = YAML.stringify({
    brain: {
      repo: config.brain.repo,
      index_db: config.brain.indexDb
    },
    projects: config.projects.map((project) => ({
      id: project.id,
      root: project.root,
      remotes: project.remotes,
      description: project.description
    })),
    llm: {
      enabled: config.llm.enabled,
      default_provider: config.llm.defaultProvider,
      providers: Object.fromEntries(
        Object.entries(config.llm.providers).map(([name, provider]) => [
          name,
          {
            mode: provider.mode,
            base_url: provider.baseUrl,
            api_key_env: provider.apiKeyEnv,
            default_model: provider.defaultModel,
            capabilities: provider.capabilities
          }
        ])
      ),
      routing: config.llm.routing
    }
  });

  await writeFile(resolvedPath, serialized, "utf8");
  return resolvedPath;
}

export function upsertProject(
  config: CodeBrainConfig,
  project: ProjectRegistration
): CodeBrainConfig {
  const existing = config.projects.findIndex((entry) => entry.id === project.id);
  if (existing === -1) {
    return {
      ...config,
      projects: [...config.projects, project]
    };
  }

  const nextProjects = [...config.projects];
  nextProjects[existing] = project;
  return {
    ...config,
    projects: nextProjects
  };
}
