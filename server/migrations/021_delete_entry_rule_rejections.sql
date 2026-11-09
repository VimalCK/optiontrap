-- The General settings and entry rules now decide whether to enter a trade
-- before anything is saved (server/autoTradeEngine.js): a signal they refuse
-- is only logged. Trades they refused earlier were saved as rejected at
-- selection, with no validated event; delete those (their events go with
-- them, ON DELETE CASCADE). Trades rejected after validation, because they
-- could not be placed, are kept, as are executed and closed trades.
--
-- A one-off clean-up, not a query the app runs: it reads the rejected trades
-- once and checks each one's events by auto_trade_events_trade_idx.
DELETE FROM auto_trades t
WHERE t.stage = 'rejected'
  AND NOT EXISTS (
    SELECT 1 FROM auto_trade_events e
    WHERE e.auto_trade_id = t.id AND e.stage = 'validated'
  );

-- Paper limit orders (shared/paperOrders.js, server/paperOrderBook.js). A
-- limit order waits here until a live tick reaches its price, then opens its
-- paper position through the one paper-trading path; open orders are
-- cancelled at the market close. Market orders don't create rows here.
--   status        open (waiting), filled or cancelled; status_reason says why
--                 it was cancelled (the user, the close, or a refused fill)
--   fill_price    the price it filled at: the last price when it could fill at
--                 placement, else its limit
--   position_id   the position it opened or netted into. Kept when positions
--                 are reset, so the order history stays; only the link clears.
-- The note, target, stop-loss, strategy and confidence go to the position.
CREATE TABLE IF NOT EXISTS paper_orders (
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
  limit_price      DOUBLE PRECISION NOT NULL CHECK (limit_price > 0),
  note             TEXT,
  target_price     DOUBLE PRECISION,
  stop_loss_price  DOUBLE PRECISION,
  strategy_tag     TEXT,
  confidence       BIGINT,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'filled', 'cancelled')),
  status_reason    TEXT,
  fill_price       DOUBLE PRECISION,
  position_id      TEXT REFERENCES positions (id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- GET /api/paper-orders: a user's orders placed in a date range, newest first.
CREATE INDEX IF NOT EXISTS paper_orders_user_created_idx ON paper_orders (user_id, created_at DESC);
-- The order book, across all users: loading today's open orders, and
-- cancelling the open ones placed before a time (at the close, and any left
-- from an earlier day). Only open orders are in it, so it stays small.
CREATE INDEX IF NOT EXISTS paper_orders_open_idx ON paper_orders (created_at) WHERE status = 'open';
-- The foreign key: clearing the link when a position is deleted stays an index lookup.
CREATE INDEX IF NOT EXISTS paper_orders_position_idx ON paper_orders (position_id) WHERE position_id IS NOT NULL;
