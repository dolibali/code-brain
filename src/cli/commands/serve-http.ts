import type { Command } from "commander";
import { serveBrainCodeHttp } from "../../http/server.js";
import { getConfigPath } from "../helpers.js";

export function registerServeHttpCommand(program: Command): void {
  program
    .command("serve-http")
    .description("Alias for 'serve --remote'")
    .option("--host <host>", "HTTP bind host, defaults to server.host or 127.0.0.1")
    .option("-i, --ip <ip>", "HTTP bind IP address, defaults to server.host or 127.0.0.1")
    .option("--port <port>", "HTTP bind port, defaults to server.port or 7331", (value) =>
      Number.parseInt(value, 10)
    )
    .action(async (commandOptions, command: Command) => {
      await serveBrainCodeHttp(getConfigPath(command), {
        host: commandOptions.ip ?? commandOptions.host,
        port: commandOptions.port
      });
    });
}
