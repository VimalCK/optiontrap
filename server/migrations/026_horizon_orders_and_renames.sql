-- Table renames, the trade horizon on every position, order and automated
-- trade, order types (limit / market), and the strategy tag dropped (at the end).
-- Renames: paper_orders to orders (first, so the rest uses the new name),
-- auto_trades / auto_trade_events to algo_trades / algo_trade_events,
-- automation_configs to algo_configuration, oi_history to oi_history_options.
-- Every step checks before it acts, so the file runs again safely.
--
-- The horizon: 1 intraday, 2 positional. These are the numbers of the Horizon
-- enum in shared/horizons.js; the code names them (Horizon.Intraday), the database
-- keeps the numbers, so a name can change without touching stored rows.
-- The trade monitor squares off only intraday positions
-- (shared/exitRules/squareOff.js), and a trade merges only with an open
-- position of the same horizon (addPosition in server/db.js).
--
-- No new index: the merge lookup (user, mode, instrument, side, source,
-- horizon among open positions) reads the user's open positions through
-- positions_open_idx (user_id, mode) WHERE exited = 0, as before, and
-- filters the horizon within those few rows.

-- Orders: paper_orders becomes orders, with every index and constraint named
-- after it, so the same table can hold live orders later (with a mode column,
-- like positions). Read by the order service (server/tradeEngine/services/orders.js) and the
-- Pending tab. Only names change: a rename is instant whatever the table's size.
DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('paper_orders') IS NOT NULL AND to_regclass('orders') IS NULL THEN
    ALTER TABLE paper_orders RENAME TO orders;
  END IF;
  IF to_regclass('orders') IS NULL THEN
    RETURN;
  END IF;

  -- Constraints first: renaming a primary key renames its index too.
  FOR r IN
    SELECT conname FROM pg_constraint WHERE conrelid = 'orders'::regclass AND conname LIKE 'paper\_orders\_%'
  LOOP
    EXECUTE format('ALTER TABLE orders RENAME CONSTRAINT %I TO %I', r.conname, 'orders_' || substr(r.conname, length('paper_orders_') + 1));
  END LOOP;

  FOR r IN
    SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = 'orders'::regclass AND c.relname LIKE 'paper\_orders\_%'
  LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I', r.relname, 'orders_' || substr(r.relname, length('paper_orders_') + 1));
  END LOOP;
END $$;

-- Positions and orders from before this column are intraday: every automated
-- trade so far was intraday, and manual trades had no other choice. The
-- default only fills existing rows (without rewriting the table) and is then
-- dropped, so every new row must say its horizon.
ALTER TABLE positions ADD COLUMN IF NOT EXISTS horizon SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE positions ALTER COLUMN horizon DROP DEFAULT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS horizon SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE orders ALTER COLUMN horizon DROP DEFAULT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'positions_horizon_check') THEN
    ALTER TABLE positions ADD CONSTRAINT positions_horizon_check CHECK (horizon IN (1, 2));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_horizon_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_horizon_check CHECK (horizon IN (1, 2));
  END IF;
END $$;

-- auto_trades.horizon (019) was text, 'intraday' / 'positional'; it stores the
-- same numbers now. Read by the Algo Trading list and the trade engine.
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'auto_trades' AND column_name = 'horizon') = 'text' THEN
    ALTER TABLE auto_trades DROP CONSTRAINT IF EXISTS auto_trades_horizon_check;
    ALTER TABLE auto_trades ALTER COLUMN horizon TYPE SMALLINT
      USING (CASE horizon WHEN 'positional' THEN 2 ELSE 1 END);
    ALTER TABLE auto_trades ADD CONSTRAINT auto_trades_horizon_check CHECK (horizon IN (1, 2));
  END IF;
END $$;

