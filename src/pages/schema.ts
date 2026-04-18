import { z } from "zod";

const DateTimeValueSchema = z.union([
  z.string().datetime({ offset: true }),
  z.date().transform((value) => value.toISOString())
]);

export const PageTypeSchema = z.enum([
  "issue",
  "architecture",
  "decision",
  "practice",
  "change"
]);

export const ScopeKindSchema = z.enum(["repo", "module", "file", "symbol"]);
export const LifecycleStageSchema = z.enum([
  "discovery",
  "design",
  "implementation",
  "validation",
  "release",
  "maintenance"
]);
export const ChangeKindSchema = z.enum([
  "bugfix",
  "refactor",
  "feature",
  "rollback",
  "recovery",
  "maintenance"
]);
export const SourceTypeSchema = z.enum(["manual", "diff", "commit", "agent_summary", "import"]);
export const SourceAgentSchema = z.enum([
  "claude-code",
  "cursor",
  "codex",
  "gemini-cli",
  "none"
]);

export const ScopeRefSchema = z.object({
  kind: ScopeKindSchema,
  value: z.string().min(1)
});

export const PageFrontmatterSchema = z.object({
  project: z.string().min(1),
  type: PageTypeSchema,
  title: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  aliases: z.array(z.string().min(1)).default([]),
  scopeRefs: z.array(ScopeRefSchema).default([]),
  status: z.string().min(1),
  sourceType: SourceTypeSchema,
  sourceAgent: SourceAgentSchema,
  createdAt: DateTimeValueSchema,
  updatedAt: DateTimeValueSchema,
  lifecycleStage: LifecycleStageSchema.optional(),
  changeKind: ChangeKindSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
  seeAlso: z.array(z.string().min(1)).default([])
});

export type PageType = z.infer<typeof PageTypeSchema>;
export type ScopeKind = z.infer<typeof ScopeKindSchema>;
export type ScopeRef = z.infer<typeof ScopeRefSchema>;
export type LifecycleStage = z.infer<typeof LifecycleStageSchema>;
export type ChangeKind = z.infer<typeof ChangeKindSchema>;
export type SourceType = z.infer<typeof SourceTypeSchema>;
export type SourceAgent = z.infer<typeof SourceAgentSchema>;
export type PageFrontmatter = z.infer<typeof PageFrontmatterSchema>;
