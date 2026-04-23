import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ServiceContext } from "../../runtime/open-service.js";
import { safeToolHandler } from "../helpers.js";

export function registerReindexTool(server: McpServer, service: ServiceContext): void {
  server.registerTool(
    "reindex",
    {
      description:
        "Rebuild the search index from Markdown truth. Use this after direct Markdown edits or when local search/embedding state needs to be repaired.",
      inputSchema: {
        project: z.string().optional(),
        full: z.boolean().optional()
      }
    },
    safeToolHandler(async ({ project, full }) => service.pages.reindex({ project, full }))
  );
}
