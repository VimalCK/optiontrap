-- Win/Loss Patterns (Analytics) groups a user's closed automated trades by the
-- strategy that chose them, its setup (pattern) and the exit rule that closed
-- them. These lived only in the trades' event JSON (and the setup inside the
-- reason text), so they become columns that GROUP BY can read directly.
ALTER TABLE auto_trades ADD COLUMN IF NOT EXISTS strategy_id TEXT;
ALTER TABLE auto_trades ADD COLUMN IF NOT EXISTS setup TEXT;
-- NULL on a closed trade means it was exited manually.
ALTER TABLE auto_trades ADD COLUMN IF NOT EXISTS exit_rule_id TEXT;

-- Backfill the strategy and setup from each trade's 'selected' event:
-- detail.strategyId, and the setup as the reason's first fragment
-- ("Bull put · score 72 · premium ₹40.00" → "Bull put").
UPDATE auto_trades t
SET strategy_id = e.detail->>'strategyId',
    setup = NULLIF(split_part(e.detail->>'reason', ' · ', 1), '')
FROM auto_trade_events e
WHERE e.auto_trade_id = t.id AND e.stage = 'selected' AND t.strategy_id IS NULL
  AND e.detail ? 'strategyId';

-- Backfill the exit rule from each closed trade's 'closed' event (ruleId is
-- null for a manual exit, which stays NULL).
UPDATE auto_trades t
SET exit_rule_id = e.detail->>'ruleId'
FROM auto_trade_events e
WHERE e.auto_trade_id = t.id AND e.stage = 'closed' AND t.stage = 'closed' AND t.exit_rule_id IS NULL
  AND e.detail->>'ruleId' IS NOT NULL;

-- GET /api/automation/results: a user's closed trades entered in a date range.
-- Only closed trades are read, so the index holds just those.
CREATE INDEX IF NOT EXISTS auto_trades_user_closed_idx ON auto_trades (user_id, created_at) WHERE stage = 'closed';
