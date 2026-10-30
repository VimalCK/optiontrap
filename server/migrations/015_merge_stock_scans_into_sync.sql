-- One row per stock is enough: keep the watchlist's scan summary on the stock's
-- sync row. The scan date always matched last_date and nothing read it.
-- last_date holds the date of the newest stored daily candle; say so.
-- Each step checks first, so the migration is safe to run again.
ALTER TABLE stock_candle_sync ADD COLUMN IF NOT EXISTS scan_summary JSONB;

DO $$
BEGIN
  IF to_regclass('stock_setup_scans') IS NOT NULL THEN
    UPDATE stock_candle_sync c
    SET scan_summary = s.summary
    FROM stock_setup_scans s
    WHERE s.instrument_token = c.instrument_token;

    DROP TABLE stock_setup_scans;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stock_candle_sync' AND column_name = 'last_date'
  ) THEN
    ALTER TABLE stock_candle_sync RENAME COLUMN last_date TO latest_candle_date;
  END IF;
END $$;
