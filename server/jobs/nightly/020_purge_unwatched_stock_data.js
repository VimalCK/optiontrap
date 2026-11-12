/**
 * Delete stored candles and sync rows for stocks no longer in any watchlist.
 * The market reference index (instruments.is_market_reference) is kept: every
 * stock's market check compares against it.
 *
 * Open setups of those stocks would stay open forever (only watchlist stocks
 * are scanned), so they go too. Finished setups stay for the scorecard.
 */
import { sqlEnum } from '../../sql.js';
import { SetupOutcomeStatus } from '../../../shared/appEnums.js';

/** Purge the unwatched stocks' candles, sync rows and open setups in one transaction. */
export default async function run({ runSql }) {
  const rowCount = await runSql(`
    DELETE FROM stock_daily_candles c
    WHERE NOT EXISTS (SELECT 1 FROM instruments i WHERE i.instrument_token = c.instrument_token AND i.is_market_reference)
      AND NOT EXISTS (SELECT 1 FROM watchlist_items wi WHERE wi.instrument_token = c.instrument_token);

    DELETE FROM stock_candle_sync s
    WHERE NOT EXISTS (SELECT 1 FROM instruments i WHERE i.instrument_token = s.instrument_token AND i.is_market_reference)
      AND NOT EXISTS (SELECT 1 FROM watchlist_items wi WHERE wi.instrument_token = s.instrument_token);

    DELETE FROM stock_setup_signals g
    WHERE g.status = ${sqlEnum(SetupOutcomeStatus.Open)}
      AND NOT EXISTS (SELECT 1 FROM watchlist_items wi WHERE wi.instrument_token = g.instrument_token);
  `);
  return { rowCount };
}
