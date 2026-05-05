-- Chat conversation logs for hosted AI chat
-- Tracks user questions, AI responses, and tool usage

CREATE TABLE IF NOT EXISTS chat_logs (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  request_id      TEXT,
  idempotency_key TEXT UNIQUE,
  model           TEXT NOT NULL,
  messages_json   TEXT NOT NULL,     -- JSON: input messages array
  response_json   TEXT NOT NULL,     -- JSON: full AI response (content + tool_calls)
  tool_calls_json TEXT,              -- JSON: extracted tool_calls for easy querying
  finish_reason   TEXT,              -- stop, tool_calls, length, etc.
  tokens_in       INTEGER,
  tokens_out      INTEGER,
  tokens_total    INTEGER,
  credit_cost     INTEGER NOT NULL DEFAULT 1,
  duration_ms     INTEGER,
  status          TEXT NOT NULL DEFAULT 'completed',  -- completed, failed
  error_message   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_chat_logs_user_created ON chat_logs(user_id, created_at DESC);
CREATE INDEX idx_chat_logs_request_id ON chat_logs(request_id);
CREATE INDEX idx_chat_logs_idempotency ON chat_logs(idempotency_key);
