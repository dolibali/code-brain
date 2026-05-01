import type { Command } from "commander";
import type { PageType } from "../../pages/schema.js";
import { parseCsv, parseScopeRefs, withService } from "../helpers.js";

export function registerSearchCommand(program: Command): void {
  program
    .command("search")
    .alias("s")
    .description("Search knowledge pages")
    .argument("<query>", "Search query")
    .option("-p, --project <project>", "Project name")
    .option("--context <path>", "Context path used for project resolution")
    .option("-g, --global", "Search across all projects", false)
    .option("-t, --type <csv>", "Comma-separated page types")
    .option("-s, --scope <kind:value...>", "Structured scope refs", [])
    .option("-l, --limit <limit>", "Maximum rows to return", "10")
    .action(async (query: string, commandOptions, command: Command) => {
      await withService(command, async (service) => {
        const response = await service.search.search({
          query,
          project: commandOptions.project,
          contextPath: commandOptions.context,
          global: commandOptions.global,
          types: parseCsv(commandOptions.type) as PageType[],
          scopeRefs: parseScopeRefs(commandOptions.scope),
          limit: Number(commandOptions.limit)
        });

        if (response.results.length === 0) {
          console.log("No results found.");
          return;
        }

        for (const result of response.results) {
          const relatedChanges = result.relatedChanges.join(", ") || "-";
          console.log(
            `${result.project}\t${result.type}\t${result.slug}\t${result.title}\t${relatedChanges}\t${result.summary}`
          );
        }
      });
    });
}
