import { Command } from "commander";
import { registerGetCommand } from "./commands/get.js";
import { registerInitCommand } from "./commands/init.js";
import { registerLinkCommand } from "./commands/link.js";
import { registerLinksCommand } from "./commands/links.js";
import { registerListCommand } from "./commands/list.js";
import { registerProjectCommands } from "./commands/project/index.js";
import { registerPutCommand } from "./commands/put.js";
import { registerReindexCommand } from "./commands/reindex.js";
import { registerSearchCommand } from "./commands/search.js";
import { registerServeCommand } from "./commands/serve.js";

export function createCli(): Command {
  const program = new Command();

  program
    .name("codebrain")
    .description("Code Brain CLI")
    .showHelpAfterError()
    .showSuggestionAfterError()
    .option("-c, --config <path>", "Path to config.yaml");

  registerInitCommand(program);
  registerServeCommand(program);
  registerProjectCommands(program);
  registerSearchCommand(program);
  registerPutCommand(program);
  registerLinkCommand(program);
  registerLinksCommand(program);
  registerGetCommand(program);
  registerListCommand(program);
  registerReindexCommand(program);

  return program;
}
