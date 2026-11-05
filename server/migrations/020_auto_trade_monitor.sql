-- The trade monitor (server/autoTradeMonitor.js) watches every open automated
-- position, across all users, against each user's exit rules.
--
-- It loads them all when the market opens (getAllOpenAutoPositions: a
-- cross-user scan) and one user's again whenever that user's positions or
-- automation settings change (getOpenAutoPositions: by user_id). Only open
-- automated positions are indexed, so both read just those rows: the full
-- index for the first, one user_id range for the second.
CREATE INDEX IF NOT EXISTS positions_open_auto_idx
  ON positions (user_id)
  WHERE source = 'auto' AND exited = 0;
