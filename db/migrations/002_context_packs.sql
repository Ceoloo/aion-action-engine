-- Context packs for Action Engine hydration layer
CREATE TABLE IF NOT EXISTS context_packs (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_context_packs_created ON context_packs(created_at);
