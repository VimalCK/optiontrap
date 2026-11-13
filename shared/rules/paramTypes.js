/**
 * The kinds of value a rule's setting can be. A new rule only names a kind;
 * the settings page and the server check both follow from it.
 */

import { ParamType } from '../tradeEnums.js';

/**
 * @typedef {import('../tradeEnums.js').ParamTypeId} ParamTypeId
 * @typedef {{ input: 'number' | 'time', step?: string, mustBe: string, parse: (value: unknown) => number | string | undefined }} ParamType
 */

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** @type {Record<ParamTypeId, ParamType>} */
export const PARAM_TYPES = {
  [ParamType.Count]: {
    input: 'number',
    step: '1',
    mustBe: 'a whole number above 0',
    parse: (value) => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined),
  },
  [ParamType.Amount]: {
    input: 'number',
    step: '0.01',
    mustBe: 'an amount above 0',
    parse: (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined),
  },
  [ParamType.Percent]: {
    input: 'number',
    step: '0.01',
    mustBe: 'a percentage above 0',
    parse: (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined),
  },
  [ParamType.Time]: {
    input: 'time',
    mustBe: 'a time as HH:MM',
    parse: (value) => (typeof value === 'string' && TIME_PATTERN.test(value) ? value : undefined),
  },
};
