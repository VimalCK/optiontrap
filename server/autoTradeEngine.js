/**
 * The trade engine: turns strategy signals into automated paper trades.
 *
 * Runs after each scheduled OI snapshot (oiSnapshotScheduler's
 * onScheduledSnapshot, every 10 minutes in market hours), for every user with
 * automation switched on and every strategy they have active
 * (shared/strategies/). Each strategy prepares once per run (the market
 * work, shared by all users), then selects each user's signals with their
 * settings, picking only trades their General settings allow. Each signal
 * becomes an automated trade that moves through the lifecycle in
 * shared/automation.js, recorded stage by stage:
 *
 *   selected   the strategy picked it; sized at tradeLots (the Max lots entry
 *              rule's value, 1 lot while it is off) × the lot size
 *   rejected   a General setting (checkGeneralSettings), an entry rule
 *              (checkEntryRules) or the paper trade rules refused it; it ends here
 *   validated  it passed the General settings and every active entry rule
 *   executed   opened as an automated paper position (source 'auto') at the
 *              last traded price, then handed to the trade monitor, which
 *              closes it when an exit rule fires
 *
 * The instrument's details (symbol, type, expiry, lot size, index or stock)
 * come from the instrument list, never from the strategy. With no strategy
 * active for anyone, a run does nothing.
 */
import {
  advanceAutoTrade,
  createAutoTrade,
  getAutomatedUsers,
  getOpenAutoPositions,
  getTodayAutoRealisedPnl,
  getTodayOiSnapshots,
  getUnderlyings,
} from './db.js';
import { openPaperTrade } from './paperTrading.js';
import { fetchQuotes } from './kiteQuotes.js';
import { openAutoTradePnl, refreshAutoTradeMonitor } from './autoTradeMonitor.js';
import { checkGeneralSettings, tradeKind } from '../shared/automation.js';
import { checkEntryRules, tradeLots } from '../shared/entryRules/index.js';
import { STRATEGIES } from '../shared/strategies/index.js';
import { marketDayStartMs } from '../shared/marketTime.js';

const LOG_PREFIX = '[Trade Engine]';
/** Intraday strategies follow the OI snapshots; positional ones (OI history) come later. */
const HORIZON = 'intraday';

/**
 * @typedef {import('../shared/strategies/index.js').Strategy} Strategy
 * @typedef {import('../shared/strategies/index.js').Signal} Signal
 * @typedef {import('../shared/automation.js').AutomationConfig} AutomationConfig
 * @typedef {{ instrumentToken: number, tradingsymbol: string, name: string, exchange: string, instrumentType: string,
 *             strike: number | null, expiry: string | null, lotSize: number | null }} Instrument
 * @typedef {{ horizon: 'intraday', kind: import('../shared/automation.js').TradeKindId, mode: string, side: 'BUY' | 'SELL',
 *             tradingsymbol: string, instrumentToken: number, exchange: string, instrumentType: string,
 *             strike: number | null, expiry: string | null, lotSize: number, quantity: number }} PlannedTrade
 */

/** A stock trades in shares: its lot is 1. */
const STOCK_LOT = 1;

/**
 * The trade a signal means for a user, sized by tradeLots; or the
 * reason it can't be traded at all (unknown instrument, an index itself).
 * @param {Signal} signal
 * @param {Map<number, Instrument>} instrumentsByToken
 * @param {Set<string>} indexNames  F&O names of the underlyings that are indices
 * @param {AutomationConfig} config
 * @returns {{ trade: PlannedTrade, error?: undefined } | { error: string, trade?: undefined }}
 */
