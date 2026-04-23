import type { Command } from "commander";
import { serveBrainCodeMcp } from "../../mcp/server.js";
import { getConfigPath } from "../helpers.js";

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Run the BrainCode MCP server over stdio")
    .action(async (_, command: Command) => {
      await serveBrainCodeMcp(getConfigPath(command));
    });
}
