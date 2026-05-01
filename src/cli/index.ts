import { Command } from "commander";
import { registerConfigCommands } from "./commands/config/index.js";
import { registerDoctorCommand } from "./commands/doctor.js";
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
import { registerSetupCommand } from "./commands/setup.js";
import { registerSyncCommands } from "./commands/sync.js";

export function createCli(): Command {
  const program = new Command();

  program
    .name("braincode")
    .description("BrainCode CLI")
    .showHelpAfterError()
    .showSuggestionAfterError()
    .option("-c, --config <path>", "Path to config.yaml");

  registerSetupCommand(program);
  registerInitCommand(program);
  registerDoctorCommand(program);
  registerConfigCommands(program);
  registerServeCommand(program);
  registerProjectCommands(program);
  registerSyncCommands(program);
  registerSearchCommand(program);
  registerPutCommand(program);
  registerLinkCommand(program);
  registerLinksCommand(program);
  registerGetCommand(program);
  registerListCommand(program);
  registerReindexCommand(program);

  return program;
}
