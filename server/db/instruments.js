import { Exchange, InstrumentType, OptionType } from '../../shared/tradeEnums.js';
import { sqlEnum, sqlEnumList } from '../sql.js';
import { firstRow, pool, query, rows } from './pool.js';

/** The instruments_meta key holding the IST date the instrument list was last fetched. */
const INSTRUMENTS_FETCHED_DATE_KEY = 'last_fetched_date';

export async function getInstrumentsDate() {
  const row = await firstRow('SELECT value FROM instruments_meta WHERE key = $1', [INSTRUMENTS_FETCHED_DATE_KEY]);
  return row ? row.value : null;
}

export async function getInstruments() {
  const result = await rows(
    'SELECT instrument_token, exchange_token, tradingsymbol, name, exchange, instrument_type, strike, expiry, lot_size FROM instruments',
  );
  return result.map((row) => ({
    instrumentToken: Number(row.instrument_token),
    exchangeToken: Number(row.exchange_token),
    tradingsymbol: row.tradingsymbol,
    name: row.name,
    exchange: row.exchange,
    instrumentType: row.instrument_type,
    strike: row.strike || null,
    expiry: row.expiry || null,
    lotSize: row.lot_size || null,
  }));
}

/** Keep the last row per key, matching what sequential upserts would leave behind. */
export function lastPerKey(items, keyOf) {
  return [...new Map(items.map((item) => [keyOf(item), item])).values()];
}

/** Keep the first row per key, matching what ON CONFLICT DO NOTHING inserts would keep. */
function firstPerKey(items, keyOf) {
  const byKey = new Map();
  for (const item of items) if (!byKey.has(keyOf(item))) byKey.set(keyOf(item), item);
  return [...byKey.values()];
}

/**
 * Reset to their defaults when Zerodha gives a token to a different tradingsymbol, so a setting never moves to
 * another instrument.
 */
const UNDERLYING_COLUMN_DEFAULTS = {
  fno_name: 'NULL',
  label: 'NULL',
  tradingview_symbol: 'NULL',
  always_snapshot: 'false',
  is_market_reference: 'false',
};

/**
 * Rows are updated in place rather than the table being wiped, so readers never see it empty.
 * `stamp` is stored as the load marker (see instruments.js).
 *
 * @returns {Promise<{ added: number, updated: number, removed: number }>}
 */
