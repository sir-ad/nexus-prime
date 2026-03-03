-- Graph Knowledge Engine Schema
-- Phase 8D: Temporal knowledge graph with bi-temporal fact versioning
-- Replaces flat MemoryEngine storage with entities, relations, and fact versions

PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────────────────────────────────────
-- Entities — nodes in the knowledge graph
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entities (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL,    -- 'file' | 'function' | 'bug' | 'decision' | 'concept' | 'session' | 'agent'
  properties TEXT DEFAULT '{}', -- JSON blob for flexible metadata
  embedding  BLOB,              -- TF-IDF vector (binary float array)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Relations — edges between entities (bi-temporal)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS relations (
  id          TEXT PRIMARY KEY,
  from_entity TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  to_entity   TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,    -- 'contains' | 'caused_by' | 'fixed_in' | 'depends_on' | 'related_to' | 'supersedes'
  weight      REAL DEFAULT 1.0, -- 0.0-1.0, decays over time
  valid_from  INTEGER NOT NULL,
  valid_until INTEGER,          -- NULL = still valid
  UNIQUE(from_entity, to_entity, type, valid_from)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Fact Versions — bi-temporal fact versioning for entities
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fact_versions (
  id            TEXT PRIMARY KEY,
  entity_id     TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  content       TEXT NOT NULL,
  version       INTEGER NOT NULL,
  valid_from    INTEGER NOT NULL,
  valid_until   INTEGER,        -- NULL = current version
  superseded_by TEXT             -- points to next version's id
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes for query performance
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_entity_type       ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entity_name       ON entities(name);
CREATE INDEX IF NOT EXISTS idx_relation_from     ON relations(from_entity);
CREATE INDEX IF NOT EXISTS idx_relation_to       ON relations(to_entity);
CREATE INDEX IF NOT EXISTS idx_relation_type     ON relations(type);
CREATE INDEX IF NOT EXISTS idx_fact_entity       ON fact_versions(entity_id);
CREATE INDEX IF NOT EXISTS idx_fact_valid        ON fact_versions(entity_id, valid_until);
