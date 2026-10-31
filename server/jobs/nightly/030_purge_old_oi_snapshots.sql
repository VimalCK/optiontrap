-- Keep only the newest snapshot day (IST), which the Option Chain shows.
-- Keyed on the newest snapshot rather than today, so weekends and holidays
-- keep the last session's snapshots.
DELETE FROM oi_snapshots
WHERE timestamp < (
  SELECT extract(epoch FROM
           date_trunc('day', to_timestamp(MAX(timestamp) / 1000.0) AT TIME ZONE 'Asia/Kolkata')
           AT TIME ZONE 'Asia/Kolkata') * 1000
  FROM oi_snapshots
);
