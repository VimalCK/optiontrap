import { describe, it, expect } from 'vitest';
import {
  LIFECYCLE_STAGES,
  TRADE_KINDS,
  canMoveTo,
  defaultAutomationConfig,
  parseAutomationConfig,
  withDefaults,
} from './automation.js';

const valid = () => {
  const config = defaultAutomationConfig();
  config.enabled = true;
  config.kinds['index-option'].SELL = true;
  config.kinds.stock.BUY = true;
  return config;
};

describe('trade kinds', () => {
  it('covers stocks, stock options and futures, and index options and futures', () => {
    expect(TRADE_KINDS.map((k) => k.id)).toEqual(['stock', 'stock-option', 'stock-future', 'index-option', 'index-future']);
  });
});

describe('defaultAutomationConfig', () => {
  it('is off, on paper, intraday only, with nothing chosen to trade', () => {
    const config = defaultAutomationConfig();
    expect(config).toMatchObject({ enabled: false, mode: 'paper', horizons: { intraday: true, positional: false } });
    expect(Object.values(config.kinds).every((sides) => !sides.BUY && !sides.SELL)).toBe(true);
  });

  it('passes its own validation', () => {
    expect(parseAutomationConfig(defaultAutomationConfig())).toEqual({ config: defaultAutomationConfig() });
  });
});

describe('parseAutomationConfig', () => {
  it('accepts a complete configuration as it is', () => {
    expect(parseAutomationConfig(valid())).toEqual({ config: valid() });
  });

  it('refuses live trading and positional trades until they are built', () => {
    expect(parseAutomationConfig({ ...valid(), mode: 'live' })).toEqual({ error: 'Live trading is not available yet' });
    expect(parseAutomationConfig({ ...valid(), horizons: { intraday: true, positional: true } }))
      .toEqual({ error: 'Positional trades are not available yet' });
  });

  it('refuses missing or malformed fields instead of guessing', () => {
    expect(parseAutomationConfig(null)).toEqual({ error: 'configuration is required' });
    expect(parseAutomationConfig({ ...valid(), enabled: 'yes' })).toEqual({ error: 'enabled must be true or false' });
    expect(parseAutomationConfig({ ...valid(), mode: 'demo' })).toEqual({ error: 'mode must be one of: paper, live' });
    const noSell = valid();
    delete noSell.kinds.stock.SELL;
    expect(parseAutomationConfig(noSell)).toEqual({ error: 'kinds.stock must say true or false for BUY and SELL' });
  });

  it('refuses a trade type it does not know', () => {
    const config = valid();
    config.kinds.crypto = { BUY: true, SELL: false };
    expect(parseAutomationConfig(config)).toEqual({ error: 'unknown trade type: crypto' });
  });

  it('drops anything extra sent with a trade type', () => {
    const config = valid();
    config.kinds.stock = { BUY: true, SELL: false, extra: 1 };
    expect(parseAutomationConfig(config).config.kinds.stock).toEqual({ BUY: true, SELL: false });
  });
});

describe('withDefaults', () => {
  it('gives the defaults when nothing is stored', () => {
    expect(withDefaults(null)).toEqual(defaultAutomationConfig());
  });

  it('switches off a trade type added after the configuration was saved', () => {
    const stored = valid();
    delete stored.kinds['index-future'];
    expect(withDefaults(stored).kinds['index-future']).toEqual({ BUY: false, SELL: false });
    expect(withDefaults(stored).kinds['index-option']).toEqual({ BUY: false, SELL: true });
  });

  it('falls back to paper if a stored mode is not available', () => {
    expect(withDefaults({ ...valid(), mode: 'live' }).mode).toBe('paper');
  });

  it('gives a configuration saved before validation rules existed every rule, inactive', () => {
    const stored = valid();
    delete stored.rules;
    expect(withDefaults(stored)).toEqual(valid());
  });
});

describe('parseAutomationConfig validation rules', () => {
  it('keeps the rules as set, and refuses a configuration without them', () => {
    const config = valid();
    config.rules['max-lots'] = { active: true, params: { max: 2 } };
    expect(parseAutomationConfig(config)).toEqual({ config });
    delete config.rules;
    expect(parseAutomationConfig(config)).toEqual({ error: 'rules is required' });
  });
});

describe('lifecycle', () => {
  it('runs selected → validated → executed → closed', () => {
    expect(canMoveTo('selected', 'validated')).toBe(true);
    expect(canMoveTo('validated', 'executed')).toBe(true);
    expect(canMoveTo('executed', 'closed')).toBe(true);
  });

  it('can be rejected at selection or validation, but not after execution', () => {
    expect(canMoveTo('selected', 'rejected')).toBe(true);
    expect(canMoveTo('validated', 'rejected')).toBe(true);
    expect(canMoveTo('executed', 'rejected')).toBe(false);
  });

  it('never skips validation, and ends at rejected or closed', () => {
    expect(canMoveTo('selected', 'executed')).toBe(false);
    for (const stage of LIFECYCLE_STAGES.filter((s) => s.final)) {
      expect(LIFECYCLE_STAGES.some((next) => canMoveTo(stage.id, next.id))).toBe(false);
    }
  });
});
