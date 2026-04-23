import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ServiceContext } from "../../runtime/open-service.js";
import { ScopeRefSchema, safeToolHandler } from "../helpers.js";

export function registerSearchTool(server: McpServer, service: ServiceContext): void {
  server.registerTool(
    "search",
    {
      description:
        "Search candidate Code Brain knowledge pages. Use this before edits or page updates. Returns summaries and related change evidence, not a final synthesized answer.",
      inputSchema: {
        query: z.string().min(1),
        project: z.string().optional(),
        global: z.boolean().optional(),
        types: z.array(z.enum(["issue", "architecture", "decision", "practice", "change"])).optional(),
        scope_refs: z.array(ScopeRefSchema).optional(),
        limit: z.number().int().positive().optional(),
        context_path: z.string().optional()
      }
    },
    safeToolHandler(async ({ query, project, global, types, scope_refs, limit, context_path }) => {
      return service.search.search({
        query,
        project,
        global,
        types,
        scopeRefs: scope_refs,
        limit,
        contextPath: context_path
      });
    })
  );
}
