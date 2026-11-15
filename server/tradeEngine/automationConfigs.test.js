import { describe, it, expect, vi } from 'vitest';
import { ParamType } from '../../shared/tradeEnums.js';

const stored = vi.fn();
vi.mock('../db.js', () => ({ getStoredAutomatedUsers: (...args) => stored(...args) }));
vi.mock('./strategies/index.js', () => ({
  strategyInfos: () => [{ id: 'test', label: 'Test', description: '', params: [{ key: 'minScore', label: 'Min score', type: ParamType.Count }] }],
}));

const { getAutomatedUsers } = await import('./automationConfigs.js');

const config = (strategy) => ({ enabled: true, strategies: { test: strategy } });

describe('getAutomatedUsers', () => {
  it('asks the database for the users with this strategy active, and completes their configurations', async () => {
    stored.mockResolvedValueOnce([{ userId: 'U1', config: config({ active: true, params: { minScore: 70 } }) }]);
    const users = await getAutomatedUsers('test');
    expect(stored).toHaveBeenCalledWith('test');
    expect(users).toEqual([{ userId: 'U1', config: expect.objectContaining({ enabled: true, strategies: { test: { active: true, params: { minScore: 70 } } } }) }]);
  });

  it('leaves out a user whose stored setting no longer holds, as completing turns it off', async () => {
    stored.mockResolvedValueOnce([
      { userId: 'U1', config: config({ active: true, params: {} }) }, // a value it now needs is missing
      { userId: 'U2', config: { ...config({ active: true, params: { minScore: 70 } }), enabled: 'true' } },
    ]);
    expect(await getAutomatedUsers('test')).toEqual([]);
  });
});
