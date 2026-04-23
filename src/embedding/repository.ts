import type { DatabaseSync } from "node:sqlite";
import type { IndexDatabase } from "../storage/index-db.js";
import type { PageType } from "../pages/schema.js";

export type EmbeddingMatch = {
  project: string;
  slug: string;
  type: PageType;
  title: string;
  summary: string;
  markdownPath: string;
  similarity: number;
};

function parseVectorJson(input: string): number[] {
  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? parsed.filter((value): value is number => typeof value === "number") : [];
  } catch {
    return [];
  }
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]!;
    const rightValue = right[index]!;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function buildCandidatesQuery(options: {
  project?: string | null;
  types?: PageType[];
}): { sql: string; values: string[] } {
  const conditions: string[] = [];
  const values: string[] = [];

  if (options.project) {
    conditions.push("pages.project = ?");
    values.push(options.project);
  }

  if (options.types && options.types.length > 0) {
    conditions.push(`pages.type IN (${options.types.map(() => "?").join(", ")})`);
    values.push(...options.types);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return {
    sql: `
      SELECT
        page_embeddings.project,
        page_embeddings.slug,
        page_embeddings.vector_json,
        pages.type,
        pages.title,
        pages.summary,
        pages.markdown_path
      FROM page_embeddings
      JOIN pages
        ON pages.project = page_embeddings.project
       AND pages.slug = page_embeddings.slug
      ${whereClause}
    `,
    values
  };
}

export class EmbeddingIndexRepository {
  private readonly db: DatabaseSync;

  constructor(index: IndexDatabase) {
    this.db = index.db;
  }

  upsertPageEmbedding(input: {
    project: string;
    slug: string;
    contentHash: string;
    model: string;
    vector: number[];
  }): void {
    this.db
      .prepare(`
        INSERT INTO page_embeddings (
          project, slug, content_hash, embedding_model, dimensions, vector_json, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(project, slug) DO UPDATE SET
          content_hash = excluded.content_hash,
          embedding_model = excluded.embedding_model,
          dimensions = excluded.dimensions,
          vector_json = excluded.vector_json,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(
        input.project,
        input.slug,
        input.contentHash,
        input.model,
        input.vector.length,
        JSON.stringify(input.vector)
      );
  }

  deleteEmbeddingsForProjects(projectIds: string[]): void {
    if (projectIds.length === 0) {
      this.db.prepare("DELETE FROM page_embeddings").run();
      return;
    }

    this.db
      .prepare(`DELETE FROM page_embeddings WHERE project IN (${projectIds.map(() => "?").join(", ")})`)
      .run(...projectIds);
  }

  searchSimilar(input: {
    project?: string | null;
    types?: PageType[];
    queryVector: number[];
    limit: number;
  }): EmbeddingMatch[] {
    const { sql, values } = buildCandidatesQuery({
      project: input.project,
      types: input.types
    });
    const rows = this.db.prepare(sql).all(...values) as Array<{
      project: string;
      slug: string;
      vector_json: string;
      type: PageType;
      title: string;
      summary: string;
      markdown_path: string;
    }>;

    return rows
      .map((row) => ({
        project: row.project,
        slug: row.slug,
        type: row.type,
        title: row.title,
        summary: row.summary,
        markdownPath: row.markdown_path,
        similarity: cosineSimilarity(input.queryVector, parseVectorJson(row.vector_json))
      }))
      .filter((row) => row.similarity > 0)
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, input.limit);
  }
}
