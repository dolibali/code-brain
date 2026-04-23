import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createCodeBrainMcpServer } from "../src/mcp/server.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (root) => {
      const fs = await import("node:fs/promises");
      await fs.rm(root, { recursive: true, force: true });
    })
  );
});

async function createConfigFile(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "code-brain-mcp-"));
  tempRoots.push(root);
  const configPath = path.join(root, "config.yaml");
  const yaml = `
brain:
  repo: ./brain
  index_db: ./state/index.sqlite
projects:
  - id: code-brain
    main_branch: main
    roots:
      - ./workspace/code-brain
    git_remotes: []
llm:
  enabled: false
`;
  await writeFile(configPath, yaml, "utf8");
  return configPath;
}

describe("Code Brain MCP server", () => {
  it("exposes only thin-service tools and operates on the same backing service as the CLI", async () => {
    const configPath = await createConfigFile();
    const { server, service } = await createCodeBrainMcpServer(configPath);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({
      name: "code-brain-test-client",
      version: "0.1.0"
    });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const tools = await client.listTools();
      const toolNames = tools.tools.map((tool) => tool.name);
      expect(toolNames).toContain("search");
      expect(toolNames).toContain("put_page");
      expect(toolNames).toContain("get_links");
      expect(toolNames).not.toContain("record_change");
      expect(toolNames).not.toContain("upsert_page");

      const pageContent = `---
project: code-brain
type: issue
title: Electron Sandbox Crash
status: fixed
source_type: manual
source_agent: codex
created_at: 2026-04-18T10:15:00Z
updated_at: 2026-04-18T10:20:00Z
---

## Symptoms

修复 electron 沙箱启动崩溃。
`;

      await client.callTool({
        name: "put_page",
        arguments: {
          slug: "issue/electron-sandbox-crash",
          project: "code-brain",
          content: pageContent
        }
      });

      await client.callTool({
        name: "put_page",
        arguments: {
          slug: "change/2026/2026-04-18-preload-bridge-fix",
          project: "code-brain",
          content: `---
project: code-brain
type: change
title: Preload bridge fix
status: recorded
source_type: agent
source_agent: codex
created_at: 2026-04-18T10:15:00Z
updated_at: 2026-04-18T10:20:00Z
---

## Background

Fix preload bridge.
`
        }
      });

      await client.callTool({
        name: "link_pages",
        arguments: {
          project: "code-brain",
          from_slug: "change/2026/2026-04-18-preload-bridge-fix",
          to_slug: "issue/electron-sandbox-crash",
          relation: "updates"
        }
      });

      const searchResult = await client.callTool({
        name: "search",
        arguments: {
          query: "electron 沙箱",
          project: "code-brain"
        }
      });

      const linksResult = await client.callTool({
        name: "get_links",
        arguments: {
          project: "code-brain",
          slug: "issue/electron-sandbox-crash"
        }
      });

      const searchText = (searchResult as { content: Array<{ type: string; text?: string }> }).content[0]?.text ?? "";
      const linksText = (linksResult as { content: Array<{ type: string; text?: string }> }).content[0]?.text ?? "";

      expect(searchText).toContain("issue/electron-sandbox-crash");
      expect(searchText).toContain("change/2026/2026-04-18-preload-bridge-fix");
      expect(searchText).toContain("\"strategy\"");
      expect(linksText).toContain("updates");

      const validationResult = await client.callTool({
        name: "put_page",
        arguments: {
          slug: "issue/electron-sandbox-crash",
          project: "kilo-code",
          content: pageContent
        }
      });
      const validationText =
        (validationResult as { content: Array<{ type: string; text?: string }> }).content[0]?.text ?? "";
      expect(validationText).toContain("\"validation_failed\"");
    } finally {
      await client.close();
      await server.close();
      service.close();
    }
  });
});
