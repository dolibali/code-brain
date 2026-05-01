import type { Command } from "commander";
import { registerProjectAddCommand } from "./add.js";
import { registerProjectListCommand } from "./list.js";

export function registerProjectCommands(program: Command): void {
  const project = program.command("project").description("Manage registered projects");
  project.alias("pj");
  registerProjectListCommand(project);
  registerProjectAddCommand(project);
}
