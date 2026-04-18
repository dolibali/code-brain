export const INDEX_SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  root TEXT NOT NULL,
  remotes_json TEXT NOT NULL DEFAULT '[]',
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL REFERENCES projects(id),
  slug TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  markdown_path TEXT NOT NULL,
  status TEXT,
  lifecycle_stage TEXT,
  change_kind TEXT,
  source_type TEXT,
  source_agent TEXT,
  confidence REAL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  aliases_json TEXT NOT NULL DEFAULT '[]',
  see_also_json TEXT NOT NULL DEFAULT '[]',
  compiled_truth TEXT NOT NULL DEFAULT '',
  timeline_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project, slug)
);

CREATE TABLE IF NOT EXISTS page_scopes (
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  scope_kind TEXT NOT NULL,
  scope_value TEXT NOT NULL,
  PRIMARY KEY (page_id, scope_kind, scope_value)
);

CREATE TABLE IF NOT EXISTS page_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL REFERENCES projects(id),
  from_slug TEXT NOT NULL,
  to_slug TEXT NOT NULL,
  relation TEXT NOT NULL,
  context TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS timeline_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL REFERENCES projects(id),
  page_slug TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  body TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingest_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL REFERENCES projects(id),
  fingerprint TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT,
  change_page_slug TEXT,
  change_kind TEXT,
  confidence REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project, fingerprint)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_page_links_unique
ON page_links(project, from_slug, to_slug, relation);

CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
  project,
  slug,
  type,
  title,
  compiled_truth,
  timeline_text,
  aliases,
  tags,
  scope_text
);
`;
