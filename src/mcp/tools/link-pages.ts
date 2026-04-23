import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ServiceContext } from "../../runtime/open-service.js";
import { safeToolHandler } from "../helpers.js";

export function registerLinkPagesTool(server: McpServer, service: ServiceContext): void {
  server.registerTool(
    "link_pages",
    {
      description:
        "Create or update a formal relationship between two pages. Use this after put_page when a change page should explicitly connect to an issue, practice, decision, or architecture page.",
      inputSchema: {
        project: z.string().min(1),
        from_slug: z.string().min(1),
        to_slug: z.string().min(1),
        relation: z.string().min(1),
        context: z.string().optional()
      }
    },
    safeToolHandler(async ({ project, from_slug, to_slug, relation, context }) => {
      service.links.linkPages({
        project,
        fromSlug: from_slug,
        toSlug: to_slug,
        relation,
        context
      });
      return { ok: true };
    })
  );
}
