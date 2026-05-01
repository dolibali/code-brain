import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { randomBytes } from "node:crypto";
import type { Interface } from "node:readline/promises";
import {
  getDefaultConfig,
  loadConfig,
  upsertProject,
  writeConfig,
  type LoadedConfig
} from "../config/load-config.js";
import type { BrainCodeConfig, ProviderPreset } from "../config/schema.js";
import { getEnvFilePath, writeEnvValues } from "../config/env-file.js";
import { ensureBrainDirectories } from "../projects/project-registry.js";
import { openIndexDatabase } from "../storage/index-db.js";
import { detectGitDefaults, type GitDefaults } from "./git-detect.js";
import {
  CUSTOM_PROVIDER_ID,
  EMBEDDING_PROVIDER_PRESETS,
  LLM_PROVIDER_PRESETS,
  providerIds
} from "./presets.js";
import { formatDoctorReport, runDoctor } from "./diagnostics.js";

export type RemoteMode = "none" | "client" | "server" | "both";

export type SetupOptions = {
  configPath?: string;
  force?: boolean;
  nonInteractive?: boolean;
  brainRepo?: string;
  indexDb?: string;
  projectName?: string;
  projectPath?: string;
  projectUrl?: string[];
  branch?: string;
  title?: string;
  enableLlm?: boolean;
  llmProvider?: string;
  llmBaseUrl?: string;
  llmApiKeyEnv?: string;
  llmModel?: string;
  enableEmbedding?: boolean;
  embeddingProvider?: string;
  embeddingBaseUrl?: string;
  embeddingApiKeyEnv?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  remoteMode?: RemoteMode;
  remoteUrl?: string;
  remoteTokenEnv?: string;
  serverHost?: string;
  serverPort?: number;
  serverTokenEnv?: string;
  maxBodyMb?: number;
};

export type SetupResult = {
  configPath: string;
  config: BrainCodeConfig;
  envFilePath: string;
  envFileUpdatedNames: string[];
  envHints: string[];
  doctorOutput: string;
};

type SetupBuildResult = {
  config: BrainCodeConfig;
  envUpdates: Record<string, string>;
};

function parseBoolean(inputValue: string, defaultValue: boolean): boolean {
  const normalized = inputValue.trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  return ["y", "yes", "true", "1"].includes(normalized);
}

async function promptText(
  rl: Interface,
  label: string,
  defaultValue?: string
): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = await rl.question(`${label}${suffix}: `);
  return answer.trim() || defaultValue || "";
}

async function promptConfirm(
  rl: Interface,
  label: string,
  defaultValue: boolean
): Promise<boolean> {
  const suffix = defaultValue ? " [Y/n]" : " [y/N]";
  const answer = await rl.question(`${label}${suffix}: `);
  return parseBoolean(answer, defaultValue);
}

async function promptSecret(
  rl: Interface,
  label: string,
  defaultValue?: string
): Promise<string> {
  if (!input.isTTY || !("setRawMode" in input)) {
    return promptText(rl, label, defaultValue);
  }

  return new Promise((resolve, reject) => {
    const wasRaw = input.isRaw;
    let value = "";
    output.write(`${label}${defaultValue ? " [configured]" : ""}: `);
    rl.pause();
    input.setRawMode(true);
    input.resume();

    const cleanup = (): void => {
      input.off("data", onData);
      input.setRawMode(wasRaw);
      rl.resume();
      output.write("\n");
    };

    const onData = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      if (text === "\u0003") {
        cleanup();
        reject(new Error("setup cancelled."));
        return;
      }
      if (text === "\r" || text === "\n" || text === "\r\n") {
        cleanup();
        resolve(value || defaultValue || "");
        return;
      }
      if (text === "\u007f" || text === "\b") {
        value = value.slice(0, -1);
        return;
      }
      value += text;
    };

    input.on("data", onData);
  });
}

function requireFields(options: SetupOptions, fields: Array<keyof SetupOptions>): void {
  const labels: Partial<Record<keyof SetupOptions, string>> = {
    projectName: "--project-name",
    projectPath: "--project-path",
    projectUrl: "--project-url",
    branch: "--branch"
  };
  const missing = fields.filter((field) => {
    const value = options[field];
    return value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
  });

  if (missing.length > 0) {
    throw new Error(
      `setup --non-interactive missing required option(s): ${missing.map((field) => labels[field] ?? field).join(", ")}`
    );
  }
}

