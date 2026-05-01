import type { ProviderCapability, ProviderPreset } from "../config/schema.js";

export const CUSTOM_PROVIDER_ID = "custom_openai_compatible";

export type ProviderPresetDefinition = ProviderPreset & {
  id: string;
  label: string;
};

function provider(input: {
  id: string;
  label: string;
  baseUrl: string;
  apiKeyEnv: string;
  defaultModel: string;
  capabilities: ProviderCapability[];
}): ProviderPresetDefinition {
  return {
    id: input.id,
    label: input.label,
    mode: "openai-compatible",
    baseUrl: input.baseUrl,
    apiKeyEnv: input.apiKeyEnv,
    defaultModel: input.defaultModel,
    capabilities: input.capabilities
  };
}

export const LLM_PROVIDER_PRESETS: Record<string, ProviderPresetDefinition> = {
  deepseek: provider({
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    defaultModel: "deepseek-chat",
    capabilities: ["chat_completions", "reasoning_control"]
  }),
  qwen_bailian: provider({
    id: "qwen_bailian",
    label: "Qwen Bailian",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKeyEnv: "DASHSCOPE_API_KEY",
    defaultModel: "qwen-max",
    capabilities: ["chat_completions", "reasoning_control"]
  }),
  zhipu: provider({
    id: "zhipu",
    label: "GLM/Zhipu",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4/",
    apiKeyEnv: "ZHIPU_API_KEY",
    defaultModel: "glm-4.5",
    capabilities: ["chat_completions", "reasoning_control"]
  }),
  minimax: provider({
    id: "minimax",
    label: "MiniMax",
    baseUrl: "https://api.minimax.io/v1",
    apiKeyEnv: "MINIMAX_API_KEY",
    defaultModel: "MiniMax-M1",
    capabilities: ["chat_completions", "reasoning_control"]
  }),
  kimi: provider({
    id: "kimi",
    label: "Kimi/Moonshot",
    baseUrl: "https://api.moonshot.cn/v1",
    apiKeyEnv: "MOONSHOT_API_KEY",
    defaultModel: "kimi-k2",
    capabilities: ["chat_completions", "reasoning_control"]
  })
};

export const EMBEDDING_PROVIDER_PRESETS: Record<string, ProviderPresetDefinition & { dimensions?: number }> = {
  qwen_bailian: {
    ...provider({
      id: "qwen_bailian",
      label: "Qwen Bailian Embedding",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKeyEnv: "DASHSCOPE_API_KEY",
      defaultModel: "text-embedding-v4",
      capabilities: ["embeddings"]
    }),
    dimensions: 1024
  }
};

export function providerIds(input: Record<string, ProviderPresetDefinition>): string {
  return [...Object.keys(input), CUSTOM_PROVIDER_ID].join("/");
}
