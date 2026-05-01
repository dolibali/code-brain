import { z } from "zod";

export const SyncPagePayloadSchema = z.object({
  project: z.string().min(1),
  slug: z.string().min(1),
  content: z.string(),
  content_hash: z.string().min(1)
});

export const SyncProjectPayloadSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  main_branch: z.string().min(1),
  git_remotes: z.array(z.string().min(1)).default([])
});

export const SyncReindexRequestSchema = z
  .object({
    project: z.string().min(1).optional(),
    full: z.boolean().optional()
  })
  .default({});
