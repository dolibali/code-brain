import { describe, expect, it } from "vitest";
import { parsePageMarkdown } from "../src/pages/parse-page.js";

function createPage(type: "issue" | "architecture" | "decision" | "practice" | "change"): string {
  return `---
project: code-brain
type: ${type}
title: Example ${type}
tags:
  - tag-a
aliases:
  - alias-a
scope_refs:
  - kind: file
    value: src/example.ts
status: active
source_type: manual
source_agent: codex
created_at: 2026-04-18T10:15:00Z
updated_at: 2026-04-18T10:20:00Z
---

## Body

Some content here.
`;
}

describe("parsePageMarkdown", () => {
  it.each([
    "issue",
    "architecture",
    "decision",
    "practice",
    "change"
  ] as const)("accepts %s pages with required frontmatter", (type) => {
    const parsed = parsePageMarkdown(createPage(type));

    expect(parsed.frontmatter.type).toBe(type);
    expect(parsed.frontmatter.project).toBe("code-brain");
    expect(parsed.frontmatter.scopeRefs).toHaveLength(1);
    expect(parsed.body).toContain("Some content here.");
  });

  it("rejects missing required fields", () => {
    const invalid = `---
type: issue
title: Missing project
tags: []
aliases: []
scope_refs: []
status: active
source_type: manual
source_agent: codex
created_at: 2026-04-18T10:15:00Z
updated_at: 2026-04-18T10:20:00Z
---
`;

    expect(() => parsePageMarkdown(invalid)).toThrowError();
  });

  it("rejects invalid scope kinds", () => {
    const invalid = `---
project: code-brain
type: issue
title: Bad scope
tags: []
aliases: []
scope_refs:
  - kind: package
    value: src/example.ts
status: active
source_type: manual
source_agent: codex
created_at: 2026-04-18T10:15:00Z
updated_at: 2026-04-18T10:20:00Z
---
`;

    expect(() => parsePageMarkdown(invalid)).toThrowError();
  });
});
