import { SetupOutcomeStatus } from '../../shared/appEnums.js';
import { Exchange } from '../../shared/tradeEnums.js';
import { sqlEnum, sqlEnumList } from '../sql.js';
import { lastPerKey } from './instruments.js';
import { firstRow, insertInBatches, pool, query, rows } from './pool.js';

export async function getWatchlistStocks() {
  const result = await rows(
    `SELECT DISTINCT ON (instrument_token) instrument_token, tradingsymbol
     FROM watchlist_items
     WHERE exchange IN (${sqlEnumList(Exchange.NSE, Exchange.BSE)}) AND tradingsymbol NOT LIKE '% %'
     ORDER BY instrument_token`,
  );
  return result.map((row) => ({ instrumentToken: Number(row.instrument_token), tradingsymbol: row.tradingsymbol }));
}

export async function getStockCandles(instrumentToken) {
  const result = await rows(
    'SELECT date, open, high, low, close, volume FROM stock_daily_candles WHERE instrument_token = $1 ORDER BY date',
    [instrumentToken],
  );
  return result.map((row) => ({ date: row.date, open: row.open, high: row.high, low: row.low, close: row.close, volume: Number(row.volume) }));
}

export async function getStockCandleSync(instrumentToken) {
  const row = await firstRow('SELECT latest_candle_date, checked_at, full_fetched_at FROM stock_candle_sync WHERE instrument_token = $1', [instrumentToken]);
  return row ? { latestCandleDate: row.latest_candle_date, checkedAt: Number(row.checked_at), fullFetchedAt: Number(row.full_fetched_at) } : null;
}

