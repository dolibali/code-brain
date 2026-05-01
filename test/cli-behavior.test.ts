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
  const root = await mkdtemp(path.join(os.tmpdir(), "braincode-cli-"));
  tempRoots.push(root);
  const configPath = path.join(root, "config.yaml");
  const projects =
    projectCount === 1
      ? `
projects:
  - id: braincode
    main_branch: main
    roots:
      - ./workspace/braincode
    git_remotes: []
`
      : `
projects:
  - id: braincode
    main_branch: main
    roots:
      - ./workspace/braincode
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
    expect(result.stdout).toContain("s");
    expect(result.stdout).toContain("put");
    expect(result.stdout).toContain("serve");
    expect(result.stdout).toContain("setup");
    expect(result.stdout).toContain("doctor");
    expect(result.stdout).toContain("config");
    expect(result.stdout).not.toContain("serve-http");
    expect(result.stdout).toContain("pj");
    expect(result.stdout).toContain("idx");
    expect(result.stdout).toContain("links");
    expect(result.stdout).not.toContain("change");
  });

  it("documents remote serve flags on the serve command", async () => {
    const result = await runCli(["serve", "--help"]);

    expect(result.failed).toBe(false);
    expect(result.stdout).toContain("-r, --remote");
    expect(result.stdout).toContain("-i, --ip <ip>");
    expect(result.stdout).toContain("-p, --port <port>");
    expect(result.stdout).toContain("127.0.0.1");
    expect(result.stdout).toContain("7331");
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
      "braincode",
      "-f",
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
    expect(result.stderr).toContain("Unable to resolve project. Pass --project or --context.");
  });

  it("supports simplified project add flags and pj alias", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "braincode-project-add-"));
    tempRoots.push(root);
    const configPath = path.join(root, "config.yaml");
    const firstWorkspace = path.join(root, "workspace");
    const secondWorkspace = path.join(root, "workspace-two");

    const result = await runCli([
      "--config",
      configPath,
      "pj",
      "add",
      "-n",
      "kilo-code",
      "-p",
      firstWorkspace,
      "-u",
      "github.com/example/kilo-code",
      "-b",
      "develop"
    ]);
    const secondResult = await runCli([
      "--config",
      configPath,
      "project",
      "add",
      "--name",
      "kilo-code",
      "--path",
      secondWorkspace,
      "--url",
      "git@github.com:example/kilo-code.git"
    ]);
    const listResult = await runCli(["--config", configPath, "pj", "ls"]);

    expect(result.failed).toBe(false);
    expect(secondResult.failed).toBe(false);
    expect(result.stdout).toContain("registered: kilo-code");
    expect(listResult.failed).toBe(false);
    expect(listResult.stdout).toContain("kilo-code");
    expect(listResult.stdout).toContain("develop");
    expect(listResult.stdout).toContain("github.com/example/kilo-code");
    expect(listResult.stdout).toContain(firstWorkspace);
    expect(listResult.stdout).toContain(secondWorkspace);
  });

  it("rejects different project names for the same git remote", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "braincode-project-conflict-"));
    tempRoots.push(root);
    const configPath = path.join(root, "config.yaml");

    const firstResult = await runCli([
      "--config",
      configPath,
      "pj",
      "add",
      "-n",
      "kilo-code",
      "-p",
      path.join(root, "workspace"),
      "-u",
      "https://github.com/example/kilo-code.git"
    ]);
    const conflictResult = await runCli([
      "--config",
      configPath,
      "pj",
      "add",
      "-n",
      "kilo-code-copy",
      "-p",
      path.join(root, "workspace-copy"),
      "-u",
      "git@github.com:example/kilo-code.git"
    ]);

    expect(firstResult.failed).toBe(false);
    expect(conflictResult.failed).toBe(true);
    expect(conflictResult.stderr).toContain("already registered to project 'kilo-code'");
  });

  it("supports common short aliases for search, list, links, and reindex", async () => {
    const configPath = await createConfigFile(1);
    const markdownPath = path.join(path.dirname(configPath), "page.md");
    await writeFile(
      markdownPath,
      `---
project: braincode
type: practice
title: CLI Alias Rule
status: active
source_type: manual
source_agent: codex
created_at: 2026-04-18T10:15:00Z
updated_at: 2026-04-18T10:20:00Z
---

