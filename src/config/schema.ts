import { z } from "zod";

export const ProviderCapabilitySchema = z.enum(["chat_completions", "reasoning_control"]);

export const ProviderPresetSchema = z.object({
  mode: z.literal("openai-compatible"),
  baseUrl: z.string().url(),
  apiKeyEnv: z.string().min(1),
  defaultModel: z.string().min(1),
  capabilities: z.array(ProviderCapabilitySchema).default([])
});

export const ProjectRegistrationSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  mainBranch: z.string().min(1).default("main"),
  roots: z.array(z.string().min(1)).min(1),
  gitRemotes: z.array(z.string().min(1)).default([])
});

export const LlmApiConfigSchema = z.object({
  mode: z.literal("openai-compatible"),
  baseUrl: z.string().url(),
  apiKeyEnv: z.string().min(1),
  defaultModel: z.string().min(1)
});

export const LlmModelOverrideSchema = z.object({
  model: z.string().min(1)
});

export const LlmConfigSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.string().optional(),
  api: LlmApiConfigSchema.optional(),
  models: z
    .object({
      search: LlmModelOverrideSchema.optional()
    })
    .default({}),
  providers: z.record(z.string(), ProviderPresetSchema).default({}),
  routing: z
    .object({
      search: z.string().optional()
    })
    .default({}),
  request: z
    .object({
      extraBody: z.record(z.string(), z.unknown()).default({})
    })
    .default({ extraBody: {} }),
  timeoutMs: z.number().int().positive().default(8000),
  retries: z.number().int().nonnegative().default(2)
});

export const McpConfigSchema = z.object({
  name: z.string().min(1).default("code-brain"),
  version: z.string().min(1).default("0.1.0")
});

export const CodeBrainConfigSchema = z.object({
  brain: z.object({
    repo: z.string().min(1),
    indexDb: z.string().min(1)
  }),
  projects: z.array(ProjectRegistrationSchema).default([]),
  llm: LlmConfigSchema.default({
    enabled: false,
    models: {},
    providers: {},
    routing: {},
    request: { extraBody: {} },
    timeoutMs: 8000,
    retries: 2
  }),
  mcp: McpConfigSchema.default({
    name: "code-brain",
    version: "0.1.0"
  })
});

export type ProviderCapability = z.infer<typeof ProviderCapabilitySchema>;
export type ProviderPreset = z.infer<typeof ProviderPresetSchema>;
export type ProjectRegistration = z.infer<typeof ProjectRegistrationSchema>;
export type LlmApiConfig = z.infer<typeof LlmApiConfigSchema>;
export type LlmModelOverride = z.infer<typeof LlmModelOverrideSchema>;
export type LlmConfig = z.infer<typeof LlmConfigSchema>;
export type McpConfig = z.infer<typeof McpConfigSchema>;
export type CodeBrainConfig = z.infer<typeof CodeBrainConfigSchema>;

