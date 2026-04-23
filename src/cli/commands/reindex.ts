import type { Command } from "commander";
import { withService } from "../helpers.js";

export function registerReindexCommand(program: Command): void {
  program
    .command("reindex")
    .description("Rebuild the index from Markdown truth")
    .option("--project <project>", "Project id")
    .option("--full", "Rebuild all registered projects", false)
    .action(async (commandOptions, command: Command) => {
      await withService(command, async (service) => {
        const result = await service.pages.reindex({
          project: commandOptions.project,
          full: commandOptions.full
        });

        console.log(`reindexed_projects: ${result.projects}`);
        console.log(`reindexed_pages: ${result.pages}`);
      });
    });
}
