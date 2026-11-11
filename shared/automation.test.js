import { describe, it, expect } from 'vitest';
import {
  LIFECYCLE_STAGES,
  TRADE_KINDS,
  canMoveTo,
  checkGeneralSettings,
  defaultAutomationConfig,
  parseAutomationConfig,
  tradeKind,
  withDefaults,
} from './automation.js';
import { Horizon } from './horizons.js';

/** A strategy as the trade engine describes it (GET /api/strategies). */
const STRATEGIES = [{ id: 'test-strategy', label: 'Test strategy', description: 'For tests', params: [{ key: 'minScore', label: 'Min score', type: 'count' }] }];
const parse = (input) => parseAutomationConfig(input, STRATEGIES);
const fill = (stored) => withDefaults(stored, STRATEGIES);

const valid = () => {
  const config = defaultAutomationConfig(STRATEGIES);
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
    const config = defaultAutomationConfig(STRATEGIES);
    expect(config).toMatchObject({ enabled: false, mode: 'paper', horizons: { [Horizon.Intraday]: true, [Horizon.Positional]: false } });
    expect(Object.values(config.kinds).every((sides) => !sides.BUY && !sides.SELL)).toBe(true);
  });

  it('passes its own validation', () => {
    expect(parse(defaultAutomationConfig(STRATEGIES))).toEqual({ config: defaultAutomationConfig(STRATEGIES) });
  });
});

describe('parseAutomationConfig', () => {
  it('accepts a complete configuration as it is', () => {
    expect(parse(valid())).toEqual({ config: valid() });
  });

  it('refuses live trading and positional trades until they are built', () => {
    expect(parse({ ...valid(), mode: 'live' })).toEqual({ error: 'Live trading is not available yet' });
    expect(parse({ ...valid(), horizons: { [Horizon.Intraday]: true, [Horizon.Positional]: true } }))
      .toEqual({ error: 'Positional trades are not available yet' });
  });

  it('refuses missing or malformed fields instead of guessing', () => {
    expect(parse(null)).toEqual({ error: 'configuration is required' });
    expect(parse({ ...valid(), enabled: 'yes' })).toEqual({ error: 'enabled must be true or false' });
    expect(parse({ ...valid(), mode: 'demo' })).toEqual({ error: 'mode must be one of: paper, live' });
    const noSell = valid();
    delete noSell.kinds.stock.SELL;
    expect(parse(noSell)).toEqual({ error: 'kinds.stock must say true or false for BUY and SELL' });
  });

  it('refuses a trade type it does not know', () => {
    const config = valid();
    config.kinds.crypto = { BUY: true, SELL: false };
    expect(parse(config)).toEqual({ error: 'unknown trade type: crypto' });
  });

  it('drops anything extra sent with a trade type', () => {
    const config = valid();
    config.kinds.stock = { BUY: true, SELL: false, extra: 1 };
    expect(parse(config).config.kinds.stock).toEqual({ BUY: true, SELL: false });
  });
});

describe('parseAutomationConfig strategies', () => {
  it('refuses a configuration without strategy settings', () => {
    const config = valid();
    delete config.strategies;
    expect(parse(config)).toEqual({ error: 'strategies is required' });
  });

  it('has a setting for each strategy it is given, inactive by default', () => {
    expect(defaultAutomationConfig(STRATEGIES).strategies).toEqual({ 'test-strategy': { active: false, params: { minScore: null } } });
  });
});

describe('tradeKind', () => {
  it('tells index and stock options, futures and stocks apart', () => {
    expect(tradeKind('CE', true)).toBe('index-option');
    expect(tradeKind('PE', false)).toBe('stock-option');
    expect(tradeKind('FUT', true)).toBe('index-future');
    expect(tradeKind('FUT', false)).toBe('stock-future');
    expect(tradeKind('EQ', false)).toBe('stock');
  });

  it('has no kind for an index itself or an unknown type', () => {
    expect(tradeKind('EQ', true)).toBeNull();
    expect(tradeKind('XX', false)).toBeNull();
  });
});

describe('checkGeneralSettings', () => {
  const trade = { horizon: Horizon.Intraday, kind: 'index-option', side: 'SELL' };

  it('allows a trade type and side the user switched on', () => {
    expect(checkGeneralSettings(trade, valid())).toBeNull();
  });

  it('refuses when automation is off, before anything else', () => {
    expect(checkGeneralSettings({ ...trade, side: 'BUY' }, { ...valid(), enabled: false })).toBe('Automation is off');
  });

  it('refuses a horizon or a trade type and side that is off', () => {
    expect(checkGeneralSettings(trade, { ...valid(), horizons: { [Horizon.Intraday]: false, [Horizon.Positional]: false } })).toMatch(/trades are off$/);
    expect(checkGeneralSettings({ ...trade, side: 'BUY' }, valid())).toMatch(/^Buy .* is off$/);
  });
});

describe('withDefaults', () => {
  it('gives the defaults when nothing is stored', () => {
    expect(fill(null)).toEqual(defaultAutomationConfig(STRATEGIES));
  });

  it('switches off a trade type added after the configuration was saved', () => {
    const stored = valid();
    delete stored.kinds['index-future'];
    expect(fill(stored).kinds['index-future']).toEqual({ BUY: false, SELL: false });
    expect(fill(stored).kinds['index-option']).toEqual({ BUY: false, SELL: true });
  });

  it('falls back to paper if a stored mode is not available', () => {
    expect(fill({ ...valid(), mode: 'live' }).mode).toBe('paper');
  });

  it('gives a configuration saved before entry or exit rules existed every rule, inactive', () => {
    const stored = valid();
    delete stored.entryRules;
    delete stored.exitRules;
    expect(fill(stored)).toEqual(valid());
  });
});

describe('parseAutomationConfig entry and exit rules', () => {
  it('keeps the rules as set, and refuses a configuration without them', () => {
    const config = valid();
    config.entryRules['max-lots'] = { active: true, params: { max: 2 } };
    expect(parse(config)).toEqual({ config });
    delete config.entryRules;
    expect(parse(config)).toEqual({ error: 'entryRules is required' });
  });

  it('keeps the exit rules as set, and refuses a configuration without them', () => {
    const config = valid();
    config.exitRules['stop-loss'] = { active: true, params: { percent: 20 } };
    config.exitRules['square-off'] = { active: true, params: { time: '15:00' } };
    expect(parse(config)).toEqual({ config });
    delete config.exitRules;
    expect(parse(config)).toEqual({ error: 'exitRules is required' });
  });
});

describe('lifecycle', () => {
  it('runs selected → validated → executed → closed', () => {
    expect(canMoveTo('selected', 'validated')).toBe(true);
    expect(canMoveTo('validated', 'executed')).toBe(true);
    expect(canMoveTo('executed', 'closed')).toBe(true);
  });

  it('is rejected only after validation (it cannot be placed), never at selection or after execution', () => {
    expect(canMoveTo('selected', 'rejected')).toBe(false);
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
