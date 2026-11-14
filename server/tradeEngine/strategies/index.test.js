import { describe, it, expect } from 'vitest';
import { STRATEGIES, StrategyId, strategyIds, strategyMemberName } from './index.js';

describe('StrategyId', () => {
  it('names each strategy by its id in PascalCase', () => {
    expect(strategyMemberName('option-analyzer-setups')).toBe('OptionAnalyzerSetups');
    expect(StrategyId.OptionAnalyzerSetups).toBe('option-analyzer-setups');
  });

  it('has a member for every strategy in the list, and nothing else', () => {
    expect(Object.values(StrategyId)).toEqual(STRATEGIES.map((strategy) => strategy.id));
    expect(Object.isFrozen(StrategyId)).toBe(true);
  });

  it('refuses two strategies whose ids give the same member name', () => {
    const strategy = (/** @type {string} */ id) => /** @type {any} */ ({ id });
    expect(() => strategyIds([strategy('a-b'), strategy('a-B')])).toThrow('share the member name AB');
  });
});
