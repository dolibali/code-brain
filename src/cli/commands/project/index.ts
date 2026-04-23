import type { Command } from "commander";
import { registerProjectListCommand } from "./list.js";
import { registerProjectRegisterCommand } from "./register.js";

export function registerProjectCommands(program: Command): void {
  const project = program.command("project").description("Manage registered projects");
  registerProjectListCommand(project);
  registerProjectRegisterCommand(project);
}
