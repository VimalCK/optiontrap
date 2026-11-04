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

-- Watched stocks across all users: the nightly purge and the stock scan look
-- items up by instrument alone.
CREATE INDEX IF NOT EXISTS watchlist_items_instrument_idx
  ON watchlist_items (instrument_token);

-- Sessions: expired ones are deleted by expiry on every startup.
CREATE INDEX IF NOT EXISTS sessions_expires_idx
  ON sessions (expires);

-- Scheduled jobs need an admin's Kite token. Whether a session is an admin's
-- was only inside the JSON data, so finding one meant loading and parsing
-- every user's session. Keep it in a column (written with the session) and
-- index just the admin sessions.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Fill it in for existing sessions. A row whose data isn't valid JSON is
-- skipped (left non-admin) rather than failing the migration, and only rows
-- that mention isAdmin at all are parsed, so this stays cheap with many
-- sessions. The function lives in pg_temp and disappears with the connection.
CREATE OR REPLACE FUNCTION pg_temp.try_jsonb(t TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN
  RETURN t::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END
$$;
UPDATE sessions SET is_admin = TRUE
  WHERE NOT is_admin
    AND data LIKE '%"isAdmin":true%'
    AND (pg_temp.try_jsonb(data) -> 'kiteSession' ->> 'isAdmin') = 'true';
CREATE INDEX IF NOT EXISTS sessions_admin_idx
  ON sessions (expires)
  WHERE is_admin;

-- Admin user list: non-admins, most recently updated first, 500 at a time.
CREATE INDEX IF NOT EXISTS users_non_admin_updated_idx
  ON users (updated_at DESC)
  WHERE is_admin = 0;

-- A user's latest subscription (looked up per user in the admin list, and on
-- every subscription check). Replaces the plain user_id index from 002.
CREATE INDEX IF NOT EXISTS subscriptions_user_latest_idx
  ON subscriptions (user_id, updated_at DESC);
DROP INDEX IF EXISTS idx_subscriptions_user_id;

-- Nightly outcome check: only signals still waiting for a final outcome.
CREATE INDEX IF NOT EXISTS trade_setup_signals_pending_idx
  ON trade_setup_signals (scrip)
  WHERE NOT outcome_final AND deleted_at IS NULL;

-- Nightly purge of triggered alerts.
CREATE INDEX IF NOT EXISTS price_alerts_triggered_idx
  ON price_alerts (user_id)
  WHERE status = 'triggered';
