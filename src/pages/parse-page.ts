import matter from "gray-matter";
import { ZodError } from "zod";
import { ValidationError } from "../errors/validation-error.js";
import { PageFrontmatterSchema, type PageFrontmatter } from "./schema.js";

export type ParsedPage = {
  frontmatter: PageFrontmatter;
  body: string;
};

function toCamelCase(key: string): string {
  return key.replace(/[_-]([a-z])/g, (_, character: string) => character.toUpperCase());
}

function normalizeKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeKeysDeep(item));
  }

  if (value instanceof Date) {
    return value;
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        toCamelCase(key),
        normalizeKeysDeep(entry)
      ])
    );
  }

  return value;
}

export function parsePageMarkdown(source: string): ParsedPage {
  const parsed = matter(source);
  const normalized = normalizeKeysDeep(parsed.data);

  try {
    const frontmatter = PageFrontmatterSchema.parse(normalized);
    return {
      frontmatter,
      body: parsed.content.trim()
    };
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ValidationError(
        "frontmatter validation failed",
        error.issues.map((issue) => ({
          field: issue.path.join(".") || "frontmatter",
          message: issue.message
        }))
      );
    }

    throw error;
  }
}

