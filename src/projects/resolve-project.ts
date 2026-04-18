import path from "node:path";
import type { CodeBrainConfig } from "../config/schema.js";

export type ResolveProjectInput = {
  project?: string;
  contextPath?: string;
  cwd?: string;
};

export type ResolvedProject = {
  projectId: string;
  reason: "explicit_project" | "context_path" | "cwd" | "single_project_fallback";
};

function normalizePath(input: string): string {
  return path.resolve(input);
}

function findProjectByPath(config: CodeBrainConfig, candidatePath?: string): string | null {
  if (!candidatePath) {
    return null;
  }

  const normalizedCandidate = normalizePath(candidatePath);
  const matches = config.projects
    .map((project) => ({
      id: project.id,
      root: normalizePath(project.root)
    }))
    .filter((project) => normalizedCandidate === project.root || normalizedCandidate.startsWith(`${project.root}${path.sep}`))
    .sort((left, right) => right.root.length - left.root.length);

  return matches[0]?.id ?? null;
}

export function resolveProject(config: CodeBrainConfig, input: ResolveProjectInput): ResolvedProject | null {
  if (input.project) {
    const exists = config.projects.some((project) => project.id === input.project);
    if (!exists) {
      throw new Error(`Unknown project '${input.project}'. Register it first.`);
    }

    return {
      projectId: input.project,
      reason: "explicit_project"
    };
  }

  const contextMatch = findProjectByPath(config, input.contextPath);
  if (contextMatch) {
    return {
      projectId: contextMatch,
      reason: "context_path"
    };
  }

  const cwdMatch = findProjectByPath(config, input.cwd);
  if (cwdMatch) {
    return {
      projectId: cwdMatch,
      reason: "cwd"
    };
  }

  if (config.projects.length === 1) {
    return {
      projectId: config.projects[0]!.id,
      reason: "single_project_fallback"
    };
  }

  return null;
}

