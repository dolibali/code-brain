export type SyncManifestProject = {
  id: string;
  title?: string;
  main_branch: string;
  git_remotes: string[];
};

export type SyncManifestPage = {
  project: string;
  slug: string;
  content_hash: string;
  updated_at: string;
  size: number;
};

export type SyncManifest = {
  version: 1;
  generated_at: string;
  projects: SyncManifestProject[];
  pages: SyncManifestPage[];
};

export type SyncPagePayload = {
  project: string;
  slug: string;
  content: string;
  content_hash: string;
};

export type SyncProjectPayload = {
  id: string;
  title?: string;
  main_branch: string;
  git_remotes: string[];
};

export type SyncDiff = {
  same: number;
  changed: SyncManifestPage[];
  localOnly: SyncManifestPage[];
  remoteOnly: SyncManifestPage[];
};

export type SyncPullResult = {
  downloaded: number;
  pruned: number;
  reindexedProjects: number;
  reindexedPages: number;
};

export type SyncPushResult = {
  uploaded: number;
};
