import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
    main_branch: main
    roots:
      - ./workspace/code-brain
    git_remotes: []
`
      : `
projects:
  - id: code-brain
    main_branch: main
    roots:
      - ./workspace/code-brain
    git_remotes: []
  - id: kilo-code
    main_branch: main
    roots:
      - ./workspace/kilo-code
    git_remotes: []
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
  it("shows concise help aligned with the thin service vocabulary", async () => {
    const result = await runCli(["--help"]);

    expect(result.failed).toBe(false);
    expect(result.stdout).toContain("search");
    expect(result.stdout).toContain("put");
    expect(result.stdout).toContain("serve");
    expect(result.stdout).toContain("links");
    expect(result.stdout).not.toContain("change");
  });

  it("returns structured validation errors for put_page mismatches", async () => {
    const configPath = await createConfigFile(1);
    const markdownPath = path.join(path.dirname(configPath), "page.md");
    await writeFile(
      markdownPath,
      `---
project: kilo-code
type: issue
title: Electron Sandbox Crash
status: fixed
source_type: manual
source_agent: codex
created_at: 2026-04-18T10:15:00Z
updated_at: 2026-04-18T10:20:00Z
---

## Symptoms

Sandbox crashed.
`,
      "utf8"
    );

    const result = await runCli([
      "--config",
      configPath,
      "put",
      "issue/electron-sandbox-crash",
      "--project",
      "code-brain",
      "--file",
      markdownPath
    ]);

    expect(result.failed).toBe(true);
    expect(result.stderr).toContain("\"error\": \"validation_failed\"");
    expect(result.stderr).toContain("\"field\": \"project\"");
  });

  it("returns contextual errors for ambiguous project resolution", async () => {
    const configPath = await createConfigFile(2);
    const result = await runCli(["--config", configPath, "search", "sandbox"]);

    expect(result.failed).toBe(true);
    expect(result.stderr).toContain("Unable to resolve project. Pass --project or --context-path.");
  });

  it("bootstraps a minimal config with the init command", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "code-brain-init-"));
    tempRoots.push(root);
    const configPath = path.join(root, "config.yaml");

    const result = await runCli(["--config", configPath, "init"]);
    const written = await readFile(configPath, "utf8");

    expect(result.failed).toBe(false);
    expect(result.stdout).toContain("config_path:");
    expect(written).toContain("brain:");
    expect(written).toContain("index_db:");
    expect(written).toContain("repo: ./brain");
    expect(written).toContain("index_db: ./state/index.sqlite");
  });
});
