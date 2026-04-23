import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/errors/validation-error.js";
import { parsePageMarkdown } from "../src/pages/parse-page.js";

function createPage(
  type: "issue" | "architecture" | "decision" | "practice" | "change",
  status: string
): string {
  return `---
project: braincode
type: ${type}
title: Example ${type}
tags:
  - tag-a
aliases:
  - alias-a
scope_refs:
  - kind: file
    value: src/example.ts
status: ${status}
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
    ["issue", "fixed"],
    ["architecture", "current"],
    ["decision", "accepted"],
    ["practice", "active"],
    ["change", "recorded"]
  ] as const)("accepts %s pages with valid frontmatter", (type, status) => {
    const parsed = parsePageMarkdown(createPage(type, status));

    expect(parsed.frontmatter.type).toBe(type);
    expect(parsed.frontmatter.project).toBe("braincode");
    expect(parsed.frontmatter.scopeRefs).toHaveLength(1);
    expect(parsed.body).toContain("Some content here.");
  });

  it("rejects missing required fields", () => {
    const invalid = `---
type: issue
title: Missing project
status: fixed
source_type: manual
source_agent: codex
created_at: 2026-04-18T10:15:00Z
updated_at: 2026-04-18T10:20:00Z
---
`;

    expect(() => parsePageMarkdown(invalid)).toThrowError("frontmatter validation failed");
  });

  it("rejects invalid status for a page type", () => {
    const invalid = createPage("change", "active");
    expect(() => parsePageMarkdown(invalid)).toThrowError(ValidationError);
    try {
      parsePageMarkdown(invalid);
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details[0]?.message).toContain("status 'active' is not valid");
    }
  });

  it("rejects invalid slug when frontmatter provides one", () => {
    const invalid = `---
project: braincode
slug: issue/中文-slug
type: issue
title: Bad slug
status: fixed
source_type: manual
source_agent: codex
created_at: 2026-04-18T10:15:00Z
updated_at: 2026-04-18T10:20:00Z
---
`;

    expect(() => parsePageMarkdown(invalid)).toThrowError(ValidationError);
    try {
      parsePageMarkdown(invalid);
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details[0]?.message).toContain("must use only [a-z0-9-]");
    }
  });
});
