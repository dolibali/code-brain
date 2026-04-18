import os from "node:os";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import YAML from "yaml";
import { z } from "zod";
import {
  CodeBrainConfigSchema,
  type CodeBrainConfig,
  type ProjectRegistration
} from "./schema.js";

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
      models: {},
      providers: {},
      routing: {},
      request: {
        extraBody: {}
      },
      timeoutMs: 8000,
      retries: 2
    },
    mcp: {
      name: "code-brain",
      version: "0.1.0"
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

function normalizeConfigShape(normalized: unknown): Record<string, unknown> {
  const record =
    normalized !== null && typeof normalized === "object"
      ? (normalized as Record<string, unknown>)
      : {};

  const projects = Array.isArray(record.projects)
    ? record.projects.map((project) => normalizeProjectRegistration(project as RawProjectRegistration))
    : [];
  const llm = normalizeLlmConfig(record.llm as RawLlmConfig | undefined);

  return {
    ...record,
    projects,
    llm
  };
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
      roots: project.roots.map((root) => resolvePathValue(root, configFilePath))
    }))
  };
}

export async function loadConfig(explicitPath?: string): Promise<LoadedConfig> {
  const resolvedPath = resolveConfigPath(explicitPath);
  const defaults = getDefaultConfig();

  try {
    const raw = await readFile(resolvedPath, "utf8");
    const normalized = normalizeKeysDeep(YAML.parse(raw) ?? {});
    const normalizedRecord = normalizeConfigShape(normalized);
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
      },
      llm: {
        ...defaults.llm,
        ...(normalizedRecord.llm as Record<string, unknown> | undefined)
      },
      mcp: {
        ...defaults.mcp,
        ...(normalizedRecord.mcp as Record<string, unknown> | undefined)
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
    mcp: {
      name: config.mcp.name,
      version: config.mcp.version
    }
  });

  await writeFile(resolvedPath, serialized, "utf8");
  return resolvedPath;
}

export function upsertProject(config: CodeBrainConfig, project: ProjectRegistration): CodeBrainConfig {
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

