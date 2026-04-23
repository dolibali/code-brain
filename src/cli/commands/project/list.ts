import type { Command } from "commander";
import { loadConfig } from "../../../config/load-config.js";
import { getConfigPath } from "../../helpers.js";

export function registerProjectListCommand(project: Command): void {
  project
    .command("list")
    .description("List all registered projects")
    .action(async (_, command: Command) => {
      const loaded = await loadConfig(getConfigPath(command));

      if (loaded.config.projects.length === 0) {
        console.log("No registered projects.");
        return;
      }

      for (const entry of loaded.config.projects) {
        const roots = entry.roots.join(", ");
        const remotes = entry.gitRemotes.length > 0 ? entry.gitRemotes.join(", ") : "-";
        console.log(`${entry.id}\t${entry.mainBranch}\t${roots}\t${remotes}`);
      }
    });
}
