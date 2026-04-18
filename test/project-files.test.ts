import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("project docs and tracking files", () => {
  it("documents quickstart, providers, and all four agent loops", async () => {
    const readme = await readFile("/Users/zhangrich/work/code-brain/README.md", "utf8");

    expect(readme).toContain("## Quickstart");
    expect(readme).toContain("qwen_bailian");
    expect(readme).toContain("Claude Code");
    expect(readme).toContain("Cursor");
    expect(readme).toContain("Codex");
    expect(readme).toContain("Gemini CLI");
    expect(readme).toContain("codebrain put");
  });

  it("keeps progress tracking files ready for future agent sessions", async () => {
    const featureList = await readFile("/Users/zhangrich/work/code-brain/feature_list.json", "utf8");
    const progress = await readFile("/Users/zhangrich/work/code-brain/claude-progress.txt", "utf8");
    const claude = await readFile("/Users/zhangrich/work/code-brain/CLAUDE.md", "utf8");
    const agents = await readFile("/Users/zhangrich/work/code-brain/AGENTS.md", "utf8");

    expect(featureList).toContain("\"passes\":");
    expect(progress).toContain("What should be worked on next");
    expect(claude).toContain("Long-Running Task Workflow");
    expect(agents).toContain("Long-Running Task Workflow");
  });
});

