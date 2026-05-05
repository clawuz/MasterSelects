CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  entry_type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT,
  description TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_user
  ON credit_ledger(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_source
  ON credit_ledger(source_id);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  feature TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  request_units TEXT,
  credit_cost INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  ledger_entry_id TEXT REFERENCES credit_ledger(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_usage_events_user
  ON usage_events(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_usage_events_feature
  ON usage_events(user_id, feature, created_at);
