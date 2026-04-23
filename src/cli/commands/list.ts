import type { Command } from "commander";
import type { PageType } from "../../pages/schema.js";
import { parseCsv, parseScopeRefs, withService } from "../helpers.js";

export function registerListCommand(program: Command): void {
  program
    .command("list")
    .description("List canonical knowledge pages")
    .option("--project <project>", "Project id")
    .option("--types <csv>", "Comma-separated page types")
    .option("--status <status>", "Page status")
    .option("--tags <csv>", "Comma-separated tags")
    .option("--scope-ref <kind:value...>", "Structured scope refs", [])
    .option("--limit <limit>", "Maximum rows to return", "20")
    .action(async (commandOptions, command: Command) => {
      await withService(command, async (service) => {
        const rows = service.pages.listPages({
          project: commandOptions.project,
          types: parseCsv(commandOptions.types) as PageType[],
          status: commandOptions.status,
          tags: parseCsv(commandOptions.tags),
          scopeRefs: parseScopeRefs(commandOptions.scopeRef),
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
