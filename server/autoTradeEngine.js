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
 * With the Entry limit offset entry rule on, a validated trade is entered
 * through a paper limit order instead (paperOrderBook.js, source auto) at a
 * better price than the last one. It stays validated while the order waits;
 * when the order fills it is executed at the limit, and when the order is
 * cancelled (by the user, or at the close) it is rejected with why
 * (settleOrder, told by the order book).
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
  getTodayAutoExits,
  getTodayAutoRealisedPnl,
  getTodayOiSnapshots,
  getUnderlyings,
  getWaitingAutoOrders,
} from './db.js';
import { openPaperTrade } from './paperTrading.js';
import { fetchQuotes } from './kiteQuotes.js';
import { marketFillPrice } from './paperFills.js';
import { openAutoTradePnl, refreshAutoTradeMonitor } from './autoTradeMonitor.js';
import { onPaperOrderSettled, placeAutoLimitOrder } from './paperOrderBook.js';
import { checkGeneralSettings, tradeKind } from '../shared/automation.js';
import { checkEntryRules, entryLimitPrice, tradeLots } from '../shared/entryRules/index.js';
import { STRATEGIES } from '../shared/strategies/index.js';
import { OPTION_TYPES } from '../shared/paperTradeRules.js';
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
 *             optionType: string | null, strike: number | null, expiry: string | null, lotSize: number, quantity: number }} PlannedTrade
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
      optionType: OPTION_TYPES.includes(instrument.instrumentType) ? instrument.instrumentType : null,
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
 *          getOpenAutoPositions: typeof getOpenAutoPositions, getTodayAutoRealisedPnl: typeof getTodayAutoRealisedPnl,
 *          getTodayAutoExits: typeof getTodayAutoExits, getWaitingAutoOrders: typeof getWaitingAutoOrders },
 *   strategies?: Strategy[],
 *   openPosition?: typeof openPaperTrade,
 *   placeOrder?: typeof placeAutoLimitOrder,
 *   quotes?: typeof fetchQuotes,
 *   openPnl?: typeof openAutoTradePnl,
 *   onExecuted?: typeof refreshAutoTradeMonitor,
 *   log?: (message: string) => void,
 * }} [deps]
 */
