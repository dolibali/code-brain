import { spawn } from "node:child_process";
import type { Command } from "commander";
import {
  getDefaultConfig,
  loadConfig,
  resolveConfigPath,
  serializeConfig,
  writeConfig
} from "../../../config/load-config.js";
import { getConfigPath } from "../../helpers.js";

async function ensureEditableConfig(configPath?: string): Promise<string> {
  const loaded = await loadConfig(configPath);
  if (loaded.exists) {
    return loaded.path;
  }

  return writeConfig({
    path: configPath,
    config: getDefaultConfig(configPath)
  });
}

function runEditor(editor: string, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(`${editor} "${filePath.replace(/"/g, '\\"')}"`, {
      stdio: "inherit",
      shell: true
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Editor exited with code ${code ?? "unknown"}.`));
    });
  });
}

export function registerConfigCommands(program: Command): void {
  const config = program.command("config").description("Inspect and edit BrainCode config");

  config
    .command("path")
    .description("Print the resolved config path")
    .action((_, command: Command) => {
      console.log(resolveConfigPath(getConfigPath(command)));
    });

  config
    .command("show")
    .description("Print the loaded config as YAML")
    .action(async (_, command: Command) => {
      const loaded = await loadConfig(getConfigPath(command));
      console.log(serializeConfig(loaded.config));
    });

  config
    .command("validate")
    .description("Validate the config file")
    .action(async (_, command: Command) => {
      const loaded = await loadConfig(getConfigPath(command));
      if (!loaded.exists) {
        throw new Error(`Config file does not exist: ${loaded.path}`);
      }
      console.log(`valid: true`);
      console.log(`config_path: ${loaded.path}`);
    });

  config
    .command("edit")
    .description("Open the config file in $BRAINCODE_EDITOR, $VISUAL, or $EDITOR")
    .action(async (_, command: Command) => {
      const configPath = await ensureEditableConfig(getConfigPath(command));
      const editor = process.env.BRAINCODE_EDITOR ?? process.env.VISUAL ?? process.env.EDITOR;
      if (!editor) {
        throw new Error("Set BRAINCODE_EDITOR, VISUAL, or EDITOR to use 'braincode config edit'.");
      }
      await runEditor(editor, configPath);
    });
}