## Rule

Alias commands should work.
`,
      "utf8"
    );

    await runCli(["--config", configPath, "put", "practice/cli-alias-rule", "-p", "braincode", "-f", markdownPath]);
    const searchResult = await runCli(["--config", configPath, "s", "Alias Rule", "-p", "braincode"]);
    const listResult = await runCli(["--config", configPath, "ls", "-p", "braincode", "-t", "practice"]);
    const linksResult = await runCli(["--config", configPath, "links", "practice/cli-alias-rule", "-p", "braincode"]);
    const reindexResult = await runCli(["--config", configPath, "idx", "--all"]);

    expect(searchResult.failed).toBe(false);
    expect(searchResult.stdout).toContain("practice/cli-alias-rule");
    expect(listResult.failed).toBe(false);
    expect(listResult.stdout).toContain("practice/cli-alias-rule");
    expect(linksResult.failed).toBe(false);
    expect(linksResult.stdout).toContain("No links found.");
    expect(reindexResult.failed).toBe(false);
    expect(reindexResult.stdout).toContain("reindexed_pages:");
  });

  it("bootstraps a minimal config with the init command", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "braincode-init-"));
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

  it("runs non-interactive setup with providers, remote config, and diagnostics", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "braincode-setup-"));
    tempRoots.push(root);
    const configPath = path.join(root, "config.yaml");
    const workspacePath = path.join(root, "workspace");

    const result = await runCli([
      "--config",
      configPath,
      "setup",
      "--non-interactive",
      "--project-name",
      "braincode",
      "--project-path",
      workspacePath,
      "--project-url",
      "https://github.com/example/braincode.git",
      "--branch",
      "main",
      "--enable-llm",
      "--llm-provider",
      "deepseek",
      "--enable-embedding",
      "--embedding-provider",
      "qwen_bailian",
      "--remote-mode",
      "both",
      "--remote-url",
      "https://brain.example.com"
    ]);
    const written = await readFile(configPath, "utf8");
    const pathResult = await runCli(["--config", configPath, "config", "path"]);
    const showResult = await runCli(["--config", configPath, "config", "show"]);
    const validateResult = await runCli(["--config", configPath, "config", "validate"]);
    const doctorResult = await runCli(["--config", configPath, "doctor"]);

    expect(result.failed).toBe(false);
    expect(result.stdout).toContain("MCP stdio config snippet");
    expect(result.stdout).toContain("export DEEPSEEK_API_KEY");
    expect(result.stdout).toContain('export BRAINCODE_REMOTE_TOKEN="..."');
    expect(result.stdout).toMatch(/export BRAINCODE_SERVER_TOKEN="[A-Za-z0-9_-]{43}"/);
    expect(written).toContain("provider: deepseek");
    expect(written).toContain("provider: qwen_bailian");
    expect(written).toContain("api_key_env: DASHSCOPE_API_KEY");
    expect(written).toContain("remote:");
    expect(written).toContain("auth_token_env: BRAINCODE_SERVER_TOKEN");
    expect(pathResult.failed).toBe(false);
    expect(pathResult.stdout.trim()).toBe(configPath);
    expect(showResult.failed).toBe(false);
    expect(showResult.stdout).toContain("https://brain.example.com");
    expect(validateResult.failed).toBe(false);
    expect(validateResult.stdout).toContain("valid: true");
    expect(doctorResult.failed).toBe(false);
    expect(doctorResult.stdout).toContain("[warning] llm_env");
  });

  it("fails non-interactive setup when required options are missing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "braincode-setup-missing-"));
    tempRoots.push(root);
    const configPath = path.join(root, "config.yaml");

    const result = await runCli(["--config", configPath, "setup", "--non-interactive"]);

    expect(result.failed).toBe(true);
    expect(result.stderr).toContain("--project-name");
    expect(result.stderr).toContain("--project-path");
  });

  it("reports invalid config through doctor", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "braincode-doctor-invalid-"));
    tempRoots.push(root);
    const configPath = path.join(root, "config.yaml");
    await writeFile(configPath, "brain:\n  repo: 42\n", "utf8");

    const result = await runCli(["--config", configPath, "doctor"]);

    expect(result.failed).toBe(true);
    expect(result.stdout).toContain("[error] config_invalid");
  });
});