export async function saveInstruments(instruments, stamp) {
  const rowsToSave = firstPerKey(instruments, (inst) => inst.instrumentToken);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Multi-row statements: row-by-row writes of the full NSE + NFO list took
    // minutes on a hosted DB, blocking every request that waits on instruments.
    // Unchanged rows are skipped by the WHERE, so a normal day writes little.
    // xmax = 0 marks a freshly inserted row, which tells added from updated.
    let added = 0;
    let updated = 0;
    const columnCount = 9;
    for (let i = 0; i < rowsToSave.length; i += 1000) {
      const batch = rowsToSave.slice(i, i + 1000);
      const placeholders = batch.map((_, r) => `(${Array.from({ length: columnCount }, (_, c) => `$${r * columnCount + c + 1}`).join(', ')})`);
      const result = await client.query(
        `INSERT INTO instruments
           (instrument_token, exchange_token, tradingsymbol, name, exchange, instrument_type, strike, expiry, lot_size)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (instrument_token) DO UPDATE SET
           exchange_token = EXCLUDED.exchange_token,
           tradingsymbol = EXCLUDED.tradingsymbol,
           name = EXCLUDED.name,
           exchange = EXCLUDED.exchange,
           instrument_type = EXCLUDED.instrument_type,
           strike = EXCLUDED.strike,
           expiry = EXCLUDED.expiry,
           lot_size = EXCLUDED.lot_size,
           ${Object.entries(UNDERLYING_COLUMN_DEFAULTS).map(([col, reset]) => `${col} = CASE WHEN instruments.tradingsymbol = EXCLUDED.tradingsymbol THEN instruments.${col} ELSE ${reset} END`).join(',\n           ')}
         WHERE (instruments.exchange_token, instruments.tradingsymbol, instruments.name, instruments.exchange,
                instruments.instrument_type, instruments.strike, instruments.expiry, instruments.lot_size)
           IS DISTINCT FROM
               (EXCLUDED.exchange_token, EXCLUDED.tradingsymbol, EXCLUDED.name, EXCLUDED.exchange,
                EXCLUDED.instrument_type, EXCLUDED.strike, EXCLUDED.expiry, EXCLUDED.lot_size)
         RETURNING (xmax = 0) AS inserted`,
        batch.flatMap((inst) => [
          inst.instrumentToken,
          inst.exchangeToken,
          inst.tradingsymbol,
          inst.name,
          inst.exchange,
          inst.instrumentType || InstrumentType.EQ,
          inst.strike || null,
          inst.expiry || null,
          inst.lotSize || null,
        ]),
      );
      for (const row of result.rows) {
        if (row.inserted) added++;
        else updated++;
      }
    }

    const removed = await client.query(
      'DELETE FROM instruments WHERE NOT (instrument_token = ANY($1::bigint[]))',
      [rowsToSave.map((inst) => inst.instrumentToken)],
    );

    await client.query(
      'INSERT INTO instruments_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [INSTRUMENTS_FETCHED_DATE_KEY, stamp],
    );
    await client.query('COMMIT');
    return { added, updated, removed: removed.rowCount };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getFnoSymbols() {
  const result = await rows(
    `SELECT DISTINCT name FROM instruments WHERE exchange = ${sqlEnum(Exchange.NFO)} AND instrument_type IN (${sqlEnumList(OptionType.CE, OptionType.PE)}) ORDER BY name`,
  );
  return result.map((r) => r.name);
}

/**
 * F&O underlyings (the names option contracts carry) with their price row:
 * the index row whose fno_name matches ("NIFTY" -> "NIFTY 50"), otherwise the
 * stock's NSE EQ row of the same tradingsymbol. `name` limits it to one.
 * instrumentToken is null when no price row is known for the name.
 */
async function queryUnderlyings(name = null) {
  const result = await rows(
    `WITH fno AS (
       SELECT DISTINCT name FROM instruments
       WHERE exchange = ${sqlEnum(Exchange.NFO)} AND instrument_type IN (${sqlEnumList(OptionType.CE, OptionType.PE)}) AND ($1::text IS NULL OR name = $1)
     )
     SELECT DISTINCT ON (f.name)
       f.name,
       p.instrument_token, p.tradingsymbol, p.exchange,
       p.label, p.tradingview_symbol, p.always_snapshot, p.is_market_reference,
       -- An index's price row is mapped to its F&O name (fno_name); a stock's is its own NSE row.
       (i.instrument_token IS NOT NULL) AS is_index
     FROM fno f
     -- Two joins rather than one with OR: the OR forces a nested loop (~0.6 s against ~30 ms).
     LEFT JOIN instruments i ON i.fno_name = f.name
     LEFT JOIN instruments e
       ON e.fno_name IS NULL AND e.exchange = ${sqlEnum(Exchange.NSE)} AND e.instrument_type = ${sqlEnum(InstrumentType.EQ)} AND e.tradingsymbol = f.name
     CROSS JOIN LATERAL (SELECT (CASE WHEN i.instrument_token IS NOT NULL THEN i ELSE e END).*) p
     ORDER BY f.name`,
    [name],
  );
  return result.map((row) => ({
    name: row.name,
    label: row.label || row.name,
    instrumentToken: row.instrument_token == null ? null : Number(row.instrument_token),
    exchange: row.exchange,
    tradingsymbol: row.tradingsymbol,
    tradingviewSymbol: row.tradingview_symbol || row.tradingsymbol,
    alwaysSnapshot: Boolean(row.always_snapshot),
    isMarketReference: Boolean(row.is_market_reference),
    isIndex: Boolean(row.is_index),
  }));
}

export async function getUnderlyings() {
  return queryUnderlyings();
}

export async function getUnderlying(name) {
  return (await queryUnderlyings(name))[0] ?? null;
}

/**
 * The market reference index (is_market_reference): the stock setups'
 * market check compares each stock against it. Null when none is set.
 */
export async function getMarketReference() {
  const row = await firstRow('SELECT instrument_token, tradingsymbol, label FROM instruments WHERE is_market_reference LIMIT 1');
  return row ? { instrumentToken: Number(row.instrument_token), label: row.label || row.tradingsymbol } : null;
}

export async function getAlwaysSnapshotSymbols() {
  const result = await rows('SELECT COALESCE(fno_name, tradingsymbol) AS name FROM instruments WHERE always_snapshot ORDER BY 1');
  return result.map((r) => r.name);
}

export async function setAlwaysSnapshot(name, alwaysSnapshot) {
  const underlying = await getUnderlying(name);
  if (!underlying?.instrumentToken) return null;
  await query('UPDATE instruments SET always_snapshot = $2 WHERE instrument_token = $1', [underlying.instrumentToken, alwaysSnapshot]);
  return { ...underlying, alwaysSnapshot };
}

export async function getStrikeStepSize(scripName) {
  const result = await rows(
    `SELECT DISTINCT strike FROM instruments
     WHERE name = $1 AND exchange = ${sqlEnum(Exchange.NFO)} AND instrument_type = ${sqlEnum(OptionType.CE)} AND strike > 0
     ORDER BY strike LIMIT 20`,
    [scripName],
  );
  if (result.length < 2) return 50;

  const strikes = result.map((r) => r.strike);
  const gaps = new Map();
  for (let i = 1; i < strikes.length; i++) {
    const gap = Math.round(strikes[i] - strikes[i - 1]);
    if (gap > 0) gaps.set(gap, (gaps.get(gap) || 0) + 1);
  }

  let bestGap = 50;
  let bestCount = 0;
  for (const [gap, count] of gaps) {
    if (count > bestCount) { bestGap = gap; bestCount = count; }
  }
  return bestGap;
}

/** An NSE or BSE cash stock by token, or null for anything else (indices are stored as NSE EQ but contain a space). */
export async function getCashStock(instrumentToken) {
  const row = await firstRow(
    `SELECT instrument_token, tradingsymbol FROM instruments
     WHERE instrument_token = $1 AND exchange IN (${sqlEnumList(Exchange.NSE, Exchange.BSE)}) AND instrument_type = ${sqlEnum(InstrumentType.EQ)} AND tradingsymbol NOT LIKE '% %'`,
    [instrumentToken],
  );
  return row ? { instrumentToken: Number(row.instrument_token), tradingsymbol: row.tradingsymbol } : null;
}
