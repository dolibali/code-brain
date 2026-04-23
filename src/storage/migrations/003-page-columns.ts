import type { DatabaseSync } from "node:sqlite";
import type { Migration } from "../migrator.js";

function existingColumns(db: DatabaseSync, tableName: string): Set<string> {
  const columnRows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return new Set(columnRows.map((row) => row.name));
}

export const pageColumnsMigration: Migration = {
  id: "003-page-columns",
  description: "Ensure page metadata columns exist for compiled truth, timeline, and tags.",
  up(db: DatabaseSync) {
    const columns = existingColumns(db, "pages");
    const additions: Array<{ name: string; sql: string }> = [
      { name: "lifecycle_stage", sql: "ALTER TABLE pages ADD COLUMN lifecycle_stage TEXT" },
      { name: "change_kind", sql: "ALTER TABLE pages ADD COLUMN change_kind TEXT" },
      {
        name: "tags_json",
        sql: "ALTER TABLE pages ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'"
      },
      {
        name: "aliases_json",
        sql: "ALTER TABLE pages ADD COLUMN aliases_json TEXT NOT NULL DEFAULT '[]'"
      },
      {
        name: "see_also_json",
        sql: "ALTER TABLE pages ADD COLUMN see_also_json TEXT NOT NULL DEFAULT '[]'"
      },
      {
        name: "compiled_truth",
        sql: "ALTER TABLE pages ADD COLUMN compiled_truth TEXT NOT NULL DEFAULT ''"
      },
      {
        name: "timeline_text",
        sql: "ALTER TABLE pages ADD COLUMN timeline_text TEXT NOT NULL DEFAULT ''"
      }
    ];

    for (const addition of additions) {
      if (!columns.has(addition.name)) {
        db.exec(addition.sql);
      }
    }
  }
};
