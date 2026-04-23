import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServiceContext } from "../../runtime/open-service.js";
import { registerGetLinksTool } from "./get-links.js";
import { registerGetPageTool } from "./get-page.js";
import { registerLinkPagesTool } from "./link-pages.js";
import { registerListPagesTool } from "./list-pages.js";
import { registerPutPageTool } from "./put-page.js";
import { registerReindexTool } from "./reindex.js";
import { registerSearchTool } from "./search.js";

export function registerTools(server: McpServer, service: ServiceContext): void {
  registerSearchTool(server, service);
  registerGetPageTool(server, service);
  registerListPagesTool(server, service);
  registerPutPageTool(server, service);
  registerLinkPagesTool(server, service);
  registerGetLinksTool(server, service);
  registerReindexTool(server, service);
}
