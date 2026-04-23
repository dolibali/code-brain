import type { DatabaseSync } from "node:sqlite";
import type { Migration } from "../migrator.js";

export const embeddingMigration: Migration = {
  id: "004-embedding",
  description: "Create the optional page embedding storage table.",
  up(db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS page_embeddings (
        project TEXT NOT NULL REFERENCES projects(id),
        slug TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        embedding_model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (project, slug)
      )
    `);
  }
};
