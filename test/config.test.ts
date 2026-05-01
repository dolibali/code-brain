import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { getDefaultConfig, loadConfig, upsertProject, writeConfig } from "../src/config/load-config.js";
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
  const root = await mkdtemp(path.join(os.tmpdir(), "braincode-"));
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
    expect(loaded.config.mcp.name).toBe("braincode");
    expect(loaded.config.brain.repo).toBe(path.join(root, "brain"));
    expect(loaded.config.brain.indexDb).toBe(path.join(root, "state", "index.sqlite"));
  });

  it("keeps home defaults for the standard config path", () => {
    const defaults = getDefaultConfig();

    expect(defaults.brain.repo).toContain(path.join(".braincode", "brain"));
    expect(defaults.brain.indexDb).toContain(path.join(".braincode", "index.sqlite"));
  });

  it("writes and reloads projects using snake_case yaml keys", async () => {
    const root = await createTempRoot();
    const configPath = path.join(root, "config.yaml");
    const loaded = await loadConfig(configPath);
    const nextConfig = upsertProject(loaded.config, {
      id: "braincode",
      mainBranch: "main",
      roots: [path.join(root, "workspace")],
      gitRemotes: ["github.com/example/braincode"]
    });

    await writeConfig({ path: configPath, config: nextConfig });

    const raw = await readFile(configPath, "utf8");
    const reloaded = await loadConfig(configPath);

    expect(raw).toContain("index_db:");
    expect(raw).toContain("main_branch:");
    expect(reloaded.exists).toBe(true);
    expect(reloaded.config.projects[0]?.roots).toHaveLength(1);
    expect(reloaded.config.projects[0]?.mainBranch).toBe("main");
  });

  it("allows remote project metadata without local roots", async () => {
    const root = await createTempRoot();
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
    roots: []
    git_remotes:
      - git@github.com:example/braincode.git
llm:
  enabled: false
`,
      "utf8"
    );

    const loaded = await loadConfig(configPath);

    expect(loaded.config.projects[0]?.id).toBe("braincode");
    expect(loaded.config.projects[0]?.roots).toEqual([]);
    expect(loaded.config.projects[0]?.gitRemotes).toEqual(["git@github.com:example/braincode.git"]);
  });

  it("loads provider presets for Chinese vendors with search-only routing", async () => {
    const root = await createTempRoot();
    const configPath = path.join(root, "config.yaml");
    const yaml = `
brain:
  repo: ./brain
  index_db: ./state/index.sqlite
projects: []
llm:
  enabled: true
  provider: deepseek
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
      capabilities: [chat_completions, reasoning_control]
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
      capabilities: [chat_completions, reasoning_control]
    kimi:
      mode: openai-compatible
      base_url: https://api.moonshot.cn/v1
      api_key_env: MOONSHOT_API_KEY
      default_model: kimi-k2
      capabilities: [chat_completions, reasoning_control]
  routing:
    search: deepseek
  request:
    extra_body: {}
  timeout_ms: 8000
  retries: 2
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
    expect(loaded.config.llm.request.extraBody).toEqual({});
  });

  it("loads embedding config independently from llm routing", async () => {
    const root = await createTempRoot();
    const configPath = path.join(root, "config.yaml");
    const yaml = `
brain:
  repo: ./brain
  index_db: ./state/index.sqlite
projects: []
llm:
  enabled: false
embedding:
  enabled: true
  provider: qwen_bailian
  model: text-embedding-v4
  providers:
    qwen_bailian:
      mode: openai-compatible
      base_url: https://dashscope.aliyuncs.com/compatible-mode/v1
      api_key_env: DASHSCOPE_API_KEY
      default_model: text-embedding-v4
      capabilities: [embeddings]
  routing:
    search: qwen_bailian
  dimensions: 1024
  timeout_ms: 5000
  retries: 1
`;

    await writeFile(configPath, yaml, "utf8");
    const loaded = await loadConfig(configPath);

    expect(loaded.config.embedding.enabled).toBe(true);
    expect(loaded.config.embedding.provider).toBe("qwen_bailian");
    expect(loaded.config.embedding.routing.search).toBe("qwen_bailian");
    expect(loaded.config.embedding.model).toBe("text-embedding-v4");
    expect(loaded.config.embedding.dimensions).toBe(1024);
  });

  it("loads remote server and manual sync config", async () => {
    const root = await createTempRoot();
    const configPath = path.join(root, "config.yaml");
    const yaml = `
brain:
  repo: ./brain
  index_db: ./state/index.sqlite
projects: []
llm:
  enabled: false
server:
  host: 0.0.0.0
  port: 7331
  auth_token_env: BRAINCODE_SERVER_TOKEN
  max_body_mb: 32
remote:
  url: https://brain.example.com
  token_env: BRAINCODE_REMOTE_TOKEN
sync:
  concurrency: 4
  compression: gzip
  prune_on_pull: true
`;

    await writeFile(configPath, yaml, "utf8");
    const loaded = await loadConfig(configPath);

    expect(loaded.config.server.host).toBe("0.0.0.0");
    expect(loaded.config.server.port).toBe(7331);
    expect(loaded.config.server.authTokenEnv).toBe("BRAINCODE_SERVER_TOKEN");
    expect(loaded.config.server.maxBodyMb).toBe(32);
    expect(loaded.config.remote.url).toBe("https://brain.example.com");
    expect(loaded.config.remote.tokenEnv).toBe("BRAINCODE_REMOTE_TOKEN");
    expect(loaded.config.sync.concurrency).toBe(4);
    expect(loaded.config.sync.compression).toBe("gzip");
    expect(loaded.config.sync.pruneOnPull).toBe(true);
  });
});

describe("index initialization", () => {
  it("creates schema, enables WAL mode, and provisions embedding storage without ingest_events", async () => {
    const root = await createTempRoot();
    const config = {
      ...getDefaultConfig(),
      brain: {
        repo: path.join(root, "brain"),
        indexDb: path.join(root, "data", "index.sqlite")
      },
      projects: [
        {
          id: "braincode",
          mainBranch: "main",
          roots: [root],
          gitRemotes: []
        }
      ]
    };

    const index = await openIndexDatabase(config);
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
      expect(tables.map((table) => table.name)).toContain("page_embeddings");
      expect(tables.map((table) => table.name)).not.toContain("ingest_events");
    } finally {
      index.close();
    }
  });
});
