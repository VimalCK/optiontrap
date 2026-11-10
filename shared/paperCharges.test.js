import { describe, it, expect } from 'vitest';
import { chargeSegment, orderCharges, roundTripCharges } from './paperCharges.js';

describe('orderCharges', () => {
  it('charges an option sell: flat brokerage, STT on the premium, no stamp duty', () => {
    // 75 × ₹60 = ₹4,500: STT 0.15% = 6.75, NSE 0.03553% = 1.60, GST 18% of (20 + 1.60 + 0.00) = 3.89.
    expect(orderCharges('option', 'SELL', 60, 75)).toEqual({ brokerage: 20, stt: 6.75, exchange: 1.6, sebi: 0, stamp: 0, gst: 3.89, dp: 0, total: 32.24 });
  });

  it('charges an option buy: stamp duty, no STT', () => {
    // 75 × ₹30 = ₹2,250: NSE 0.80, stamp 0.003% = 0.07, GST 18% of 20.80 = 3.74.
    expect(orderCharges('option', 'BUY', 30, 75)).toEqual({ brokerage: 20, stt: 0, exchange: 0.8, sebi: 0, stamp: 0.07, gst: 3.74, dp: 0, total: 24.61 });
  });

  it('caps futures brokerage at ₹20 an order, and charges on the contract value', () => {
    // 75 × ₹24,000 = ₹18 lakh: 0.03% would be ₹540, capped at 20; NSE 32.94, SEBI 1.80, stamp 0.002% = 36.
    expect(orderCharges('future', 'BUY', 24000, 75)).toEqual({ brokerage: 20, stt: 0, exchange: 32.94, sebi: 1.8, stamp: 36, gst: 9.85, dp: 0, total: 100.59 });
    expect(orderCharges('future', 'SELL', 24000, 75).stt).toBe(900); // 0.05% on the sell side
  });

  it('charges small futures and intraday orders 0.03% when that is under ₹20', () => {
    expect(orderCharges('equityIntraday', 'BUY', 500, 10).brokerage).toBe(1.5); // 0.03% of ₹5,000
  });

  it('charges delivery STT on both sides, no brokerage, and the DP charge on the sell', () => {
    const buy = orderCharges('equityDelivery', 'BUY', 1000, 10);
    const sell = orderCharges('equityDelivery', 'SELL', 1000, 10);
    expect(buy).toMatchObject({ brokerage: 0, stt: 10, stamp: 1.5, dp: 0 });
    expect(sell).toMatchObject({ brokerage: 0, stt: 10, stamp: 0, dp: 15.34 });
  });
});

describe('chargeSegment', () => {
  const morning = new Date('2026-11-09T04:00:00Z'); // Mon 09:30 IST
  const afternoon = new Date('2026-11-09T09:00:00Z'); // Mon 14:30 IST
  const nextDay = new Date('2026-11-10T04:00:00Z'); // Tue 09:30 IST

  it('picks options and futures by instrument type', () => {
    expect(chargeSegment('CE', morning, nextDay)).toBe('option');
    expect(chargeSegment('PE', morning, morning)).toBe('option');
    expect(chargeSegment('FUT', morning, nextDay)).toBe('future');
  });

  it('treats a stock exited the same IST day as intraday, else delivery', () => {
    expect(chargeSegment('EQ', morning, afternoon)).toBe('equityIntraday');
    expect(chargeSegment('EQ', morning, nextDay)).toBe('equityDelivery');
    // 23:00 IST Mon and 01:00 IST Tue are different IST days, though the same UTC day.
    expect(chargeSegment('EQ', new Date('2026-11-09T17:30:00Z'), new Date('2026-11-09T19:30:00Z'))).toBe('equityDelivery');
  });
});

describe('roundTripCharges', () => {
  it('adds the entry order and the opposite-side exit order', () => {
    const sold = { instrumentType: 'PE', side: /** @type {const} */ ('SELL'), quantity: 75, entryPrice: 60, entryTime: new Date('2026-11-09T04:00:00Z') };
    const charges = roundTripCharges(sold, 30, new Date('2026-11-09T08:00:00Z'));
    // The sell at 60 (32.24) and the buy back at 30 (24.61).
    expect(charges).toEqual({ brokerage: 40, stt: 6.75, exchange: 2.4, sebi: 0, stamp: 0.07, gst: 7.63, dp: 0, total: 56.85 });
  });
});
