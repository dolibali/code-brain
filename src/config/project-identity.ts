import type { BrainCodeConfig, ProjectRegistration } from "./schema.js";

export class ProjectIdentityConflictError extends Error {
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = "ProjectIdentityConflictError";
  }
}

export function normalizeGitRemote(remote: string): string {
  const trimmed = remote.trim();
  if (!trimmed) {
    return "";
  }

  const scpLike = /^(?:[^@]+@)?([^:]+):(.+)$/.exec(trimmed);
  if (scpLike && !trimmed.includes("://")) {
    return stripGitSuffix(`${scpLike[1]}/${scpLike[2]}`);
  }

  try {
    const parsed = new URL(trimmed);
    return stripGitSuffix(`${parsed.hostname}${parsed.pathname}`);
  } catch {
    return stripGitSuffix(trimmed);
  }
}

function stripGitSuffix(input: string): string {
  return input.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "").toLowerCase();
}

function uniqueByValue(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)));
}

function uniqueRemotes(remotes: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const remote of remotes) {
    const normalized = normalizeGitRemote(remote);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(remote);
  }

  return result;
}

export function findProjectRemoteConflict(
  config: BrainCodeConfig,
  project: ProjectRegistration
): { projectId: string; remote: string } | null {
  const incomingRemotes = new Map(
    project.gitRemotes
      .map((remote) => [normalizeGitRemote(remote), remote] as const)
      .filter(([normalized]) => normalized.length > 0)
  );

  if (incomingRemotes.size === 0) {
    return null;
  }

  for (const existing of config.projects) {
    if (existing.id === project.id) {
      continue;
    }

    for (const existingRemote of existing.gitRemotes) {
      const normalized = normalizeGitRemote(existingRemote);
      const incomingRemote = incomingRemotes.get(normalized);
      if (incomingRemote) {
        return {
          projectId: existing.id,
          remote: incomingRemote
        };
      }
    }
  }

  return null;
}

export function upsertProjectIdentity(
  config: BrainCodeConfig,
  project: ProjectRegistration
): BrainCodeConfig {
  const conflict = findProjectRemoteConflict(config, project);
  if (conflict) {
    throw new ProjectIdentityConflictError(
      `Git remote '${conflict.remote}' is already registered to project '${conflict.projectId}'. Use that project name instead.`
    );
  }

  const existing = config.projects.findIndex((entry) => entry.id === project.id);
  const normalizedProject: ProjectRegistration = {
    ...project,
    roots: uniqueByValue(project.roots),
    gitRemotes: uniqueRemotes(project.gitRemotes)
  };

  if (existing === -1) {
    return {
      ...config,
      projects: [...config.projects, normalizedProject]
    };
  }

  const current = config.projects[existing]!;
  const nextProjects = [...config.projects];
  nextProjects[existing] = {
    id: current.id,
    title: normalizedProject.title ?? current.title,
    mainBranch: normalizedProject.mainBranch || current.mainBranch,
    roots: uniqueByValue([...current.roots, ...normalizedProject.roots]),
    gitRemotes: uniqueRemotes([...current.gitRemotes, ...normalizedProject.gitRemotes])
  };

  return {
    ...config,
    projects: nextProjects
  };
}
