import type { CodeBrainConfig } from "../config/schema.js";
import { LinkRepository } from "../links/repository.js";
import { normalizePageRef } from "../pages/page-ref.js";
import { PageRepository, type StoredPage } from "../pages/repository.js";
import type { ChangeKind, PageType, ScopeRef, SourceAgent } from "../pages/schema.js";
import { resolveProject } from "../projects/resolve-project.js";
import type { IndexDatabase } from "../storage/index-db.js";
import {
  buildFingerprint,
  buildNormalizedSourceRef,
  computePrimaryScopeRefs,
  extractScopeRefsFromDiff,
  inferSourceType,
  mergeScopeRefs,
  type ChangeSourceType
} from "./fingerprint.js";
import {
  RecordChangeInputSchema,
  type RecordChangeInput,
  type RelatedKnowledgeType
} from "./schema.js";

type IngestEventRow = {
  fingerprint: string;
  source_type: string;
  source_ref: string | null;
  change_page_slug: string | null;
  change_kind: string | null;
  confidence: number | null;
};

type KnowledgeTargetDecision = {
  type: RelatedKnowledgeType;
  createAllowed: boolean;
  reason: string;
};

type KnowledgeTargetContext = {
  project: string;
  title: string;
  changeKind: ChangeKind;
  agentSummary?: string;
  commitMessage?: string;
  diff?: string;
  scopeRefs: ScopeRef[];
  relatedTypes: RelatedKnowledgeType[];
  llmEnabled: boolean;
};

type CandidatePage = {
  slug: string;
  title: string;
};

type RecordChangeResult = {
  mode: "rule" | "llm";
  fingerprint: string;
  sourceType: ChangeSourceType;
  sourceRef: string;
  changePage: StoredPage;
  linkedPages: StoredPage[];
};

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function uniqueScopeRefs(scopeRefs: ScopeRef[]): ScopeRef[] {
  const seen = new Set<string>();
  const results: ScopeRef[] = [];
  for (const scope of scopeRefs) {
    const key = `${scope.kind}:${scope.value}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(scope);
  }
  return results;
}

function normalizeSentence(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function stripCommitPrefix(input: string): string {
  return input
    .replace(/^(fix|feat|refactor|chore|docs|test|style|perf)(\(.+?\))?!?:\s*/i, "")
    .replace(/^(修复|新增|重构|回滚|恢复)[：:]\s*/u, "")
    .trim();
}

function detectChangeKind(input: {
  explicit?: ChangeKind;
  commitMessage?: string;
  agentSummary?: string;
  diff?: string;
}): ChangeKind {
  if (input.explicit) {
    return input.explicit;
  }

  const text = [input.commitMessage, input.agentSummary, input.diff].filter(Boolean).join(" ").toLowerCase();
  if (/(fix|bug|hotfix|regression|修复|崩溃|问题)/u.test(text)) {
    return "bugfix";
  }
  if (/(refactor|cleanup|重构|整理)/u.test(text)) {
    return "refactor";
  }
  if (/(rollback|revert|回滚)/u.test(text)) {
    return "rollback";
  }
  if (/(recover|恢复)/u.test(text)) {
    return "recovery";
  }
  if (/(feature|feat|add|introduce|implement|新增|支持)/u.test(text)) {
    return "feature";
  }
  return "maintenance";
}

function deriveTitle(input: {
  explicitTitle?: string;
  commitMessage?: string;
  agentSummary?: string;
  diff?: string;
  changeKind: ChangeKind;
}): string {
  if (input.explicitTitle) {
    return normalizeSentence(input.explicitTitle);
  }

  if (input.commitMessage) {
    return stripCommitPrefix(input.commitMessage);
  }

  if (input.agentSummary) {
    const firstLine = input.agentSummary.split("\n").map((line) => line.trim()).find((line) => line.length > 0);
    if (firstLine) {
      return normalizeSentence(firstLine).slice(0, 100);
    }
  }

  return {
    bugfix: "Recorded bugfix change",
    refactor: "Recorded refactor change",
    feature: "Recorded feature change",
    rollback: "Recorded rollback change",
    recovery: "Recorded recovery change",
    maintenance: "Recorded maintenance change"
  }[input.changeKind];
}

function deriveSummary(input: { agentSummary?: string; commitMessage?: string; diff?: string; title: string }): string {
  if (input.agentSummary) {
    return normalizeSentence(input.agentSummary);
  }

  if (input.commitMessage) {
    return normalizeSentence(stripCommitPrefix(input.commitMessage));
  }

  if (input.diff) {
    const changedFiles = extractScopeRefsFromDiff(input.diff).map((scope) => scope.value);
    if (changedFiles.length > 0) {
      return `Updated files: ${changedFiles.join(", ")}`;
    }
  }

  return input.title;
}

function computeConfidence(input: {
  diff?: string;
  commitMessage?: string;
  agentSummary?: string;
  scopeRefs: ScopeRef[];
  sourceRef?: string;
  llmEnabled: boolean;
}): number {
  let score = 0.45;
  if (input.diff) {
    score += 0.15;
  }
  if (input.commitMessage) {
    score += 0.15;
  }
  if (input.agentSummary) {
    score += 0.15;
  }
  if (input.scopeRefs.length > 0) {
    score += 0.05;
  }
  if (input.sourceRef) {
    score += 0.05;
  }
  if (input.llmEnabled) {
    score += 0.05;
  }
  return Math.min(0.95, Number(score.toFixed(2)));
}

function buildChangeBody(input: {
  createdAt: string;
  title: string;
  changeKind: ChangeKind;
  sourceType: ChangeSourceType;
  sourceRef: string;
  summary: string;
  scopeRefs: ScopeRef[];
  commitMessage?: string;
  agentSummary?: string;
  linkedKnowledge: string[];
}): string {
  const scopeLines =
    input.scopeRefs.length > 0
      ? input.scopeRefs.map((scope) => `- ${scope.kind}: \`${scope.value}\``).join("\n")
      : "- No explicit scope refs";

  const changeLines = uniqueStrings(
    [
      input.commitMessage ? `- Commit: ${normalizeSentence(input.commitMessage)}` : "",
      input.agentSummary ? `- Summary: ${normalizeSentence(input.agentSummary)}` : "",
      input.sourceRef ? `- Source ref: \`${input.sourceRef}\`` : ""
    ].filter(Boolean)
  ).join("\n");

  const linkedKnowledge =
    input.linkedKnowledge.length > 0
      ? input.linkedKnowledge.map((slug) => `- \`${slug}\``).join("\n")
      : "- None yet";

  const timelineLines = [
    `- ${input.createdAt.slice(0, 10)} | recorded | captured from ${input.sourceType}`,
    ...input.linkedKnowledge.map((slug) => `- ${input.createdAt.slice(0, 10)} | linked | ${slug}`)
  ].join("\n");

  return `## Background

${input.summary}

## Goal

Record this ${input.changeKind} as a reusable change artifact for future agents.

## What Changed

${changeLines || "- Change details captured from available inputs"}

## Why

Preserve the stable outcome and execution context so later searches can recover this work quickly.

## Impact

${scopeLines}

## Linked Knowledge

${linkedKnowledge}

## Timeline

${timelineLines}
`;
}

