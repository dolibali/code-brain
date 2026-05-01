import type { Command } from "commander";
import { formatDoctorReport, runDoctor } from "../../setup/diagnostics.js";
import { getConfigPath } from "../helpers.js";

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Diagnose BrainCode configuration and environment readiness")
    .action(async (_, command: Command) => {
      const report = await runDoctor(getConfigPath(command));
      console.log(formatDoctorReport(report));

      if (report.checks.some((entry) => entry.level === "error")) {
        process.exitCode = 1;
      }
    });
}
