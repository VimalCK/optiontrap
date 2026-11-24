import { describe, it, expect } from 'vitest';
import {
  LIFECYCLE_STAGES,
  canMoveTo,
  checkStrategySettings,
  defaultAutomationConfig,
  executionModes,
  exitRuleSettings,
  parseAutomationConfig,
  parseSwitch,
  tradeKind,
  withDefaults,
  withStrategyActive,
} from './automation.js';
import { Horizon, TradingMode } from './tradeEnums.js';

/** Strategies as the trade engine describes them (GET /api/strategies). */
const STRATEGIES = [
  { id: 'test-strategy', label: 'Test strategy', description: 'For tests', params: [{ key: 'minScore', label: 'Min score', type: 'Count' }] },
  { id: 'other-strategy', label: 'Other strategy', description: 'For tests', params: [] },
];
const parse = (input) => parseAutomationConfig(input, STRATEGIES);
const fill = (stored) => withDefaults(stored, STRATEGIES);

const valid = () => {
  const config = defaultAutomationConfig(STRATEGIES);
  config.enabled = true;
  config.strategies['test-strategy'].active = true;
  config.strategies['test-strategy'].params.minScore = 70;
  return config;
};

describe('defaultAutomationConfig', () => {
  it('is off, with every general rule off', () => {
    const config = defaultAutomationConfig(STRATEGIES);
    expect(config.enabled).toBe(false);
    expect(Object.values(config.generalRules).every((rule) => !rule.active)).toBe(true);
  });

  it('gives each strategy its own settings: inactive, on paper, intraday only, every rule off', () => {
    const strategy = defaultAutomationConfig(STRATEGIES).strategies['test-strategy'];
    expect(strategy).toMatchObject({
      active: false,
      params: { minScore: null },
      execution: { [TradingMode.Paper]: true, [TradingMode.Live]: false },
      horizons: { [Horizon.Intraday]: true, [Horizon.Positional]: false },
    });
    expect([...Object.values(strategy.entryRules), ...Object.values(strategy.exitRules)].every((rule) => !rule.active)).toBe(true);
    expect(Object.keys(defaultAutomationConfig(STRATEGIES).strategies)).toEqual(['test-strategy', 'other-strategy']);
  });

  it('passes its own validation', () => {
    expect(parse(defaultAutomationConfig(STRATEGIES))).toEqual({ config: defaultAutomationConfig(STRATEGIES) });
  });
});

describe('parseAutomationConfig', () => {
  it('accepts a complete configuration as it is', () => {
    expect(parse(valid())).toEqual({ config: valid() });
  });

  it("keeps each strategy's own rules apart", () => {
    const config = valid();
    config.strategies['test-strategy'].entryRules['max-lots'] = { active: true, params: { max: 2 } };
    config.strategies['other-strategy'].exitRules['stop-loss'] = { active: true, params: { percent: 20 } };
    const parsed = parse(config).config;
    expect(parsed.strategies['test-strategy'].entryRules['max-lots']).toEqual({ active: true, params: { max: 2 } });
    expect(parsed.strategies['other-strategy'].entryRules['max-lots'].active).toBe(false);
    expect(parsed.strategies['other-strategy'].exitRules['stop-loss']).toEqual({ active: true, params: { percent: 20 } });
    expect(parsed.strategies['test-strategy'].exitRules['stop-loss'].active).toBe(false);
  });

  it('keeps the general rules as set', () => {
    const config = valid();
    config.generalRules['max-daily-loss'] = { active: true, params: { amount: 5000 } };
    expect(parse(config)).toEqual({ config });
  });

  it('refuses live trading and positional trades until they are built, naming the strategy', () => {
    const live = valid();
    live.strategies['test-strategy'].execution[TradingMode.Live] = true;
    expect(parse(live)).toEqual({ error: 'Test strategy: Live trading is not available yet' });
    const positional = valid();
    positional.strategies['other-strategy'].horizons[Horizon.Positional] = true;
    expect(parse(positional)).toEqual({ error: 'Other strategy: Positional trades are not available yet' });
  });

  it('names the strategy whose rule is incomplete', () => {
    const config = valid();
    config.strategies['other-strategy'].entryRules['max-lots'] = { active: true, params: { max: null } };
    expect(parse(config)).toEqual({ error: 'Other strategy: Max lots per trade: set Lots to make it active' });
  });

  it('refuses missing or malformed fields instead of guessing', () => {
    expect(parse(null)).toEqual({ error: 'configuration is required' });
    expect(parse({ ...valid(), enabled: 'yes' })).toEqual({ error: 'enabled must be true or false' });
    expect(parse({ ...valid(), generalRules: undefined })).toEqual({ error: 'generalRules is required' });
    expect(parse({ ...valid(), strategies: undefined })).toEqual({ error: 'strategies is required' });
    const noStrategy = valid();
    delete noStrategy.strategies['other-strategy'];
    expect(parse(noStrategy)).toEqual({ error: 'Other strategy: strategies.other-strategy is required' });
    const noExecution = valid();
    delete noExecution.strategies['test-strategy'].execution[TradingMode.Paper];
    expect(parse(noExecution)).toEqual({ error: 'Test strategy: strategies.test-strategy.execution.Paper must be true or false' });
    const noExitRules = valid();
    delete noExitRules.strategies['test-strategy'].exitRules;
    expect(parse(noExitRules)).toEqual({ error: 'Test strategy: strategies.test-strategy.exitRules is required' });
  });

  it('refuses a strategy it does not know', () => {
    const config = valid();
    config.strategies.unknown = config.strategies['test-strategy'];
    expect(parse(config)).toEqual({ error: 'unknown strategy: unknown' });
  });
});

