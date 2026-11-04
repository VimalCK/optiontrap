-- Indexes for lookups that scanned whole tables.
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

-- Option chains: contracts are looked up by underlying name, then expiry and
-- strike, among NFO options only (about a third of the instruments table).
CREATE INDEX IF NOT EXISTS instruments_nfo_options_idx
  ON instruments (name, expiry, strike)
  WHERE exchange = 'NFO' AND instrument_type IN ('CE', 'PE');

-- Watchlists are listed per user, and items per watchlist (also used by the
-- ON DELETE CASCADE from watchlists).
CREATE INDEX IF NOT EXISTS watchlists_user_idx
  ON watchlists (user_id);

CREATE INDEX IF NOT EXISTS watchlist_items_watchlist_idx
  ON watchlist_items (watchlist_id, instrument_token);
