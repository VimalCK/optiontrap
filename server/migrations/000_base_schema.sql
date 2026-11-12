-- The base schema: every table, constraint and index the migrations it
-- replaces built, written as their end state (renamed tables and columns under
-- their current names, added columns in their tables, indexes beside them).
-- replaces: 026_horizon_orders_and_renames.sql
--
-- The line above names the last migration folded in. A new database runs this
-- file; a database that has that migration recorded already has all of this,
-- so it is recorded without running (server/migrationRunner.js). New schema
-- changes go in new files after this one (001_…). To fold them in later,
-- regenerate this file, update the replaces line and delete those files.
--
-- Tables come in dependency order (a table before the ones that reference it).
-- Each index says which query or route it serves. Every foreign key column has
-- an index, so joins and ON DELETE stay index lookups.

-- ── Users, subscriptions, sessions ──

-- Kite users who have logged in. is_admin opens the Admin pages.
CREATE TABLE IF NOT EXISTS users (
  user_id    TEXT PRIMARY KEY,
  user_name  TEXT,
  updated_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  is_admin   INTEGER NOT NULL DEFAULT 0
);

-- Admin user list: non-admins, most recently updated first, 500 at a time.
CREATE INDEX IF NOT EXISTS users_non_admin_updated_idx ON users (updated_at DESC) WHERE is_admin = 0;

-- The plans a user can subscribe to (self-activated until payments exist).
CREATE TABLE IF NOT EXISTS subscription_plans (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT,
  price          DOUBLE PRECISION NOT NULL DEFAULT 0,
  currency       TEXT NOT NULL DEFAULT 'INR',
  "interval"     TEXT NOT NULL DEFAULT 'month',
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at     TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  duration_count INTEGER NOT NULL DEFAULT 1,
  duration_unit  TEXT NOT NULL DEFAULT 'month'
);

-- A user's subscriptions to a plan (requireSubscription checks the latest).
CREATE TABLE IF NOT EXISTS subscriptions (
  id                       TEXT PRIMARY KEY,
  user_id                  TEXT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  plan_id                  TEXT NOT NULL REFERENCES subscription_plans (id),
  status                   TEXT NOT NULL,
  starts_at                TEXT,
  expires_at               TEXT,
  provider                 TEXT,
  provider_subscription_id TEXT,
  provider_payment_id      TEXT,
  created_at               TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at               TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

-- A user's latest subscription (looked up per user in the admin list, and on
-- every subscription check); also the foreign key's index for the cascade.
CREATE INDEX IF NOT EXISTS subscriptions_user_latest_idx ON subscriptions (user_id, updated_at DESC);
-- Subscriptions by status (from 002; no query filters by status today).
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions (status);

-- Feedback users send from the app, read on the Admin Feedback page.
CREATE TABLE IF NOT EXISTS feedback (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  message    TEXT NOT NULL,
  page_url   TEXT,
  user_agent TEXT,
  status     TEXT NOT NULL DEFAULT 'open',
  created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

-- A user's feedback (and the foreign key's cascade), the open / closed
-- filter, and the newest-first list.
CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback (user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback (status);
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback (created_at);

-- Login sessions: the Kite session lives in data. is_admin marks an admin's
-- session, whose token the scheduled jobs use.
CREATE TABLE IF NOT EXISTS sessions (
  sid      TEXT PRIMARY KEY,
  data     TEXT NOT NULL,
  expires  BIGINT NOT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT false
);

-- Expired sessions are deleted by expiry on every startup.
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires);
-- Admin sessions that haven't expired: scheduled jobs fetch shared market
-- data with an admin's token (getAdminKiteSessions).
CREATE INDEX IF NOT EXISTS sessions_admin_idx ON sessions (expires) WHERE is_admin;

-- ── Watchlists ──

