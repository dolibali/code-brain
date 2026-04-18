import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { CodeBrainConfig } from "../src/config/schema.js";
import { RecordChangeService } from "../src/changes/record-change-service.js";
import { LinkRepository } from "../src/links/repository.js";
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

async function createFixture(llmEnabled = false): Promise<{
  config: CodeBrainConfig;
  pages: PageRepository;
  links: LinkRepository;
  changes: RecordChangeService;
  index: Awaited<ReturnType<typeof openIndexDatabase>>;
  close: () => void;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "code-brain-change-"));
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
        remotes: []
      }
    ],
    llm: {
      enabled: llmEnabled,
      providers: {},
      routing: {}
    }
  };

  await ensureBrainDirectories(config);
  const index = await openIndexDatabase(config);
  index.initialize();
  index.syncProjects();

  const pages = new PageRepository(config, index);
  const links = new LinkRepository(index);
  const changes = new RecordChangeService(config, index, pages, links);

  return {
    config,
    pages,
    links,
    changes,
    index,
    close: () => index.close()
  };
}

describe("RecordChangeService", () => {
  it("creates a change page, dedupes ingest events, and links to an issue in rule mode", async () => {
    const fixture = await createFixture(false);

    try {
      const first = await fixture.changes.recordChange({
        project: "code-brain",
        commitMessage: "fix: electron sandbox crash",
        agentSummary: "修复 electron 沙箱启动崩溃，preload bridge 不再直接访问 Node API。",
        scopeRefs: [
          {
            kind: "file",
            value: "src/main/preload.ts"
          }
        ],
        sourceRef: "abc1234"
      });

      expect(first.mode).toBe("rule");
      expect(first.changePage.slug).toContain("electron-sandbox-crash");
      expect(first.linkedPages.some((page) => page.frontmatter.type === "issue")).toBe(true);

      const second = await fixture.changes.recordChange({
        project: "code-brain",
        commitMessage: "fix: electron sandbox crash",
        agentSummary: "修复 electron 沙箱启动崩溃，preload bridge 不再直接访问 Node API。",
        scopeRefs: [
          {
            kind: "file",
            value: "src/main/preload.ts"
          }
        ],
        sourceRef: "abc1234"
      });

      const ingestCountRow = fixture.index.db
        .prepare("SELECT COUNT(*) AS count FROM ingest_events")
        .get() as { count: number };
      const pageCountRow = fixture.index.db
        .prepare("SELECT COUNT(*) AS count FROM pages")
        .get() as { count: number };

      expect(second.changePage.slug).toBe(first.changePage.slug);
      expect(ingestCountRow.count).toBe(1);
      expect(pageCountRow.count).toBe(2);

      const links = fixture.links.getLinks({
        project: "code-brain",
        slug: first.changePage.slug,
        direction: "outgoing"
      });
      expect(links).toHaveLength(1);
      expect(links[0]?.relation).toBe("updates");
      expect(links[0]?.otherType).toBe("issue");
    } finally {
      fixture.close();
    }
  });

  it("creates a practice page in llm mode when the summary encodes a reusable rule", async () => {
    const fixture = await createFixture(true);

    try {
      const result = await fixture.changes.recordChange({
        project: "code-brain",
        agentSummary:
          "规则：在 sandbox 场景下必须通过 preload bridge 暴露 browser-safe API，避免直接访问 Node API。",
        scopeRefs: [
          {
            kind: "file",
            value: "src/main/preload.ts"
          }
        ],
        sourceRef: "task-42"
      });

      expect(result.mode).toBe("llm");
      expect(result.linkedPages.some((page) => page.frontmatter.type === "practice")).toBe(true);

      const practicePage = result.linkedPages.find((page) => page.frontmatter.type === "practice");
      expect(practicePage?.body).toContain("## Rule");
      expect(practicePage?.frontmatter.seeAlso).toContain(result.changePage.slug);
    } finally {
      fixture.close();
    }
  });

  it("can create architecture and decision pages when explicit related types are provided", async () => {
    const fixture = await createFixture(true);

    try {
      const result = await fixture.changes.recordChange({
        project: "code-brain",
        title: "Migrate extension host lifecycle bootstrap",
        agentSummary: "选择将 extension host 生命周期迁移到新的 bootstrap 流程，并更新模块边界。",
        relatedTypes: ["architecture", "decision"],
        scopeRefs: [
          {
            kind: "module",
            value: "src/extension-host"
          }
        ],
        sourceRef: "task-arch-1"
      });

      expect(result.linkedPages.some((page) => page.frontmatter.type === "architecture")).toBe(true);
      expect(result.linkedPages.some((page) => page.frontmatter.type === "decision")).toBe(true);

      const outgoing = fixture.links.getLinks({
        project: "code-brain",
        slug: result.changePage.slug,
        direction: "outgoing"
      });

      expect(outgoing.some((link) => link.otherType === "architecture")).toBe(true);
      expect(outgoing.some((link) => link.otherType === "decision")).toBe(true);
    } finally {
      fixture.close();
    }
  });
});