describe('parseSwitch', () => {
  it('takes the switch as given, and refuses anything but true or false', () => {
    expect(parseSwitch({ enabled: true }, 'enabled')).toEqual({ on: true });
    expect(parseSwitch({ active: false }, 'active')).toEqual({ on: false });
    for (const input of [null, {}, { enabled: 'true' }, { enabled: 1 }, { active: true }]) {
      expect(parseSwitch(input, 'enabled')).toEqual({ error: 'enabled must be true or false' });
    }
  });
});

describe('withStrategyActive', () => {
  const [strategy] = STRATEGIES;

  it('switches only that strategy, keeping its settings and the others', () => {
    const config = valid();
    const off = withStrategyActive(config, strategy, false).config;
    expect(off?.strategies['test-strategy']).toEqual({ ...config.strategies['test-strategy'], active: false });
    expect(off?.strategies['other-strategy']).toEqual(config.strategies['other-strategy']);
    expect(off?.enabled).toBe(true);
  });

  it("refuses to switch a strategy on while a value it needs is unset, saying which", () => {
    expect(withStrategyActive(defaultAutomationConfig(STRATEGIES), strategy, true))
      .toEqual({ error: 'Test strategy: set Min score to make it active' });
    expect(withStrategyActive(defaultAutomationConfig(STRATEGIES), strategy, false).config).toBeDefined();
  });
});

describe('withDefaults', () => {
  it('gives the defaults when nothing is stored', () => {
    expect(fill(null)).toEqual(defaultAutomationConfig(STRATEGIES));
  });

  it('gives a strategy added after the configuration was saved its defaults, keeping the others', () => {
    const stored = valid();
    delete stored.strategies['other-strategy'];
    expect(fill(stored)).toEqual({ ...valid(), strategies: { ...valid().strategies, 'other-strategy': defaultAutomationConfig(STRATEGIES).strategies['other-strategy'] } });
  });

  it('drops a strategy that no longer exists', () => {
    const stored = valid();
    stored.strategies.gone = stored.strategies['test-strategy'];
    expect(Object.keys(fill(stored).strategies)).toEqual(['test-strategy', 'other-strategy']);
  });

  it("switches off a mode or horizon that isn't built yet, and fills one added since", () => {
    const stored = valid();
    stored.strategies['test-strategy'].execution = { [TradingMode.Paper]: false, [TradingMode.Live]: true };
    delete stored.strategies['test-strategy'].horizons[Horizon.Intraday];
    const strategy = fill(stored).strategies['test-strategy'];
    expect(strategy.execution).toEqual({ [TradingMode.Paper]: false, [TradingMode.Live]: false });
    expect(strategy.horizons).toEqual({ [Horizon.Intraday]: true, [Horizon.Positional]: false });
  });

  it('gives rules added since they were saved, inactive', () => {
    const stored = valid();
    delete stored.generalRules;
    delete stored.strategies['test-strategy'].entryRules;
    expect(fill(stored)).toEqual(valid());
  });
});

