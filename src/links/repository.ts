import type { IndexDatabase } from "../storage/index-db.js";
import { normalizePageRef } from "../pages/page-ref.js";

export type LinkDirection = "incoming" | "outgoing" | "both";

export type LinkPageInput = {
  project: string;
  fromSlug: string;
  toSlug: string;
  relation: string;
  context?: string;
};

export type RetrievedLink = {
  direction: "incoming" | "outgoing";
  relation: string;
  fromSlug: string;
  toSlug: string;
  otherSlug: string;
  otherType: string | null;
  otherTitle: string | null;
  context: string | null;
};

function assertPageExists(index: IndexDatabase, project: string, slug: string): void {
  const row = index.db
    .prepare("SELECT 1 FROM pages WHERE project = ? AND slug = ?")
    .get(project, normalizePageRef(slug)) as { 1: number } | undefined;

  if (!row) {
    throw new Error(`Page '${slug}' does not exist in project '${project}'.`);
  }
}

export class LinkRepository {
  constructor(private readonly index: IndexDatabase) {}

  linkPages(input: LinkPageInput): void {
    const fromSlug = normalizePageRef(input.fromSlug);
    const toSlug = normalizePageRef(input.toSlug);
    assertPageExists(this.index, input.project, fromSlug);
    assertPageExists(this.index, input.project, toSlug);

    this.index.db.prepare(`
      INSERT INTO page_links (project, from_slug, to_slug, relation, context)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project, from_slug, to_slug, relation) DO UPDATE SET
        context = excluded.context
    `).run(input.project, fromSlug, toSlug, input.relation, input.context ?? null);
  }

  getLinks(input: { project: string; slug: string; direction?: LinkDirection }): RetrievedLink[] {
    const slug = normalizePageRef(input.slug);
    const direction = input.direction ?? "both";
    const rows: RetrievedLink[] = [];

    if (direction === "outgoing" || direction === "both") {
      const outgoing = this.index.db.prepare(`
        SELECT
          'outgoing' AS direction,
          page_links.relation,
          page_links.from_slug,
          page_links.to_slug,
          pages.slug AS other_slug,
          pages.type AS other_type,
          pages.title AS other_title,
          page_links.context
        FROM page_links
        LEFT JOIN pages
          ON pages.project = page_links.project
         AND pages.slug = page_links.to_slug
        WHERE page_links.project = ? AND page_links.from_slug = ?
        ORDER BY page_links.relation ASC, page_links.to_slug ASC
      `).all(input.project, slug) as Array<{
        direction: "outgoing";
        relation: string;
        from_slug: string;
        to_slug: string;
        other_slug: string;
        other_type: string | null;
        other_title: string | null;
        context: string | null;
      }>;

      rows.push(
        ...outgoing.map((row) => ({
          direction: row.direction,
          relation: row.relation,
          fromSlug: row.from_slug,
          toSlug: row.to_slug,
          otherSlug: row.other_slug,
          otherType: row.other_type,
          otherTitle: row.other_title,
          context: row.context
        }))
      );
    }

    if (direction === "incoming" || direction === "both") {
      const incoming = this.index.db.prepare(`
        SELECT
          'incoming' AS direction,
          page_links.relation,
          page_links.from_slug,
          page_links.to_slug,
          pages.slug AS other_slug,
          pages.type AS other_type,
          pages.title AS other_title,
          page_links.context
        FROM page_links
        LEFT JOIN pages
          ON pages.project = page_links.project
         AND pages.slug = page_links.from_slug
        WHERE page_links.project = ? AND page_links.to_slug = ?
        ORDER BY page_links.relation ASC, page_links.from_slug ASC
      `).all(input.project, slug) as Array<{
        direction: "incoming";
        relation: string;
        from_slug: string;
        to_slug: string;
        other_slug: string;
        other_type: string | null;
        other_title: string | null;
        context: string | null;
      }>;

      rows.push(
        ...incoming.map((row) => ({
          direction: row.direction,
          relation: row.relation,
          fromSlug: row.from_slug,
          toSlug: row.to_slug,
          otherSlug: row.other_slug,
          otherType: row.other_type,
          otherTitle: row.other_title,
          context: row.context
        }))
      );
    }

    return rows;
  }
}

