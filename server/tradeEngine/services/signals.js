/**
 * The signals service: turns a strategy's signals into automated paper
 * trades, a trade engine service (server/tradeEngine/host.js).
 *
 * A strategy (server/tradeEngine/strategies/) does its market work once for
 * all users and calls submit(strategyId, prepared). For every user with
 * automation switched on and that strategy active, the strategy then selects
 * the user's signals with their settings (select), picking only trades their
 * General settings allow. Each signal becomes an automated trade that moves
 * through the lifecycle in shared/automation.js, recorded stage by stage:
 *
 *   selected   the strategy picked it; sized at tradeLots (the Max lots entry
 *              rule's value, 1 lot while it is off) × the lot size
 *   rejected   it could not be placed after validation: no price, the order
 *              rules refused it, or its order was cancelled
 *   validated  it passed the General settings and every active entry rule
 *   executed   its order filled into an automated position (source Auto),
 *              which the trade monitor closes when an exit rule fires
 *
 * The General settings and entry rules decide whether to enter at all, so a
 * signal they refuse is only logged, never saved. A validated trade is placed
 * as an order with the order service (ctx.services.orders): a market order
 * filled at once at the bid / ask from the engine's quote, or, with the Entry
 * limit offset entry rule on, a limit order at a better price than the last
 * one. Either way the order service says when the order filled or was
 * cancelled (onSettled → settleOrder), and the trade is executed or rejected.
 *
 * The instrument's details (symbol, type, expiry, lot size, index or stock)
 * come from the instrument list, never from the strategy.
 */
import {
  advanceAutoTrade,
  createAutoTrade,
  getOpenAutoPositions,
  getTodayAutoExits,
  getTodayAutoRealisedPnl,
  getUnderlyings,
  getWaitingAutoOrders,
} from '../../db.js';
import { getAutomatedUsers } from '../automationConfigs.js';
import { fetchQuotes } from '../../kiteQuotes.js';
import { findWorkingAdminSession } from '../../oiHistoryScheduler.js';
import { getOrFetchInstruments } from '../../instruments.js';
import { marketFillPrice } from '../fillPrice.js';
import { checkGeneralSettings, tradeKind } from '../../../shared/automation.js';
import { checkEntryRules, entryLimitPrice, tradeLots } from '../../../shared/entryRules/index.js';
import { STRATEGIES } from '../strategies/index.js';
import { marketDayStartMs } from '../../../shared/marketTime.js';
import { algoLogger } from '../../algoLog.js';
import { Horizon, LifecycleStage, OrderStatus, OrderType, TradeSource, isOptionType } from '../../../shared/tradeEnums.js';
import { HealthStatus } from '../../../shared/appEnums.js';
import { countLabel, healthTime } from '../../serviceHealth.js';

/** This trade engine service's id: its key in ctx.services and on Admin Services. */
export const SIGNALS_SERVICE_ID = 'signals';

/** Intraday strategies follow the OI snapshots; positional ones (OI history) come later. */
const HORIZON = Horizon.Intraday;

/**
 * @typedef {import('../strategies/index.js').Strategy} Strategy
 * @typedef {import('../strategies/index.js').Signal} Signal
 * @typedef {import('../../../shared/automation.js').AutomationConfig} AutomationConfig
 * @typedef {{ instrumentToken: number, tradingsymbol: string, name: string, exchange: string, instrumentType: string,
 *             strike: number | null, expiry: string | null, lotSize: number | null }} Instrument
 * @typedef {{ horizon: import('../../../shared/tradeEnums.js').HorizonId, kind: import('../../../shared/automation.js').TradeKindId, mode: string, side: import('../../../shared/tradeEnums.js').SideId,
 *             tradingsymbol: string, instrumentToken: number, exchange: string, instrumentType: string,
 *             optionType: string | null, strike: number | null, expiry: string | null, lotSize: number, quantity: number }} PlannedTrade
 * @typedef {{ users: number, signals: number, failed: number }} RunCounts
 *   users with the strategy active, signals it gave them, signals that failed with an error
 * @typedef {RunCounts & { strategyId: string, at: number, error: string | null }} LastRun  a submit's time (ms) and outcome
 * @typedef {import('./orders.js').Order} Order
 */

