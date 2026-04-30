import { rm } from "node:fs/promises";
import { createContentHash } from "../embedding/provider.js";
import type { ServiceContext } from "../runtime/open-service.js";
import { resolveProjectPagesRoot } from "../pages/page-project.js";
import { slugToMarkdownPath } from "../pages/page-ref.js";
import { buildSyncManifest, diffManifests, manifestPageKey, readSyncPage } from "./manifest.js";
import { SyncHttpClient } from "./http-client.js";
import type { SyncManifestPage, SyncPullResult, SyncPushResult } from "./types.js";

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const current = items[nextIndex]!;
      nextIndex += 1;
      await worker(current);
    }
  });
  await Promise.all(workers);
}

export async function pullFromRemote(
  service: ServiceContext,
  client: SyncHttpClient
): Promise<SyncPullResult> {
  const localManifest = await buildSyncManifest(service.config);
  const remoteManifest = await client.getManifest();
  const diff = diffManifests(localManifest, remoteManifest);
  const pagesToDownload = [...diff.changed, ...diff.remoteOnly];
  const changedProjects = new Set<string>();

  await runWithConcurrency(pagesToDownload, service.config.sync.concurrency, async (page) => {
    const payload = await client.getPage(page.project, page.slug);
    if (createContentHash(payload.content) !== payload.content_hash) {
      throw new Error(`remote page hash mismatch for ${payload.project}/${payload.slug}`);
    }

    await service.pages.putPage({
      project: payload.project,
      slug: payload.slug,
      content: payload.content
    });
    changedProjects.add(payload.project);
  });

  let pruned = 0;
  if (service.config.sync.pruneOnPull) {
    const remoteKeys = new Set(remoteManifest.pages.map((page) => manifestPageKey(page)));
    const stalePages = localManifest.pages.filter((page) => !remoteKeys.has(manifestPageKey(page)));
    for (const stalePage of stalePages) {
      const markdownPath = slugToMarkdownPath(resolveProjectPagesRoot(service.config, stalePage.project), stalePage.slug);
      await rm(markdownPath, { force: true });
      changedProjects.add(stalePage.project);
      pruned += 1;
    }
  }

  let reindexedProjects = 0;
  let reindexedPages = 0;
  for (const project of changedProjects) {
    const result = await service.pages.reindex({ project });
    reindexedProjects += result.projects;
    reindexedPages += result.pages;
  }

  return {
    downloaded: pagesToDownload.length,
    pruned,
    reindexedProjects,
    reindexedPages
  };
}

export async function pushToRemote(
  service: ServiceContext,
  client: SyncHttpClient
): Promise<SyncPushResult> {
  const localManifest = await buildSyncManifest(service.config);
  const remoteManifest = await client.getManifest();
  const remoteByKey = new Map(remoteManifest.pages.map((page) => [manifestPageKey(page), page]));
  const pagesToUpload = localManifest.pages.filter((page) => {
    const remotePage = remoteByKey.get(manifestPageKey(page));
    return !remotePage || remotePage.content_hash !== page.content_hash;
  });

  await runWithConcurrency(pagesToUpload, service.config.sync.concurrency, async (page) => {
    const payload = await readSyncPage(service.config, page.project, page.slug);
    await client.putPage(payload);
  });

  return {
    uploaded: pagesToUpload.length
  };
}

export async function getSyncStatus(
  service: ServiceContext,
  client: SyncHttpClient
): Promise<{
  same: number;
  changed: SyncManifestPage[];
  localOnly: SyncManifestPage[];
  remoteOnly: SyncManifestPage[];
}> {
  const localManifest = await buildSyncManifest(service.config);
  const remoteManifest = await client.getManifest();
  return diffManifests(localManifest, remoteManifest);
}
