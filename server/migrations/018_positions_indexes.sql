-- Positions had no indexes, so every list scanned the whole table.
--
-- Closed trades: the trade journal and Dashboard select a user's exits by
-- mode and exit-time range (GET /api/positions?status=closed, /daily-pnl,
-- /stats), so index exactly those rows in that order.
CREATE INDEX IF NOT EXISTS positions_closed_idx
  ON positions (user_id, mode, exit_time)
  WHERE exited = 1;

-- Open positions: the Positions page and Dashboard list them on every load.
CREATE INDEX IF NOT EXISTS positions_open_idx
  ON positions (user_id, mode)
  WHERE exited = 0;
