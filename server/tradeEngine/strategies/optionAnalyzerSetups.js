/**
 * Option Analyzer setups: a trade engine strategy that trades what the Option
 * Analyzer's Strategy card suggests, scored by the same code
 * (shared/optionAnalysis/setups.js).
 *
 * It runs itself on the market clock: every SNAPSHOT_CHECK_MS in market hours
 * it looks for an OI snapshot newer than the last one it acted on (the
 * scheduler takes one every 10 minutes). At the open, and when the server
 * starts mid-session, it marks the latest one as seen, so a restart never
 * trades the same snapshot twice. A new snapshot is scored once for all users
 * (prepare) and handed to the signals service, which picks each user's trades
 * with their settings (select).
 *
 * For a new snapshot, for every underlying in it, the chain of
 * its nearest expiry is scored like the card scores it: the ±15 strikes
 * around ATM, with today's snapshots, and OI, prices and volume from the
 * newest one. Only single options are taken (sell or buy a CE or PE);
 * straddles and strangles are left out.
 *
 * For each user it takes, per underlying, the highest-scored setup that
 * their General settings allow (buy or sell, index or stock option), if its
 * score reaches their Min score and its premium their Min premium, so a
 * setup with a tiny premium isn't taken.
 */
import { atmStrikeOf, averageVolume, buildOptionChain, strikeWindow, upcomingExpiries } from '../../../shared/optionAnalysis/chain.js';
import { computeBuyRecommendations, computeSellRecommendations } from '../../../shared/optionAnalysis/setups.js';
import { withSpot } from '../../../shared/optionAnalysis/velocityPattern.js';
import { daysUntil, marketDate } from '../../../shared/marketTime.js';
import { getLatestOiSnapshotTimestamp, getTodayOiSnapshots, getUnderlyings } from '../../db.js';
import { findWorkingAdminSession } from '../../oiHistoryScheduler.js';
import { getOrFetchInstruments } from '../../instruments.js';
import { Exchange, InstrumentType, Side, isOptionType } from '../../../shared/tradeEnums.js';

/** How often, in market hours, it looks for a new OI snapshot. */
const SNAPSHOT_CHECK_MS = 30 * 1000;

/**
 * @typedef {import('./index.js').StrategyInput} StrategyInput
 * @typedef {import('./index.js').Signal} Signal
 * @typedef {import('./index.js').StrategyInstrument} StrategyInstrument
 * @typedef {Signal & { underlying: string, score: number, premium: number }} Setup
 */

/**
 * The card's single-option setups, by side and option type; straddles and strangles have none.
 * @type {Record<string, { side: import('../../../shared/tradeEnums.js').SideId, optionType: 'ce' | 'pe' }>}
 */
const SINGLE_OPTION_SETUPS = {
  'sell-ce': { side: Side.SELL, optionType: 'ce' },
  'sell-pe': { side: Side.SELL, optionType: 'pe' },
  'buy-ce': { side: Side.BUY, optionType: 'ce' },
  'buy-pe': { side: Side.BUY, optionType: 'pe' },
};

/** A snapshot's token → number record as a map. */
const tokenMap = (/** @type {Record<string, number> | undefined} */ record) =>
  new Map(Object.entries(record ?? {}).map(([token, value]) => [Number(token), value]));

/**
 * One underlying's single-option setups from the card's scoring, best first.
 * @param {{ name: string, instrumentToken: number }} underlying
 * @param {StrategyInstrument[]} options  the underlying's options
 * @param {StrategyInput} input
 * @returns {Setup[]}
 */
export function underlyingSetups(underlying, options, { now, snapshots }) {
  const latest = snapshots[snapshots.length - 1];
  const spot = latest?.prices?.[String(underlying.instrumentToken)];
  if (!spot) return [];
  const [expiry] = upcomingExpiries(options, marketDate(now));
  if (!expiry) return [];

  const chain = buildOptionChain(options, expiry);
  const atm = atmStrikeOf(chain, spot);
  const rows = strikeWindow(chain, atm);
  const oi = tokenMap(latest.data);
  const prices = tokenMap(latest.prices);
  const volumes = tokenMap(latest.volumes);
  const daysToExpiry = Math.max(0, daysUntil(expiry, now));
  const args = /** @type {const} */ ([rows, oi, prices, new Map(), new Map(), withSpot(snapshots, underlying.instrumentToken), spot, daysToExpiry, atm, volumes, averageVolume(rows, volumes)]);
  const suggested = [...computeSellRecommendations(...args), ...computeBuyRecommendations(...args)];

  /** @type {Setup[]} */
  const setups = [];
  for (const suggestion of suggested) {
    const single = SINGLE_OPTION_SETUPS[suggestion.type];
    const option = single && rows.find((r) => r.strike === suggestion.strikes[0])?.[single.optionType];
    if (!option) continue;
    const pop = 'pop' in suggestion ? ` · POP ${Math.round(suggestion.pop)}%` : '';
    setups.push({
      underlying: underlying.name,
      instrumentToken: option.instrumentToken,
      side: single.side,
      score: suggestion.score,
      premium: suggestion.premium,
      setup: suggestion.pattern,
      reason: `${suggestion.pattern} · score ${Math.round(suggestion.score)}${pop} · premium ₹${suggestion.premium.toFixed(2)}`,
    });
  }
  return setups.sort((a, b) => b.score - a.score);
}

