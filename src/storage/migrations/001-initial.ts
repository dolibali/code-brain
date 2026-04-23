import type { DatabaseSync } from "node:sqlite";
import { INDEX_SCHEMA_SQL } from "../index-schema.js";
import type { Migration } from "../migrator.js";

export const initialSchemaMigration: Migration = {
  id: "001-initial",
  description: "Create the base BrainCode index schema.",
  up(db: DatabaseSync) {
    db.exec(INDEX_SCHEMA_SQL);
  }
};