export function createAutoTradeEngine({
  db = { getAutomatedUsers, getTodayOiSnapshots, getUnderlyings, createAutoTrade, advanceAutoTrade, getOpenAutoPositions, getTodayAutoRealisedPnl, getTodayAutoExits, getWaitingAutoOrders },
  strategies = STRATEGIES,
  openPosition = openPaperTrade,
  placeOrder = placeAutoLimitOrder,
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

  /**
   * Take one signal through the lifecycle for one user. The General settings
   * and entry rules decide whether to enter at all, so a signal they refuse is
   * only logged, never saved: a trade is recorded once it is validated, and is
   * rejected after that only when it cannot be placed (no price, or paper
   * trading refuses it, e.g. outside market hours).
   */
  async function take(userId, config, signal, { instrumentsByToken, indexNames, prices, quotesByKey, now }) {
    const planned = planTrade(signal, instrumentsByToken, indexNames, config);
    if (planned.error !== undefined) {
      log(`${signal.strategyId} [${userId}] skipped a signal: ${planned.error}`);
      return;
    }
    const { trade } = planned;
    const todayStart = new Date(marketDayStartMs(now.getTime())).toISOString();
    const ctx = {
      now,
      openAutoPositions: await db.getOpenAutoPositions(userId),
      waitingAutoOrders: await db.getWaitingAutoOrders(userId),
      todayAutoPnl: (await db.getTodayAutoRealisedPnl(userId, todayStart)) + openPnl(userId),
      todayAutoExits: await db.getTodayAutoExits(userId, todayStart),
    };
    const refused = refusal(trade, config, ctx);
    if (refused) {
      log(`${signal.strategyId} [${userId}] did not enter ${trade.tradingsymbol}: ${refused.reason}`);
      return;
    }

    const id = await db.createAutoTrade(userId, trade, { strategyId: signal.strategyId, setup: signal.setup ?? null, reason: signal.reason });
    await db.advanceAutoTrade(userId, id, 'selected', 'validated', {}, {});
    const reject = (/** @type {string} */ reason) => db.advanceAutoTrade(userId, id, 'validated', 'rejected', { reason }, { ruleId: null, reason });

    const entryPrice = prices.get(`${trade.exchange}:${trade.tradingsymbol}`);
    if (!entryPrice) return reject(`No last price for ${trade.tradingsymbol}`);
    const limitPrice = entryLimitPrice(config.entryRules, trade.side, entryPrice);
    if (limitPrice !== null) {
      const placed = await placeOrder(userId, { ...trade, limitPrice }, { lastPrice: entryPrice, autoTradeId: id });
      if (!placed.ok) return reject(placed.message);
      if (placed.order.status === 'open') {
        log(`${trade.side} ${trade.quantity} ${trade.tradingsymbol} limit at ${limitPrice} (last ${entryPrice}) placed [${userId}] (${signal.strategyId})`);
      }
      return; // the order book tells settleOrder when it fills or is cancelled
    }
    // A market entry fills at the bid / ask in the same quote, as on Zerodha (the LTP when it has none).
    const fill = marketFillPrice(quotesByKey.get(`${trade.exchange}:${trade.tradingsymbol}`), trade.side) ?? entryPrice;
    const opened = await openPosition(userId, { ...trade, entryPrice: fill }, { now, source: 'auto' });
    if (!opened.ok) return reject(opened.message);

    await db.advanceAutoTrade(userId, id, 'validated', 'executed', { entryPrice: fill, positionId: opened.position.id }, { entryPrice: fill, positionId: opened.position.id });
    onExecuted(userId);
    log(`${trade.side} ${trade.quantity} ${trade.tradingsymbol} at ${fill} (last ${entryPrice}) [${userId}] (${signal.strategyId})`);
  }

  return {
    /**
     * Move an automated trade on when its limit order settles: executed at
     * the fill price into the position it opened (then watched by the trade
     * monitor), or rejected with why the order was cancelled. Orders placed
     * by hand are ignored.
     * @param {import('./paperOrderBook.js').PaperOrder} order
     */
    async settleOrder(order) {
      if (order.source !== 'auto' || !order.autoTradeId) return;
      const { userId, autoTradeId: id } = order;
      if (order.status === 'filled') {
        const entryPrice = order.fillPrice;
        await db.advanceAutoTrade(userId, id, 'validated', 'executed', { entryPrice, positionId: order.positionId }, { entryPrice, positionId: order.positionId });
        onExecuted(userId);
        log(`${order.side} ${order.quantity} ${order.tradingsymbol} limit filled at ${entryPrice} [${userId}]`);
        return;
      }
      if (order.status === 'cancelled') {
        const reason = order.statusReason ?? 'Limit order cancelled';
        await db.advanceAutoTrade(userId, id, 'validated', 'rejected', { reason }, { ruleId: null, reason });
      }
    },

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
      const quotesByKey = new Map(Object.entries(quoted));
      const prices = new Map(Object.entries(quoted).map(([key, q]) => [key, q?.last_price]));

      for (const { userId, config, signals } of work) {
        for (const signal of signals) {
          try {
            await take(userId, config, signal, { instrumentsByToken, indexNames, prices, quotesByKey, now });
          } catch (err) {
            log(`${signal.strategyId} [${userId}] failed: ${/** @type {Error} */ (err).message}`);
          }
        }
      }
    },
  };
}

const engine = createAutoTradeEngine();

/**
 * Run the engine after each scheduled OI snapshot, and move automated trades
 * on when their limit orders settle; a failed run is logged, never thrown.
 */
export function startAutoTradeEngine(/** @type {typeof import('./oiSnapshotScheduler.js').onScheduledSnapshot} */ onScheduledSnapshot) {
  onScheduledSnapshot((event) => {
    engine.run(event).catch((err) => console.warn(`${LOG_PREFIX} run failed:`, err.message));
  });
  onPaperOrderSettled(engine.settleOrder);
}
