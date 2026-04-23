import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { getDefaultConfig } from "../src/config/load-config.js";
import type { BrainCodeConfig } from "../src/config/schema.js";
import { EmbeddingIndexRepository } from "../src/embedding/repository.js";
import { LinkRepository } from "../src/links/repository.js";
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
  config: BrainCodeConfig;
  pages: PageRepository;
  links: LinkRepository;
  search: SearchService;
  index: Awaited<ReturnType<typeof openIndexDatabase>>;
  close: () => void;
  roots: { codeBrain: string; kiloCode: string };
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "braincode-search-"));
  tempRoots.push(root);

  const roots = {
    codeBrain: path.join(root, "workspace", "braincode"),
    kiloCode: path.join(root, "workspace", "kilo-code")
  };

  const config: BrainCodeConfig = {
    ...getDefaultConfig(),
    brain: {
      repo: path.join(root, "brain"),
      indexDb: path.join(root, "state", "index.sqlite")
    },
    projects: [
      {
        id: "braincode",
        mainBranch: "main",
        roots: [roots.codeBrain],
        gitRemotes: []
      },
      {
        id: "kilo-code",
        mainBranch: "main",
        roots: [roots.kiloCode],
        gitRemotes: []
      }
    ]
  };

  await ensureBrainDirectories(config);
  const index = await openIndexDatabase(config);
  index.initialize();
  index.syncProjects();

  return {
    config,
    pages: new PageRepository(config, index),
    links: new LinkRepository(index),
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
        project: "braincode",
        contextPath: path.join(fixture.roots.kiloCode, "src")
      });

      expect(resolved?.projectId).toBe("braincode");
      expect(resolved?.reason).toBe("explicit_project");
    } finally {
      fixture.close();
    }
  });
});

