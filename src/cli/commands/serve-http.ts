import type { Command } from "commander";
import { serveBrainCodeHttp } from "../../http/server.js";
import { getConfigPath } from "../helpers.js";

export function registerServeHttpCommand(program: Command): void {
  program
    .command("serve-http")
    .description("Run the BrainCode MCP and sync server over Streamable HTTP")
    .option("--host <host>", "HTTP bind host")
    .option("--port <port>", "HTTP bind port", (value) => Number.parseInt(value, 10))
    .action(async (commandOptions, command: Command) => {
      await serveBrainCodeHttp(getConfigPath(command), {
        host: commandOptions.host,
        port: commandOptions.port
      });
    });
}
