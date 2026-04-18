import { z } from "zod";
import { ChangeKindSchema, ScopeRefSchema, SourceAgentSchema, type PageType } from "../pages/schema.js";

export const RelatedKnowledgeTypeSchema = z.enum([
  "issue",
  "architecture",
  "decision",
  "practice"
]);

export const RecordChangeInputSchema = z.object({
  project: z.string().optional(),
  contextPath: z.string().optional(),
  title: z.string().optional(),
  changeKind: ChangeKindSchema.optional(),
  diff: z.string().optional(),
  commitMessage: z.string().optional(),
  agentSummary: z.string().optional(),
  scopeRefs: z.array(ScopeRefSchema).default([]),
  relatedTypes: z.array(RelatedKnowledgeTypeSchema).default([]),
  sourceRef: z.string().optional(),
  sourceAgent: SourceAgentSchema.default("none")
});

export type RelatedKnowledgeType = z.infer<typeof RelatedKnowledgeTypeSchema>;
export type RecordChangeInput = z.input<typeof RecordChangeInputSchema>;
export type ParsedRecordChangeInput = z.output<typeof RecordChangeInputSchema>;
export type RelatedPageType = Exclude<PageType, "change">;
