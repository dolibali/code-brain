import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (root) => {
      const fs = await import("node:fs/promises");
      await fs.rm(root, { recursive: true, force: true });
    })
  );
});

async function createConfigFile(projectCount = 1): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "code-brain-cli-"));
  tempRoots.push(root);
  const configPath = path.join(root, "config.yaml");
  const projects =
    projectCount === 1
      ? `
projects:
  - id: code-brain
    root: ./workspace/code-brain
    remotes: []
`
      : `
projects:
  - id: code-brain
    root: ./workspace/code-brain
    remotes: []
  - id: kilo-code
    root: ./workspace/kilo-code
    remotes: []
`;
  await writeFile(
    configPath,
    `
brain:
  repo: ./brain
  index_db: ./state/index.sqlite
${projects}
llm:
  enabled: false
`,
    "utf8"
  );
  return configPath;
}

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; failed: boolean }> {
  try {
    const result = await execFileAsync("node_modules/.bin/tsx", ["src/main.ts", ...args], {
      cwd: "/Users/zhangrich/work/code-brain"
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      failed: false
    };
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string };
    return {
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      failed: true
    };
  }
}

describe("CLI help and errors", () => {
  it("shows concise help aligned with the main command vocabulary", async () => {
    const result = await runCli(["--help"]);

    expect(result.failed).toBe(false);
    expect(result.stdout).toContain("search");
    expect(result.stdout).toContain("change");
    expect(result.stdout).toContain("serve");
    expect(result.stdout).toContain("links");
  });

  it("returns contextual errors for missing change inputs", async () => {
    const configPath = await createConfigFile(1);
    const result = await runCli(["--config", configPath, "change", "record", "--project", "code-brain"]);

    expect(result.failed).toBe(true);
    expect(result.stderr).toContain("record_change requires at least one of diff, commit_message, or agent_summary");
  });

  it("returns contextual errors for ambiguous project resolution", async () => {
    const configPath = await createConfigFile(2);
    const result = await runCli(["--config", configPath, "search", "sandbox"]);

    expect(result.failed).toBe(true);
    expect(result.stderr).toContain("Unable to resolve project. Pass --project or --context-path.");
  });
});

