import type { Command } from "commander";
import { parseDirection, withService } from "../helpers.js";

export function registerLinksCommand(program: Command): void {
  program
    .command("links")
    .alias("get-links")
    .description("Get page links")
    .requiredOption("--project <project>", "Project id")
    .requiredOption("--slug <slug>", "Page slug")
    .option("--direction <direction>", "incoming | outgoing | both", "both")
    .action(async (commandOptions, command: Command) => {
      await withService(command, async (service) => {
        const links = service.links.getLinks({
          project: commandOptions.project,
          slug: commandOptions.slug,
          direction: parseDirection(commandOptions.direction)
        });

        if (links.length === 0) {
          console.log("No links found.");
          return;
        }

        for (const link of links) {
          console.log(
            `${link.direction}\t${link.relation}\t${link.fromSlug}\t${link.toSlug}\t${link.otherType ?? "-"}\t${link.otherTitle ?? "-"}`
          );
        }
      });
    });
}
