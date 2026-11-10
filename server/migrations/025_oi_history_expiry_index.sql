-- OI history by expiry month.
--
-- GET /api/oi-history (getOiHistoryDataByExpiryMonth), the strike list and the
-- fetched-dates check for an expiry month (oiHistoryFetch) filter a scrip's rows by
-- `expiry LIKE 'YYYY-MM%'`, and signal outcomes look one contract up by
-- `expiry = …`. The only index was (scrip, date), so each of them read every row
-- stored for the scrip. text_pattern_ops lets the LIKE prefix use the index
-- whatever the database collation; date follows for the `date >=` filters.
CREATE INDEX IF NOT EXISTS oi_history_scrip_expiry_idx
  ON oi_history (scrip, expiry text_pattern_ops, date);
