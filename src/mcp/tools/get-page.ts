import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ServiceContext } from "../../runtime/open-service.js";
import { safeToolHandler } from "../helpers.js";

export function registerGetPageTool(server: McpServer, service: ServiceContext): void {
  server.registerTool(
    "get_page",
    {
      description:
        "Read one canonical Markdown knowledge page after search identifies a likely slug. Returns the full page content from the Markdown source of truth.",
      inputSchema: {
        slug: z.string().min(1),
        project: z.string().optional()
      }
    },
    safeToolHandler(async ({ slug, project }) => {
      const page = await service.pages.getPage(project, slug);
      if (!page) {
        return {
          error: "not_found",
          message: `Page '${slug}' not found.`
        };
      }

      return {
        project: page.frontmatter.project,
        slug: page.slug,
        content: page.content,
        markdown_path: page.markdownPath
      };
    })
  );
}
