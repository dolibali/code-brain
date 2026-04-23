import type {
  BrainCodeConfig,
  EmbeddingConfig,
  LlmConfig,
  ProviderCapability,
  ProviderPreset
} from "../config/schema.js";

export type ResolvedProviderConfig = {
  providerId: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  capabilities: ProviderCapability[];
  timeoutMs: number;
  retries: number;
  extraBody: Record<string, unknown>;
};

function readApiKey(apiKeyEnv: string): string {
  const value = process.env[apiKeyEnv];
  if (!value) {
    throw new Error(`Missing API key environment variable '${apiKeyEnv}'.`);
  }

  return value;
}

function resolvePresetConfig(input: {
  providerId: string;
  preset: ProviderPreset;
  timeoutMs: number;
  retries: number;
  extraBody?: Record<string, unknown>;
  requiredCapability?: ProviderCapability;
}): ResolvedProviderConfig {
  if (
    input.requiredCapability &&
    input.preset.capabilities.length > 0 &&
    !input.preset.capabilities.includes(input.requiredCapability)
  ) {
    throw new Error(
      `Provider '${input.providerId}' does not advertise capability '${input.requiredCapability}'.`
    );
  }

  return {
    providerId: input.providerId,
    baseUrl: input.preset.baseUrl,
    apiKey: readApiKey(input.preset.apiKeyEnv),
    defaultModel: input.preset.defaultModel,
    capabilities: input.preset.capabilities,
    timeoutMs: input.timeoutMs,
    retries: input.retries,
    extraBody: input.extraBody ?? {}
  };
}

export function resolveSearchLlmProvider(config: BrainCodeConfig): ResolvedProviderConfig {
  return resolveLlmProvider(config.llm);
}

function resolveLlmProvider(config: LlmConfig): ResolvedProviderConfig {
  const providerId = config.routing.search ?? config.provider;
  if (providerId) {
    const preset = config.providers[providerId];
    if (!preset) {
      throw new Error(`Unknown llm provider '${providerId}'.`);
    }

    return resolvePresetConfig({
      providerId,
      preset,
      timeoutMs: config.timeoutMs,
      retries: config.retries,
      extraBody: config.request.extraBody,
      requiredCapability: "chat_completions"
    });
  }

  if (!config.api) {
    throw new Error("LLM search is enabled but no provider or api config is set.");
  }

  return {
    providerId: "api",
    baseUrl: config.api.baseUrl,
    apiKey: readApiKey(config.api.apiKeyEnv),
    defaultModel: config.api.defaultModel,
    capabilities: ["chat_completions"],
    timeoutMs: config.timeoutMs,
    retries: config.retries,
    extraBody: config.request.extraBody
  };
}

export function resolveSearchEmbeddingProvider(config: BrainCodeConfig): ResolvedProviderConfig {
  return resolveEmbeddingProvider(config.embedding);
}

function resolveEmbeddingProvider(config: EmbeddingConfig): ResolvedProviderConfig {
  const providerId = config.routing.search ?? config.provider;
  if (providerId) {
    const preset = config.providers[providerId];
    if (!preset) {
      throw new Error(`Unknown embedding provider '${providerId}'.`);
    }

    return resolvePresetConfig({
      providerId,
      preset,
      timeoutMs: config.timeoutMs,
      retries: config.retries,
      requiredCapability: "embeddings"
    });
  }

  if (!config.api) {
    throw new Error("Embedding search is enabled but no provider or api config is set.");
  }

  return {
    providerId: "api",
    baseUrl: config.api.baseUrl,
    apiKey: readApiKey(config.api.apiKeyEnv),
    defaultModel: config.model ?? config.api.defaultModel,
    capabilities: ["embeddings"],
    timeoutMs: config.timeoutMs,
    retries: config.retries,
    extraBody: {}
  };
}