/** `replace` drops the stock's stored history first (a full refetch, e.g. after a split rewrote past prices). */
export async function saveStockCandles(instrumentToken, candles, { replace = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (replace) await client.query('DELETE FROM stock_daily_candles WHERE instrument_token = $1', [instrumentToken]);
    await insertInBatches(
      client,
      'INSERT INTO stock_daily_candles (instrument_token, date, open, high, low, close, volume)',
      `ON CONFLICT (instrument_token, date) DO UPDATE SET
        open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
        close = EXCLUDED.close, volume = EXCLUDED.volume`,
      lastPerKey(candles, (c) => c.date).map((c) => [instrumentToken, c.date, c.open, c.high, c.low, c.close, Math.round(c.volume)]),
    );
    const now = Date.now();
    await client.query(
      `INSERT INTO stock_candle_sync (instrument_token, latest_candle_date, checked_at, full_fetched_at)
       VALUES ($1, (SELECT MAX(date) FROM stock_daily_candles WHERE instrument_token = $1), $2, $2)
       ON CONFLICT (instrument_token) DO UPDATE SET
         latest_candle_date = EXCLUDED.latest_candle_date,
         checked_at = EXCLUDED.checked_at,
         full_fetched_at = CASE WHEN $3 THEN EXCLUDED.full_fetched_at ELSE stock_candle_sync.full_fetched_at END`,
      [instrumentToken, now, replace],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }
}

/** Storing candles creates the sync row, so it always exists. */
export async function saveStockScan(instrumentToken, summary) {
  await query(
    'UPDATE stock_candle_sync SET scan_summary = $2 WHERE instrument_token = $1',
    [instrumentToken, JSON.stringify(summary)],
  );
}

export async function getStockScansForUser(userId) {
  const result = await rows(
    `SELECT s.instrument_token, s.scan_summary
     FROM stock_candle_sync s
     WHERE s.scan_summary IS NOT NULL AND s.instrument_token IN (
       SELECT wi.instrument_token FROM watchlist_items wi
       JOIN watchlists w ON w.id = wi.watchlist_id
       WHERE w.user_id = $1
     )`,
    [userId],
  );
  return result.map((row) => ({ instrumentToken: Number(row.instrument_token), summary: row.scan_summary }));
}

/** Record setups, with their outcome when already known (a backfill); one per stock, day and type. Existing ones are kept. */
export async function insertStockSetupSignals(signals) {
  if (!signals.length) return;
  const client = await pool.connect();
  try {
    await insertInBatches(
      client,
      `INSERT INTO stock_setup_signals
        (instrument_token, tradingsymbol, signal_date, setup_type, direction, entry, stop, target,
         status, resolved_date, sessions_held, max_favorable_pct, max_adverse_pct, created_at)`,
      'ON CONFLICT (instrument_token, signal_date, setup_type) DO NOTHING',
      signals.map((s) => [
        s.instrumentToken, s.tradingsymbol, s.signalDate, s.setupType, s.direction, s.entry, s.stop, s.target,
        s.outcome?.status ?? SetupOutcomeStatus.Open, s.outcome?.resolvedDate ?? null, s.outcome?.sessionsHeld ?? 0,
        s.outcome?.maxFavorablePct ?? null, s.outcome?.maxAdversePct ?? null, Date.now(),
      ]),
    );
  } finally { client.release(); }
}

export async function getOpenStockSetupSignals(instrumentToken) {
  const result = await rows(
    `SELECT id, signal_date, setup_type, direction, entry, stop, target
     FROM stock_setup_signals WHERE instrument_token = $1 AND status = ${sqlEnum(SetupOutcomeStatus.Open)} ORDER BY signal_date`,
    [instrumentToken],
  );
  return result.map((row) => ({
    id: Number(row.id), signalDate: row.signal_date, setupType: row.setup_type, direction: row.direction,
    entry: row.entry, stop: row.stop, target: row.target,
  }));
}

export async function updateStockSetupSignal(id, outcome) {
  await query(
    `UPDATE stock_setup_signals
     SET status = $2, resolved_date = $3, sessions_held = $4, max_favorable_pct = $5, max_adverse_pct = $6
     WHERE id = $1`,
    [id, outcome.status, outcome.resolvedDate, outcome.sessionsHeld, outcome.maxFavorablePct, outcome.maxAdversePct],
  );
}

export async function getStockSetupStats(instrumentToken) {
  const result = await rows(
    `SELECT setup_type, direction,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = ${sqlEnum(SetupOutcomeStatus.Open)}) AS open,
            COUNT(*) FILTER (WHERE status = ${sqlEnum(SetupOutcomeStatus.Target)}) AS target,
            COUNT(*) FILTER (WHERE status = ${sqlEnum(SetupOutcomeStatus.Stop)}) AS stop,
            COUNT(*) FILTER (WHERE status = ${sqlEnum(SetupOutcomeStatus.Expired)}) AS expired,
            AVG(max_favorable_pct) FILTER (WHERE status <> ${sqlEnum(SetupOutcomeStatus.Open)}) AS avg_favorable_pct,
            AVG(max_adverse_pct) FILTER (WHERE status <> ${sqlEnum(SetupOutcomeStatus.Open)}) AS avg_adverse_pct
     FROM stock_setup_signals
     WHERE instrument_token = $1
     GROUP BY setup_type, direction
     ORDER BY setup_type`,
    [instrumentToken],
  );
  return result.map((row) => ({
    setupType: row.setup_type, direction: row.direction,
    total: Number(row.total), open: Number(row.open), target: Number(row.target), stop: Number(row.stop), expired: Number(row.expired),
    avgFavorablePct: row.avg_favorable_pct === null ? null : Number(row.avg_favorable_pct),
    avgAdversePct: row.avg_adverse_pct === null ? null : Number(row.avg_adverse_pct),
  }));
}

export async function getStockSetupSignals(instrumentToken, limit = 50) {
  const result = await rows(
    `SELECT s.id, s.instrument_token, s.tradingsymbol, s.signal_date, s.setup_type, s.direction,
            s.entry, s.stop, s.target, s.status, s.resolved_date, s.sessions_held, s.max_favorable_pct, s.max_adverse_pct
     FROM stock_setup_signals s
     WHERE s.instrument_token = $1
     ORDER BY s.signal_date DESC, s.id DESC
     LIMIT $2`,
    [instrumentToken, limit],
  );
  return result.map((row) => ({
    id: Number(row.id), instrumentToken: Number(row.instrument_token), tradingsymbol: row.tradingsymbol,
    signalDate: row.signal_date, setupType: row.setup_type, direction: row.direction,
    entry: row.entry, stop: row.stop, target: row.target, status: row.status, resolvedDate: row.resolved_date,
    sessionsHeld: row.sessions_held, maxFavorablePct: row.max_favorable_pct, maxAdversePct: row.max_adverse_pct,
  }));
}