function applyProviderPreset(input: {
  providerId: string;
  customBaseUrl?: string;
  customApiKeyEnv?: string;
  customModel?: string;
  presets: Record<string, ProviderPreset>;
  customCapability: ProviderPreset["capabilities"][number];
}): ProviderPreset {
  if (input.providerId === CUSTOM_PROVIDER_ID) {
    if (!input.customBaseUrl || !input.customApiKeyEnv || !input.customModel) {
      throw new Error(
        `${CUSTOM_PROVIDER_ID} requires base URL, API key environment variable, and model.`
      );
    }
    return {
      mode: "openai-compatible",
      baseUrl: input.customBaseUrl,
      apiKeyEnv: input.customApiKeyEnv,
      defaultModel: input.customModel,
      capabilities: [input.customCapability]
    };
  }

  const preset = input.presets[input.providerId];
  if (!preset) {
    throw new Error(`Unknown provider '${input.providerId}'.`);
  }
  return {
    ...preset,
    baseUrl: input.customBaseUrl ?? preset.baseUrl,
    apiKeyEnv: input.customApiKeyEnv ?? preset.apiKeyEnv,
    defaultModel: input.customModel ?? preset.defaultModel
  };
}

function configureLlm(config: BrainCodeConfig, options: SetupOptions): BrainCodeConfig {
  const providerId = options.llmProvider ?? "deepseek";
  const preset = applyProviderPreset({
    providerId,
    customBaseUrl: options.llmBaseUrl,
    customApiKeyEnv: options.llmApiKeyEnv,
    customModel: options.llmModel,
    presets: LLM_PROVIDER_PRESETS,
    customCapability: "chat_completions"
  });

  return {
    ...config,
    llm: {
      ...config.llm,
      enabled: true,
      provider: providerId,
      providers: {
        ...config.llm.providers,
        [providerId]: preset
      },
      routing: {
        ...config.llm.routing,
        search: providerId
      }
    }
  };
}

function configureEmbedding(config: BrainCodeConfig, options: SetupOptions): BrainCodeConfig {
  const providerId = options.embeddingProvider ?? "qwen_bailian";
  const preset = applyProviderPreset({
    providerId,
    customBaseUrl: options.embeddingBaseUrl,
    customApiKeyEnv: options.embeddingApiKeyEnv,
    customModel: options.embeddingModel,
    presets: EMBEDDING_PROVIDER_PRESETS,
    customCapability: "embeddings"
  });
  const presetDimensions = EMBEDDING_PROVIDER_PRESETS[providerId]?.dimensions;

  return {
    ...config,
    embedding: {
      ...config.embedding,
      enabled: true,
      provider: providerId,
      model: options.embeddingModel ?? preset.defaultModel,
      dimensions: options.embeddingDimensions ?? presetDimensions ?? config.embedding.dimensions,
      providers: {
        ...config.embedding.providers,
        [providerId]: preset
      },
      routing: {
        ...config.embedding.routing,
        search: providerId
      }
    }
  };
}

function configureRemote(config: BrainCodeConfig, options: SetupOptions): BrainCodeConfig {
  const mode = options.remoteMode;
  if (!mode) {
    return config;
  }

  if (mode === "none") {
    return {
      ...config,
      remote: {}
    };
  }

  const withServer =
    mode === "server" || mode === "both"
      ? {
          ...config.server,
          host: options.serverHost ?? config.server.host,
          port: options.serverPort ?? config.server.port,
          authTokenEnv: options.serverTokenEnv ?? config.server.authTokenEnv ?? "BRAINCODE_SERVER_TOKEN",
          maxBodyMb: options.maxBodyMb ?? config.server.maxBodyMb
        }
      : config.server;

  const withRemote =
    mode === "client" || mode === "both"
      ? {
          url: options.remoteUrl ?? config.remote.url,
          tokenEnv: options.remoteTokenEnv ?? config.remote.tokenEnv ?? "BRAINCODE_REMOTE_TOKEN"
        }
      : {};

  if ((mode === "client" || mode === "both") && !withRemote.url) {
    throw new Error(`remote mode '${mode}' requires --remote-url.`);
  }

  return {
    ...config,
    server: withServer,
    remote: withRemote,
    sync: {
      ...config.sync
    }
  };
}

