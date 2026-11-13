import { SignalOutcome } from '../../shared/appEnums.js';
import { OptionType, Side } from '../../shared/tradeEnums.js';
import { firstRow, query, rows } from './pool.js';

export async function saveTradeSetupSignal(userId, signal) {
  const row = await firstRow(
    `INSERT INTO trade_setup_signals
      (user_id, scrip, signal_date, expiry, strike, option_type, action, status, entry_premium, spot_price, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (user_id, scrip, signal_date, expiry, strike, option_type, action)
     DO UPDATE SET status = EXCLUDED.status,
                   entry_premium = EXCLUDED.entry_premium,
                   spot_price = EXCLUDED.spot_price,
                   -- Merge so a re-log without the OI pattern keeps the one recorded earlier.
                   details = trade_setup_signals.details || EXCLUDED.details
     RETURNING id, signal_date, strike, option_type, action, status`,
    [userId, signal.scrip, signal.signalDate, signal.expiry || null, signal.strike,
      signal.optionType, signal.action, signal.status, signal.entryPremium ?? null,
      signal.spotPrice ?? null, JSON.stringify(signal.details || {})],
  );
  return row;
}

export async function getTradeSetupSignals(userId, { scrip = null, limit = 100 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  if (scrip) {
    return rows(
      `SELECT * FROM trade_setup_signals WHERE user_id = $1 AND scrip = $2 AND deleted_at IS NULL
       ORDER BY signal_date DESC, created_at DESC LIMIT $3`,
      [userId, scrip, safeLimit],
    );
  }
  return rows(
    `SELECT * FROM trade_setup_signals WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY signal_date DESC, created_at DESC LIMIT $2`,
    [userId, safeLimit],
  );
}

/** Returns false if it wasn't theirs or is already deleted. */
export async function deleteTradeSetupSignal(userId, signalId) {
  const row = await firstRow(
    `UPDATE trade_setup_signals SET deleted_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
     RETURNING id`,
    [signalId, userId],
  );
  return Boolean(row);
}

export async function updateTradeSetupSignalOutcome(userId, signalId, outcome) {
  return firstRow(
    `UPDATE trade_setup_signals
     SET outcome_price = $1, outcome_date = $2, outcome_return = $3, outcome_status = $4,
         max_favorable_return = $5, max_adverse_return = $6, outcome_final = $7
     WHERE id = $8 AND user_id = $9
     RETURNING id, outcome_price, outcome_date, outcome_return, outcome_status,
               max_favorable_return, max_adverse_return, outcome_final`,
    [outcome.price, outcome.date, outcome.returnPct, outcome.status,
      outcome.maxFavorableReturn, outcome.maxAdverseReturn, outcome.final, signalId, userId],
  );
}

/**
 * Runs on the server so signals are scored even when nobody opens that strike. If the option's own expiry-day close
 * was never stored (the contract drops out of the instruments list after expiry), the expiry price falls back to
 * intrinsic value from that day's stored spot close.
 */
export async function evaluateTradeSetupSignalOutcomes(scrip = null) {
  const signals = await rows(
    `SELECT id, scrip, signal_date, expiry, strike, option_type, action, entry_premium
     FROM trade_setup_signals
     WHERE NOT outcome_final AND expiry IS NOT NULL AND entry_premium > 0 AND deleted_at IS NULL
       ${scrip ? 'AND scrip = $1' : ''}`,
    scrip ? [scrip] : [],
  );
  if (signals.length === 0) return 0;

  const latestByScrip = new Map();
  const latestDateFor = async (name) => {
    if (!latestByScrip.has(name)) {
      const row = await firstRow('SELECT MAX(date) AS date FROM oi_history_options WHERE scrip = $1', [name]);
      latestByScrip.set(name, row?.date || null);
    }
    return latestByScrip.get(name);
  };

  let updated = 0;
  for (const signal of signals) {
    const latestDate = await latestDateFor(signal.scrip);
    if (!latestDate || latestDate < signal.signal_date) continue;

    const path = (await rows(
      `SELECT date, close FROM oi_history_options
       WHERE scrip = $1 AND expiry = $2 AND strike = $3 AND option_type = $4
         AND date >= $5 AND date <= $2 AND close > 0
       ORDER BY date`,
      [signal.scrip, signal.expiry, signal.strike, signal.option_type, signal.signal_date],
    )).map((row) => ({ date: row.date, price: Number(row.close) }));

    const expired = latestDate >= signal.expiry;
    let settled = path.some((point) => point.date === signal.expiry);
    if (expired && !settled) {
      const spotRow = await firstRow(
        'SELECT MAX(spot_close) AS spot FROM oi_history_options WHERE scrip = $1 AND date = $2 AND spot_close > 0',
        [signal.scrip, signal.expiry],
      );
      const spot = Number(spotRow?.spot);
      if (spot > 0) {
        const strike = Number(signal.strike);
        const intrinsic = signal.option_type === OptionType.CE ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
        path.push({ date: signal.expiry, price: intrinsic });
        settled = true;
      }
    }

    if (path.length < 2) continue;

    const entry = Number(signal.entry_premium);
    const returns = path.map(({ price }) => {
      const raw = ((price - entry) / entry) * 100;
      return signal.action === Side.SELL ? -raw : raw;
    });
    const last = path[path.length - 1];
    const returnPct = returns[returns.length - 1];
    const final = expired && settled;
    await query(
      `UPDATE trade_setup_signals
       SET outcome_price = $1, outcome_date = $2, outcome_return = $3, outcome_status = $4,
           max_favorable_return = $5, max_adverse_return = $6, outcome_final = $7
       WHERE id = $8`,
      [last.price, last.date, returnPct, final ? (returnPct > 0 ? SignalOutcome.Profit : SignalOutcome.Loss) : SignalOutcome.Open,
        Math.max(...returns), Math.min(...returns), final, signal.id],
    );
    updated += 1;
  }
  return updated;
}