CREATE TABLE IF NOT EXISTS watchlists (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  sort_order BIGINT NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

-- Watchlists are listed per user.
CREATE INDEX IF NOT EXISTS watchlists_user_idx ON watchlists (user_id);

CREATE TABLE IF NOT EXISTS watchlist_items (
  id               TEXT PRIMARY KEY,
  watchlist_id     TEXT NOT NULL REFERENCES watchlists (id) ON DELETE CASCADE,
  instrument_token BIGINT NOT NULL,
  tradingsymbol    TEXT NOT NULL,
  exchange         TEXT NOT NULL DEFAULT 'NSE',
  sort_order       BIGINT NOT NULL DEFAULT 0,
  added_at         TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
);

-- Items per watchlist (also the ON DELETE CASCADE from watchlists).
CREATE INDEX IF NOT EXISTS watchlist_items_watchlist_idx ON watchlist_items (watchlist_id, instrument_token);
-- Watched stocks across all users: the nightly purge and the stock scan look
-- items up by instrument alone.
CREATE INDEX IF NOT EXISTS watchlist_items_instrument_idx ON watchlist_items (instrument_token);

-- ── Instruments ──

-- Zerodha's instrument list, synced daily at 08:30 IST, plus our own settings
-- on an underlying's price row (the index row such as "NIFTY 50", or a stock's
-- NSE EQ row). The sync updates only the Zerodha columns and keeps these:
--   fno_name            F&O name the index's contracts carry ("NIFTY" for "NIFTY 50");
--                       null on stock rows, whose F&O name is their tradingsymbol.
--   label               Display name; null shows the F&O name.
--   tradingview_symbol  TradingView symbol when it differs from the tradingsymbol.
--   always_snapshot     Option-chain OI snapshot every trading day.
--   is_market_reference The index the market's direction is read from.
CREATE TABLE IF NOT EXISTS instruments (
  instrument_token    BIGINT PRIMARY KEY,
  exchange_token      BIGINT NOT NULL,
  tradingsymbol       TEXT NOT NULL,
  name                TEXT NOT NULL,
  exchange            TEXT NOT NULL DEFAULT 'NSE',
  instrument_type     TEXT NOT NULL DEFAULT 'EQ',
  strike              DOUBLE PRECISION,
  expiry              TEXT,
  lot_size            BIGINT,
  fno_name            TEXT,
  label               TEXT,
  tradingview_symbol  TEXT,
  always_snapshot     BOOLEAN NOT NULL DEFAULT false,
  is_market_reference BOOLEAN NOT NULL DEFAULT false
);

-- An underlying by its F&O name (getUnderlying), unique among underlyings.
CREATE UNIQUE INDEX IF NOT EXISTS instruments_fno_name_idx ON instruments (fno_name) WHERE fno_name IS NOT NULL;
-- At most one market reference index.
CREATE UNIQUE INDEX IF NOT EXISTS instruments_market_reference_idx ON instruments (is_market_reference) WHERE is_market_reference;
-- Option chains: contracts are looked up by underlying name, then expiry and
-- strike, among NFO options only (about a third of the table).
CREATE INDEX IF NOT EXISTS instruments_nfo_options_idx ON instruments (name, expiry, strike)
  WHERE exchange = 'NFO' AND instrument_type IN ('CE', 'PE');

-- Key / value facts about the instrument sync (last_fetched_date).
CREATE TABLE IF NOT EXISTS instruments_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ── OI data ──

-- Option-chain OI snapshots, every 10 minutes in market hours
-- (oiSnapshotScheduler.js). The unique timestamp also serves "newest snapshot"
-- (MAX(timestamp)) and the lookups by time.
CREATE TABLE IF NOT EXISTS oi_snapshots (
  id          BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  "timestamp" BIGINT NOT NULL UNIQUE,
  time_label  TEXT NOT NULL,
  data        TEXT NOT NULL,
  prices      TEXT,
  close       TEXT,
  spot        DOUBLE PRECISION,
  volumes     TEXT,
  bids        TEXT,
  asks        TEXT,
  trade_times TEXT,
  contracts   TEXT
);

-- Daily OI history of each option contract, fetched after the close.
CREATE TABLE IF NOT EXISTS oi_history_options (
  id               BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  scrip            TEXT NOT NULL,
  date             TEXT NOT NULL,
  instrument_token BIGINT NOT NULL,
  tradingsymbol    TEXT NOT NULL,
  strike           DOUBLE PRECISION,
  option_type      TEXT,
  expiry           TEXT,
  open             DOUBLE PRECISION,
  high             DOUBLE PRECISION,
  low              DOUBLE PRECISION,
  close            DOUBLE PRECISION,
  volume           BIGINT,
  oi               BIGINT,
  spot_close       DOUBLE PRECISION,
  CONSTRAINT oi_history_options_scrip_date_instrument_token_key UNIQUE (scrip, date, instrument_token)
);

