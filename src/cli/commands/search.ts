import type { Command } from "commander";
import type { PageType } from "../../pages/schema.js";
import { parseCsv, parseScopeRefs, withService } from "../helpers.js";

export function registerSearchCommand(program: Command): void {
  program
    .command("search")
    .description("Search knowledge pages")
    .argument("<query>", "Search query")
    .option("--project <project>", "Project id")
    .option("--context-path <path>", "Context path used for project resolution")
    .option("--global", "Search across all projects", false)
    .option("--types <csv>", "Comma-separated page types")
    .option("--scope-ref <kind:value...>", "Structured scope refs", [])
    .option("--limit <limit>", "Maximum rows to return", "10")
    .action(async (query: string, commandOptions, command: Command) => {
      await withService(command, async (service) => {
        const response = await service.search.search({
          query,
          project: commandOptions.project,
          contextPath: commandOptions.contextPath,
          global: commandOptions.global,
          types: parseCsv(commandOptions.types) as PageType[],
          scopeRefs: parseScopeRefs(commandOptions.scopeRef),
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