describe('executionModes', () => {
  it('lists the modes a strategy trades in, paper and live at once when both are on', () => {
    const strategy = valid().strategies['test-strategy'];
    expect(executionModes(strategy)).toEqual([TradingMode.Paper]);
    expect(executionModes({ ...strategy, execution: { [TradingMode.Paper]: true, [TradingMode.Live]: true } })).toEqual([TradingMode.Paper, TradingMode.Live]);
    expect(executionModes({ ...strategy, execution: { [TradingMode.Paper]: false, [TradingMode.Live]: false } })).toEqual([]);
  });
});

describe('exitRuleSettings', () => {
  it("pairs a strategy's own exit rules with the general ones, and gives a strategy no longer there none of its own", () => {
    const config = valid();
    config.strategies['test-strategy'].exitRules['stop-loss'] = { active: true, params: { percent: 10 } };
    expect(exitRuleSettings(config, 'test-strategy')).toEqual({ strategy: config.strategies['test-strategy'].exitRules, general: config.generalRules });
    expect(exitRuleSettings(config, 'gone')).toEqual({ strategy: {}, general: config.generalRules });
  });
});

describe('checkStrategySettings', () => {
  const trade = { horizon: Horizon.Intraday };

  it('allows a trade of an active strategy while Algo Trading is on', () => {
    expect(checkStrategySettings(trade, valid(), 'test-strategy')).toBeNull();
  });

  it('refuses when Algo Trading is off, before anything else', () => {
    expect(checkStrategySettings(trade, { ...valid(), enabled: false }, 'test-strategy')).toBe('Algo Trading is off');
  });

  it("refuses by the strategy's own settings: inactive, no mode on, or its horizon off", () => {
    expect(checkStrategySettings(trade, valid(), 'other-strategy')).toBe('The strategy is inactive');
    const noMode = valid();
    noMode.strategies['test-strategy'].execution[TradingMode.Paper] = false;
    expect(checkStrategySettings(trade, noMode, 'test-strategy')).toBe('Paper and live trading are both off');
    const noIntraday = valid();
    noIntraday.strategies['test-strategy'].horizons[Horizon.Intraday] = false;
    expect(checkStrategySettings(trade, noIntraday, 'test-strategy')).toBe('Intraday trades are off');
  });

  it('refuses a strategy the configuration does not have', () => {
    expect(checkStrategySettings(trade, valid(), 'unknown')).toBe('Unknown strategy');
  });
});

describe('tradeKind', () => {
  it('tells index and stock options, futures and stocks apart', () => {
    expect(tradeKind('CE', true)).toBe('IndexOption');
    expect(tradeKind('PE', false)).toBe('StockOption');
    expect(tradeKind('FUT', true)).toBe('IndexFuture');
    expect(tradeKind('FUT', false)).toBe('StockFuture');
    expect(tradeKind('EQ', false)).toBe('Stock');
  });

  it('has no kind for an index itself or an unknown type', () => {
    expect(tradeKind('EQ', true)).toBeNull();
    expect(tradeKind('XX', false)).toBeNull();
  });
});

describe('lifecycle', () => {
  it('runs selected → validated → executed → closed', () => {
    expect(canMoveTo('Selected', 'Validated')).toBe(true);
    expect(canMoveTo('Validated', 'Executed')).toBe(true);
    expect(canMoveTo('Executed', 'Closed')).toBe(true);
  });

  it('is rejected only after validation (it cannot be placed), never at selection or after execution', () => {
    expect(canMoveTo('Selected', 'Rejected')).toBe(false);
    expect(canMoveTo('Validated', 'Rejected')).toBe(true);
    expect(canMoveTo('Executed', 'Rejected')).toBe(false);
  });

  it('never skips validation, and ends at rejected or closed', () => {
    expect(canMoveTo('Selected', 'Executed')).toBe(false);
    for (const stage of LIFECYCLE_STAGES.filter((s) => s.final)) {
      expect(LIFECYCLE_STAGES.some((next) => canMoveTo(stage.id, next.id))).toBe(false);
    }
  });
});
