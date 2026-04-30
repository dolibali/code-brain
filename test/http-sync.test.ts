import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createBrainCodeHttpServer } from "../src/http/server.js";
import { openService, type ServiceContext } from "../src/runtime/open-service.js";
import { SyncHttpClient } from "../src/sync/http-client.js";
import { pullFromRemote, pushToRemote } from "../src/sync/local-sync.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (root) => {
      await rm(root, { recursive: true, force: true });
    })
  );
});

async function createConfig(root: string, remoteUrl?: string): Promise<string> {
  await mkdir(root, { recursive: true });
  const configPath = path.join(root, "config.yaml");
  await writeFile(
    configPath,
    `
brain:
  repo: ./brain
  index_db: ./state/index.sqlite
projects:
  - id: braincode
    main_branch: main
    roots:
      - ./workspace/braincode
    git_remotes: []
llm:
  enabled: false
server:
  host: 127.0.0.1
  port: 7331
  auth_token_env: BRAINCODE_TEST_TOKEN
remote:
  url: ${remoteUrl ?? "http://127.0.0.1:7331"}
  token_env: BRAINCODE_TEST_TOKEN
sync:
  concurrency: 2
  compression: gzip
  prune_on_pull: true
`,
    "utf8"
  );
  return configPath;
}

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test server did not expose a TCP address");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function testPage(title: string, body: string): string {
  return `---
project: braincode
type: practice
title: ${title}
status: active
source_type: manual
source_agent: codex
created_at: 2026-04-30T00:00:00Z
updated_at: 2026-04-30T00:00:00Z
---

## Rule

${body}
`;
}

describe("HTTP MCP and sync server", () => {
  it("requires bearer auth for HTTP MCP and exposes the same tools", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "braincode-http-mcp-"));
    tempRoots.push(root);
    const configPath = await createConfig(root);
    process.env.BRAINCODE_TEST_TOKEN = "secret-token";
    const service = await openService(configPath);
    const server = createBrainCodeHttpServer({ service, authToken: "secret-token" });
    const baseUrl = await listen(server);

    try {
      const unauthorized = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
      });
      expect(unauthorized.status).toBe(401);

      const client = new Client({
        name: "braincode-http-test",
        version: "0.1.0"
      });
      const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
        requestInit: {
          headers: {
            Authorization: "Bearer secret-token"
          }
        }
      });

      try {
        await client.connect(transport);
        const tools = await client.listTools();
        expect(tools.tools.map((tool) => tool.name)).toEqual([
          "search",
          "get_page",
          "list_pages",
          "put_page",
          "link_pages",
          "get_links",
          "reindex"
        ]);
      } finally {
        await client.close().catch(() => {});
        await transport.close().catch(() => {});
      }
    } finally {
      await closeServer(server);
      service.close();
      delete process.env.BRAINCODE_TEST_TOKEN;
    }
  });

  it("pulls remote truth into local cache and pushes local overwrites back", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "braincode-http-sync-"));
    tempRoots.push(root);
    const remoteRoot = path.join(root, "remote");
    const localRoot = path.join(root, "local");
    const remoteConfigPath = await createConfig(remoteRoot);
    process.env.BRAINCODE_TEST_TOKEN = "secret-token";
    const remoteService = await openService(remoteConfigPath);
    const server = createBrainCodeHttpServer({ service: remoteService, authToken: "secret-token" });
    const baseUrl = await listen(server);
    const localConfigPath = await createConfig(localRoot, baseUrl);
    const localService = await openService(localConfigPath);
    const client = new SyncHttpClient({
      url: baseUrl,
      token: "secret-token",
      compression: "gzip"
    });

    try {
      await remoteService.pages.putPage({
        project: "braincode",
        slug: "practice/remote-rule",
        content: testPage("Remote Rule", "remote truth")
      });

      const pullResult = await pullFromRemote(localService, client);
      expect(pullResult.downloaded).toBe(1);
      const localPage = await localService.pages.getPage("braincode", "practice/remote-rule");
      expect(localPage?.content).toContain("remote truth");

      await localService.pages.putPage({
        project: "braincode",
        slug: "practice/remote-rule",
        content: testPage("Remote Rule", "local overwrite")
      });

      const pushResult = await pushToRemote(localService, client);
      expect(pushResult.uploaded).toBe(1);
      const remotePage = await remoteService.pages.getPage("braincode", "practice/remote-rule");
      expect(remotePage?.content).toContain("local overwrite");
    } finally {
      await closeServer(server);
      localService.close();
      remoteService.close();
      delete process.env.BRAINCODE_TEST_TOKEN;
    }
  });
});
