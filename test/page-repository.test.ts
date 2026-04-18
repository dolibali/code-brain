import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { CodeBrainConfig } from "../src/config/schema.js";
import { PageRepository } from "../src/pages/repository.js";
import { ensureBrainDirectories } from "../src/projects/project-registry.js";
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
  repository: PageRepository;
  indexDbPath: string;
  close: () => void;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "code-brain-pages-"));
  tempRoots.push(root);

  const config: CodeBrainConfig = {
    brain: {
      repo: path.join(root, "brain"),
      indexDb: path.join(root, "state", "index.sqlite")
    },
    projects: [
      {
        id: "code-brain",
        root: path.join(root, "workspace"),
        remotes: ["github.com/example/code-brain"]
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
    repository: new PageRepository(config, index),
    indexDbPath: config.brain.indexDb,
    close: () => index.close()
  };
}

describe("PageRepository", () => {
  it("writes markdown first and indexes the page immediately", async () => {
    const fixture = await createFixture();

    try {
      const stored = await fixture.repository.upsertPage({
        project: "code-brain",
        type: "practice",
        title: "Preload Bridge Rule",
        body: `## Rule\n\nUse browser-safe bridges.\n\n## Timeline\n\n- 2026-04-18 | created`,
        status: "active",
        sourceType: "manual",
        sourceAgent: "codex",
        tags: ["electron", "bridge"],
        aliases: ["preload bridge"],
        scopeRefs: [
          {
            kind: "file",
            value: "src/preload.ts"
          }
        ]
      });

      const markdown = await readFile(stored.markdownPath, "utf8");
      expect(markdown).toContain("type: practice");
      expect(markdown).toContain("## Rule");

      const index = await openIndexDatabase(fixture.config);
      try {
        const row = index.db
          .prepare("SELECT slug, compiled_truth, timeline_text FROM pages WHERE project = ? AND slug = ?")
          .get("code-brain", stored.slug) as
          | { slug: string; compiled_truth: string; timeline_text: string }
          | undefined;

        expect(row?.slug).toBe(stored.slug);
        expect(row?.compiled_truth).toContain("Use browser-safe bridges.");
        expect(row?.timeline_text).toContain("created");
      } finally {
        index.close();
      }
    } finally {
      fixture.close();
    }
  });

  it("lists and retrieves canonical pages from markdown truth", async () => {
    const fixture = await createFixture();

    try {
      const issue = await fixture.repository.upsertPage({
        project: "code-brain",
        type: "issue",
        title: "Electron Sandbox Crash",
        body: `## Symptoms\n\nSandbox crashed.\n\n## Timeline\n\n- 2026-04-18 | fixed`,
        status: "fixed",
        sourceType: "manual",
        sourceAgent: "codex",
        tags: ["electron"]
      });

      await fixture.repository.upsertPage({
        project: "code-brain",
        type: "practice",
        title: "Bridge Rule",
        body: `## Rule\n\nRoute access through bridge.`,
        status: "active",
        sourceType: "manual",
        sourceAgent: "codex",
        tags: ["bridge"]
      });

      const listed = fixture.repository.listPages({
        project: "code-brain",
        types: ["issue"],
        limit: 10
      });

      expect(listed).toHaveLength(1);
      expect(listed[0]?.slug).toBe(issue.slug);

      const loaded = await fixture.repository.getPage("code-brain", issue.slug);
      expect(loaded?.frontmatter.title).toBe("Electron Sandbox Crash");
      expect(loaded?.body).toContain("Sandbox crashed.");
    } finally {
      fixture.close();
    }
  });

  it("reindexes after manual markdown edits", async () => {
    const fixture = await createFixture();

    try {
      const stored = await fixture.repository.upsertPage({
        project: "code-brain",
        type: "architecture",
        title: "Extension Host Lifecycle",
        body: `## Purpose\n\nOriginal body.`,
        status: "active",
        sourceType: "manual",
        sourceAgent: "codex"
      });

      const updatedMarkdown = `---
project: code-brain
type: architecture
title: Extension Host Lifecycle
tags:
  - lifecycle
aliases: []
scope_refs: []
status: active
source_type: manual
source_agent: codex
created_at: 2026-04-18T10:15:00Z
updated_at: 2026-04-18T10:30:00Z
---

## Purpose

Updated body after manual edit.
`;

      await writeFile(stored.markdownPath, updatedMarkdown, "utf8");

      const result = await fixture.repository.reindex({ project: "code-brain" });
      const reloaded = await fixture.repository.getPage("code-brain", stored.slug);

      expect(result.projects).toBe(1);
      expect(result.pages).toBe(1);
      expect(reloaded?.body).toContain("Updated body after manual edit.");
    } finally {
      fixture.close();
    }
  });
});
