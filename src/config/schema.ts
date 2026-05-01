import { z } from "zod";

export const ProviderCapabilitySchema = z.enum(["chat_completions", "reasoning_control", "embeddings"]);

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
  roots: z.array(z.string().min(1)).default([]),
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

export const EmbeddingApiConfigSchema = z.object({
  mode: z.literal("openai-compatible"),
  baseUrl: z.string().url(),
  apiKeyEnv: z.string().min(1),
  defaultModel: z.string().min(1)
});

export const EmbeddingConfigSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.string().optional(),
  api: EmbeddingApiConfigSchema.optional(),
  model: z.string().min(1).optional(),
  providers: z.record(z.string(), ProviderPresetSchema).default({}),
  routing: z
    .object({
      search: z.string().optional()
    })
    .default({}),
  dimensions: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().default(8000),
  retries: z.number().int().nonnegative().default(2)
});

export const McpConfigSchema = z.object({
  name: z.string().min(1).default("braincode"),
  version: z.string().min(1).default("0.1.0")
});

export const ServerConfigSchema = z.object({
  host: z.string().min(1).default("127.0.0.1"),
  port: z.number().int().positive().max(65535).default(7331),
  authTokenEnv: z.string().min(1).optional(),
  maxBodyMb: z.number().int().positive().default(20)
});

export const RemoteConfigSchema = z.object({
  url: z.string().url().optional(),
  tokenEnv: z.string().min(1).optional()
});

export const SyncConfigSchema = z.object({
  concurrency: z.number().int().positive().default(8),
  compression: z.enum(["gzip", "none"]).default("gzip"),
  pruneOnPull: z.boolean().default(true)
});

export const BrainCodeConfigSchema = z.object({
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
  embedding: EmbeddingConfigSchema.default({
    enabled: false,
    providers: {},
    routing: {},
    timeoutMs: 8000,
    retries: 2
  }),
  mcp: McpConfigSchema.default({
    name: "braincode",
    version: "0.1.0"
  }),
  server: ServerConfigSchema.default({
    host: "127.0.0.1",
    port: 7331,
    maxBodyMb: 20
  }),
  remote: RemoteConfigSchema.default({}),
  sync: SyncConfigSchema.default({
    concurrency: 8,
    compression: "gzip",
    pruneOnPull: true
  })
});

export type ProviderCapability = z.infer<typeof ProviderCapabilitySchema>;
export type ProviderPreset = z.infer<typeof ProviderPresetSchema>;
export type ProjectRegistration = z.infer<typeof ProjectRegistrationSchema>;
export type LlmApiConfig = z.infer<typeof LlmApiConfigSchema>;
export type LlmModelOverride = z.infer<typeof LlmModelOverrideSchema>;
export type LlmConfig = z.infer<typeof LlmConfigSchema>;
export type EmbeddingApiConfig = z.infer<typeof EmbeddingApiConfigSchema>;
export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>;
export type McpConfig = z.infer<typeof McpConfigSchema>;
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type RemoteConfig = z.infer<typeof RemoteConfigSchema>;
export type SyncConfig = z.infer<typeof SyncConfigSchema>;
export type BrainCodeConfig = z.infer<typeof BrainCodeConfigSchema>;
