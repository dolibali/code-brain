import { z } from "zod";

export const ProviderCapabilitySchema = z.enum([
  "chat_completions",
  "responses_api",
  "embeddings",
  "vision",
  "tool_calling",
  "reasoning_control"
]);

export const ProviderPresetSchema = z.object({
  mode: z.literal("openai-compatible"),
  baseUrl: z.string().url(),
  apiKeyEnv: z.string().min(1),
  defaultModel: z.string().min(1),
  capabilities: z.array(ProviderCapabilitySchema).default([])
});

export const ProjectRegistrationSchema = z.object({
  id: z.string().min(1),
  root: z.string().min(1),
  remotes: z.array(z.string().min(1)).default([]),
  description: z.string().optional()
});

export const LlmConfigSchema = z.object({
  enabled: z.boolean().default(false),
  defaultProvider: z.string().optional(),
  providers: z.record(z.string(), ProviderPresetSchema).default({}),
  routing: z
    .object({
      search: z.string().optional(),
      extract: z.string().optional(),
      dedup: z.string().optional()
    })
    .default({})
});

export const CodeBrainConfigSchema = z.object({
  brain: z.object({
    repo: z.string().min(1),
    indexDb: z.string().min(1)
  }),
  projects: z.array(ProjectRegistrationSchema).default([]),
  llm: LlmConfigSchema.default({
    enabled: false,
    providers: {},
    routing: {}
  })
});

export type ProviderCapability = z.infer<typeof ProviderCapabilitySchema>;
export type ProviderPreset = z.infer<typeof ProviderPresetSchema>;
export type ProjectRegistration = z.infer<typeof ProjectRegistrationSchema>;
export type LlmConfig = z.infer<typeof LlmConfigSchema>;
export type CodeBrainConfig = z.infer<typeof CodeBrainConfigSchema>;

