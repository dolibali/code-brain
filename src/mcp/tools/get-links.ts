import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ServiceContext } from "../../runtime/open-service.js";
import { safeToolHandler } from "../helpers.js";

export function registerGetLinksTool(server: McpServer, service: ServiceContext): void {
  server.registerTool(
    "get_links",
    {
      description:
        "Get explicit page links for one slug. Use this to inspect evidence and navigation after search or put_page operations.",
      inputSchema: {
        project: z.string().min(1),
        slug: z.string().min(1),
        direction: z.enum(["incoming", "outgoing", "both"]).optional()
      }
    },
    safeToolHandler(async ({ project, slug, direction }) => ({
      links: service.links.getLinks({
        project,
        slug,
        direction
      })
    }))
  );
}