function detectSignals(text: string): {
  issue: boolean;
  architecture: boolean;
  decision: boolean;
  practice: boolean;
} {
  return {
    issue: /(fix|bug|hotfix|regression|修复|崩溃|故障|问题)/iu.test(text),
    architecture: /(architecture|boundary|lifecycle|module|structure|数据流|边界|架构|模块|链路)/iu.test(text),
    decision: /(choose|decision|migrate|switch|adopt|弃用|改用|迁移|决定|选择)/iu.test(text),
    practice: /(rule|should|must|pattern|anti-pattern|约定|规则|必须|推荐|避免|反模式)/iu.test(text)
  };
}

function decideKnowledgeTargets(context: KnowledgeTargetContext): KnowledgeTargetDecision[] {
  const combinedText = [context.title, context.commitMessage, context.agentSummary, context.diff]
    .filter(Boolean)
    .join(" ");
  const signals = detectSignals(combinedText);
  const results = new Map<RelatedKnowledgeType, KnowledgeTargetDecision>();

  for (const explicitType of context.relatedTypes) {
    results.set(explicitType, {
      type: explicitType,
      createAllowed: true,
      reason: "explicit_related_type"
    });
  }

  if (context.changeKind === "bugfix" || signals.issue) {
    results.set("issue", {
      type: "issue",
      createAllowed: true,
      reason: "bugfix_signal"
    });
  }

  if (signals.architecture || context.scopeRefs.some((scope) => scope.kind === "module" || scope.kind === "symbol")) {
    results.set("architecture", {
      type: "architecture",
      createAllowed: context.llmEnabled || context.relatedTypes.includes("architecture"),
      reason: "architecture_signal"
    });
  }

  if (signals.decision) {
    results.set("decision", {
      type: "decision",
      createAllowed: context.llmEnabled || context.relatedTypes.includes("decision"),
      reason: "decision_signal"
    });
  }

  if (signals.practice) {
    results.set("practice", {
      type: "practice",
      createAllowed: context.llmEnabled || context.relatedTypes.includes("practice"),
      reason: "practice_signal"
    });
  }

  return [...results.values()];
}

