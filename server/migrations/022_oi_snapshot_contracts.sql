-- What each token in an OI snapshot is, saved with the snapshot itself
-- (server/oiSnapshotScheduler.js → saveOiSnapshot), so a snapshot exported for
-- analysis can be read without the day's instrument list: a JSON map of token →
-- { symbol, underlying, type, strike, expiry } for options, and
-- { symbol, underlying, type: 'SPOT' } for each underlying's price row.
-- Nullable: older rows have none. Only written and read with the whole row by
-- timestamp (the existing unique index), so no new index.
ALTER TABLE oi_snapshots ADD COLUMN IF NOT EXISTS contracts TEXT;
