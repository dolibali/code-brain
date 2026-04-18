import path from "node:path";
import type { PageType } from "./schema.js";

const SLUG_SEGMENT_PATTERN = /^[a-z0-9-]+$/;
const CHANGE_YEAR_PATTERN = /^[0-9]{4}$/;
const CHANGE_DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

function assertSlugSegment(segment: string, label: string): void {
  if (!SLUG_SEGMENT_PATTERN.test(segment)) {
    throw new Error(`${label} '${segment}' must use only [a-z0-9-].`);
  }
}

export function normalizePageRef(input: string): string {
  return input.trim().replace(/^\/+|\/+$/g, "");
}

export function validatePageSlug(slugInput: string, expectedType?: PageType): string {
  const slug = normalizePageRef(slugInput);
  const parts = slug.split("/");
  const type = parts[0] as PageType | undefined;

  if (!type) {
    throw new Error("slug must not be empty.");
  }

  if (expectedType && type !== expectedType) {
    throw new Error(`slug '${slug}' does not match page type '${expectedType}'.`);
  }

  if (type === "change") {
    if (parts.length !== 3) {
      throw new Error(`change slug '${slug}' must use change/<year>/<yyyy-mm-dd>-<slug>.`);
    }

    const [_, year, datedSlug] = parts;
    if (!CHANGE_YEAR_PATTERN.test(year)) {
      throw new Error(`change slug year '${year}' must be four digits.`);
    }

    const separatorIndex = datedSlug.indexOf("-");
    if (separatorIndex === -1) {
      throw new Error(`change slug '${slug}' must include a dated slug segment.`);
    }

    const datePart = datedSlug.slice(0, 10);
    const tail = datedSlug.slice(11);
    if (!CHANGE_DATE_PATTERN.test(datePart)) {
      throw new Error(`change slug date '${datePart}' must use yyyy-mm-dd.`);
    }

    if (datePart.slice(0, 4) !== year) {
      throw new Error(`change slug '${slug}' must use the same year in both segments.`);
    }

    if (!tail) {
      throw new Error(`change slug '${slug}' must end with a slug segment.`);
    }

    assertSlugSegment(tail, "change slug tail");
    return slug;
  }

  if (!["issue", "architecture", "decision", "practice"].includes(type)) {
    throw new Error(
      `slug '${slug}' must start with issue/, architecture/, decision/, practice/, or change/.`
    );
  }

  if (parts.length !== 2) {
    throw new Error(`slug '${slug}' must use <type>/<slug>.`);
  }

  assertSlugSegment(parts[1]!, "slug segment");
  return slug;
}

export function slugToMarkdownPath(projectRoot: string, slugInput: string): string {
  const slug = validatePageSlug(slugInput);
  const [type, ...rest] = slug.split("/");

  switch (type) {
    case "issue":
      return path.join(projectRoot, "issues", `${rest[0]}.md`);
    case "architecture":
      return path.join(projectRoot, "architecture", `${rest[0]}.md`);
    case "decision":
      return path.join(projectRoot, "decisions", `${rest[0]}.md`);
    case "practice":
      return path.join(projectRoot, "practices", `${rest[0]}.md`);
    case "change":
      return path.join(projectRoot, "changes", rest[0]!, `${rest[1]}.md`);
    default: {
      const exhaustive: never = type as never;
      throw new Error(`Unhandled page type '${exhaustive}'.`);
    }
  }
}

export function markdownPathToSlug(projectPagesRoot: string, markdownPath: string): string {
  const relative = path.relative(projectPagesRoot, markdownPath).replace(/\\/g, "/");
  const withoutExtension = relative.replace(/\.md$/, "");
  const parts = withoutExtension.split("/");

  if (parts[0] === "issues" && parts.length === 2) {
    return `issue/${parts[1]}`;
  }

  if (parts[0] === "architecture" && parts.length === 2) {
    return `architecture/${parts[1]}`;
  }

  if (parts[0] === "decisions" && parts.length === 2) {
    return `decision/${parts[1]}`;
  }

  if (parts[0] === "practices" && parts.length === 2) {
    return `practice/${parts[1]}`;
  }

  if (parts[0] === "changes" && parts.length === 3) {
    return `change/${parts[1]}/${parts[2]}`;
  }

  throw new Error(`Unable to derive slug from markdown path '${markdownPath}'.`);
}