function relationForTarget(type: RelatedKnowledgeType): string {
  switch (type) {
    case "issue":
      return "updates";
    case "architecture":
    case "decision":
    case "practice":
      return "documents";
    default: {
      const exhaustive: never = type;
      throw new Error(`Unhandled related type: ${exhaustive}`);
    }
  }
}

function knowledgeStatus(type: RelatedKnowledgeType, changeKind: ChangeKind, confidence: number): string {
  if (confidence < 0.55) {
    return "needs_review";
  }

  if (type === "issue") {
    return changeKind === "bugfix" ? "fixed" : "active";
  }

  if (type === "decision") {
    return "accepted";
  }

  return "active";
}

function knowledgeTitle(type: RelatedKnowledgeType, title: string): string {
  const cleanTitle = stripCommitPrefix(title);
  switch (type) {
    case "issue":
      return cleanTitle;
    case "practice":
      return /rule|约定|规则/i.test(cleanTitle) ? cleanTitle : `${cleanTitle} Rule`;
    case "architecture":
      return cleanTitle;
    case "decision":
      return /decision|决定|选择/i.test(cleanTitle) ? cleanTitle : `Decision: ${cleanTitle}`;
    default: {
      const exhaustive: never = type;
      throw new Error(`Unhandled related type: ${exhaustive}`);
    }
  }
}

function createKnowledgeBody(input: {
  type: RelatedKnowledgeType;
  title: string;
  summary: string;
  scopeRefs: ScopeRef[];
  changeSlug: string;
  createdAt: string;
}): string {
  const scopeList =
    input.scopeRefs.length > 0
      ? input.scopeRefs.map((scope) => `- ${scope.kind}: \`${scope.value}\``).join("\n")
      : "- See related change for scope details";
  const timeline = `- ${input.createdAt.slice(0, 10)} | updated from change \`${input.changeSlug}\``;

  switch (input.type) {
    case "issue":
      return `## Symptoms

${input.summary}

## Root Cause

See related change \`${input.changeSlug}\` for the freshest implementation evidence.

## Fix

${input.summary}

## Impact

${scopeList}

## Validation

- Review related change \`${input.changeSlug}\`

## See Also

- \`${input.changeSlug}\`

## Timeline

${timeline}
`;
    case "practice":
      return `## Rule

${input.summary}

## Why

This rule was extracted from change \`${input.changeSlug}\`.

## Correct Pattern

- Follow the recorded approach in \`${input.changeSlug}\`

## Anti-pattern

- Avoid bypassing the recorded rule

## Scope

${scopeList}

## Exceptions

- None recorded yet

## See Also

- \`${input.changeSlug}\`

## Timeline

${timeline}
`;
    case "architecture":
      return `## Purpose

${input.summary}

## Boundaries

${scopeList}

## Structure

- See change \`${input.changeSlug}\` for concrete edits

## Key Flows

- Derived from \`${input.changeSlug}\`

## Constraints

- Keep future edits aligned with this recorded structure

## Failure Modes

- Validate affected scopes before large changes

## See Also

- \`${input.changeSlug}\`

## Timeline

${timeline}
`;
    case "decision":
      return `## Context

${input.summary}

## Decision

Follow the direction recorded in change \`${input.changeSlug}\`.

## Alternatives Considered

- Not recorded yet

## Trade-offs

- Review follow-up changes before broad rollout

## Consequences

${scopeList}

## Revisit Trigger

- Revisit when the related scopes materially change

## See Also

- \`${input.changeSlug}\`

## Timeline

${timeline}
`;
    default: {
      const exhaustive: never = input.type;
      throw new Error(`Unhandled related type: ${exhaustive}`);
    }
  }
}

function ensureTimelineLine(body: string, line: string): string {
  const normalizedLine = line.trim();
  if (body.includes(normalizedLine)) {
    return body;
  }

  if (!body.includes("## Timeline")) {
    return `${body.trim()}\n\n## Timeline\n\n${normalizedLine}\n`;
  }

  return `${body.trim()}\n${normalizedLine}\n`;
}