function generateServerToken(): string {
  return randomBytes(32).toString("base64url");
}

function providerDefaults(input: {
  providerId: string;
  presets: Record<string, ProviderPreset>;
  existing?: ProviderPreset;
  customApiKeyEnv: string;
}): ProviderPreset {
  const preset = input.presets[input.providerId];
  return {
    mode: "openai-compatible",
    baseUrl: input.existing?.baseUrl ?? preset?.baseUrl ?? "",
    apiKeyEnv: input.existing?.apiKeyEnv ?? preset?.apiKeyEnv ?? input.customApiKeyEnv,
    defaultModel: input.existing?.defaultModel ?? preset?.defaultModel ?? "",
    capabilities: input.existing?.capabilities ?? preset?.capabilities ?? []
  };
}

function collectEnvHints(config: BrainCodeConfig): string[] {
  const hints: string[] = [];
  const seen = new Set<string>();
  const llmProvider = config.llm.routing.search ?? config.llm.provider;
  const embeddingProvider = config.embedding.routing.search ?? config.embedding.provider;
  const addHint = (envName: string | undefined, value: string): void => {
    if (!envName || process.env[envName] || seen.has(envName)) {
      return;
    }
    seen.add(envName);
    hints.push(`export ${envName}=\"${value}\"`);
  };

  if (config.llm.enabled && llmProvider) {
    const envName = config.llm.providers[llmProvider]?.apiKeyEnv;
    addHint(envName, "...");
  }

  if (config.embedding.enabled && embeddingProvider) {
    const envName = config.embedding.providers[embeddingProvider]?.apiKeyEnv;
    addHint(envName, "...");
  }

  addHint(config.server.authTokenEnv, generateServerToken());
  addHint(config.remote.tokenEnv, "...");

  return hints;
}

function printMcpSnippets(): string {
  return [
    "MCP stdio config snippet:",
    JSON.stringify(
      {
        braincode: {
          command: "braincode",
          args: ["serve"]
        }
      },
      null,
      2
    )
  ].join("\n");
}

async function initializeStorage(config: BrainCodeConfig): Promise<void> {
  await ensureBrainDirectories(config);
  const index = await openIndexDatabase(config);
  try {
    index.initialize();
    index.syncProjects();
  } finally {
    index.close();
  }
}

function baseConfig(loaded: LoadedConfig, options: SetupOptions): BrainCodeConfig {
  const source = loaded.exists && !options.force ? loaded.config : getDefaultConfig(options.configPath);
  return {
    ...source,
    brain: {
      repo: options.brainRepo ?? source.brain.repo,
      indexDb: options.indexDb ?? source.brain.indexDb
    }
  };
}

async function buildNonInteractiveConfig(
  loaded: LoadedConfig,
  options: SetupOptions
): Promise<SetupBuildResult> {
  requireFields(options, ["projectName", "projectPath"]);
  let config = baseConfig(loaded, options);

  config = upsertProject(config, {
    id: options.projectName!,
    title: options.title,
    mainBranch: options.branch ?? "main",
    roots: [options.projectPath!],
    gitRemotes: options.projectUrl ?? []
  });

  if (options.enableLlm || options.llmProvider) {
    config = configureLlm(config, options);
  } else if (!loaded.exists || options.force) {
    config = {
      ...config,
      llm: {
        ...config.llm,
        enabled: false
      }
    };
  }

  if (options.enableEmbedding || options.embeddingProvider) {
    config = configureEmbedding(config, options);
  } else if (!loaded.exists || options.force) {
    config = {
      ...config,
      embedding: {
        ...config.embedding,
        enabled: false
      }
    };
  }

  config = configureRemote(config, options);
  return {
    config,
    envUpdates: {}
  };
}

