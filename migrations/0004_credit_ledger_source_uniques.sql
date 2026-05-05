CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_ledger_user_source_id
  ON credit_ledger(user_id, source, source_id)
  WHERE source_id IS NOT NULL;