export class RecordChangeService {
  constructor(
    private readonly config: CodeBrainConfig,
    private readonly index: IndexDatabase,
    private readonly pages: PageRepository,
    private readonly links: LinkRepository
  ) {}

  async recordChange(rawInput: RecordChangeInput): Promise<RecordChangeResult> {
    const input = RecordChangeInputSchema.parse(rawInput);
    if (!input.diff && !input.commitMessage && !input.agentSummary) {
      throw new Error("record_change requires at least one of diff, commit_message, or agent_summary.");
    }

    const resolvedProject = resolveProject(this.config, {
      project: input.project,
      contextPath: input.contextPath,
      cwd: process.cwd()
    });
    if (!resolvedProject) {
      throw new Error("Unable to resolve project for record_change. Pass --project or --context-path.");
    }

    const project = resolvedProject.projectId;
    const scopeRefs = mergeScopeRefs(input.scopeRefs, extractScopeRefsFromDiff(input.diff));
    const changeKind = detectChangeKind({
      explicit: input.changeKind,
      commitMessage: input.commitMessage,
      agentSummary: input.agentSummary,
      diff: input.diff
    });
    const title = deriveTitle({
      explicitTitle: input.title,
      commitMessage: input.commitMessage,
      agentSummary: input.agentSummary,
      diff: input.diff,
      changeKind
    });
    const summary = deriveSummary({
      agentSummary: input.agentSummary,
      commitMessage: input.commitMessage,
      diff: input.diff,
      title
    });
    const sourceType = inferSourceType({
      sourceRef: input.sourceRef,
      diff: input.diff,
      commitMessage: input.commitMessage,
      agentSummary: input.agentSummary
    });
    const normalizedSourceRef = buildNormalizedSourceRef({
      sourceType,
      sourceRef: input.sourceRef,
      diff: input.diff,
      commitMessage: input.commitMessage,
      agentSummary: input.agentSummary
    });
    const primaryScopeRefs = computePrimaryScopeRefs(scopeRefs);
    const fingerprint = buildFingerprint({
      project,
      sourceType,
      normalizedSourceRef,
      changeKind,
      primaryScopeRefs
    });
    const existingEvent = this.getIngestEvent(project, fingerprint);
    const existingChange = existingEvent?.change_page_slug
      ? await this.pages.getPage(project, existingEvent.change_page_slug)
      : null;
    const createdAt = existingChange?.frontmatter.createdAt ?? new Date().toISOString();
    const mode = this.config.llm.enabled ? "llm" : "rule";
    const confidence = computeConfidence({
      diff: input.diff,
      commitMessage: input.commitMessage,
      agentSummary: input.agentSummary,
      scopeRefs,
      sourceRef: normalizedSourceRef,
      llmEnabled: this.config.llm.enabled
    });

    let changePage = await this.pages.upsertPage({
      project,
      type: "change",
      title: existingChange?.frontmatter.title ?? title,
      slug: existingEvent?.change_page_slug ?? existingChange?.slug,
      body: buildChangeBody({
        createdAt,
        title,
        changeKind,
        sourceType,
        sourceRef: normalizedSourceRef,
        summary,
        scopeRefs,
        commitMessage: input.commitMessage,
        agentSummary: input.agentSummary,
        linkedKnowledge: existingChange?.frontmatter.seeAlso ?? []
      }),
      tags: uniqueStrings([
        ...(existingChange?.frontmatter.tags ?? []),
        ...primaryScopeRefs.map((scope) => scope.value.split("/").at(-1) ?? scope.value),
        changeKind
      ]),
      aliases: uniqueStrings(existingChange?.frontmatter.aliases ?? []),
      seeAlso: existingChange?.frontmatter.seeAlso ?? [],
      scopeRefs,
      status: confidence < 0.55 ? "needs_review" : "recorded",
      sourceType: sourceType === "commit" ? "commit" : sourceType === "diff" ? "diff" : "agent_summary",
      sourceAgent: input.sourceAgent,
      createdAt,
      updatedAt: new Date().toISOString(),
      lifecycleStage: "implementation",
      changeKind,
      confidence
    });

    const linkedPages = await this.upsertKnowledgeTargets({
      project,
      changePage,
      changeKind,
      title,
      summary,
      scopeRefs,
      commitMessage: input.commitMessage,
      agentSummary: input.agentSummary,
      diff: input.diff,
      relatedTypes: input.relatedTypes,
      sourceAgent: input.sourceAgent,
      sourceType,
      createdAt,
      confidence,
      mode
    });

    if (linkedPages.length > 0) {
      changePage = await this.pages.upsertPage({
        project,
        type: "change",
        title: changePage.frontmatter.title,
        slug: changePage.slug,
        body: buildChangeBody({
          createdAt,
          title: changePage.frontmatter.title,
          changeKind,
          sourceType,
          sourceRef: normalizedSourceRef,
          summary,
          scopeRefs,
          commitMessage: input.commitMessage,
          agentSummary: input.agentSummary,
          linkedKnowledge: linkedPages.map((page) => page.slug)
        }),
        tags: changePage.frontmatter.tags,
        aliases: changePage.frontmatter.aliases,
        seeAlso: uniqueStrings(linkedPages.map((page) => page.slug)),
        scopeRefs,
        status: changePage.frontmatter.status,
        sourceType: changePage.frontmatter.sourceType,
        sourceAgent: changePage.frontmatter.sourceAgent,
        createdAt,
        updatedAt: new Date().toISOString(),
        lifecycleStage: changePage.frontmatter.lifecycleStage,
        changeKind,
        confidence
      });
    }

    this.upsertIngestEvent({
      project,
      fingerprint,
      sourceType,
      sourceRef: normalizedSourceRef,
      changePageSlug: changePage.slug,
      changeKind,
      confidence
    });

    return {
      mode,
      fingerprint,
      sourceType,
      sourceRef: normalizedSourceRef,
      changePage,
      linkedPages
    };
  }

