-- Replay (pages/Replay): a user plays a past session back minute by minute and
-- takes short option buys without seeing what comes next. Each playthrough of a
-- day is a session; its trades are kept so the Results tab can show whether the
-- player's blind entries make money. The day's candles are fetched from Kite when
-- opened and never stored.

-- One playthrough of an underlying's day. attempt counts the user's playthroughs
-- of that day: only the first is blind, so the results count only attempt 1.
-- finished_at is set when the session reaches the close; trade_count and net are
-- its trades' totals at that moment.
CREATE TABLE IF NOT EXISTS replay_sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  underlying  TEXT NOT NULL,
  trade_date  TEXT NOT NULL,
  expiry      TEXT NOT NULL,
  lot_size    INTEGER NOT NULL CHECK (lot_size > 0),
  attempt     INTEGER NOT NULL CHECK (attempt > 0),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  trade_count INTEGER NOT NULL DEFAULT 0,
  net         NUMERIC(14, 2) NOT NULL DEFAULT 0,
  -- Also serves the next attempt number (MAX(attempt) for a user's underlying and day).
  CONSTRAINT replay_sessions_user_day_attempt_key UNIQUE (user_id, underlying, trade_date, attempt)
);

-- GET /api/replay-sessions?from=&to=[&underlying=]: a user's sessions by day range, across underlyings.
CREATE INDEX IF NOT EXISTS replay_sessions_user_date_idx ON replay_sessions (user_id, trade_date);

-- A replay trade: a bought ATM option, entered and exited at fill prices already
-- through the replay's slippage (shared/replay.js), with Zerodha's charges.
-- underlying, trade_date and attempt are copied from the session so the results
-- read this table alone. Times are 'HH:MM' IST on trade_date.
-- option_type: OptionType; exit_reason: ReplayExitReason; reasons: ReplayReason.
CREATE TABLE IF NOT EXISTS replay_trades (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES replay_sessions (id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,
  underlying    TEXT NOT NULL,
  trade_date    TEXT NOT NULL,
  attempt       INTEGER NOT NULL,
  option_type   TEXT NOT NULL CHECK (option_type IN ('CE', 'PE')),
  strike        DOUBLE PRECISION NOT NULL,
  tradingsymbol TEXT NOT NULL,
  lots          INTEGER NOT NULL CHECK (lots > 0),
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  click_time    TEXT NOT NULL,
  entry_time    TEXT NOT NULL,
  exit_time     TEXT NOT NULL,
  entry_price   NUMERIC(12, 2) NOT NULL,
  exit_price    NUMERIC(12, 2) NOT NULL,
  points        NUMERIC(12, 2) NOT NULL,
  charges       NUMERIC(12, 2) NOT NULL,
  net           NUMERIC(14, 2) NOT NULL,
  exit_reason   TEXT NOT NULL CHECK (exit_reason IN ('Manual', 'SquareOff')),
  reasons       TEXT[] NOT NULL DEFAULT '{}' CHECK (reasons <@ ARRAY['Breakout', 'LevelHeld', 'PullbackInTrend', 'Reversal', 'OiWriters', 'MomentumBurst', 'PremiumLeads', 'GutFeel']::TEXT[]),
  note          TEXT,
  context       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A session's trades (its totals when it finishes) and the foreign key's cascade.
CREATE INDEX IF NOT EXISTS replay_trades_session_idx ON replay_trades (session_id);
-- GET /api/replay-stats: a user's first-attempt trades by day range.
CREATE INDEX IF NOT EXISTS replay_trades_user_attempt_date_idx ON replay_trades (user_id, attempt, trade_date);
