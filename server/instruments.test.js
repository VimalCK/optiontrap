import { describe, it, expect } from 'vitest';
import { bseOnlyStocks, isDebtOrFund } from './instruments.js';

const stock = (tradingsymbol, name) => ({ tradingsymbol, name });

describe('bseOnlyStocks', () => {
  const nse = [
    stock('RELIANCE', 'RELIANCE INDUSTRIES'),
    stock('BLUECHIP-BE', 'BLUE CHIP INDIA'),
    stock('MCCHRLS-B', 'MAC CHARLES (INDIA)'),
    stock('SGRL', 'SHREE GANESH REMEDIES'),
  ];

  it('keeps stocks listed only on BSE', () => {
    const bse = [stock('SPICEJET', 'SPICEJET'), stock('GOODRICKE', 'GOODRICKE GROUP')];
    expect(bseOnlyStocks(nse, bse)).toEqual(bse);
  });

  it('drops a BSE stock whose symbol is an NSE stock', () => {
    expect(bseOnlyStocks(nse, [stock('RELIANCE', 'RELIANCE INDUSTRIES')])).toEqual([]);
  });

  it('matches symbols without the NSE series or BSE group suffix', () => {
    expect(bseOnlyStocks(nse, [stock('BLUECHIP', 'BLUE CHIP'), stock('MCCHRLS-B', 'MAC CHARLES')])).toEqual([]);
  });

  it('drops a BSE stock with another symbol but the same company name', () => {
    expect(bseOnlyStocks(nse, [stock('SHGANREM', 'Shree Ganesh Remedies Ltd.')])).toEqual([]);
    expect(bseOnlyStocks(nse, [stock('RELIND', 'RELIANCE INDUSTRIES LIMI')])).toEqual([]);
  });

  it('keeps a different company whose name only starts the same', () => {
    const bse = [stock('SHGANEL', 'SHREE GANESH ELASTOPLAST')];
    expect(bseOnlyStocks(nse, bse)).toEqual(bse);
  });
});

describe('isDebtOrFund', () => {
  const nse = (tradingsymbol, name) => isDebtOrFund({ exchange: 'NSE', tradingsymbol, name });
  const bse = (exchangeToken, tradingsymbol, name) => isDebtOrFund({ exchange: 'BSE', exchangeToken, tradingsymbol, name });

  it('keeps stocks, ETFs, REITs and indices', () => {
    expect(nse('RELIANCE', 'RELIANCE INDUSTRIES')).toBe(false);
    expect(nse('NURECA-BE', 'NURECA')).toBe(false);
    expect(nse('EMBASSY-RR', 'EMBASSY OFFICE PARKS REIT')).toBe(false);
    expect(nse('NIFTY 50', 'NIFTY 50')).toBe(false);
    expect(nse('NIFTY200MOMENTM30', 'NIFTY200MOMENTM30')).toBe(false);
    expect(nse('SBIMID150', 'SBIAMC-SBIMID150')).toBe(false);
    expect(bse(500285, 'SPICEJET', 'SPICEJET')).toBe(false);
    expect(bse(526521, 'A1L', 'A-1')).toBe(false);
    expect(bse(543971, '7NR', '7NR RETAIL')).toBe(false);
    expect(bse(590095, 'SENSEXBEES', 'NIPPON INDIA ETF SENSEX')).toBe(false);
  });

  it('drops NSE government securities, T-bills, gold bonds and unnamed bonds', () => {
    expect(nse('656KA30-SG', 'SDL KA 6.56% 2030')).toBe(true);
    expect(nse('622GS2035-GS', 'GOI LOAN  6.22% 2035')).toBe(true);
    expect(nse('182D101226-TB', 'GOI TBILL 182D-10/12/26')).toBe(true);
    expect(nse('SGBSEP28VI-GB', '2.50%GOLDBONDS2028SR-VI')).toBe(true);
    expect(nse('965SCL25C-N0', '')).toBe(true);
  });

  it('drops BSE debt by scrip code, and fund units', () => {
    expect(bse(810626, '765TNSDL27', '765TNSDL27')).toBe(true);
    expect(bse(800289, 'SGBNOV26', 'SOVEREIGN GOLD BOND 2019 SERIE')).toBe(true);
    expect(bse(700123, 'QDLCCPS', 'QUINT DIGITAL')).toBe(true);
    expect(bse(950001, 'SMILCCD', 'SMILCCD')).toBe(true);
    expect(bse(500999, '08MPD', 'NIPPON INDIA MUTUAL FUND')).toBe(true);
    expect(bse(500998, 'DWSFTS50AG', '')).toBe(true);
  });
});