  private getIngestEvent(project: string, fingerprint: string): IngestEventRow | null {
    const row = this.index.db
      .prepare(`
        SELECT fingerprint, source_type, source_ref, change_page_slug, change_kind, confidence
        FROM ingest_events
        WHERE project = ? AND fingerprint = ?
      `)
      .get(project, fingerprint) as IngestEventRow | undefined;

    return row ?? null;
  }

  private upsertIngestEvent(input: {
    project: string;
    fingerprint: string;
    sourceType: ChangeSourceType;
    sourceRef: string;
    changePageSlug: string;
    changeKind: ChangeKind;
    confidence: number;
  }): void {
    this.index.db.prepare(`
      INSERT INTO ingest_events (
        project, fingerprint, source_type, source_ref, change_page_slug, change_kind, confidence
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project, fingerprint) DO UPDATE SET
        source_type = excluded.source_type,
        source_ref = excluded.source_ref,
        change_page_slug = excluded.change_page_slug,
        change_kind = excluded.change_kind,
        confidence = excluded.confidence
    `).run(
      input.project,
      input.fingerprint,
      input.sourceType,
      input.sourceRef,
      input.changePageSlug,
      input.changeKind,
      input.confidence
    );
  }

  private findBestCandidate(project: string, type: RelatedKnowledgeType, scopeRefs: ScopeRef[]): CandidatePage | null {
    if (scopeRefs.length === 0) {
      return null;
    }

    const scopeConditions = scopeRefs
      .map(() => "(page_scopes.scope_kind = ? AND page_scopes.scope_value = ?)")
      .join(" OR ");
    const scopeValues = scopeRefs.flatMap((scope) => [scope.kind, scope.value]);

    const row = this.index.db.prepare(`
      SELECT pages.slug, pages.title, COUNT(*) AS overlap_count
      FROM pages
      JOIN page_scopes
        ON page_scopes.page_id = pages.id
      WHERE pages.project = ?
        AND pages.type = ?
        AND (${scopeConditions})
      GROUP BY pages.id
      ORDER BY overlap_count DESC, pages.updated_at DESC
      LIMIT 1
    `).get(project, type, ...scopeValues) as { slug: string; title: string } | undefined;

    return row ? { slug: row.slug, title: row.title } : null;
  }