/** A stock trades in shares: its lot is 1. */
const STOCK_LOT = 1;
/** "SELL 75 NIFTY26NOV24000PE", for the algo log. */
const tradeLabel = (/** @type {{ side: string, quantity: number, tradingsymbol: string }} */ t) => `${t.side} ${t.quantity} ${t.tradingsymbol}`;
/** A submit that had nothing to do. */
const NO_WORK = Object.freeze({ users: 0, signals: 0, failed: 0 });

/**
 * The service's health, from its last run: passes when it worked, warns when
 * some signals failed, fails when the run itself failed.
 * @param {LastRun | null} lastRun
 * @returns {import('../../serviceHealth.js').HealthCheck}
 */
export function signalsHealth(lastRun) {
  if (!lastRun) return { status: HealthStatus.Pass, output: 'No run yet · runs when a strategy has a new signal', time: null };
  const time = healthTime(lastRun.at);
  if (lastRun.error !== null) return { status: HealthStatus.Fail, output: `Last run failed · ${lastRun.error}`, time };
  const summary = `Last run · ${countLabel(lastRun.users, 'user')} · ${countLabel(lastRun.signals, 'signal')}`;
  if (lastRun.failed > 0) return { status: HealthStatus.Warn, output: `${summary} · ${lastRun.failed} failed`, time };
  return { status: HealthStatus.Pass, output: summary, time };
}

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
      optionType: isOptionType(instrument.instrumentType) ? instrument.instrumentType : null,
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
 * @param {import('../../../shared/entryRules/index.js').EntryRuleContext} ctx
 * @returns {{ ruleId: string | null, reason: string } | null}
 */
export function refusal(trade, config, ctx) {
  const general = checkGeneralSettings(trade, config);
  if (general) return { ruleId: null, reason: general };
  const entry = checkEntryRules(trade, ctx, config.entryRules);
  return entry.ok ? null : { ruleId: entry.ruleId, reason: entry.reason };
}

/**
 * A signals service. Everything it talks to is injectable, for tests; the
 * order service and trade monitor come from the engine (ctx.services).
 * @param {{
 *   db?: { getAutomatedUsers: typeof getAutomatedUsers, getUnderlyings: typeof getUnderlyings,
 *          createAutoTrade: typeof createAutoTrade, advanceAutoTrade: typeof advanceAutoTrade,
 *          getOpenAutoPositions: typeof getOpenAutoPositions, getTodayAutoRealisedPnl: typeof getTodayAutoRealisedPnl,
 *          getTodayAutoExits: typeof getTodayAutoExits, getWaitingAutoOrders: typeof getWaitingAutoOrders },
 *   strategies?: Strategy[],
 *   quotes?: typeof fetchQuotes,
 *   findKiteSession?: typeof findWorkingAdminSession,
 *   loadInstruments?: typeof getOrFetchInstruments,
 *   clock?: () => Date,
 *   log?: (event: string, details?: import('../../algoLog.js').AlgoDetails) => void,
 * }} [deps]
 */
