import type { Command } from "commander";
import { serveBrainCodeHttp } from "../../http/server.js";
import { serveBrainCodeMcp } from "../../mcp/server.js";
import { getConfigPath } from "../helpers.js";

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Run the BrainCode MCP server over stdio, or remote HTTP with --remote")
    .option("-r, --remote", "Run Streamable HTTP MCP and sync API instead of stdio", false)
    .option("--host <host>", "HTTP bind host, defaults to server.host or 127.0.0.1")
    .option("-i, --ip <ip>", "HTTP bind IP address, defaults to server.host or 127.0.0.1")
    .option("-p, --port <port>", "HTTP bind port, defaults to server.port or 7331", (value) =>
      Number.parseInt(value, 10)
    )
    .action(async (commandOptions, command: Command) => {
      if (commandOptions.remote) {
        await serveBrainCodeHttp(getConfigPath(command), {
          host: commandOptions.ip ?? commandOptions.host,
          port: commandOptions.port
        });
        return;
      }

      await serveBrainCodeMcp(getConfigPath(command));
    });
}
