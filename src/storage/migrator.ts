import type { DatabaseSync } from "node:sqlite";
import { MIGRATIONS } from "./migrations/index.js";

export type Migration = {
  id: string;
  description: string;
  up: (db: DatabaseSync) => void;
};

function ensureMigrationTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function getAppliedMigrationIds(db: DatabaseSync): Set<string> {
  const rows = db
    .prepare("SELECT id FROM schema_migrations ORDER BY id ASC")
    .all() as Array<{ id: string }>;

  return new Set(rows.map((row) => row.id));
}

export function runMigrations(db: DatabaseSync): void {
  ensureMigrationTable(db);
  const applied = getAppliedMigrationIds(db);
  const insertAppliedMigration = db.prepare(`
    INSERT INTO schema_migrations (id, description)
    VALUES (?, ?)
  `);

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) {
      continue;
    }

    migration.up(db);
    insertAppliedMigration.run(migration.id, migration.description);
  }
}
