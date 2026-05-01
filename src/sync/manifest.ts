import { stat, readFile } from "node:fs/promises";
import { createContentHash } from "../embedding/provider.js";
import type { BrainCodeConfig } from "../config/schema.js";
import { markdownPathToSlug, slugToMarkdownPath, validatePageSlug } from "../pages/page-ref.js";
import { walkMarkdownFiles } from "../pages/page-filesystem.js";
import { resolveProjectPagesRoot, selectProjectForRead } from "../pages/page-project.js";
import type { SyncDiff, SyncManifest, SyncManifestPage, SyncPagePayload } from "./types.js";

function pageKey(page: Pick<SyncManifestPage, "project" | "slug">): string {
  return `${page.project}\0${page.slug}`;
}

export async function buildSyncManifest(config: BrainCodeConfig): Promise<SyncManifest> {
  const pages: SyncManifestPage[] = [];

  for (const project of config.projects) {
    const projectRoot = resolveProjectPagesRoot(config, project.id);
    const markdownFiles = await walkMarkdownFiles(projectRoot);

    for (const markdownPath of markdownFiles) {
      const content = await readFile(markdownPath, "utf8");
      const fileStat = await stat(markdownPath);
      pages.push({
        project: project.id,
        slug: markdownPathToSlug(projectRoot, markdownPath),
        content_hash: createContentHash(content),
        updated_at: fileStat.mtime.toISOString(),
        size: fileStat.size
      });
    }
  }

  pages.sort((left, right) => pageKey(left).localeCompare(pageKey(right)));

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    projects: config.projects.map((project) => ({
      id: project.id,
      title: project.title,
      main_branch: project.mainBranch,
      git_remotes: project.gitRemotes
    })),
    pages
  };
}

export async function readSyncPage(config: BrainCodeConfig, projectInput: string, slugInput: string): Promise<SyncPagePayload> {
  const project = selectProjectForRead(config, projectInput);
  const slug = validatePageSlug(slugInput);
  const markdownPath = slugToMarkdownPath(resolveProjectPagesRoot(config, project), slug);
  const content = await readFile(markdownPath, "utf8");

  return {
    project,
    slug,
    content,
    content_hash: createContentHash(content)
  };
}

export function diffManifests(local: SyncManifest, remote: SyncManifest): SyncDiff {
  const localByKey = new Map(local.pages.map((page) => [pageKey(page), page]));
  const remoteByKey = new Map(remote.pages.map((page) => [pageKey(page), page]));

  const changed: SyncManifestPage[] = [];
  const localOnly: SyncManifestPage[] = [];
  const remoteOnly: SyncManifestPage[] = [];
  let same = 0;

  for (const localPage of local.pages) {
    const remotePage = remoteByKey.get(pageKey(localPage));
    if (!remotePage) {
      localOnly.push(localPage);
      continue;
    }

    if (localPage.content_hash === remotePage.content_hash) {
      same += 1;
      continue;
    }

    changed.push(remotePage);
  }

  for (const remotePage of remote.pages) {
    if (!localByKey.has(pageKey(remotePage))) {
      remoteOnly.push(remotePage);
    }
  }

  return { same, changed, localOnly, remoteOnly };
}

export function manifestPageKey(page: Pick<SyncManifestPage, "project" | "slug">): string {
  return pageKey(page);
}
