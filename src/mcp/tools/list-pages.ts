import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ServiceContext } from "../../runtime/open-service.js";
import { ScopeRefSchema, safeToolHandler } from "../helpers.js";

export function registerListPagesTool(server: McpServer, service: ServiceContext): void {
  server.registerTool(
    "list_pages",
    {
      description:
        "List canonical knowledge pages by structured filters such as project, type, status, tags, and scope_refs. Use this when you know the structure you want instead of free-text search.",
      inputSchema: {
        project: z.string().optional(),
        types: z.array(z.enum(["issue", "architecture", "decision", "practice", "change"])).optional(),
        status: z.string().optional(),
        tags: z.array(z.string()).optional(),
        scope_refs: z.array(ScopeRefSchema).optional(),
        limit: z.number().int().positive().optional()
      }
    },
    safeToolHandler(async ({ project, types, status, tags, scope_refs, limit }) => ({
      pages: service.pages.listPages({
        project,
        types,
        status,
        tags,
        scopeRefs: scope_refs,
        limit
      })
    }))
  );
}
