/**
 * The algo trading log: a purple block in the server console for each thing
 * the trade automation does (engine runs, signals skipped or not entered,
 * trades executed or rejected, limit orders placed / filled / cancelled, exit
 * rules firing, automated positions booked), so it can be followed and
 * inspected in the console. Console only; the UI shows the stored trades.
 *
 * Each entry is a header line (IST time, which part, what happened) and one
 * indented line per detail, labels aligned, so it stays readable in a
 * narrow terminal:
 *
 *   [Algo 12:10:05 IST] Engine · executed
 *       trade     SELL 75 NIFTY26NOV24000PE
 *       price     119.85
 *
 * Used by autoTradeEngine.js, autoTradeMonitor.js and paperTrading.js (the
 * booking of an automated position, whoever exits it).
 */
import { MARKET_TIME_ZONE } from '../shared/marketTime.js';

const PURPLE = '\x1b[35m';
const RESET = '\x1b[0m';
const DETAIL_INDENT = '    ';
/** Spaces between the longest label and the values. */
const LABEL_GAP = 2;
const TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: MARKET_TIME_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/**
 * Details of an entry, label → value, in print order; empty values are left out.
 * @typedef {Record<string, string | number | null | undefined>} AlgoDetails
 */

/**
 * One algo log entry, in purple: the header line, then a line per detail.
 * @param {string} source  which part of the automation (Engine, Monitor, Exit)
 * @param {string} event   what happened ("executed", "rejected", …)
 * @param {AlgoDetails} [details]
 * @param {Date} [now]
 */
export function algoEntry(source, event, details = {}, now = new Date()) {
  const shown = Object.entries(details).filter(([, value]) => value !== null && value !== undefined && value !== '');
  const width = Math.max(0, ...shown.map(([label]) => label.length)) + LABEL_GAP;
  const lines = [
    `[Algo ${TIME.format(now)} IST] ${source} · ${event}`,
    ...shown.map(([label, value]) => `${DETAIL_INDENT}${label.padEnd(width)}${value}`),
  ];
  return `${PURPLE}${lines.join('\n')}${RESET}`;
}

/** Print one algo log entry to the console. */
export function algoLog(/** @type {string} */ source, /** @type {string} */ event, /** @type {AlgoDetails} */ details = {}) {
  console.log(algoEntry(source, event, details));
}

/**
 * A logger for one part of the automation, for its `log` dependency.
 * @param {string} source
 * @returns {(event: string, details?: AlgoDetails) => void}
 */
export const algoLogger = (source) => (event, details) => algoLog(source, event, details);
