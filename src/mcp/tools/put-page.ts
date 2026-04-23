import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ServiceContext } from "../../runtime/open-service.js";
import { safeToolHandler } from "../helpers.js";

export function registerPutPageTool(server: McpServer, service: ServiceContext): void {
  server.registerTool(
    "put_page",
    {
      description:
        "Create or overwrite a full Markdown page. Use this only after you have already decided the target slug and full page content; the service does not auto-merge or auto-extract links.",
      inputSchema: {
        project: z.string().optional(),
        slug: z.string().min(1),
        content: z.string().min(1),
        context_path: z.string().optional()
      }
    },
    safeToolHandler(async ({ project, slug, content, context_path }) => {
      const page = await service.pages.putPage({
        project,
        slug,
        content,
        contextPath: context_path
      });

      return {
        project: page.frontmatter.project,
        slug: page.slug,
        markdown_path: page.markdownPath
      };
    })
  );
}
