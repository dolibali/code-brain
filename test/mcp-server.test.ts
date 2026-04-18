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
    root: ./workspace/code-brain
    remotes: []
llm:
  enabled: false
`;
  await writeFile(configPath, yaml, "utf8");
  return configPath;
}

describe("Code Brain MCP server", () => {
  it("exposes MCP tools that operate on the same backing service as the CLI", async () => {
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
      expect(toolNames).toContain("record_change");
      expect(toolNames).toContain("get_links");

      const recordResult = await client.callTool({
        name: "record_change",
        arguments: {
          project: "code-brain",
          commit_message: "fix: electron sandbox crash",
          agent_summary: "修复 electron 沙箱启动崩溃，preload bridge 不再直接访问 Node API。",
          scope_refs: [
            {
              kind: "file",
              value: "src/main/preload.ts"
            }
          ],
          source_ref: "mcp-commit-1"
        }
      });

      const searchResult = await client.callTool({
        name: "search",
        arguments: {
          query: "electron 沙箱 崩溃 preload",
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

      const recordContent = (recordResult as { content: Array<{ type: string; text?: string }> }).content;
      const searchContent = (searchResult as { content: Array<{ type: string; text?: string }> }).content;
      const linksContent = (linksResult as { content: Array<{ type: string; text?: string }> }).content;

      expect(recordContent[0]?.type).toBe("text");
      expect(recordContent[0]?.type === "text" ? recordContent[0].text ?? "" : "").toContain(
        "change_slug"
      );
      expect(searchContent[0]?.type === "text" ? searchContent[0].text ?? "" : "").toContain(
        "electron-sandbox-crash"
      );
      expect(linksContent[0]?.type === "text" ? linksContent[0].text ?? "" : "").toContain("updates");
    } finally {
      await client.close();
      await server.close();
      service.close();
    }
  });
});
