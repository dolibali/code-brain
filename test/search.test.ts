import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { CodeBrainConfig } from "../src/config/schema.js";
import { PageRepository } from "../src/pages/repository.js";
import { ensureBrainDirectories } from "../src/projects/project-registry.js";
import { resolveProject } from "../src/projects/resolve-project.js";
import { SearchService } from "../src/search/search-service.js";
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

async function createFixture(): Promise<{
  config: CodeBrainConfig;
  pages: PageRepository;
  search: SearchService;
  index: Awaited<ReturnType<typeof openIndexDatabase>>;
  close: () => void;
  roots: { codeBrain: string; kiloCode: string };
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "code-brain-search-"));
  tempRoots.push(root);

  const roots = {
    codeBrain: path.join(root, "workspace", "code-brain"),
    kiloCode: path.join(root, "workspace", "kilo-code")
  };

  const config: CodeBrainConfig = {
    brain: {
      repo: path.join(root, "brain"),
      indexDb: path.join(root, "state", "index.sqlite")
    },
    projects: [
      {
        id: "code-brain",
        root: roots.codeBrain,
        remotes: []
      },
      {
        id: "kilo-code",
        root: roots.kiloCode,
        remotes: []
      }
    ],
    llm: {
      enabled: false,
      providers: {},
      routing: {}
    }
  };

  await ensureBrainDirectories(config);
  const index = await openIndexDatabase(config);
  index.initialize();
  index.syncProjects();

  return {
    config,
    pages: new PageRepository(config, index),
    search: new SearchService(config, index),
    index,
    close: () => index.close(),
    roots
  };
}

describe("project resolution", () => {
  it("prefers explicit project over context path", async () => {
    const fixture = await createFixture();

    try {
      const resolved = resolveProject(fixture.config, {
        project: "code-brain",
        contextPath: path.join(fixture.roots.kiloCode, "src")
      });

      expect(resolved?.projectId).toBe("code-brain");
      expect(resolved?.reason).toBe("explicit_project");
    } finally {
      fixture.close();
    }
  });
});

describe("search service", () => {
  it("supports mixed Chinese and English queries with type filters", async () => {
    const fixture = await createFixture();

    try {
      await fixture.pages.upsertPage({
        project: "code-brain",
        type: "issue",
        title: "Electron Sandbox Crash",
        body: `## Symptoms\n\nElectron 沙箱启动崩溃，preload bridge 访问失败。\n\n## Timeline\n\n- 2026-04-18 | fixed`,
        status: "fixed",
        sourceType: "manual",
        sourceAgent: "codex",
        tags: ["electron", "sandbox"],
        scopeRefs: [
          {
            kind: "file",
            value: "src/main/preload.ts"
          }
        ]
      });

      await fixture.pages.upsertPage({
        project: "code-brain",
        type: "practice",
        title: "Preload Bridge Rule",
        body: `## Rule\n\n在 sandbox 场景下通过 preload bridge 暴露 browser-safe API。`,
        status: "active",
        sourceType: "manual",
        sourceAgent: "codex",
        tags: ["bridge"]
      });

      const results = fixture.search.search({
        query: "electron 沙箱 崩溃 preload",
        contextPath: path.join(fixture.roots.codeBrain, "src"),
        types: ["issue"],
        scopeRefs: [
          {
            kind: "file",
            value: "src/main/preload.ts"
          }
        ],
        limit: 5
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.slug).toBe("electron-sandbox-crash");
      expect(results[0]?.type).toBe("issue");
    } finally {
      fixture.close();
    }
  });

  it("falls back to local ranking when the LLM rerank hook fails", async () => {
    const fixture = await createFixture();

    try {
      fixture.config.llm.enabled = true;
      const failingSearch = new SearchService(fixture.config, fixture.index, {
        rerank: () => {
          throw new Error("simulated llm failure");
        }
      });

      await fixture.pages.upsertPage({
        project: "code-brain",
        type: "issue",
        title: "Electron Sandbox Crash",
        body: `## Symptoms\n\nElectron sandbox crash.\n\n## Timeline\n\n- 2026-04-18 | fixed`,
        status: "fixed",
        sourceType: "manual",
        sourceAgent: "codex"
      });

      const results = failingSearch.search({
        query: "electron sandbox crash",
        project: "code-brain"
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.slug).toBe("electron-sandbox-crash");
    } finally {
      fixture.close();
    }
  });
});