-- A scrip's history by date range.
CREATE INDEX IF NOT EXISTS idx_oi_history_options_scrip_date ON oi_history_options (scrip, date);
-- OI history by expiry month: GET /api/oi-history, the strike list and the
-- fetched-dates check filter a scrip's rows by `expiry LIKE 'YYYY-MM%'`, and
-- signal outcomes look one contract up by `expiry = …`. text_pattern_ops lets
-- the LIKE prefix use the index whatever the collation; date follows for the
-- `date >=` filters.
CREATE INDEX IF NOT EXISTS oi_history_options_scrip_expiry_idx ON oi_history_options (scrip, expiry text_pattern_ops, date);

-- Daily OI history of each futures contract, fetched after the close.
CREATE TABLE IF NOT EXISTS oi_history_futures (
  id               BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  scrip            TEXT NOT NULL,
  expiry           TEXT NOT NULL,
  date             TEXT NOT NULL,
  instrument_token BIGINT NOT NULL,
  tradingsymbol    TEXT NOT NULL,
  open             DOUBLE PRECISION,
  high             DOUBLE PRECISION,
  low              DOUBLE PRECISION,
  close            DOUBLE PRECISION,
  volume           BIGINT,
  oi               BIGINT,
  CONSTRAINT oi_history_futures_scrip_expiry_date_key UNIQUE (scrip, expiry, date)
);

-- A scrip's futures by expiry and date.
CREATE INDEX IF NOT EXISTS idx_oi_history_futures_scrip_expiry ON oi_history_futures (scrip, expiry, date);

-- Option Analyzer trade setups recorded per user, with their outcomes checked
-- nightly. deleted_at soft-deletes a signal.
CREATE TABLE IF NOT EXISTS trade_setup_signals (
  id                   BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id              TEXT NOT NULL,
  scrip                TEXT NOT NULL,
  signal_date          TEXT NOT NULL,
  expiry               TEXT,
  strike               DOUBLE PRECISION NOT NULL,
  option_type          TEXT NOT NULL,
  action               TEXT NOT NULL,
  status               TEXT NOT NULL,
  entry_premium        DOUBLE PRECISION,
  spot_price           DOUBLE PRECISION,
  details              JSONB NOT NULL DEFAULT '{}'::jsonb,
  outcome_price        DOUBLE PRECISION,
  outcome_date         TEXT,
  outcome_return       DOUBLE PRECISION,
  outcome_status       TEXT,
  created_at           TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  max_favorable_return DOUBLE PRECISION,
  max_adverse_return   DOUBLE PRECISION,
  outcome_final        BOOLEAN NOT NULL DEFAULT false,
  deleted_at           TEXT,
  CONSTRAINT trade_setup_signals_user_id_scrip_signal_date_expiry_strike_key
    UNIQUE (user_id, scrip, signal_date, expiry, strike, option_type, action)
);

-- A user's signals, newest day first.
CREATE INDEX IF NOT EXISTS idx_trade_setup_signals_user_date ON trade_setup_signals (user_id, signal_date DESC);
-- Nightly outcome check: only signals still waiting for a final outcome.
CREATE INDEX IF NOT EXISTS trade_setup_signals_pending_idx ON trade_setup_signals (scrip)
  WHERE NOT outcome_final AND deleted_at IS NULL;

-- ── Stock setups ──

-- Daily candles of the watched stocks, for the stock setup scan.
CREATE TABLE IF NOT EXISTS stock_daily_candles (
  instrument_token BIGINT NOT NULL,
  date             TEXT NOT NULL,
  open             DOUBLE PRECISION NOT NULL,
  high             DOUBLE PRECISION NOT NULL,
  low              DOUBLE PRECISION NOT NULL,
  close            DOUBLE PRECISION NOT NULL,
  volume           BIGINT NOT NULL,
  PRIMARY KEY (instrument_token, date)
);

