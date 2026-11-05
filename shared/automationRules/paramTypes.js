/**
 * The kinds of value a validation rule's setting can be. Each kind says how
 * the settings page asks for it and how the server checks what was sent, so
 * a new rule only names a kind; nothing else needs to change.
 */

/**
 * @typedef {'count' | 'amount'} ParamTypeId
 * @typedef {{ step: string, mustBe: string, parse: (value: unknown) => number | undefined }} ParamType
 */

/** @type {Record<ParamTypeId, ParamType>} */
export const PARAM_TYPES = {
  count: {
    step: '1',
    mustBe: 'a whole number above 0',
    parse: (value) => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined),
  },
  amount: {
    step: '0.01',
    mustBe: 'an amount above 0',
    parse: (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined),
  },
};
