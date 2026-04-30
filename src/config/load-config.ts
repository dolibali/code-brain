import os from "node:os";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import YAML from "yaml";
import { z } from "zod";
import {
  BrainCodeConfigSchema,
  type BrainCodeConfig,
  type ProjectRegistration
} from "./schema.js";

export const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".braincode", "config.yaml");

export type LoadedConfig = {
  path: string;
  exists: boolean;
  config: BrainCodeConfig;
};

type ConfigWriteInput = {
  path?: string;
  config: BrainCodeConfig;
};

type RawProjectRegistration = {
  id?: unknown;
  title?: unknown;
  mainBranch?: unknown;
  roots?: unknown;
  root?: unknown;
  gitRemotes?: unknown;
  remotes?: unknown;
};

type RawLlmConfig = {
  provider?: unknown;
  defaultProvider?: unknown;
  api?: unknown;
  models?: unknown;
  providers?: unknown;
  routing?: unknown;
  request?: unknown;
  timeoutMs?: unknown;
  retries?: unknown;
  enabled?: unknown;
};

type RawEmbeddingConfig = {
  provider?: unknown;
  defaultProvider?: unknown;
  api?: unknown;
  providers?: unknown;
  routing?: unknown;
  model?: unknown;
  dimensions?: unknown;
  timeoutMs?: unknown;
  retries?: unknown;
  enabled?: unknown;
};

export function getDefaultConfig(configFilePath = DEFAULT_CONFIG_PATH): BrainCodeConfig {
  const home = os.homedir();
  const usePortableDefaults = path.resolve(configFilePath) !== path.resolve(DEFAULT_CONFIG_PATH);
  return {
    brain: {
      repo: usePortableDefaults ? "./brain" : path.join(home, ".braincode", "brain"),
      indexDb: usePortableDefaults ? "./state/index.sqlite" : path.join(home, ".braincode", "index.sqlite")
    },
    projects: [],
    llm: {
      enabled: false,
      models: {},
      providers: {},
      routing: {},
      request: {
        extraBody: {}
      },
      timeoutMs: 8000,
      retries: 2
    },
    embedding: {
      enabled: false,
      providers: {},
      routing: {},
      timeoutMs: 8000,
      retries: 2
    },
    mcp: {
      name: "braincode",
      version: "0.2.0"
    },
    server: {
      host: "127.0.0.1",
      port: 7331,
      maxBodyMb: 20
    },
    remote: {},
    sync: {
      concurrency: 8,
      compression: "gzip",
      pruneOnPull: true
    }
  };
}