describe("search service", () => {
  it("supports mixed Chinese and English queries with type and scope filters", async () => {
    const fixture = await createFixture();

    try {
      await fixture.pages.putPage({
        slug: "issue/electron-sandbox-crash",
        content: `---
project: braincode
type: issue
title: Electron Sandbox Crash
scope_refs:
  - kind: file
    value: src/main/preload.ts
status: fixed
source_type: manual
source_agent: codex
created_at: 2026-04-18T10:15:00Z
updated_at: 2026-04-18T10:20:00Z
---

## Symptoms

Electron 沙箱启动崩溃，preload bridge 访问失败。

## Timeline

- 2026-04-18 | fixed
`
      });

      await fixture.pages.putPage({
        slug: "practice/preload-bridge-rule",
        content: `---
project: braincode
type: practice
title: Preload Bridge Rule
status: active
source_type: manual
source_agent: codex
created_at: 2026-04-18T10:15:00Z
updated_at: 2026-04-18T10:20:00Z
---

## Rule

在 sandbox 场景下通过 preload bridge 暴露 browser-safe API。
`
      });

      const response = await fixture.search.search({
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

      const results = response.results;
      expect(results).toHaveLength(1);
      expect(results[0]?.slug).toBe("issue/electron-sandbox-crash");
      expect(results[0]?.type).toBe("issue");
    } finally {
      fixture.close();
    }
  });

  it("returns related change slugs from the explicit link graph", async () => {
    const fixture = await createFixture();

    try {
      await fixture.pages.putPage({
        slug: "issue/electron-sandbox-crash",
        content: `---
project: braincode
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
`
      });

      await fixture.pages.putPage({
        slug: "change/2026/2026-04-18-preload-bridge-fix",
        content: `---
project: braincode
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
      });

      fixture.links.linkPages({
        project: "braincode",
        fromSlug: "change/2026/2026-04-18-preload-bridge-fix",
        toSlug: "issue/electron-sandbox-crash",
        relation: "updates"
      });

      const response = await fixture.search.search({
        query: "sandbox crashed",
        project: "braincode"
      });

      const results = response.results;
      expect(results[0]?.relatedChanges).toContain("change/2026/2026-04-18-preload-bridge-fix");
    } finally {
      fixture.close();
    }
  });

  it("falls back to local ranking when the LLM augmentor fails", async () => {
    const fixture = await createFixture();

    try {
      fixture.config.llm.enabled = true;
      const failingSearch = new SearchService(fixture.config, fixture.index, {
        augmentor: {
          expandQuery: async () => {
            throw new Error("simulated llm failure");
          },
          rerankResults: async (_input, results) => results
        }
      });

      await fixture.pages.putPage({
        slug: "issue/electron-sandbox-crash",
        content: `---
project: braincode
type: issue
title: Electron Sandbox Crash
status: fixed
source_type: manual
source_agent: codex
created_at: 2026-04-18T10:15:00Z
updated_at: 2026-04-18T10:20:00Z
---

## Symptoms

Electron sandbox crash.

## Timeline

- 2026-04-18 | fixed
`
      });

      const response = await failingSearch.search({
        query: "electron sandbox crash",
        project: "braincode"
      });

      const results = response.results;
      expect(results).toHaveLength(1);
      expect(results[0]?.slug).toBe("issue/electron-sandbox-crash");
      expect(response.strategy.degraded).toBe(true);
    } finally {
      fixture.close();
    }
  });

  it("uses query expansion and reranking when the search augmentor succeeds", async () => {
    const fixture = await createFixture();

    try {
      fixture.config.llm.enabled = true;
      const boostedSearch = new SearchService(fixture.config, fixture.index, {
        augmentor: {
          expandQuery: async () => ({
            queries: ["sandbox bridge crash"],
            preferred_types: ["issue"],
            scope_refs: []
          }),
          rerankResults: async (_input, results) => [...results].reverse()
        }
      });

      await fixture.pages.putPage({
        slug: "issue/electron-sandbox-crash",
        content: `---
project: braincode
type: issue
title: Electron Sandbox Crash
status: fixed
source_type: manual
source_agent: codex
created_at: 2026-04-18T10:15:00Z
updated_at: 2026-04-18T10:20:00Z
---

## Symptoms

Electron sandbox crash.
`
      });

      await fixture.pages.putPage({
        slug: "practice/preload-bridge-rule",
        content: `---
project: braincode
type: practice
title: Preload Bridge Rule
status: active
source_type: manual
source_agent: codex
created_at: 2026-04-18T10:15:00Z
updated_at: 2026-04-18T10:20:00Z
---

## Rule

Use the preload bridge safely after a sandbox bridge crash.
`
      });

      const response = await boostedSearch.search({
        query: "electron sandbox crash",
        project: "braincode"
      });

      expect(response.results).toHaveLength(2);
      expect(response.strategy.queryExpansionUsed).toBe(true);
      expect(response.strategy.reranked).toBe(true);
    } finally {
      fixture.close();
    }
  });

  it("adds embedding-only recall without breaking local FTS results", async () => {
    const fixture = await createFixture();

    try {
      fixture.config.embedding.enabled = true;
      const embeddingRepository = new EmbeddingIndexRepository(fixture.index);
      const pagesWithEmbeddings = new PageRepository(fixture.config, fixture.index, {
        enabled: true,
        provider: {
          embedTexts: async (input) => ({
            model: "mock-embedding",
            vectors: input.map(() => [1, 0, 0])
          })
        },
        repository: embeddingRepository
      });
      const semanticSearch = new SearchService(fixture.config, fixture.index, {
        embeddingProvider: {
          embedTexts: async () => ({
            model: "mock-embedding",
            vectors: [[1, 0, 0]]
          })
        },
        embeddingRepository
      });

      await pagesWithEmbeddings.putPage({
        slug: "practice/preload-bridge-rule",
        content: `---
project: braincode
type: practice
title: Preload Bridge Rule
status: active
source_type: manual
source_agent: codex
created_at: 2026-04-18T10:15:00Z
updated_at: 2026-04-18T10:20:00Z
---

## Rule

Expose browser-safe APIs over the preload bridge.
`
      });

      const response = await semanticSearch.search({
        query: "renderer safe bridge rule",
        project: "braincode"
      });

      expect(response.results[0]?.slug).toBe("practice/preload-bridge-rule");
      expect(response.strategy.embeddingUsed).toBe(true);
    } finally {
      fixture.close();
    }
  });
});
