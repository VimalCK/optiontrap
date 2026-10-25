-- Signals the user deleted from the grid. Kept as a soft delete so re-logging
-- the same setup (the upsert never touches this column) doesn't bring it back.
ALTER TABLE trade_setup_signals ADD COLUMN IF NOT EXISTS deleted_at TEXT;