async function buildInteractiveConfig(
  loaded: LoadedConfig,
  options: SetupOptions,
  gitDefaults: GitDefaults
): Promise<SetupBuildResult | null> {
  const rl = createInterface({ input, output });
  const envUpdates: Record<string, string> = {};
  try {
    if (loaded.exists && !options.force) {
      const shouldContinue = await promptConfirm(rl, `Modify existing config at ${loaded.path}?`, true);
      if (!shouldContinue) {
        return null;
      }
    }

    let config = baseConfig(loaded, options);
    config = {
      ...config,
      brain: {
        repo: await promptText(rl, "Brain repo path", config.brain.repo),
        indexDb: await promptText(rl, "SQLite index DB path", config.brain.indexDb)
      }
    };

    const configureProject = await promptConfirm(rl, "Register or update a project?", true);
    if (configureProject) {
      const projectName = await promptText(rl, "Project name", gitDefaults.projectName);
      const projectPath = await promptText(rl, "Project path", gitDefaults.root);
      const projectUrl = await promptText(rl, "Git remote URL", gitDefaults.remote ?? "");
      const branch = await promptText(rl, "Main branch", gitDefaults.branch ?? "main");
      config = upsertProject(config, {
        id: projectName,
        mainBranch: branch,
        roots: [projectPath],
        gitRemotes: projectUrl ? [projectUrl] : []
      });
    }

    if (await promptConfirm(rl, "Enable search-side LLM?", config.llm.enabled)) {
      const provider = await promptText(
        rl,
        `LLM provider (${providerIds(LLM_PROVIDER_PRESETS)})`,
        config.llm.provider ?? "deepseek"
      );
      const defaults = providerDefaults({
        providerId: provider,
        presets: LLM_PROVIDER_PRESETS,
        existing: config.llm.providers[provider],
        customApiKeyEnv: "LLM_API_KEY"
      });
      const llmOptions: SetupOptions = {
        ...options,
        llmProvider: provider,
        enableLlm: true,
        llmBaseUrl: await promptText(rl, "LLM OpenAI-compatible base URL", defaults.baseUrl),
        llmApiKeyEnv: await promptText(rl, "LLM API key env", defaults.apiKeyEnv),
        llmModel: await promptText(rl, "LLM model", defaults.defaultModel)
      };
      const llmApiKeyEnv = llmOptions.llmApiKeyEnv ?? defaults.apiKeyEnv;
      const apiKey = await promptSecret(
        rl,
        `LLM API key for ${llmApiKeyEnv} (stored in ${getEnvFilePath(loaded.path)}, leave blank to skip)`,
        process.env[llmApiKeyEnv]
      );
      if (apiKey && apiKey !== process.env[llmApiKeyEnv]) {
        envUpdates[llmApiKeyEnv] = apiKey;
      }
      config = configureLlm(config, llmOptions);
    } else {
      config = { ...config, llm: { ...config.llm, enabled: false } };
    }

    if (await promptConfirm(rl, "Enable embedding search?", config.embedding.enabled)) {
      const provider = await promptText(
        rl,
        `Embedding provider (${providerIds(EMBEDDING_PROVIDER_PRESETS)})`,
        config.embedding.provider ?? "qwen_bailian"
      );
      const defaults = providerDefaults({
        providerId: provider,
        presets: EMBEDDING_PROVIDER_PRESETS,
        existing: config.embedding.providers[provider],
        customApiKeyEnv: "EMBEDDING_API_KEY"
      });
      const presetDimensions = EMBEDDING_PROVIDER_PRESETS[provider]?.dimensions ?? config.embedding.dimensions;
      const embeddingOptions: SetupOptions = {
        ...options,
        embeddingProvider: provider,
        enableEmbedding: true,
        embeddingBaseUrl: await promptText(rl, "Embedding OpenAI-compatible base URL", defaults.baseUrl),
        embeddingApiKeyEnv: await promptText(rl, "Embedding API key env", defaults.apiKeyEnv),
        embeddingModel: await promptText(rl, "Embedding model", defaults.defaultModel),
        embeddingDimensions: Number(
          await promptText(rl, "Embedding dimensions", presetDimensions ? String(presetDimensions) : "")
        ) || undefined
      };
      const embeddingApiKeyEnv = embeddingOptions.embeddingApiKeyEnv ?? defaults.apiKeyEnv;
      const apiKey = await promptSecret(
        rl,
        `Embedding API key for ${embeddingApiKeyEnv} (stored in ${getEnvFilePath(loaded.path)}, leave blank to skip)`,
        process.env[embeddingApiKeyEnv]
      );
      if (apiKey && apiKey !== process.env[embeddingApiKeyEnv]) {
        envUpdates[embeddingApiKeyEnv] = apiKey;
      }
      config = configureEmbedding(config, embeddingOptions);
    } else {
      config = { ...config, embedding: { ...config.embedding, enabled: false } };
    }

    const remoteMode = (await promptText(rl, "Remote sync mode (none/client/server/both)", "none")) as RemoteMode;
    const remoteOptions: SetupOptions = { ...options, remoteMode };
    if (remoteMode === "client" || remoteMode === "both") {
      remoteOptions.remoteUrl = await promptText(rl, "Remote server URL", config.remote.url ?? "");
      remoteOptions.remoteTokenEnv = await promptText(rl, "Remote token env", config.remote.tokenEnv ?? "BRAINCODE_REMOTE_TOKEN");
      const remoteToken = await promptSecret(
        rl,
        `Remote bearer token for ${remoteOptions.remoteTokenEnv} (stored in ${getEnvFilePath(loaded.path)}, leave blank to skip)`,
        process.env[remoteOptions.remoteTokenEnv]
      );
      if (remoteToken && remoteToken !== process.env[remoteOptions.remoteTokenEnv]) {
        envUpdates[remoteOptions.remoteTokenEnv] = remoteToken;
      }
    }
    if (remoteMode === "server" || remoteMode === "both") {
      remoteOptions.serverHost = await promptText(rl, "Server host", config.server.host);
      remoteOptions.serverPort = Number(await promptText(rl, "Server port", String(config.server.port)));
      remoteOptions.serverTokenEnv = await promptText(rl, "Server token env", config.server.authTokenEnv ?? "BRAINCODE_SERVER_TOKEN");
      if (remoteOptions.serverTokenEnv && !process.env[remoteOptions.serverTokenEnv]) {
        envUpdates[remoteOptions.serverTokenEnv] = generateServerToken();
      }
    }
    return {
      config: configureRemote(config, remoteOptions),
      envUpdates
    };
  } finally {
    rl.close();
  }
}

