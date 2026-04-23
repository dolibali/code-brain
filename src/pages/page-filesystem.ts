import path from "node:path";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { parsePageMarkdown } from "./parse-page.js";
import type { StoredPage } from "./types.js";

function extractCompiledTruthAndTimeline(body: string): {
  compiledTruth: string;
  timelineText: string;
} {
  const timelineMarker = /^## Timeline\s*$/m;
  const marker = timelineMarker.exec(body);
  if (!marker || marker.index === undefined) {
    return {
      compiledTruth: body.trim(),
      timelineText: ""
    };
  }

  const compiledTruth = body.slice(0, marker.index).trim();
  const timelineText = body.slice(marker.index).replace(/^## Timeline\s*$/m, "").trim();
  return {
    compiledTruth,
    timelineText
  };
}

export async function writeMarkdownAtomically(markdownPath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(markdownPath), { recursive: true });
  const temporaryPath = `${markdownPath}.${process.pid}.${Date.now()}.tmp`;
  const fileHandle = await open(temporaryPath, "w");

  try {
    await fileHandle.writeFile(contents, "utf8");
    await fileHandle.sync();
  } finally {
    await fileHandle.close();
  }

  try {
    await rename(temporaryPath, markdownPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function parseStoredPage(markdownPath: string, slug: string): Promise<StoredPage> {
  const source = await readFile(markdownPath, "utf8");
  const parsed = parsePageMarkdown(source);
  const textParts = extractCompiledTruthAndTimeline(parsed.body);

  return {
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    content: source,
    slug,
    markdownPath,
    compiledTruth: textParts.compiledTruth,
    timelineText: textParts.timelineText
  };
}

export async function walkMarkdownFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });

  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkMarkdownFiles(absolutePath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(absolutePath);
    }
  }

  return files;
}
