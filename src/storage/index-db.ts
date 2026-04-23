import path from "node:path";
import { mkdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import type { CodeBrainConfig } from "../config/schema.js";
import { runMigrations } from "./migrator.js";

export type IndexDatabase = {
  db: DatabaseSync;
  initialize: () => void;
  syncProjects: () => void;
  getJournalMode: () => string;
  close: () => void;
};

export async function openIndexDatabase(config: CodeBrainConfig): Promise<IndexDatabase> {
  await mkdir(path.dirname(config.brain.indexDb), { recursive: true });
  const db = new DatabaseSync(config.brain.indexDb);

  const initialize = (): void => {
    runMigrations(db);
  };

  const syncProjects = (): void => {
    const statement = db.prepare(`
      INSERT INTO projects (id, title, main_branch, roots_json, git_remotes_json, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        main_branch = excluded.main_branch,
        roots_json = excluded.roots_json,
        git_remotes_json = excluded.git_remotes_json,
        updated_at = CURRENT_TIMESTAMP
    `);

    for (const project of config.projects) {
      statement.run(
        project.id,
        project.title ?? null,
        project.mainBranch,
        JSON.stringify(project.roots),
        JSON.stringify(project.gitRemotes)
      );
    }
  };

  const getJournalMode = (): string => {
    const row = db.prepare("PRAGMA journal_mode;").get() as Record<string, string>;
    return row.journal_mode;
  };

  const close = (): void => {
    db.close();
  };

  return {
    db,
    initialize,
    syncProjects,
    getJournalMode,
    close
  };
}