/**
 * The strategy. Its data sources are injectable, for tests.
 * @param {{
 *   db?: { getLatestOiSnapshotTimestamp: typeof getLatestOiSnapshotTimestamp, getTodayOiSnapshots: typeof getTodayOiSnapshots,
 *          getUnderlyings: typeof getUnderlyings },
 *   findKiteSession?: typeof findWorkingAdminSession,
 *   loadInstruments?: typeof getOrFetchInstruments,
 *   clock?: () => Date,
 * }} [deps]
 * @returns {import('./index.js').Strategy<Setup[]>}
 */
export const createOptionAnalyzerSetups = ({
  db = { getLatestOiSnapshotTimestamp, getTodayOiSnapshots, getUnderlyings },
  findKiteSession = findWorkingAdminSession,
  loadInstruments = getOrFetchInstruments,
  clock = () => new Date(),
} = {}) => ({
  id: 'option-analyzer-setups',
  label: 'Option Analyzer setups',
  description: 'Takes the Strategy card\'s best single-option setup for each snapshotted underlying (nearest expiry), after every OI snapshot (every 10 minutes): the highest score among the trades your General settings allow, if it reaches Min score and its premium reaches Min premium. Straddles and strangles are skipped.',
  params: [
    { key: 'minScore', label: 'Min score (of 100)', type: 'count' },
    { key: 'minPremium', label: 'Min premium (₹)', type: 'amount' },
  ],

  /** Every snapshotted underlying's setups, scored once per run for all users. */
  prepare(input) {
    /** @type {Map<string, StrategyInstrument[]>} */
    const optionsByName = new Map();
    for (const instrument of input.instruments) {
      if (instrument.exchange !== Exchange.NFO || !isOptionType(instrument.instrumentType)) continue;
      const options = optionsByName.get(instrument.name);
      if (options) options.push(instrument);
      else optionsByName.set(instrument.name, [instrument]);
    }
    return input.underlyings.flatMap((underlying) => {
      const options = optionsByName.get(underlying.name);
      if (underlying.instrumentToken === null || !options) return [];
      return underlyingSetups({ name: underlying.name, instrumentToken: underlying.instrumentToken }, options, input);
    });
  },

  /** Per underlying, the best setup this user allows that reaches their minimums. */
  select(setups, params, { allows }) {
    /** @type {Map<string, Setup>} */
    const best = new Map();
    for (const setup of setups) {
      if (best.has(setup.underlying)) continue;
      if (setup.score < params.minScore || setup.premium < params.minPremium || !allows(setup)) continue;
      best.set(setup.underlying, setup);
    }
    return [...best.values()].map(({ instrumentToken, side, reason, setup }) => ({ instrumentToken, side, reason, setup }));
  },

  /** Run on the market clock: score each new snapshot and hand it to the signals service. */
  start(ctx) {
    /** The newest snapshot acted on (or marked seen), as its timestamp in ms. @type {number | null} */
    let seen = null;
    ctx.market.onOpen(async () => { seen = await db.getLatestOiSnapshotTimestamp(); });
    ctx.market.every(SNAPSHOT_CHECK_MS, async () => {
      const latest = await db.getLatestOiSnapshotTimestamp();
      if (latest === null || latest === seen) return;
      seen = latest;
      const kite = await findKiteSession();
      if (!kite) {
        ctx.log('skipped snapshot', { reason: 'no admin Kite login for the instrument list' });
        return;
      }
      const [snapshots, underlyings, instruments] = await Promise.all([
        db.getTodayOiSnapshots(), db.getUnderlyings(), loadInstruments(kite.apiKey, kite.accessToken),
      ]);
      await ctx.services.signals.submit(this.id, this.prepare({ now: clock(), snapshots, instruments, underlyings }));
    });
  },
});

/** The strategy the engine runs. */
export const optionAnalyzerSetups = createOptionAnalyzerSetups();