-- The automation settings key their horizon switches by the same numbers
-- ({"1": true, "2": false}) instead of {"intraday": …, "positional": …}
-- (parseAutomationConfig / withDefaults in shared/automation.js). A missing
-- switch is left out, so withDefaults fills it as before. Runs before the
-- table is renamed (below); skipped on a re-run after it.
DO $$
BEGIN
  IF to_regclass('automation_configs') IS NOT NULL THEN
    UPDATE automation_configs
    SET config = jsonb_set(config, '{horizons}', jsonb_strip_nulls(jsonb_build_object(
      '1', config -> 'horizons' -> 'intraday',
      '2', config -> 'horizons' -> 'positional')))
    WHERE config -> 'horizons' ? 'intraday' OR config -> 'horizons' ? 'positional';
  END IF;
END $$;

-- Automated trades are "algo" trades: auto_trades becomes algo_trades and
-- auto_trade_events algo_trade_events, with the columns that point at them
-- (algo_trade_events.algo_trade_id, orders.algo_trade_id) and every
-- index, constraint and sequence named after them. The data, the keys and the
-- indexes themselves stay as they are; only names change. Each step checks the
-- old name still exists, so this runs again safely.
DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('auto_trades') IS NOT NULL AND to_regclass('algo_trades') IS NULL THEN
    ALTER TABLE auto_trades RENAME TO algo_trades;
  END IF;
  IF to_regclass('auto_trade_events') IS NOT NULL AND to_regclass('algo_trade_events') IS NULL THEN
    ALTER TABLE auto_trade_events RENAME TO algo_trade_events;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'algo_trade_events' AND column_name = 'auto_trade_id') THEN
    ALTER TABLE algo_trade_events RENAME COLUMN auto_trade_id TO algo_trade_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'auto_trade_id') THEN
    ALTER TABLE orders RENAME COLUMN auto_trade_id TO algo_trade_id;
  END IF;

  -- Constraints first: renaming a primary key renames its index too.
  FOR r IN
    SELECT conname, conrelid::regclass AS tbl FROM pg_constraint
    WHERE conrelid IN ('algo_trades'::regclass, 'algo_trade_events'::regclass, 'orders'::regclass)
      AND conname LIKE '%auto\_trade%'
  LOOP
    EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I', r.tbl, r.conname, replace(r.conname, 'auto_trade', 'algo_trade'));
  END LOOP;

  FOR r IN
    SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid IN ('algo_trades'::regclass, 'algo_trade_events'::regclass, 'orders'::regclass)
      AND c.relname LIKE '%auto\_trade%'
  LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I', r.relname, replace(r.relname, 'auto_trade', 'algo_trade'));
  END LOOP;

  -- The event id's sequence; the column default refers to it by id, not name.
  IF to_regclass('auto_trade_events_id_seq') IS NOT NULL THEN
    ALTER SEQUENCE auto_trade_events_id_seq RENAME TO algo_trade_events_id_seq;
  END IF;
END $$;

-- The automation settings table: automation_configs becomes algo_configuration,
-- with its primary key and automation_configs_enabled_idx (the trade engine's
-- list of users with automation on) renamed to match. Runs again safely.
DO $$
BEGIN
  IF to_regclass('automation_configs') IS NOT NULL AND to_regclass('algo_configuration') IS NULL THEN
    ALTER TABLE automation_configs RENAME TO algo_configuration;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'automation_configs_pkey') THEN
    ALTER TABLE algo_configuration RENAME CONSTRAINT automation_configs_pkey TO algo_configuration_pkey;
  END IF;
  IF to_regclass('automation_configs_enabled_idx') IS NOT NULL THEN
    ALTER INDEX automation_configs_enabled_idx RENAME TO algo_configuration_enabled_idx;
  END IF;
END $$;