export function resolveConfigPath(explicitPath?: string): string {
  return explicitPath ?? process.env.BRAINCODE_CONFIG ?? DEFAULT_CONFIG_PATH;
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

function normalizeProjectRegistration(project: RawProjectRegistration): ProjectRegistration {
  const roots = Array.isArray(project.roots)
    ? project.roots
    : typeof project.root === "string"
      ? [project.root]
      : [];
  const gitRemotes = Array.isArray(project.gitRemotes)
    ? project.gitRemotes
    : Array.isArray(project.remotes)
      ? project.remotes
      : [];

  return {
    id: z.string().min(1).parse(project.id),
    title: typeof project.title === "string" ? project.title : undefined,
    mainBranch: typeof project.mainBranch === "string" ? project.mainBranch : "main",
    roots: z.array(z.string().min(1)).min(1).parse(roots),
    gitRemotes: z.array(z.string().min(1)).parse(gitRemotes)
  };
}

function normalizeLlmConfig(raw: RawLlmConfig | undefined): Record<string, unknown> {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  return {
    ...raw,
    provider: typeof raw.provider === "string" ? raw.provider : raw.defaultProvider,
    routing:
      raw.routing && typeof raw.routing === "object"
        ? {
            search:
              typeof (raw.routing as Record<string, unknown>).search === "string"
                ? (raw.routing as Record<string, unknown>).search
                : undefined
          }
        : undefined
  };
}

function normalizeEmbeddingConfig(raw: RawEmbeddingConfig | undefined): Record<string, unknown> {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  return {
    ...raw,
    provider: typeof raw.provider === "string" ? raw.provider : raw.defaultProvider,
    routing:
      raw.routing && typeof raw.routing === "object"
        ? {
            search:
              typeof (raw.routing as Record<string, unknown>).search === "string"
                ? (raw.routing as Record<string, unknown>).search
                : undefined
          }
        : undefined
  };
}

function normalizeConfigShape(normalized: unknown): Record<string, unknown> {
  const record =
    normalized !== null && typeof normalized === "object"
      ? (normalized as Record<string, unknown>)
      : {};

  const projects = Array.isArray(record.projects)
    ? record.projects.map((project) => normalizeProjectRegistration(project as RawProjectRegistration))
    : [];
  const llm = normalizeLlmConfig(record.llm as RawLlmConfig | undefined);
  const embedding = normalizeEmbeddingConfig(record.embedding as RawEmbeddingConfig | undefined);

  return {
    ...record,
    projects,
    llm,
    embedding
  };
}

function normalizeConfigPaths(config: BrainCodeConfig, configFilePath: string): BrainCodeConfig {
  return {
    ...config,
    brain: {
      repo: resolvePathValue(config.brain.repo, configFilePath),
      indexDb: resolvePathValue(config.brain.indexDb, configFilePath)
    },
    projects: config.projects.map((project) => ({
      ...project,
      roots: project.roots.map((root) => resolvePathValue(root, configFilePath))
    }))
  };
}

export async function loadConfig(explicitPath?: string): Promise<LoadedConfig> {
  const resolvedPath = resolveConfigPath(explicitPath);
  const defaults = getDefaultConfig(resolvedPath);

  try {
    const raw = await readFile(resolvedPath, "utf8");
    const normalized = normalizeKeysDeep(YAML.parse(raw) ?? {});
    const normalizedRecord = normalizeConfigShape(normalized);
    const normalizedBrain =
      normalizedRecord.brain !== null && typeof normalizedRecord.brain === "object"
        ? (normalizedRecord.brain as Record<string, unknown>)
        : {};
    const parsed = BrainCodeConfigSchema.parse({
      ...defaults,
      ...normalizedRecord,
      brain: {
        ...defaults.brain,
        ...normalizedBrain
      },
      llm: {
        ...defaults.llm,
        ...(normalizedRecord.llm as Record<string, unknown> | undefined)
      },
      embedding: {
        ...defaults.embedding,
        ...(normalizedRecord.embedding as Record<string, unknown> | undefined)
      },
      mcp: {
        ...defaults.mcp,
        ...(normalizedRecord.mcp as Record<string, unknown> | undefined)
      },
      server: {
        ...defaults.server,
        ...(normalizedRecord.server as Record<string, unknown> | undefined)
      },
      remote: {
        ...defaults.remote,
        ...(normalizedRecord.remote as Record<string, unknown> | undefined)
      },
      sync: {
        ...defaults.sync,
        ...(normalizedRecord.sync as Record<string, unknown> | undefined)
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
        config: normalizeConfigPaths(defaults, resolvedPath)
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
      title: project.title,
      main_branch: project.mainBranch,
      roots: project.roots,
      git_remotes: project.gitRemotes
    })),
    llm: {
      enabled: config.llm.enabled,
      provider: config.llm.provider,
      api: config.llm.api
        ? {
            mode: config.llm.api.mode,
            base_url: config.llm.api.baseUrl,
            api_key_env: config.llm.api.apiKeyEnv,
            default_model: config.llm.api.defaultModel
          }
        : undefined,
      models: {
        search: config.llm.models.search
          ? {
              model: config.llm.models.search.model
            }
          : undefined
      },
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
      routing: {
        search: config.llm.routing.search
      },
      request: {
        extra_body: config.llm.request.extraBody
      },
      timeout_ms: config.llm.timeoutMs,
      retries: config.llm.retries
    },
    embedding: {
      enabled: config.embedding.enabled,
      provider: config.embedding.provider,
      api: config.embedding.api
        ? {
            mode: config.embedding.api.mode,
            base_url: config.embedding.api.baseUrl,
            api_key_env: config.embedding.api.apiKeyEnv,
            default_model: config.embedding.api.defaultModel
          }
        : undefined,
      model: config.embedding.model,
      providers: Object.fromEntries(
        Object.entries(config.embedding.providers).map(([name, provider]) => [
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
      routing: {
        search: config.embedding.routing.search
      },
      dimensions: config.embedding.dimensions,
      timeout_ms: config.embedding.timeoutMs,
      retries: config.embedding.retries
    },
    mcp: {
      name: config.mcp.name,
      version: config.mcp.version
    },
    server: {
      host: config.server.host,
      port: config.server.port,
      auth_token_env: config.server.authTokenEnv,
      max_body_mb: config.server.maxBodyMb
    },
    remote: {
      url: config.remote.url,
      token_env: config.remote.tokenEnv
    },
    sync: {
      concurrency: config.sync.concurrency,
      compression: config.sync.compression,
      prune_on_pull: config.sync.pruneOnPull
    }
  });

  await writeFile(resolvedPath, serialized, "utf8");
  return resolvedPath;
}

export function upsertProject(config: BrainCodeConfig, project: ProjectRegistration): BrainCodeConfig {
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
