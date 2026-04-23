import type { DatabaseSync } from "node:sqlite";
import type { Migration } from "../migrator.js";

function existingColumns(db: DatabaseSync, tableName: string): Set<string> {
  const columnRows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return new Set(columnRows.map((row) => row.name));
}

export const projectColumnsMigration: Migration = {
  id: "002-project-columns",
  description: "Ensure project metadata columns exist for thin-service project resolution.",
  up(db: DatabaseSync) {
    const columns = existingColumns(db, "projects");
    const additions: Array<{ name: string; sql: string }> = [
      { name: "title", sql: "ALTER TABLE projects ADD COLUMN title TEXT" },
      { name: "main_branch", sql: "ALTER TABLE projects ADD COLUMN main_branch TEXT NOT NULL DEFAULT 'main'" },
      {
        name: "roots_json",
        sql: "ALTER TABLE projects ADD COLUMN roots_json TEXT NOT NULL DEFAULT '[]'"
      },
      {
        name: "git_remotes_json",
        sql: "ALTER TABLE projects ADD COLUMN git_remotes_json TEXT NOT NULL DEFAULT '[]'"
      }
    ];

    for (const addition of additions) {
      if (!columns.has(addition.name)) {
        db.exec(addition.sql);
      }
    }

    if (columns.has("root")) {
      db.exec("UPDATE projects SET roots_json = json_array(root) WHERE COALESCE(roots_json, '[]') = '[]'");
    }

    if (columns.has("remotes_json")) {
      db.exec(`
        UPDATE projects
        SET git_remotes_json = remotes_json
        WHERE COALESCE(git_remotes_json, '[]') = '[]'
      `);
    }
  }
};