export async function runSetup(options: SetupOptions): Promise<SetupResult | null> {
  const loaded = await loadConfig(options.configPath);
  const gitDefaults = await detectGitDefaults();
  const built = options.nonInteractive
    ? await buildNonInteractiveConfig(loaded, options)
    : await buildInteractiveConfig(loaded, options, gitDefaults);

  if (!built) {
    return null;
  }

  const savedPath = await writeConfig({
    path: options.configPath,
    config: built.config
  });
  const envWrite = await writeEnvValues(savedPath, built.envUpdates);
  const nextLoaded = await loadConfig(savedPath);
  await initializeStorage(nextLoaded.config);
  const doctorOutput = formatDoctorReport(await runDoctor(savedPath));

  return {
    configPath: savedPath,
    config: nextLoaded.config,
    envFilePath: getEnvFilePath(savedPath),
    envFileUpdatedNames: envWrite?.updatedNames ?? [],
    envHints: collectEnvHints(nextLoaded.config),
    doctorOutput
  };
}

export function formatSetupResult(result: SetupResult): string {
  return [
    `config_path: ${result.configPath}`,
    `brain_repo: ${result.config.brain.repo}`,
    `index_db: ${result.config.brain.indexDb}`,
    `env_file: ${result.envFilePath}${
      result.envFileUpdatedNames.length > 0 ? ` (updated: ${result.envFileUpdatedNames.join(", ")})` : ""
    }`,
    "",
    printMcpSnippets(),
    result.envHints.length > 0 ? `\nEnvironment variables to set:\n${result.envHints.join("\n")}` : "",
    "",
    "Doctor:",
    result.doctorOutput,
    "",
    "Next steps:",
    "  braincode doctor",
    "  braincode search \"query\" --project <project>",
    "  braincode serve"
  ]
    .filter((section) => section.length > 0)
    .join("\n");
}
