import { z } from "zod";
import { validatePageSlug } from "./page-ref.js";

const DateTimeValueSchema = z.union([
  z.string().datetime({ offset: true }),
  z.date().transform((value) => value.toISOString())
]);

export const PageTypeSchema = z.enum(["issue", "architecture", "decision", "practice", "change"]);
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
export const SourceTypeSchema = z.enum(["manual", "agent", "import"]);
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

const StatusByType = {
  issue: ["open", "investigating", "fixed", "wont_fix", "needs_review"] as const,
  architecture: ["current", "proposed", "deprecated", "needs_review"] as const,
  decision: ["proposed", "accepted", "superseded", "needs_review"] as const,
  practice: ["active", "deprecated", "needs_review"] as const,
  change: ["recorded", "validated", "reverted"] as const
} as const;

export const PageFrontmatterSchema = z
  .object({
    project: z.string().min(1),
    slug: z.string().min(1).optional(),
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
    seeAlso: z.array(z.string().min(1)).default([])
  })
  .superRefine((value, context) => {
    const allowedStatuses = StatusByType[value.type];
    if (!allowedStatuses.includes(value.status as never)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: `status '${value.status}' is not valid for type '${value.type}'. Expected: ${allowedStatuses.join(" | ")}`
      });
    }

    if (value.slug) {
      try {
        validatePageSlug(value.slug, value.type);
      } catch (error) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["slug"],
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
  });

export type PageType = z.infer<typeof PageTypeSchema>;
export type ScopeKind = z.infer<typeof ScopeKindSchema>;
export type ScopeRef = z.infer<typeof ScopeRefSchema>;
export type LifecycleStage = z.infer<typeof LifecycleStageSchema>;
export type ChangeKind = z.infer<typeof ChangeKindSchema>;
export type SourceType = z.infer<typeof SourceTypeSchema>;
export type SourceAgent = z.infer<typeof SourceAgentSchema>;
export type PageFrontmatter = z.infer<typeof PageFrontmatterSchema>;

