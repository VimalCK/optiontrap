-- One row per stock is enough: keep the watchlist's scan summary on the stock's
-- sync row. The scan date always matched last_date and nothing read it.
ALTER TABLE stock_candle_sync ADD COLUMN IF NOT EXISTS scan_summary JSONB;

UPDATE stock_candle_sync c
SET scan_summary = s.summary
FROM stock_setup_scans s
WHERE s.instrument_token = c.instrument_token;

DROP TABLE IF EXISTS stock_setup_scans;
