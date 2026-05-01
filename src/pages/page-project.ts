import path from "node:path";
import type { BrainCodeConfig } from "../config/schema.js";
import { singleValidationError } from "../errors/validation-error.js";
import { resolveProject } from "../projects/resolve-project.js";

export function findProject(config: BrainCodeConfig, projectId: string): { id: string } {
  const project = config.projects.find((entry) => entry.id === projectId);
  if (!project) {
    throw new Error(`Unknown project '${projectId}'. Add it first with 'braincode project add'.`);
  }

  return project;
}

export function resolveStoredProject(input: {
  config: BrainCodeConfig;
  frontmatterProject: string;
  project?: string;
  contextPath?: string;
}): string {
  if (input.project && input.project !== input.frontmatterProject) {
    throw singleValidationError(
      "project",
      `project '${input.project}' does not match frontmatter project '${input.frontmatterProject}'.`
    );
  }

  const resolvedFromContext = input.contextPath
    ? resolveProject(input.config, {
        contextPath: input.contextPath,
        cwd: process.cwd()
      })
    : null;

  if (resolvedFromContext && resolvedFromContext.projectId !== input.frontmatterProject) {
    throw singleValidationError(
      "project",
      `context_path resolves to project '${resolvedFromContext.projectId}', but frontmatter project is '${input.frontmatterProject}'.`
    );
  }

  findProject(input.config, input.frontmatterProject);
  return input.frontmatterProject;
}

export function selectProjectForRead(config: BrainCodeConfig, project?: string): string {
  const resolved = resolveProject(config, {
    project,
    cwd: process.cwd()
  });

  if (!resolved) {
    throw new Error("Unable to resolve project. Pass --project.");
  }

  return resolved.projectId;
}

export function resolveProjectPagesRoot(config: BrainCodeConfig, projectId: string): string {
  findProject(config, projectId);
  return path.join(config.brain.repo, "projects", projectId, "pages");
}
