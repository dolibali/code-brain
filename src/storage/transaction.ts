import type { DatabaseSync } from "node:sqlite";

export function runInTransaction<T>(db: DatabaseSync, task: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = task();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

