import type { Command } from "commander";
import { registerProject } from "../../../projects/project-registry.js";
import { openIndexDatabase } from "../../../storage/index-db.js";
import { getConfigPath } from "../../helpers.js";

export function registerProjectAddCommand(project: Command): void {
  project
    .command("add")
    .description("Register or update a project entry")
    .requiredOption("-n, --name <name>", "Project name")
    .requiredOption("-p, --path <path>", "Project root path")
    .option("-b, --branch <branch>", "Main branch name", "main")
    .option("-u, --url <url...>", "Git remote URL matcher", [])
    .option("--title <title>", "Human-readable project title")
    .action(async (commandOptions, command: Command) => {
      const loaded = await registerProject({
        id: commandOptions.name,
        root: commandOptions.path,
        remotes: commandOptions.url,
        title: commandOptions.title,
        mainBranch: commandOptions.branch,
        configPath: getConfigPath(command)
      });

      const index = await openIndexDatabase(loaded.config);
      try {
        index.initialize();
        index.syncProjects();
      } finally {
        index.close();
      }

      console.log(`registered: ${commandOptions.name}`);
      console.log(`config_path: ${loaded.path}`);
    });
}
