import type { Command } from "commander";
import { withService } from "../helpers.js";

export function registerGetCommand(program: Command): void {
  program
    .command("get")
    .description("Get a canonical knowledge page by slug")
    .argument("<slug>", "Page slug, such as issue/electron-sandbox-crash")
    .option("-p, --project <project>", "Project name")
    .action(async (slug: string, commandOptions, command: Command) => {
      await withService(command, async (service) => {
        const page = await service.pages.getPage(commandOptions.project, slug);
        if (!page) {
          throw new Error(`Page '${slug}' not found.`);
        }

        console.log(page.content);
      });
    });
}
