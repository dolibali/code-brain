import matter from "gray-matter";
import type { PageFrontmatter } from "./schema.js";

function toSnakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
}

function normalizeValuesDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValuesDeep(entry));
  }

  if (value === undefined) {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value !== null && typeof value === "object") {
    const normalizedEntries = Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => [toSnakeCase(key), normalizeValuesDeep(entry)] as const)
      .filter(([, entry]) => entry !== undefined);

    return Object.fromEntries(normalizedEntries);
  }

  return value;
}

export function renderPageMarkdown(frontmatter: PageFrontmatter, body: string): string {
  const normalizedFrontmatter = normalizeValuesDeep(frontmatter) as Record<string, unknown>;
  return matter.stringify(body.trim(), normalizedFrontmatter).trimEnd() + "\n";
}
