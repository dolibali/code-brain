import type { DatabaseSync } from "node:sqlite";
import { buildIndexedSearchText } from "../search/normalize.js";
import { runInTransaction } from "../storage/transaction.js";
import type { ScopeRef } from "./schema.js";
import type { StoredPage } from "./types.js";

function buildSummary(compiledTruth: string, fallbackTitle: string): string {
  const lines = compiledTruth
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("## "));

  return lines[0] ?? fallbackTitle;
}

function buildScopeText(scopeRefs: ScopeRef[]): string {
  return scopeRefs.map((scope) => `${scope.kind}:${scope.value} ${scope.value}`).join(" ");
}

export function upsertPageIndex(db: DatabaseSync, page: StoredPage): void {
  const scopeText = buildScopeText(page.frontmatter.scopeRefs);
  const summary = buildSummary(page.compiledTruth, page.frontmatter.title);
  const indexedCompiledTruth = buildIndexedSearchText(page.compiledTruth);
  const indexedTimelineText = buildIndexedSearchText(page.timelineText);
  const indexedAliases = buildIndexedSearchText(page.frontmatter.aliases.join(" "));
  const indexedTags = buildIndexedSearchText(page.frontmatter.tags.join(" "));
  const indexedScopeText = buildIndexedSearchText(scopeText);

  runInTransaction(db, () => {
    db.prepare(`
      INSERT INTO pages (
        project, slug, type, title, summary, markdown_path, status,
        lifecycle_stage, change_kind, source_type, source_agent,
        tags_json, aliases_json, see_also_json, compiled_truth, timeline_text,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project, slug) DO UPDATE SET
        type = excluded.type,
        title = excluded.title,
        summary = excluded.summary,
        markdown_path = excluded.markdown_path,
        status = excluded.status,
        lifecycle_stage = excluded.lifecycle_stage,
        change_kind = excluded.change_kind,
        source_type = excluded.source_type,
        source_agent = excluded.source_agent,
        tags_json = excluded.tags_json,
        aliases_json = excluded.aliases_json,
        see_also_json = excluded.see_also_json,
        compiled_truth = excluded.compiled_truth,
        timeline_text = excluded.timeline_text,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `).run(
      page.frontmatter.project,
      page.slug,
      page.frontmatter.type,
      page.frontmatter.title,
      summary,
      page.markdownPath,
      page.frontmatter.status,
      page.frontmatter.lifecycleStage ?? null,
      page.frontmatter.changeKind ?? null,
      page.frontmatter.sourceType,
      page.frontmatter.sourceAgent,
      JSON.stringify(page.frontmatter.tags),
      JSON.stringify(page.frontmatter.aliases),
      JSON.stringify(page.frontmatter.seeAlso),
      page.compiledTruth,
      page.timelineText,
      page.frontmatter.createdAt,
      page.frontmatter.updatedAt
    );

    const pageRow = db
      .prepare("SELECT id FROM pages WHERE project = ? AND slug = ?")
      .get(page.frontmatter.project, page.slug) as { id: number };

    db.prepare("DELETE FROM page_scopes WHERE page_id = ?").run(pageRow.id);
    for (const scope of page.frontmatter.scopeRefs) {
      db.prepare(
        "INSERT INTO page_scopes (page_id, scope_kind, scope_value) VALUES (?, ?, ?)"
      ).run(pageRow.id, scope.kind, scope.value);
    }

    db.prepare("DELETE FROM pages_fts WHERE project = ? AND slug = ?").run(
      page.frontmatter.project,
      page.slug
    );
    db.prepare(`
      INSERT INTO pages_fts (
        project, slug, type, title, compiled_truth, timeline_text, aliases, tags, scope_text
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      page.frontmatter.project,
      page.slug,
      page.frontmatter.type,
      page.frontmatter.title,
      indexedCompiledTruth,
      indexedTimelineText,
      indexedAliases,
      indexedTags,
      indexedScopeText
    );
  });
}
