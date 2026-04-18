import crypto from "node:crypto";
import type { ChangeKind, ScopeRef } from "../pages/schema.js";

export type ChangeSourceType = "commit" | "diff" | "agent_summary" | "manual";

const SCOPE_PRIORITY: Record<ScopeRef["kind"], number> = {
  symbol: 0,
  file: 1,
  module: 2,
  repo: 3
};

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function uniqueScopeRefs(scopeRefs: ScopeRef[]): ScopeRef[] {
  const seen = new Set<string>();
  const results: ScopeRef[] = [];

  for (const scope of scopeRefs) {
    const key = `${scope.kind}:${normalizeWhitespace(scope.value)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push({
      kind: scope.kind,
      value: normalizeWhitespace(scope.value)
    });
  }

  return results;
}

export function inferSourceType(input: {
  sourceRef?: string;
  diff?: string;
  commitMessage?: string;
  agentSummary?: string;
}): ChangeSourceType {
  if (input.commitMessage) {
    return "commit";
  }

  if (input.diff) {
    return "diff";
  }

  if (input.agentSummary) {
    return "agent_summary";
  }

  return "manual";
}

export function buildNormalizedSourceRef(input: {
  sourceType: ChangeSourceType;
  sourceRef?: string;
  diff?: string;
  commitMessage?: string;
  agentSummary?: string;
}): string {
  if (input.sourceRef) {
    return normalizeWhitespace(input.sourceRef);
  }

  switch (input.sourceType) {
    case "commit":
      return sha256(normalizeWhitespace(input.commitMessage ?? ""));
    case "diff":
      return sha256(normalizeWhitespace(input.diff ?? ""));
    case "agent_summary":
      return sha256(normalizeWhitespace(input.agentSummary ?? ""));
    case "manual":
      return "manual";
    default: {
      const exhaustive: never = input.sourceType;
      throw new Error(`Unhandled source type: ${exhaustive}`);
    }
  }
}

export function extractScopeRefsFromDiff(diff?: string): ScopeRef[] {
  if (!diff) {
    return [];
  }

  const scopes: ScopeRef[] = [];
  const lines = diff.split("\n");
  for (const line of lines) {
    const diffGitMatch = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (diffGitMatch) {
      scopes.push({ kind: "file", value: diffGitMatch[2] });
      continue;
    }

    const fileMatch = /^(?:\+\+\+ b\/|--- a\/)(.+)$/.exec(line);
    if (fileMatch && fileMatch[1] !== "/dev/null") {
      scopes.push({ kind: "file", value: fileMatch[1] });
    }
  }

  return uniqueScopeRefs(scopes);
}

export function mergeScopeRefs(primary: ScopeRef[], secondary: ScopeRef[]): ScopeRef[] {
  return uniqueScopeRefs([...primary, ...secondary]);
}

export function computePrimaryScopeRefs(scopeRefs: ScopeRef[]): ScopeRef[] {
  return uniqueScopeRefs(scopeRefs)
    .sort((left, right) => {
      const priorityDelta = SCOPE_PRIORITY[left.kind] - SCOPE_PRIORITY[right.kind];
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return left.value.localeCompare(right.value);
    })
    .slice(0, 3);
}

export function buildFingerprint(input: {
  project: string;
  sourceType: ChangeSourceType;
  normalizedSourceRef: string;
  changeKind: ChangeKind;
  primaryScopeRefs: ScopeRef[];
}): string {
  const normalizedScopes = input.primaryScopeRefs
    .map((scope) => `${scope.kind}:${normalizeWhitespace(scope.value)}`)
    .join("|");

  return sha256(
    [
      input.project,
      input.sourceType,
      input.normalizedSourceRef,
      input.changeKind,
      normalizedScopes
    ].join("\n")
  );
}

