import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, upsertProject, writeConfig } from "../src/config/load-config.js";
import { openIndexDatabase } from "../src/storage/index-db.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (root) => {
      const fs = await import("node:fs/promises");
      await fs.rm(root, { recursive: true, force: true });
    })
  );
});

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "code-brain-"));
  tempRoots.push(root);
  return root;
}

describe("config loading", () => {
  it("returns defaults when config file does not exist", async () => {
    const root = await createTempRoot();
    const configPath = path.join(root, "config.yaml");

    const loaded = await loadConfig(configPath);

    expect(loaded.exists).toBe(false);
    expect(loaded.path).toBe(configPath);
    expect(loaded.config.projects).toHaveLength(0);
  });

  it("writes and reloads projects using snake_case yaml keys", async () => {
    const root = await createTempRoot();
    const configPath = path.join(root, "config.yaml");
    const loaded = await loadConfig(configPath);
    const nextConfig = upsertProject(loaded.config, {
      id: "code-brain",
      root: path.join(root, "workspace"),
      remotes: ["github.com/example/code-brain"]
    });

    await writeConfig({ path: configPath, config: nextConfig });

    const raw = await readFile(configPath, "utf8");
    const reloaded = await loadConfig(configPath);

    expect(raw).toContain("index_db:");
    expect(reloaded.exists).toBe(true);
    expect(reloaded.config.projects[0]?.id).toBe("code-brain");
  });

  it("loads OpenAI-compatible provider presets for Chinese vendors", async () => {
    const root = await createTempRoot();
    const configPath = path.join(root, "config.yaml");
    const yaml = `
brain:
  repo: ./brain
  index_db: ./state/index.sqlite
projects: []
llm:
  enabled: true
  default_provider: deepseek
  providers:
    zhipu:
      mode: openai-compatible
      base_url: https://open.bigmodel.cn/api/paas/v4/
      api_key_env: ZHIPU_API_KEY
      default_model: glm-4.5
      capabilities: [chat_completions, reasoning_control]
    qwen_bailian:
      mode: openai-compatible
      base_url: https://dashscope.aliyuncs.com/compatible-mode/v1
      api_key_env: DASHSCOPE_API_KEY
      default_model: qwen-max
      capabilities: [chat_completions, responses_api]
    minimax:
      mode: openai-compatible
      base_url: https://api.minimax.io/v1
      api_key_env: MINIMAX_API_KEY
      default_model: MiniMax-M1
      capabilities: [chat_completions, reasoning_control]
    deepseek:
      mode: openai-compatible
      base_url: https://api.deepseek.com
      api_key_env: DEEPSEEK_API_KEY
      default_model: deepseek-chat
      capabilities: [chat_completions]
    kimi:
      mode: openai-compatible
      base_url: https://api.moonshot.cn/v1
      api_key_env: MOONSHOT_API_KEY
      default_model: kimi-k2
      capabilities: [chat_completions, reasoning_control]
  routing:
    search: deepseek
    extract: qwen_bailian
    dedup: zhipu
`;

    await writeFile(configPath, yaml, "utf8");
    const loaded = await loadConfig(configPath);

    expect(loaded.config.llm.enabled).toBe(true);
    expect(Object.keys(loaded.config.llm.providers)).toEqual([
      "zhipu",
      "qwen_bailian",
      "minimax",
      "deepseek",
      "kimi"
    ]);
    expect(loaded.config.llm.providers.qwen_bailian?.baseUrl).toContain("dashscope.aliyuncs.com");
    expect(loaded.config.llm.routing.search).toBe("deepseek");
    expect(loaded.config.llm.routing.extract).toBe("qwen_bailian");
    expect(loaded.config.llm.routing.dedup).toBe("zhipu");
  });
});

describe("index initialization", () => {
  it("creates schema and enables WAL mode", async () => {
    const root = await createTempRoot();
    const configPath = path.join(root, "config.yaml");
    const loaded = await loadConfig(configPath);
    const configured = {
      ...loaded.config,
      brain: {
        repo: path.join(root, "brain"),
        indexDb: path.join(root, "data", "index.sqlite")
      },
      projects: [
        {
          id: "code-brain",
          root,
          remotes: []
        }
      ]
    };

    const index = await openIndexDatabase(configured);
    try {
      index.initialize();
      index.syncProjects();

      const tables = index.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual table') ORDER BY name ASC"
        )
        .all() as Array<{ name: string }>;

      expect(index.getJournalMode().toLowerCase()).toBe("wal");
      expect(tables.map((table) => table.name)).toContain("projects");
      expect(tables.map((table) => table.name)).toContain("pages");
      expect(tables.map((table) => table.name)).toContain("ingest_events");
    } finally {
      index.close();
    }
  });
});