export function planTrade(signal, instrumentsByToken, indexNames, config) {
  const instrument = instrumentsByToken.get(signal.instrumentToken);
  if (!instrument) return { error: `instrument ${signal.instrumentToken} is not in today's instrument list` };
  const kind = tradeKind(instrument.instrumentType, indexNames.has(instrument.name));
  if (!kind) return { error: `${instrument.tradingsymbol} can't be traded` };
  const lotSize = instrument.lotSize || STOCK_LOT;
  return {
    trade: {
      horizon: HORIZON,
      kind,
      mode: config.mode,
      side: signal.side,
      tradingsymbol: instrument.tradingsymbol,
      instrumentToken: instrument.instrumentToken,
      exchange: instrument.exchange,
      instrumentType: instrument.instrumentType,
      strike: instrument.strike,
      expiry: instrument.expiry,
      lotSize,
      quantity: tradeLots(config.entryRules) * lotSize,
    },
  };
}

/**
 * Why the user's settings refuse this trade (General settings first, then the
 * entry rules in order), or null when it may be executed.
 * @param {PlannedTrade} trade
 * @param {AutomationConfig} config
 * @param {import('../shared/entryRules/index.js').EntryRuleContext} ctx
 * @returns {{ ruleId: string | null, reason: string } | null}
 */
export function refusal(trade, config, ctx) {
  const general = checkGeneralSettings(trade, config);
  if (general) return { ruleId: null, reason: general };
  const entry = checkEntryRules(trade, ctx, config.entryRules);
  return entry.ok ? null : { ruleId: entry.ruleId, reason: entry.reason };
}

/**
 * A trade engine. Everything it talks to is injectable, for tests.
 * @param {{
 *   db?: { getAutomatedUsers: typeof getAutomatedUsers, getTodayOiSnapshots: typeof getTodayOiSnapshots, getUnderlyings: typeof getUnderlyings,
 *          createAutoTrade: typeof createAutoTrade, advanceAutoTrade: typeof advanceAutoTrade,
 *          getOpenAutoPositions: typeof getOpenAutoPositions, getTodayAutoRealisedPnl: typeof getTodayAutoRealisedPnl },
 *   strategies?: Strategy[],
 *   openPosition?: typeof openPaperTrade,
 *   quotes?: typeof fetchQuotes,
 *   openPnl?: typeof openAutoTradePnl,
 *   onExecuted?: typeof refreshAutoTradeMonitor,
 *   log?: (message: string) => void,
 * }} [deps]
 */
