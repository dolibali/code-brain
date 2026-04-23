import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function runCli(repoRoot, args, env) {
  const child = spawn(process.execPath, [path.join(repoRoot, "dist/src/main.js"), ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });

  if (exitCode !== 0) {
    throw new Error(`CLI failed (${args.join(" ")}): ${stderr || stdout}`);
  }

  return { stdout, stderr };
}

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "code-brain-mcp-smoke-"));
  const configPath = path.join(tempRoot, "config.yaml");

  try {
    await runCli(repoRoot, ["--config", configPath, "init"], {});
    await runCli(
      repoRoot,
      [
        "--config",
        configPath,
        "project",
        "register",
        "--id",
        "smoke-project",
        "--root",
        path.join(tempRoot, "workspace"),
        "--main-branch",
        "main"
      ],
      {}
    );

    const markdownPath = path.join(tempRoot, "page.md");
    await writeFile(
      markdownPath,
      `---
project: smoke-project
type: practice
title: MCP Smoke Rule
status: active
source_type: manual
source_agent: codex
created_at: 2026-04-24T00:00:00Z
updated_at: 2026-04-24T00:00:00Z
---

## Rule

This page exists for the stdio MCP smoke test.
`,
      "utf8"
    );

    await runCli(
      repoRoot,
      [
        "--config",
        configPath,
        "put",
        "practice/mcp-smoke-rule",
        "--project",
        "smoke-project",
        "--file",
        markdownPath
      ],
      {}
    );

    const client = new Client({
      name: "code-brain-smoke-client",
      version: "0.2.0"
    });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(repoRoot, "dist/src/main.js"), "--config", configPath, "serve"],
      cwd: repoRoot,
      env: process.env,
      stderr: "pipe"
    });

    let stderr = "";
    transport.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      const toolNames = tools.tools.map((tool) => tool.name);
      if (!toolNames.includes("search") || !toolNames.includes("get_page")) {
        throw new Error(`Expected search/get_page tools, got: ${toolNames.join(", ")}`);
      }

      const searchResult = await client.callTool({
        name: "search",
        arguments: {
          query: "MCP Smoke Rule",
          project: "smoke-project"
        }
      });
      const searchText = searchResult.content[0]?.type === "text" ? searchResult.content[0].text : "";
      if (!searchText?.includes("practice/mcp-smoke-rule")) {
        throw new Error(`search did not return expected slug. stderr=${stderr}`);
      }

      const pageResult = await client.callTool({
        name: "get_page",
        arguments: {
          project: "smoke-project",
          slug: "practice/mcp-smoke-rule"
        }
      });
      const pageText = pageResult.content[0]?.type === "text" ? pageResult.content[0].text : "";
      if (!pageText?.includes("This page exists for the stdio MCP smoke test.")) {
        throw new Error(`get_page did not return expected content. stderr=${stderr}`);
      }
    } finally {
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
    }

    console.log("MCP smoke test passed.");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
