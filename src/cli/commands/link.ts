import type { Command } from "commander";
import { normalizePageRef } from "../../pages/page-ref.js";
import { withService } from "../helpers.js";

export function registerLinkCommand(program: Command): void {
  program
    .command("link")
    .description("Create or update an explicit page link")
    .requiredOption("--project <project>", "Project id")
    .requiredOption("--from <slug>", "Source page slug")
    .requiredOption("--to <slug>", "Target page slug")
    .requiredOption("--relation <relation>", "Link relation")
    .option("--context <context>", "Optional link context")
    .action(async (commandOptions, command: Command) => {
      await withService(command, async (service) => {
        service.links.linkPages({
          project: commandOptions.project,
          fromSlug: commandOptions.from,
          toSlug: commandOptions.to,
          relation: commandOptions.relation,
          context: commandOptions.context
        });

        console.log(
          `linked: ${normalizePageRef(commandOptions.from)} -> ${normalizePageRef(commandOptions.to)} (${commandOptions.relation})`
        );
      });
    });
}