-- OI history of option contracts: oi_history becomes oi_history_options,
-- beside oi_history_futures, with its primary key, unique key, id sequence and
-- indexes (idx_oi_history_scrip_date, oi_history_scrip_expiry_idx) renamed to
-- match. Read by the OI History page, zones, position risk, signal outcomes
-- and the nightly purge (server/jobs/nightly/010_purge_old_oi_history.sql).
-- Only names change: a rename is instant whatever the table's size. Runs
-- again safely.
DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('oi_history') IS NOT NULL AND to_regclass('oi_history_options') IS NULL THEN
    ALTER TABLE oi_history RENAME TO oi_history_options;
  END IF;
  IF to_regclass('oi_history_options') IS NULL THEN
    RETURN;
  END IF;

  -- Constraints first: renaming a primary or unique key renames its index too.
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'oi_history_options'::regclass AND conname LIKE '%oi\_history%' AND conname NOT LIKE '%oi\_history\_options%'
  LOOP
    EXECUTE format('ALTER TABLE oi_history_options RENAME CONSTRAINT %I TO %I', r.conname, replace(r.conname, 'oi_history', 'oi_history_options'));
  END LOOP;

  FOR r IN
    SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = 'oi_history_options'::regclass AND c.relname LIKE '%oi\_history%' AND c.relname NOT LIKE '%oi\_history\_options%'
  LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I', r.relname, replace(r.relname, 'oi_history', 'oi_history_options'));
  END LOOP;

  -- The id column's identity sequence; the column refers to it by id, not name.
  IF to_regclass('oi_history_id_seq') IS NOT NULL THEN
    ALTER SEQUENCE oi_history_id_seq RENAME TO oi_history_options_id_seq;
  END IF;
END $$;

-- Order types (shared/paperOrders.js): a limit order has its limit price; a
-- market order has none and fills at the bid / ask. Positional market orders
-- are kept here so one placed while the market is closed waits for the open
-- (server/tradeEngine/services/orders.js). Orders from before this column are limit
-- orders; the default only fills them and is then dropped.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'limit';
ALTER TABLE orders ALTER COLUMN order_type DROP DEFAULT;
ALTER TABLE orders ALTER COLUMN limit_price DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_order_type_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_order_type_check CHECK (order_type IN ('limit', 'market'));
  END IF;
  -- A limit order has a limit price; a market order has none.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_limit_price_given_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_limit_price_given_check CHECK ((order_type = 'limit') = (limit_price IS NOT NULL));
  END IF;
END $$;

-- The Pending tab: a user's open orders, whenever they were placed (one placed
-- on a weekend still waits on Monday), newest first
-- (GET /api/orders?status=open, getUserOpenOrders). Only open
-- orders are in it, so it stays small.
CREATE INDEX IF NOT EXISTS orders_user_open_idx ON orders (user_id, created_at DESC) WHERE status = 'open';

-- Every trade is an order (server/tradeEngine/services/orders.js): one that
-- opens or adds to a position, or one that closes a position (an exit, by hand
-- or by an exit rule). A closing order names the position it closes in
-- position_id from the start (orders_position_idx serves the lookup). Orders
-- from before this column all opened positions, which the default fills in.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS closes_position BOOLEAN NOT NULL DEFAULT false;

-- The session square-off (server/tradeEngine/services/sessionSquareOff.js):
-- every user's open intraday paper positions opened before the last session
-- ended, oldest first (getOpenIntradayPositionsBefore). Only open positions are
-- in it, so the check every minute in market hours reads one small range.
CREATE INDEX IF NOT EXISTS positions_open_intraday_idx ON positions (mode, horizon, entry_time) WHERE exited = 0;

-- Drop the free-text strategy tag from positions and orders. It was a label
-- set by the browser ("Quick Trade", "Manual", "OI Chart", or typed in the
-- order popup) and only ever displayed; who placed a trade is the server-set
-- `source` column (manual / auto), which the screens show instead. Nothing
-- reads or writes the tag, and no index uses it. Runs after the rename above,
-- so the orders table has its new name.
ALTER TABLE positions DROP COLUMN IF EXISTS strategy_tag;
ALTER TABLE orders DROP COLUMN IF EXISTS strategy_tag;
