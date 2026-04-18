import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { getDefaultConfig } from "../src/config/load-config.js";
import type { CodeBrainConfig } from "../src/config/schema.js";
import { ValidationError } from "../src/errors/validation-error.js";
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
  index: Awaited<ReturnType<typeof openIndexDatabase>>;
  close: () => void;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "code-brain-pages-"));
  tempRoots.push(root);

  const config: CodeBrainConfig = {
    ...getDefaultConfig(),
    brain: {
      repo: path.join(root, "brain"),
      indexDb: path.join(root, "state", "index.sqlite")
    },
    projects: [
      {
        id: "code-brain",
        mainBranch: "main",
        roots: [path.join(root, "workspace")],
        gitRemotes: ["github.com/example/code-brain"]
      }
    ]
  };

  await ensureBrainDirectories(config);
  const index = await openIndexDatabase(config);
  index.initialize();
  index.syncProjects();

  return {
    config,
    repository: new PageRepository(config, index),
    index,
    close: () => index.close()
  };
}

describe("PageRepository", () => {
  it("writes markdown first and indexes the page immediately", async () => {
    const fixture = await createFixture();

    try {
      const stored = await fixture.repository.putPage({
        slug: "practice/preload-bridge-rule",
        content: `---
project: code-brain
type: practice
title: Preload Bridge Rule
tags:
  - electron
  - bridge
aliases:
  - preload bridge
scope_refs:
  - kind: file
    value: src/preload.ts
status: active
source_type: manual
source_agent: codex
created_at: 2026-04-18T10:15:00Z
updated_at: 2026-04-18T10:20:00Z
---

## Rule

Use browser-safe bridges.

## Timeline

- 2026-04-18 | created
`
      });

      expect(stored.slug).toBe("practice/preload-bridge-rule");
      expect(stored.markdownPath).toContain("/practices/preload-bridge-rule.md");

      const row = fixture.index.db
        .prepare("SELECT slug, compiled_truth, timeline_text FROM pages WHERE project = ? AND slug = ?")
        .get("code-brain", stored.slug) as
        | { slug: string; compiled_truth: string; timeline_text: string }
        | undefined;

      expect(row?.slug).toBe(stored.slug);
      expect(row?.compiled_truth).toContain("Use browser-safe bridges.");
      expect(row?.timeline_text).toContain("created");
    } finally {
      fixture.close();
    }
  });

  it("lists and retrieves canonical pages with scope filters", async () => {
    const fixture = await createFixture();

    try {
      await fixture.repository.putPage({
        slug: "issue/electron-sandbox-crash",
        content: `---
project: code-brain
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

Sandbox crashed.
`
      });

      await fixture.repository.putPage({
        slug: "practice/preload-bridge-rule",
        content: `---
project: code-brain
type: practice
title: Bridge Rule
scope_refs:
  - kind: file
    value: src/main/preload.ts
status: active
source_type: manual
source_agent: codex
created_at: 2026-04-18T10:15:00Z
updated_at: 2026-04-18T10:20:00Z
---

## Rule

Route access through bridge.
`
      });

      const listed = fixture.repository.listPages({
        project: "code-brain",
        types: ["practice"],
        scopeRefs: [
          {
            kind: "file",
            value: "src/main/preload.ts"
          }
        ],
        limit: 10
      });

      expect(listed).toHaveLength(1);
      expect(listed[0]?.slug).toBe("practice/preload-bridge-rule");

      const loaded = await fixture.repository.getPage("code-brain", "practice/preload-bridge-rule");
      expect(loaded?.frontmatter.title).toBe("Bridge Rule");
      expect(loaded?.content).toContain("Route access through bridge.");
    } finally {
      fixture.close();
    }
  });

  it("reindexes after manual markdown edits", async () => {
    const fixture = await createFixture();

    try {
      const stored = await fixture.repository.putPage({
        slug: "architecture/extension-host-lifecycle",
        content: `---
project: code-brain
type: architecture
title: Extension Host Lifecycle
status: current
source_type: manual
source_agent: codex
created_at: 2026-04-18T10:15:00Z
updated_at: 2026-04-18T10:20:00Z
---

## Purpose

Original body.
`
      });

      const updatedMarkdown = `---
project: code-brain
type: architecture
title: Extension Host Lifecycle
status: current
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
      expect(reloaded?.content).toContain("Updated body after manual edit.");
    } finally {
      fixture.close();
    }
  });

  it("treats project mismatches as validation errors and does not auto-link see_also", async () => {
    const fixture = await createFixture();

    try {
      await expect(
        fixture.repository.putPage({
          project: "code-brain",
          slug: "issue/electron-sandbox-crash",
          content: `---
project: kilo-code
type: issue
title: Electron Sandbox Crash
see_also:
  - practice/preload-bridge-rule
status: fixed
source_type: manual
source_agent: codex
created_at: 2026-04-18T10:15:00Z
updated_at: 2026-04-18T10:20:00Z
---

## Symptoms

Sandbox crashed.
`
        })
      ).rejects.toBeInstanceOf(ValidationError);
    } finally {
      fixture.close();
    }
  });
});