-- Per stock: how far its candles are synced, and its last scan.
CREATE TABLE IF NOT EXISTS stock_candle_sync (
  instrument_token   BIGINT PRIMARY KEY,
  latest_candle_date TEXT,
  checked_at         BIGINT NOT NULL,
  full_fetched_at    BIGINT NOT NULL,
  scan_summary       JSONB
);

-- Setups the stock scan found, tracked until stopped out or on target.
CREATE TABLE IF NOT EXISTS stock_setup_signals (
  id                BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  instrument_token  BIGINT NOT NULL,
  tradingsymbol     TEXT NOT NULL,
  signal_date       TEXT NOT NULL,
  setup_type        TEXT NOT NULL,
  direction         TEXT NOT NULL,
  entry             DOUBLE PRECISION NOT NULL,
  stop              DOUBLE PRECISION NOT NULL,
  target            DOUBLE PRECISION NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open',
  resolved_date     TEXT,
  sessions_held     INTEGER NOT NULL DEFAULT 0,
  max_favorable_pct DOUBLE PRECISION,
  max_adverse_pct   DOUBLE PRECISION,
  created_at        BIGINT NOT NULL,
  CONSTRAINT stock_setup_signals_instrument_token_signal_date_setup_type_key
    UNIQUE (instrument_token, signal_date, setup_type)
);

-- Open setups by stock, checked against each new candle.
CREATE INDEX IF NOT EXISTS idx_stock_setup_signals_open ON stock_setup_signals (instrument_token) WHERE status = 'open';

-- ── Jobs and alerts ──

-- One row per scheduled job per day, so a job runs once a day (and Admin
-- Services shows how it went).
CREATE TABLE IF NOT EXISTS scheduled_job_runs (
  job         TEXT NOT NULL,
  run_date    TEXT NOT NULL,
  status      TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at  TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  finished_at TEXT,
  PRIMARY KEY (job, run_date)
);

-- A user's price alerts, fired on live ticks.
CREATE TABLE IF NOT EXISTS price_alerts (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL,
  instrument_token     BIGINT NOT NULL,
  tradingsymbol        TEXT NOT NULL,
  exchange             TEXT NOT NULL,
  condition            TEXT NOT NULL CHECK (condition IN ('above', 'below')),
  value                DOUBLE PRECISION NOT NULL,
  note                 TEXT,
  browser_notification BOOLEAN NOT NULL DEFAULT false,
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'triggered')),
  triggered_at         TIMESTAMPTZ,
  triggered_price      DOUBLE PRECISION,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A user's alerts.
CREATE INDEX IF NOT EXISTS price_alerts_user_idx ON price_alerts (user_id);
-- Nightly purge of triggered alerts.
CREATE INDEX IF NOT EXISTS price_alerts_triggered_idx ON price_alerts (user_id) WHERE status = 'triggered';

-- ── Paper trading ──

-- Paper positions, manual and automated. Same-instrument trades of the same
-- source and horizon merge into one open position at the average price.
-- horizon: 1 intraday, 2 positional (the Horizon enum in shared/horizons.js).
-- Closing records Zerodha's charges (shared/paperCharges.js).
CREATE TABLE IF NOT EXISTS positions (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  mode             TEXT NOT NULL DEFAULT 'paper',
  tradingsymbol    TEXT NOT NULL,
  instrument_token BIGINT NOT NULL,
  strike           DOUBLE PRECISION,
  option_type      TEXT,
  side             TEXT NOT NULL,
  quantity         BIGINT NOT NULL,
  entry_price      DOUBLE PRECISION NOT NULL,
  entry_time       TEXT NOT NULL,
  expiry           TEXT,
  exited           INTEGER NOT NULL DEFAULT 0,
  exit_price       DOUBLE PRECISION,
  exit_time        TEXT,
  note             TEXT,
  target_price     DOUBLE PRECISION,
  stop_loss_price  DOUBLE PRECISION,
  confidence       BIGINT,
  instrument_type  TEXT NOT NULL CHECK (instrument_type IN ('CE', 'PE', 'FUT', 'EQ')),
  exchange         TEXT NOT NULL DEFAULT 'NFO',
  source           TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto')),
  charges          NUMERIC,
  charge_breakdown JSONB,
  horizon          SMALLINT NOT NULL CHECK (horizon IN (1, 2)),
  -- Options carry their strike, type and expiry; futures their expiry.
  CONSTRAINT positions_instrument_fields_check CHECK (
    (instrument_type IN ('CE', 'PE') AND strike IS NOT NULL AND option_type = instrument_type AND expiry IS NOT NULL)
    OR (instrument_type = 'FUT' AND expiry IS NOT NULL)
    OR instrument_type = 'EQ'
  )
);

