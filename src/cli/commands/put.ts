import type { Command } from "commander";
import { loadContent, withService } from "../helpers.js";

export function registerPutCommand(program: Command): void {
  program
    .command("put")
    .description("Create or update a full markdown page")
    .argument("<slug>", "Page slug, such as issue/electron-sandbox-crash")
    .option("-p, --project <project>", "Project name used for helper validation")
    .option("--context <path>", "Context path used for helper validation")
    .option("--content <content>", "Inline markdown content")
    .option("-f, --file <path>", "Load markdown content from a file")
    .action(async (slug: string, commandOptions, command: Command) => {
      await withService(command, async (service) => {
        const stored = await service.pages.putPage({
          project: commandOptions.project,
          slug,
          content: await loadContent({
            inline: commandOptions.content,
            file: commandOptions.file
          }),
          contextPath: commandOptions.context
        });

        console.log(`put: ${stored.frontmatter.project}/${stored.slug}`);
        console.log(`path: ${stored.markdownPath}`);
      });
    });
}
