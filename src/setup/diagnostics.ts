import { constants } from "node:fs";
import path from "node:path";
import { access, stat } from "node:fs/promises";
import { loadConfig, resolveConfigPath, type LoadedConfig } from "../config/load-config.js";
import type { BrainCodeConfig, EmbeddingConfig, LlmConfig } from "../config/schema.js";

export type DiagnosticLevel = "ok" | "warning" | "error";

export type DiagnosticCheck = {
  level: DiagnosticLevel;
  code: string;
  message: string;
};

export type DoctorReport = {
  configPath: string;
  config?: BrainCodeConfig;
  checks: DiagnosticCheck[];
};

function check(level: DiagnosticLevel, code: string, message: string): DiagnosticCheck {
  return { level, code, message };
}

async function pathExists(inputPath: string): Promise<boolean> {
  try {
    await stat(inputPath);
    return true;
  } catch {
    return false;
  }
}

async function writableDirectory(inputPath: string): Promise<boolean> {
  try {
    await access(inputPath, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function providerEnvForLlm(config: LlmConfig): string | undefined {
  const providerId = config.routing.search ?? config.provider;
  if (providerId) {
    return config.providers[providerId]?.apiKeyEnv;
  }
  return config.api?.apiKeyEnv;
}

function providerEnvForEmbedding(config: EmbeddingConfig): string | undefined {
  const providerId = config.routing.search ?? config.provider;
  if (providerId) {
    return config.providers[providerId]?.apiKeyEnv;
  }
  return config.api?.apiKeyEnv;
}

function isLocalHost(host: string): boolean {
  return ["localhost", "127.0.0.1", "::1"].includes(host);
}

function addEnvCheck(checks: DiagnosticCheck[], envName: string | undefined, code: string, label: string): void {
  if (!envName) {
    checks.push(check("warning", code, `${label} is enabled but no environment variable name is configured.`));
    return;
  }

  if (!process.env[envName]) {
    checks.push(check("warning", code, `${label} expects environment variable ${envName}, but it is not set.`));
    return;
  }

  checks.push(check("ok", code, `${label} environment variable ${envName} is set.`));
}

async function diagnoseLoadedConfig(loaded: LoadedConfig): Promise<DiagnosticCheck[]> {
  const checks: DiagnosticCheck[] = [];
  const config = loaded.config;

  checks.push(
    loaded.exists
      ? check("ok", "config_exists", `Config file exists at ${loaded.path}.`)
      : check("warning", "config_missing", `Config file does not exist yet at ${loaded.path}.`)
  );

  const brainRepoExists = await pathExists(config.brain.repo);
  checks.push(
    brainRepoExists
      ? check("ok", "brain_repo_exists", `Brain repo exists at ${config.brain.repo}.`)
      : check("warning", "brain_repo_missing", `Brain repo does not exist yet at ${config.brain.repo}.`)
  );

  const indexParent = path.dirname(config.brain.indexDb);
  checks.push(
    (await writableDirectory(indexParent))
      ? check("ok", "index_parent_writable", `Index DB parent is writable at ${indexParent}.`)
      : check("warning", "index_parent_unavailable", `Index DB parent is not writable or does not exist: ${indexParent}.`)
  );

  if (config.projects.length === 0) {
    checks.push(check("warning", "no_projects", "No projects are registered yet."));
  }

  for (const project of config.projects) {
    if (project.roots.length === 0) {
      checks.push(check("warning", "project_no_local_roots", `Project '${project.id}' has no local roots.`));
      continue;
    }

    for (const root of project.roots) {
      checks.push(
        (await pathExists(root))
          ? check("ok", "project_root_exists", `Project '${project.id}' root exists: ${root}.`)
          : check("warning", "project_root_missing", `Project '${project.id}' root does not exist: ${root}.`)
      );
    }
  }

  if (config.llm.enabled) {
    addEnvCheck(checks, providerEnvForLlm(config.llm), "llm_env", "LLM search");
  } else {
    checks.push(check("ok", "llm_disabled", "LLM search is disabled; local FTS5 fallback is available."));
  }

  if (config.embedding.enabled) {
    addEnvCheck(checks, providerEnvForEmbedding(config.embedding), "embedding_env", "Embedding search");
  } else {
    checks.push(check("ok", "embedding_disabled", "Embedding search is disabled."));
  }

  if (config.remote.url) {
    addEnvCheck(checks, config.remote.tokenEnv, "remote_token_env", "Remote sync");
  }

  if (!isLocalHost(config.server.host) && !config.server.authTokenEnv) {
    checks.push(
      check("error", "server_token_required", "Remote server binding outside localhost requires server.auth_token_env.")
    );
  } else if (config.server.authTokenEnv) {
    addEnvCheck(checks, config.server.authTokenEnv, "server_token_env", "Remote HTTP server");
  }

  return checks;
}

export async function runDoctor(configPath?: string): Promise<DoctorReport> {
  const resolvedPath = resolveConfigPath(configPath);
  try {
    const loaded = await loadConfig(configPath);
    return {
      configPath: loaded.path,
      config: loaded.config,
      checks: await diagnoseLoadedConfig(loaded)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      configPath: resolvedPath,
      checks: [check("error", "config_invalid", `Unable to load config: ${message}`)]
    };
  }
}

export function formatDoctorReport(report: DoctorReport): string {
  const counts = {
    ok: report.checks.filter((entry) => entry.level === "ok").length,
    warning: report.checks.filter((entry) => entry.level === "warning").length,
    error: report.checks.filter((entry) => entry.level === "error").length
  };

  return [
    `config_path: ${report.configPath}`,
    ...report.checks.map((entry) => `[${entry.level}] ${entry.code}: ${entry.message}`),
    `summary: ok=${counts.ok} warning=${counts.warning} error=${counts.error}`
  ].join("\n");
}
