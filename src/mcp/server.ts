import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openService, type ServiceContext } from "../runtime/open-service.js";
import { registerTools } from "./tools/index.js";

export async function createCodeBrainMcpServer(configPath?: string): Promise<{
  server: McpServer;
  service: ServiceContext;
}> {
  const service = await openService(configPath);
  const server = new McpServer({
    name: service.config.mcp.name,
    version: service.config.mcp.version
  });

  registerTools(server, service);
  return { server, service };
}

export async function serveCodeBrainMcp(configPath?: string): Promise<void> {
  const { server, service } = await createCodeBrainMcpServer(configPath);
  const transport = new StdioServerTransport();
  transport.onclose = () => {
    service.close();
  };

  await server.connect(transport);
}
