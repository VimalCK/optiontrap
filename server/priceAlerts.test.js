import { describe, it, expect } from 'vitest';
import { parsePriceAlertInput } from './priceAlerts.js';

const valid = {
  instrumentToken: 738561,
  tradingsymbol: 'RELIANCE',
  exchange: 'NSE',
  condition: 'above',
  value: 2950.5,
  note: '  breakout  ',
  browserNotification: true,
};

describe('parsePriceAlertInput', () => {
  it('accepts a complete alert and trims the note', () => {
    expect(parsePriceAlertInput(valid)).toEqual({
      alert: { ...valid, note: 'breakout' },
    });
  });

  it('defaults exchange, note and notification when left out', () => {
    const { alert } = parsePriceAlertInput({ instrumentToken: '738561', tradingsymbol: 'RELIANCE', condition: 'below', value: '2800' });
    expect(alert).toEqual({
      instrumentToken: 738561,
      tradingsymbol: 'RELIANCE',
      exchange: 'NSE',
      condition: 'below',
      value: 2800,
      note: null,
      browserNotification: false,
    });
  });

  it.each([
    ['missing token', { instrumentToken: undefined }],
    ['blank symbol', { tradingsymbol: '  ' }],
    ['unknown condition', { condition: 'crosses' }],
    ['zero price', { value: 0 }],
    ['non-numeric price', { value: 'abc' }],
    ['overlong note', { note: 'x'.repeat(201) }],
  ])('rejects %s', (_label, override) => {
    expect(parsePriceAlertInput({ ...valid, ...override })).toHaveProperty('error');
  });

  it('rejects a missing body', () => {
    expect(parsePriceAlertInput(undefined)).toHaveProperty('error');
  });
});
