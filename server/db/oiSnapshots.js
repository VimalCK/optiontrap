import { firstRow, getTodayMidnight, query, rows, withNamedAdvisoryLock } from './pool.js';

function roundTo10Min(timestamp) {
  const TEN_MIN = 10 * 60 * 1000;
  return Math.floor(timestamp / TEN_MIN) * TEN_MIN;
}

const OI_SNAPSHOT_MAPS = {
  prices: 'prices',
  close: 'close',
  volumes: 'volumes',
  bids: 'bids',
  asks: 'asks',
  tradeTimes: 'trade_times',
  contracts: 'contracts',
};
const OI_SNAPSHOT_MAP_COLUMNS = Object.values(OI_SNAPSHOT_MAPS);

const parseJsonMap = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

export async function saveOiSnapshot(snapshot) {
  const rounded = roundTo10Min(snapshot.timestamp);
  const newData = parseJsonMap(snapshot.data);
  const newMaps = Object.keys(OI_SNAPSHOT_MAPS).map((field) => (snapshot[field] ? parseJsonMap(snapshot[field]) : null));
  const newSpot = snapshot.spot || null;

  // All users' snapshots for a given 10-min slot merge into ONE shared row.
  // Serialize the read-modify-write per slot (cross-process) so concurrent
  // watchers on the same/different scrips can't lose each other's tokens.
  await withNamedAdvisoryLock(`oi-snapshot:${rounded}`, async () => {
    const existing = await firstRow(
      `SELECT id, data, spot, ${OI_SNAPSHOT_MAP_COLUMNS.join(', ')} FROM oi_snapshots WHERE timestamp = $1`,
      [rounded],
    );

    if (existing) {
      const data = { ...JSON.parse(existing.data), ...newData };
      const maps = OI_SNAPSHOT_MAP_COLUMNS.map((column, i) => {
        const merged = { ...(existing[column] ? JSON.parse(existing[column]) : {}), ...(newMaps[i] ?? {}) };
        return Object.keys(merged).length > 0 ? JSON.stringify(merged) : null;
      });
      const sets = OI_SNAPSHOT_MAP_COLUMNS.map((column, i) => `${column} = $${i + 3}`).join(', ');
      await query(
        `UPDATE oi_snapshots SET data = $1, spot = $2, ${sets} WHERE id = $${OI_SNAPSHOT_MAP_COLUMNS.length + 3}`,
        [JSON.stringify(data), newSpot || existing.spot || null, ...maps, existing.id],
      );
    } else {
      const columns = ['data', 'spot', ...OI_SNAPSHOT_MAP_COLUMNS];
      const placeholders = columns.map((_, i) => `$${i + 3}`).join(', ');
      await query(
        `INSERT INTO oi_snapshots (timestamp, time_label, ${columns.join(', ')})
         VALUES ($1, $2, ${placeholders})
         ON CONFLICT (timestamp) DO UPDATE SET ${columns.map((column) => `${column} = EXCLUDED.${column}`).join(', ')}`,
        [rounded, snapshot.timeLabel, JSON.stringify(newData), newSpot, ...newMaps.map((map) => (map ? JSON.stringify(map) : null))],
      );
    }
  });
}

export async function getTodayOiSnapshots() {
  const maxRow = await firstRow('SELECT MAX(timestamp) AS max_ts FROM oi_snapshots');
  if (!maxRow || maxRow.max_ts === null) return [];

  // The newest snapshot's IST day, independent of the server's own time zone.
  const midnightMs = getTodayMidnight(Number(maxRow.max_ts));

  const result = await rows(
    'SELECT timestamp, time_label, data, prices, close, spot, volumes FROM oi_snapshots WHERE timestamp >= $1 ORDER BY timestamp',
    [midnightMs],
  );

  return result.map((obj) => ({
    timestamp: Number(obj.timestamp),
    timeLabel: obj.time_label,
    data: JSON.parse(obj.data),
    prices: obj.prices ? JSON.parse(obj.prices) : undefined,
    close: obj.close ? JSON.parse(obj.close) : undefined,
    spot: obj.spot || undefined,
    volumes: obj.volumes ? JSON.parse(obj.volumes) : undefined,
  }));
}

export async function getLatestOiSnapshotTimestamp() {
  const row = await firstRow(
    'SELECT MAX(timestamp) AS ts FROM oi_snapshots WHERE timestamp >= $1',
    [getTodayMidnight()],
  );
  return row && row.ts !== null ? Number(row.ts) : null;
}

/** Served by the unique index on timestamp (one entry read). */
export async function getNewestOiSnapshotTimestamp() {
  const row = await firstRow('SELECT MAX(timestamp) AS ts FROM oi_snapshots');
  return row && row.ts !== null ? Number(row.ts) : null;
}

export async function getTodayOiSnapshotTokens() {
  const result = await rows(
    'SELECT DISTINCT jsonb_object_keys(data::jsonb) AS token FROM oi_snapshots WHERE timestamp >= $1',
    [getTodayMidnight()],
  );
  return result.map((r) => r.token);
}