-- Open positions: the Positions page and Dashboard list them on every load,
-- and the merge looks a trade's open position up among them.
CREATE INDEX IF NOT EXISTS positions_open_idx ON positions (user_id, mode) WHERE exited = 0;
-- Closed trades: the Trade Journal and Dashboard select a user's exits by mode
-- and exit-time range (GET /api/positions?status=closed, /daily-pnl, /stats).
CREATE INDEX IF NOT EXISTS positions_closed_idx ON positions (user_id, mode, exit_time) WHERE exited = 1;
-- The trade monitor: every open automated position across users when the
-- market opens, and one user's again when their positions or settings change.
CREATE INDEX IF NOT EXISTS positions_open_auto_idx ON positions (user_id) WHERE source = 'auto' AND exited = 0;
-- The session square-off: every user's open intraday paper positions opened
-- before the last session ended, oldest first (getOpenIntradayPositionsBefore).
CREATE INDEX IF NOT EXISTS positions_open_intraday_idx ON positions (mode, horizon, entry_time) WHERE exited = 0;

-- A user's automation settings (the trade engine completes them with defaults).
CREATE TABLE IF NOT EXISTS algo_configuration (
  user_id    TEXT PRIMARY KEY,
  config     JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The signals service runs for every user with automation switched on (a
-- cross-user scan); only switched-on configurations are indexed.
CREATE INDEX IF NOT EXISTS algo_configuration_enabled_idx ON algo_configuration (user_id) WHERE config ->> 'enabled' = 'true';

-- Automated trades and their lifecycle stage (shared/automation.js):
-- selected → validated → executed → closed, or rejected.
CREATE TABLE IF NOT EXISTS algo_trades (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  horizon          SMALLINT NOT NULL CHECK (horizon IN (1, 2)),
  kind             TEXT NOT NULL CHECK (kind IN ('stock', 'stock-option', 'stock-future', 'index-option', 'index-future')),
  mode             TEXT NOT NULL CHECK (mode IN ('paper', 'live')),
  tradingsymbol    TEXT NOT NULL,
  instrument_token BIGINT NOT NULL,
  side             TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quantity         BIGINT NOT NULL CHECK (quantity > 0),
  stage            TEXT NOT NULL CHECK (stage IN ('selected', 'validated', 'rejected', 'executed', 'closed')),
  reason           TEXT,
  entry_price      NUMERIC CHECK (entry_price > 0),
  exit_price       NUMERIC CHECK (exit_price > 0),
  position_id      TEXT REFERENCES positions (id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  strategy_id      TEXT,
  setup            TEXT,
  exit_rule_id     TEXT,
  charges          NUMERIC
);

-- The Algo Trading page lists a user's trades newest first.
CREATE INDEX IF NOT EXISTS algo_trades_user_created_idx ON algo_trades (user_id, created_at DESC);
-- A user's trades still in progress.
CREATE INDEX IF NOT EXISTS algo_trades_user_open_idx ON algo_trades (user_id, stage) WHERE stage NOT IN ('rejected', 'closed');
-- GET /api/automation/results: a user's closed trades entered in a date range.
CREATE INDEX IF NOT EXISTS algo_trades_user_closed_idx ON algo_trades (user_id, created_at) WHERE stage = 'closed';
-- The trades behind a position (closing them with it), and the foreign key.
CREATE INDEX IF NOT EXISTS algo_trades_position_idx ON algo_trades (position_id) WHERE position_id IS NOT NULL;

-- Each automated trade's lifecycle events, with their reasons in detail.
CREATE TABLE IF NOT EXISTS algo_trade_events (
  id            BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  algo_trade_id TEXT NOT NULL REFERENCES algo_trades (id) ON DELETE CASCADE,
  stage         TEXT NOT NULL CHECK (stage IN ('selected', 'validated', 'rejected', 'executed', 'closed')),
  at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  detail        JSONB
);

-- A trade's events in order (and the foreign key's cascade).
CREATE INDEX IF NOT EXISTS algo_trade_events_trade_idx ON algo_trade_events (algo_trade_id, at);

-- Every paper order, manual or automated, entry or exit, placed through the
-- trade engine's order service (server/tradeEngine/services/orders.js).
-- A limit order carries its limit price, a market order none. An exit is a
-- filled market order with closes_position. Settled orders placed before today
-- are deleted nightly (server/jobs/nightly/050_purge_settled_orders.sql).
CREATE TABLE IF NOT EXISTS orders (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  tradingsymbol    TEXT NOT NULL,
  instrument_token BIGINT NOT NULL,
  instrument_type  TEXT NOT NULL CHECK (instrument_type IN ('CE', 'PE', 'FUT', 'EQ')),
  exchange         TEXT NOT NULL,
  strike           DOUBLE PRECISION,
  option_type      TEXT,
  expiry           TEXT,
  side             TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quantity         BIGINT NOT NULL,
  limit_price      DOUBLE PRECISION CHECK (limit_price > 0),
  note             TEXT,
  target_price     DOUBLE PRECISION,
  stop_loss_price  DOUBLE PRECISION,
  confidence       BIGINT,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'filled', 'cancelled')),
  status_reason    TEXT,
  fill_price       DOUBLE PRECISION,
  position_id      TEXT REFERENCES positions (id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  source           TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto')),
  algo_trade_id    TEXT REFERENCES algo_trades (id) ON DELETE SET NULL,
  horizon          SMALLINT NOT NULL CHECK (horizon IN (1, 2)),
  order_type       TEXT NOT NULL CHECK (order_type IN ('limit', 'market')),
  closes_position  BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT orders_limit_price_given_check CHECK ((order_type = 'limit') = (limit_price IS NOT NULL))
);