export function createAutoTradeEngine({
  db = { getAutomatedUsers, getTodayOiSnapshots, getUnderlyings, createAutoTrade, advanceAutoTrade, getOpenAutoPositions, getTodayAutoRealisedPnl },
  strategies = STRATEGIES,
  openPosition = openPaperTrade,
  quotes = fetchQuotes,
  openPnl = openAutoTradePnl,
  onExecuted = refreshAutoTradeMonitor,
  log = (message) => console.log(`${LOG_PREFIX} ${message}`),
} = {}) {
  const activeFor = (/** @type {AutomationConfig} */ config) => strategies.filter((s) => config.strategies[s.id]?.active);

  /** Each strategy active for any of these users, prepared once on this run's market data. */
  function prepareStrategies(users, input) {
    const active = strategies.filter((s) => users.some(({ config }) => config.strategies[s.id]?.active));
    return new Map(active.map((strategy) => [strategy.id, strategy.prepare(input)]));
  }

  /** One user's signals from their active strategies, with their own strategy settings. */
  function userSignals(config, prepared, allows) {
    return activeFor(config).flatMap((strategy) => strategy.select(prepared.get(strategy.id), config.strategies[strategy.id].params, { allows })
      .map((signal) => ({ ...signal, strategyId: strategy.id })));
  }

  /** Take one signal through the lifecycle for one user. */
  async function take(userId, config, signal, { instrumentsByToken, indexNames, prices, now }) {
    const planned = planTrade(signal, instrumentsByToken, indexNames, config);
    if (planned.error !== undefined) {
      log(`${signal.strategyId} [${userId}] skipped a signal: ${planned.error}`);
      return;
    }
    const { trade } = planned;
    const id = await db.createAutoTrade(userId, trade, { strategyId: signal.strategyId, reason: signal.reason });
    const reject = (from, reason, ruleId = null) => db.advanceAutoTrade(userId, id, from, 'rejected', { reason }, { ruleId, reason });

    const ctx = {
      openAutoPositions: await db.getOpenAutoPositions(userId),
      todayAutoPnl: (await db.getTodayAutoRealisedPnl(userId, new Date(marketDayStartMs(now.getTime())).toISOString())) + openPnl(userId),
    };
    const refused = refusal(trade, config, ctx);
    if (refused) return reject('selected', refused.reason, refused.ruleId);
    await db.advanceAutoTrade(userId, id, 'selected', 'validated', {}, {});

    const entryPrice = prices.get(`${trade.exchange}:${trade.tradingsymbol}`);
    if (!entryPrice) return reject('validated', `No last price for ${trade.tradingsymbol}`);
    const opened = await openPosition(userId, { ...trade, entryPrice }, { now, source: 'auto' });
    if (!opened.ok) return reject('validated', opened.message);

    await db.advanceAutoTrade(userId, id, 'validated', 'executed', { entryPrice, positionId: opened.position.id }, { entryPrice, positionId: opened.position.id });
    onExecuted(userId);
    log(`${trade.side} ${trade.quantity} ${trade.tradingsymbol} at ${entryPrice} [${userId}] (${signal.strategyId})`);
  }

  return {
    /**
     * One run after a scheduled snapshot: every active strategy for every
     * user with automation on, each signal taken through the lifecycle.
     * @param {{ now: Date, kite: { apiKey: string, accessToken: string }, instruments: Instrument[] }} event
     */
    async run({ now, kite, instruments }) {
      if (strategies.length === 0) return;
      const users = (await db.getAutomatedUsers()).filter(({ config }) => activeFor(config).length > 0);
      if (users.length === 0) return;

      const [snapshots, underlyings] = await Promise.all([db.getTodayOiSnapshots(), db.getUnderlyings()]);
      const prepared = prepareStrategies(users, { now, snapshots, instruments, underlyings });
      const instrumentsByToken = new Map(instruments.map((i) => [i.instrumentToken, i]));
      const indexNames = new Set(underlyings.filter((u) => u.isIndex).map((u) => u.name));
      /** Whether the user's General settings allow the trade a signal means. */
      const allowsFor = (/** @type {AutomationConfig} */ config) => (/** @type {Signal} */ signal) => {
        const planned = planTrade(signal, instrumentsByToken, indexNames, config);
        return planned.error === undefined && checkGeneralSettings(planned.trade, config) === null;
      };

      const work = users
        .map(({ userId, config }) => ({ userId, config, signals: userSignals(config, prepared, allowsFor(config)) }))
        .filter((u) => u.signals.length > 0);
      if (work.length === 0) return;

      const keys = [...new Set(work.flatMap((u) => u.signals)
        .map((s) => instrumentsByToken.get(s.instrumentToken))
        .filter(Boolean)
        .map((i) => `${i.exchange}:${i.tradingsymbol}`))];
      const quoted = keys.length > 0 ? await quotes(kite, keys) : {};
      const prices = new Map(Object.entries(quoted).map(([key, q]) => [key, q?.last_price]));

      for (const { userId, config, signals } of work) {
        for (const signal of signals) {
          try {
            await take(userId, config, signal, { instrumentsByToken, indexNames, prices, now });
          } catch (err) {
            log(`${signal.strategyId} [${userId}] failed: ${/** @type {Error} */ (err).message}`);
          }
        }
      }
    },
  };
}

const engine = createAutoTradeEngine();

/** Run the engine after each scheduled OI snapshot; a failed run is logged, never thrown. */
export function startAutoTradeEngine(/** @type {typeof import('./oiSnapshotScheduler.js').onScheduledSnapshot} */ onScheduledSnapshot) {
  onScheduledSnapshot((event) => {
    engine.run(event).catch((err) => console.warn(`${LOG_PREFIX} run failed:`, err.message));
  });
}