  private async upsertKnowledgeTargets(input: {
    project: string;
    changePage: StoredPage;
    changeKind: ChangeKind;
    title: string;
    summary: string;
    scopeRefs: ScopeRef[];
    commitMessage?: string;
    agentSummary?: string;
    diff?: string;
    relatedTypes: RelatedKnowledgeType[];
    sourceAgent: SourceAgent;
    sourceType: ChangeSourceType;
    createdAt: string;
    confidence: number;
    mode: "rule" | "llm";
  }): Promise<StoredPage[]> {
    const decisions = decideKnowledgeTargets({
      project: input.project,
      title: input.title,
      changeKind: input.changeKind,
      agentSummary: input.agentSummary,
      commitMessage: input.commitMessage,
      diff: input.diff,
      scopeRefs: input.scopeRefs,
      relatedTypes: input.relatedTypes,
      llmEnabled: input.mode === "llm"
    });

    const linkedPages: StoredPage[] = [];

    for (const decision of decisions) {
      const candidate = this.findBestCandidate(input.project, decision.type, input.scopeRefs);
      const page = await this.upsertKnowledgePage({
        project: input.project,
        decision,
        candidate,
        changePage: input.changePage,
        title: input.title,
        summary: input.summary,
        scopeRefs: input.scopeRefs,
        changeKind: input.changeKind,
        sourceAgent: input.sourceAgent,
        sourceType: input.sourceType,
        createdAt: input.createdAt,
        confidence: input.confidence
      });

      if (!page) {
        continue;
      }

      this.links.linkPages({
        project: input.project,
        fromSlug: input.changePage.slug,
        toSlug: page.slug,
        relation: relationForTarget(decision.type),
        context: decision.reason
      });

      linkedPages.push(page);
    }

    return linkedPages;
  }

  private async upsertKnowledgePage(input: {
    project: string;
    decision: KnowledgeTargetDecision;
    candidate: CandidatePage | null;
    changePage: StoredPage;
    title: string;
    summary: string;
    scopeRefs: ScopeRef[];
    changeKind: ChangeKind;
    sourceAgent: SourceAgent;
    sourceType: ChangeSourceType;
    createdAt: string;
    confidence: number;
  }): Promise<StoredPage | null> {
    const knowledgeConfidence = Number(
      Math.max(0.45, input.confidence - (input.decision.createAllowed ? 0.05 : 0.15)).toFixed(2)
    );

    if (input.candidate) {
      const existing = await this.pages.getPage(input.project, input.candidate.slug);
      if (!existing) {
        return null;
      }

      return this.pages.upsertPage({
        project: input.project,
        type: input.decision.type,
        slug: existing.slug,
        title: existing.frontmatter.title,
        body: ensureTimelineLine(
          existing.body,
          `- ${input.createdAt.slice(0, 10)} | updated from change \`${input.changePage.slug}\``
        ),
        tags: uniqueStrings([...existing.frontmatter.tags, ...input.changePage.frontmatter.tags]),
        aliases: uniqueStrings(existing.frontmatter.aliases),
        seeAlso: uniqueStrings([...existing.frontmatter.seeAlso, input.changePage.slug]),
        scopeRefs: uniqueScopeRefs([...existing.frontmatter.scopeRefs, ...input.scopeRefs]),
        status: knowledgeStatus(input.decision.type, input.changeKind, knowledgeConfidence),
        sourceType: input.sourceType === "commit" ? "commit" : input.sourceType === "diff" ? "diff" : "agent_summary",
        sourceAgent: input.sourceAgent,
        createdAt: existing.frontmatter.createdAt,
        updatedAt: new Date().toISOString(),
        lifecycleStage: existing.frontmatter.lifecycleStage,
        changeKind: existing.frontmatter.changeKind,
        confidence: Math.max(existing.frontmatter.confidence ?? 0, knowledgeConfidence)
      });
    }

    if (!input.decision.createAllowed) {
      return null;
    }

    return this.pages.upsertPage({
      project: input.project,
      type: input.decision.type,
      title: knowledgeTitle(input.decision.type, input.title),
      body: createKnowledgeBody({
        type: input.decision.type,
        title: input.title,
        summary: input.summary,
        scopeRefs: input.scopeRefs,
        changeSlug: input.changePage.slug,
        createdAt: input.createdAt
      }),
      tags: uniqueStrings([...input.changePage.frontmatter.tags, input.decision.type]),
      aliases: [],
      seeAlso: [input.changePage.slug],
      scopeRefs: input.scopeRefs,
      status: knowledgeStatus(input.decision.type, input.changeKind, knowledgeConfidence),
      sourceType: input.sourceType === "commit" ? "commit" : input.sourceType === "diff" ? "diff" : "agent_summary",
      sourceAgent: input.sourceAgent,
      createdAt: input.createdAt,
      updatedAt: new Date().toISOString(),
      confidence: knowledgeConfidence
    });
  }
}