-- GET /api/orders?from=…&to=…: a user's orders placed in a date range, newest first.
CREATE INDEX IF NOT EXISTS orders_user_created_idx ON orders (user_id, created_at DESC);
-- The Pending tab: a user's open orders whenever placed, newest first
-- (GET /api/orders?status=open, getUserOpenOrders).
CREATE INDEX IF NOT EXISTS orders_user_open_idx ON orders (user_id, created_at DESC) WHERE status = 'open';
-- The order service across all users: loading the open orders, and cancelling
-- the open ones placed before a time (at the close).
CREATE INDEX IF NOT EXISTS orders_open_idx ON orders (created_at) WHERE status = 'open';
-- The entry rules: a user's automated orders still waiting, which count like
-- open positions (getWaitingAutoOrders).
CREATE INDEX IF NOT EXISTS orders_open_auto_idx ON orders (user_id) WHERE status = 'open' AND source = 'auto';
-- The foreign keys: clearing the link when a position or automated trade is
-- deleted stays an index lookup.
CREATE INDEX IF NOT EXISTS orders_position_idx ON orders (position_id) WHERE position_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_algo_trade_idx ON orders (algo_trade_id) WHERE algo_trade_id IS NOT NULL;

-- ── Seed data ──

-- The subscription plans.
INSERT INTO subscription_plans (id, name, description, price, currency, "interval", is_active, duration_count, duration_unit)
VALUES
  ('one_month',     '1 Month',   'Monthly OptionTrap access. Payment integration coming soon.',        0, 'INR', 'month',    1,  1, 'month'),
  ('six_months',    '6 Months',  'Half-yearly OptionTrap access. Payment integration coming soon.',  999, 'INR', '6 months', 1,  6, 'month'),
  ('twelve_months', '12 Months', 'Annual OptionTrap access. Payment integration coming soon.',      2999, 'INR', 'year',     1, 12, 'month')
ON CONFLICT (id) DO NOTHING;

-- The first admin.
INSERT INTO users (user_id, is_admin) VALUES ('UR5452', 1)
ON CONFLICT (user_id) DO UPDATE SET is_admin = 1;
