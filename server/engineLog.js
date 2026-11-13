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
 * @typedef {Record<string, string | number | null | undefined>} EngineLogDetails
 */

/**
 * @param {string} source  which part of the automation (Engine, Monitor, Exit)
 * @param {string} event   what happened ("executed", "rejected", …)
 * @param {EngineLogDetails} [details]
 * @param {Date} [now]
 */
export function engineLogEntry(source, event, details = {}, now = new Date()) {
  const shown = Object.entries(details).filter(([, value]) => value !== null && value !== undefined && value !== '');
  const width = Math.max(0, ...shown.map(([label]) => label.length)) + LABEL_GAP;
  const lines = [
    `[Algo ${TIME.format(now)} IST] ${source} · ${event}`,
    ...shown.map(([label, value]) => `${DETAIL_INDENT}${label.padEnd(width)}${value}`),
  ];
  return `${PURPLE}${lines.join('\n')}${RESET}`;
}

export function engineLog(/** @type {string} */ source, /** @type {string} */ event, /** @type {EngineLogDetails} */ details = {}) {
  console.log(engineLogEntry(source, event, details));
}

/**
 * @param {string} source
 * @returns {(event: string, details?: EngineLogDetails) => void}
 */
export const engineLogger = (source) => (event, details) => engineLog(source, event, details);
