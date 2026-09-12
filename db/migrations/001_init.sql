-- AION Action Engine V0 schema
CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  title TEXT NOT NULL,
  reason TEXT NOT NULL,
  priority INTEGER NOT NULL CHECK (priority >= 0 AND priority <= 100),
  urgency TEXT NOT NULL,
  suggested_action_json TEXT NOT NULL,
  requires_approval INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  due_at TEXT,
  claimed_by TEXT,
  claimed_at TEXT,
  approved_by TEXT,
  approved_at TEXT,
  executed_at TEXT,
  completed_at TEXT,
  context_pack_id TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  outcome_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_actions_status ON actions(status);
CREATE INDEX IF NOT EXISTS idx_actions_priority ON actions(priority DESC);
CREATE INDEX IF NOT EXISTS idx_actions_entity ON actions(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS action_events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  action_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (action_id) REFERENCES actions(id)
);

CREATE INDEX IF NOT EXISTS idx_events_action ON action_events(action_id);
