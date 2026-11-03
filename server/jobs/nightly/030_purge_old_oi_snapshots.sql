-- Keep only the newest snapshot day (market time), which the Option Chain shows.
-- Keyed on the newest snapshot rather than today, so weekends and holidays
-- keep the last session's snapshots. date_trunc() works in the session time
-- zone, which the runner sets to the market's.
DELETE FROM oi_snapshots
WHERE timestamp < (
  SELECT extract(epoch FROM date_trunc('day', to_timestamp(MAX(timestamp) / 1000.0))) * 1000
  FROM oi_snapshots
);
