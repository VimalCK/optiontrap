-- Watchlist price alerts, one row per alert, owned by the user who set it.
-- The browser checks live ticks against active alerts and marks them triggered here.
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

CREATE INDEX IF NOT EXISTS price_alerts_user_idx ON price_alerts (user_id);
