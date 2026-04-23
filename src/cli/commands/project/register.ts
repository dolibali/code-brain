import type { Command } from "commander";
import { registerProject } from "../../../projects/project-registry.js";
import { openIndexDatabase } from "../../../storage/index-db.js";
import { getConfigPath } from "../../helpers.js";

export function registerProjectRegisterCommand(project: Command): void {
  project
    .command("register")
    .description("Register or update a project entry")
    .requiredOption("--id <id>", "Project id")
    .requiredOption("--root <root>", "Project root path")
    .option("--main-branch <branch>", "Main branch name", "main")
    .option("--remote <remote...>", "Git remote matcher", [])
    .option("--title <title>", "Human-readable project title")
    .action(async (commandOptions, command: Command) => {
      const loaded = await registerProject({
        id: commandOptions.id,
        root: commandOptions.root,
        remotes: commandOptions.remote,
        title: commandOptions.title,
        mainBranch: commandOptions.mainBranch,
        configPath: getConfigPath(command)
      });

      const index = await openIndexDatabase(loaded.config);
      try {
        index.initialize();
        index.syncProjects();
      } finally {
        index.close();
      }

      console.log(`registered: ${commandOptions.id}`);
      console.log(`config_path: ${loaded.path}`);
    });
}
