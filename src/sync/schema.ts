import { z } from "zod";

export const SyncPagePayloadSchema = z.object({
  project: z.string().min(1),
  slug: z.string().min(1),
  content: z.string(),
  content_hash: z.string().min(1)
});

export const SyncReindexRequestSchema = z
  .object({
    project: z.string().min(1).optional(),
    full: z.boolean().optional()
  })
  .default({});
