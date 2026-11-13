/** Console only; the UI shows the stored trades. */
import { MARKET_TIME_ZONE } from '../shared/marketTime.js';

const PURPLE = '\x1b[35m';
const RESET = '\x1b[0m';
const DETAIL_INDENT = '    ';
const LABEL_GAP = 2;
const TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: MARKET_TIME_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/**
 * @typedef {Record<string, string | number | null | undefined>} AlgoDetails
 */

/**
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

export function algoLog(/** @type {string} */ source, /** @type {string} */ event, /** @type {AlgoDetails} */ details = {}) {
  console.log(algoEntry(source, event, details));
}

/**
 * @param {string} source
 * @returns {(event: string, details?: AlgoDetails) => void}
 */
export const algoLogger = (source) => (event, details) => algoLog(source, event, details);
