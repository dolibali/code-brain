import type { Command } from "commander";
import { getDefaultConfig, loadConfig, writeConfig } from "../../config/load-config.js";
import { ensureBrainDirectories } from "../../projects/project-registry.js";
import { openIndexDatabase } from "../../storage/index-db.js";
import { getConfigPath } from "../helpers.js";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Create a minimal config and bootstrap local state")
    .option("--force", "Overwrite an existing config file", false)
    .action(async (commandOptions, command: Command) => {
      const configPath = getConfigPath(command);
      const loaded = await loadConfig(configPath);

      if (loaded.exists && !commandOptions.force) {
        await ensureBrainDirectories(loaded.config);
        const index = await openIndexDatabase(loaded.config);
        try {
          index.initialize();
          index.syncProjects();
        } finally {
          index.close();
        }

        console.log(`config_path: ${loaded.path}`);
        console.log("status: existing_config_reused");
        return;
      }

      const defaultConfig = getDefaultConfig(configPath);
      const savedPath = await writeConfig({
        path: configPath,
        config: defaultConfig
      });
      const nextLoaded = await loadConfig(savedPath);
      await ensureBrainDirectories(nextLoaded.config);

      const index = await openIndexDatabase(nextLoaded.config);
      try {
        index.initialize();
        index.syncProjects();
      } finally {
        index.close();
      }

      console.log(`config_path: ${savedPath}`);
      console.log(`brain_repo: ${nextLoaded.config.brain.repo}`);
      console.log(`index_db: ${nextLoaded.config.brain.indexDb}`);
    });
}
