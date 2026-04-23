import type { Command } from "commander";
import { serveCodeBrainMcp } from "../../mcp/server.js";
import { getConfigPath } from "../helpers.js";

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Run the Code Brain MCP server over stdio")
    .action(async (_, command: Command) => {
      await serveCodeBrainMcp(getConfigPath(command));
    });
}
