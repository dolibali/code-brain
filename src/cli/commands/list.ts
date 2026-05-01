import type { Command } from "commander";
import type { PageType } from "../../pages/schema.js";
import { parseCsv, parseScopeRefs, withService } from "../helpers.js";

export function registerListCommand(program: Command): void {
  program
    .command("list")
    .alias("ls")
    .description("List canonical knowledge pages")
    .option("-p, --project <project>", "Project name")
    .option("-t, --type <csv>", "Comma-separated page types")
    .option("--status <status>", "Page status")
    .option("--tag <csv>", "Comma-separated tags")
    .option("-s, --scope <kind:value...>", "Structured scope refs", [])
    .option("-l, --limit <limit>", "Maximum rows to return", "20")
    .action(async (commandOptions, command: Command) => {
      await withService(command, async (service) => {
        const rows = service.pages.listPages({
          project: commandOptions.project,
          types: parseCsv(commandOptions.type) as PageType[],
          status: commandOptions.status,
          tags: parseCsv(commandOptions.tag),
          scopeRefs: parseScopeRefs(commandOptions.scope),
          limit: Number(commandOptions.limit)
        });

        if (rows.length === 0) {
          console.log("No pages found.");
          return;
        }

        for (const row of rows) {
          console.log(`${row.project}\t${row.type}\t${row.slug}\t${row.title}`);
        }
      });
    });
}