export function createSignalsService({
  db = { getAutomatedUsers, getUnderlyings, createAutoTrade, advanceAutoTrade, getOpenAutoPositions, getTodayAutoRealisedPnl, getTodayAutoExits, getWaitingAutoOrders },
  strategies = STRATEGIES,
  quotes = fetchQuotes,
  findKiteSession = findWorkingAdminSession,
  loadInstruments = getOrFetchInstruments,
  clock = () => new Date(),
  log = algoLogger('Signals'),
} = {}) {
  /** The order service and trade monitor (from the engine at start), and the order-settled unsubscribe. */
  let orders = null;
  let monitor = null;
  let stopListening = null;
  /** @type {LastRun | null} */
  let lastRun = null;

  /**
   * Take one signal through the lifecycle for one user: check it, record it
   * validated, and place its order. The order service settles it later
   * (settleOrder), at once for a market order that fills now.
   */
  async function take(userId, config, signal, { instrumentsByToken, indexNames, quotesByKey, now }) {
    const planned = planTrade(signal, instrumentsByToken, indexNames, config);
    if (planned.error !== undefined) {
      log('skipped signal', { user: userId, strategy: signal.strategyId, reason: planned.error });
      return;
    }
    const { trade } = planned;
    const todayStart = new Date(marketDayStartMs(now.getTime())).toISOString();
    const ctx = {
      now,
      openAutoPositions: await db.getOpenAutoPositions(userId),
      waitingAutoOrders: await db.getWaitingAutoOrders(userId),
      todayAutoPnl: (await db.getTodayAutoRealisedPnl(userId, todayStart)) + monitor.openPnl(userId),
      todayAutoExits: await db.getTodayAutoExits(userId, todayStart),
    };
    const refused = refusal(trade, config, ctx);
    if (refused) {
      log('not entered', { trade: tradeLabel(trade), user: userId, strategy: signal.strategyId, reason: refused.reason });
      return;
    }

    const id = await db.createAutoTrade(userId, trade, { strategyId: signal.strategyId, setup: signal.setup ?? null, reason: signal.reason });
    await db.advanceAutoTrade(userId, id, LifecycleStage.Selected, LifecycleStage.Validated, {}, {});
    log(LifecycleStage.Validated, { trade: tradeLabel(trade), user: userId, strategy: signal.strategyId, signal: signal.reason });
    const reject = (/** @type {string} */ reason) => {
      log(LifecycleStage.Rejected, { trade: tradeLabel(trade), user: userId, strategy: signal.strategyId, reason });
      return db.advanceAutoTrade(userId, id, LifecycleStage.Validated, LifecycleStage.Rejected, { reason }, { ruleId: null, reason });
    };

    const quote = quotesByKey.get(`${trade.exchange}:${trade.tradingsymbol}`);
    const lastPrice = quote?.last_price;
    if (!lastPrice) return reject(`No last price for ${trade.tradingsymbol}`);
    const limitPrice = entryLimitPrice(config.entryRules, trade.side, lastPrice);
    const order = limitPrice === null ? { ...trade, orderType: OrderType.Market } : { ...trade, orderType: OrderType.Limit, limitPrice };
    // A market entry fills at the bid / ask in the same quote, as on Zerodha (the last price when it has none).
    const placed = await orders.placeAuto(userId, order, { lastPrice, fillPrice: marketFillPrice(quote, trade.side), autoTradeId: id });
    if (!placed.ok) return reject(placed.message);
    if (placed.order.status === OrderStatus.Open) {
      log('limit order placed', { trade: tradeLabel(trade), limit: limitPrice, last: lastPrice, user: userId, strategy: signal.strategyId });
    }
  }

  /**
   * Every user with automation on and this strategy active: their signals
   * from the strategy's market work, each taken through the lifecycle; a
   * signal that fails is logged and counted.
   * @param {Strategy} strategy
   * @param {unknown} prepared
   * @returns {Promise<RunCounts>}
   */
  async function runFor(strategy, prepared) {
    const users = (await db.getAutomatedUsers()).filter(({ config }) => config.strategies[strategy.id]?.active);
    if (users.length === 0) return NO_WORK;

    const kite = await findKiteSession();
    if (!kite) throw new Error('No admin Kite login for the instrument list and quotes');
    const [instruments, underlyings] = await Promise.all([loadInstruments(kite.apiKey, kite.accessToken), db.getUnderlyings()]);
    const instrumentsByToken = new Map(instruments.map((i) => [i.instrumentToken, i]));
    const indexNames = new Set(underlyings.filter((u) => u.isIndex).map((u) => u.name));
    /** Whether the user's General settings allow the trade a signal means. */
    const allowsFor = (/** @type {AutomationConfig} */ config) => (/** @type {Signal} */ signal) => {
      const planned = planTrade(signal, instrumentsByToken, indexNames, config);
      return planned.error === undefined && checkGeneralSettings(planned.trade, config) === null;
    };

    const work = users
      .map(({ userId, config }) => ({
        userId,
        config,
        signals: strategy.select(prepared, config.strategies[strategy.id].params, { allows: allowsFor(config) })
          .map((signal) => ({ ...signal, strategyId: strategy.id })),
      }))
      .filter((u) => u.signals.length > 0);
    if (work.length === 0) return { ...NO_WORK, users: users.length };

    const keys = [...new Set(work.flatMap((u) => u.signals)
      .map((s) => instrumentsByToken.get(s.instrumentToken))
      .filter(Boolean)
      .map((i) => `${i.exchange}:${i.tradingsymbol}`))];
    const quotesByKey = new Map(Object.entries(keys.length > 0 ? await quotes(kite, keys) : {}));

    const now = clock();
    let failed = 0;
    for (const { userId, config, signals } of work) {
      for (const signal of signals) {
        try {
          await take(userId, config, signal, { instrumentsByToken, indexNames, quotesByKey, now });
        } catch (err) {
          failed += 1;
          log('signal failed', { user: userId, strategy: signal.strategyId, error: /** @type {Error} */ (err).message });
        }
      }
    }
    return { users: users.length, signals: work.reduce((total, u) => total + u.signals.length, 0), failed };
  }

  /**
   * Move an automated trade on when its order settles: executed at the fill
   * price into the position it opened (then watched by the trade monitor), or
   * rejected with why the order was cancelled. Orders placed by hand, and
   * exits, are ignored.
   * @param {Order} order
   */
  async function settleOrder(order) {
    if (order.source !== TradeSource.Auto || !order.autoTradeId || order.closesPosition) return;
    const { userId, autoTradeId: id } = order;
    if (order.status === OrderStatus.Filled) {
      const entryPrice = order.fillPrice;
      await db.advanceAutoTrade(userId, id, LifecycleStage.Validated, LifecycleStage.Executed, { entryPrice, positionId: order.positionId }, { entryPrice, positionId: order.positionId });
      await monitor.refreshUser(userId);
      log(LifecycleStage.Executed, { trade: tradeLabel(order), price: entryPrice, order: order.orderType, user: userId });
      return;
    }
    if (order.status === OrderStatus.Cancelled) {
      const reason = order.statusReason ?? 'Order cancelled';
      log(LifecycleStage.Rejected, { trade: tradeLabel(order), user: userId, reason });
      await db.advanceAutoTrade(userId, id, LifecycleStage.Validated, LifecycleStage.Rejected, { reason }, { ruleId: null, reason });
    }
  }

  return {
    id: SIGNALS_SERVICE_ID,

    /** Take the order service and trade monitor from the engine, and hear when automated orders settle. */
    start(/** @type {import('../host.js').PluginContext} */ ctx) {
      orders = ctx.services.orders;
      monitor = ctx.services.tradeMonitor;
      stopListening = orders.onSettled(settleOrder);
    },

    stop() {
      stopListening?.();
      stopListening = null;
    },

    settleOrder,

    /**
     * A strategy's new market work: pick and enter each user's trades from it.
     * Its outcome is kept for status(); a submit that fails is recorded, then thrown.
     * @param {string} strategyId
     * @param {unknown} prepared  what the strategy's prepare gave
     */
    async submit(strategyId, prepared) {
      const at = clock().getTime();
      const strategy = strategies.find((s) => s.id === strategyId);
      try {
        if (!strategy) throw new Error(`unknown strategy ${strategyId}`);
        lastRun = { strategyId, at, ...(await runFor(strategy, prepared)), error: null };
        log('run done', { strategy: strategyId, users: lastRun.users, signals: lastRun.signals, failed: lastRun.failed });
      } catch (err) {
        lastRun = { strategyId, at, ...NO_WORK, error: /** @type {Error} */ (err).message };
        log('run failed', { strategy: strategyId, error: lastRun.error });
        throw err;
      }
    },

    /** The last submit's outcome (null before the first), for Admin Services. */
    status: () => ({ lastRun }),

    /** Its own check for Admin Services, from the last run. */
    health: () => signalsHealth(lastRun),
  };
}
