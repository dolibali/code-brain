import type { Migration } from "../migrator.js";
import { initialSchemaMigration } from "./001-initial.js";
import { projectColumnsMigration } from "./002-project-columns.js";
import { pageColumnsMigration } from "./003-page-columns.js";
import { embeddingMigration } from "./004-embedding.js";
import { ftsMigration } from "./005-fts.js";

export const MIGRATIONS: Migration[] = [
  initialSchemaMigration,
  projectColumnsMigration,
  pageColumnsMigration,
  embeddingMigration,
  ftsMigration
];
