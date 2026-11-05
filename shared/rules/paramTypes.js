/**
 * The kinds of value a rule's setting can be (entry and exit rules alike).
 * Each kind says how the settings page asks for it and how the server checks
 * what was sent, so a new rule only names a kind; nothing else needs to change.
 */

/**
 * @typedef {'count' | 'amount' | 'time'} ParamTypeId
 * @typedef {{ input: 'number' | 'time', step?: string, mustBe: string, parse: (value: unknown) => number | string | undefined }} ParamType
 */

/** 'HH:MM', 24-hour. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** @type {Record<ParamTypeId, ParamType>} */
export const PARAM_TYPES = {
  count: {
    input: 'number',
    step: '1',
    mustBe: 'a whole number above 0',
    parse: (value) => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined),
  },
  amount: {
    input: 'number',
    step: '0.01',
    mustBe: 'an amount above 0',
    parse: (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined),
  },
  time: {
    input: 'time',
    mustBe: 'a time as HH:MM',
    parse: (value) => (typeof value === 'string' && TIME_PATTERN.test(value) ? value : undefined),
  },
};
