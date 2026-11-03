-- Option-chain symbols the server snapshots for a trading day, besides NIFTY
-- and BANKNIFTY (always snapshotted). A symbol is added when someone opens it
-- in the Option Analyzer and stays for the rest of that IST day.
CREATE TABLE IF NOT EXISTS oi_snapshot_symbols (
  trade_date TEXT NOT NULL,          -- IST date, YYYY-MM-DD
  symbol     TEXT NOT NULL,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (trade_date, symbol)
);
