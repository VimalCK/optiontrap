import { describe, it, expect, vi } from 'vitest';

vi.mock('./db.js', () => ({}));
vi.mock('./instruments.js', () => ({}));
vi.mock('./oiHistoryScheduler.js', () => ({}));

const { pickChainWindow } = await import('./oiSnapshotScheduler.js');

/** CE+PE at strikes 100..(100 + 10*(n-1)) for each expiry. */
function chain(expiries, n = 11) {
  return expiries.flatMap((expiry) => Array.from({ length: n }, (_, i) => 100 + i * 10)
    .flatMap((strike) => ['CE', 'PE'].map((t) => ({ expiry, strike, instrumentType: t }))));
}
const strikesOf = (opts) => [...new Set(opts.map((o) => o.strike))];

describe('pickChainWindow', () => {
  it('takes the nearest unexpired expiry, centred on ATM', () => {
    const picked = pickChainWindow(chain(['2026-11-10', '2026-11-03', '2026-10-27']), 151, '2026-11-03', 2);
    expect(new Set(picked.map((o) => o.expiry))).toEqual(new Set(['2026-11-03']));
    expect(strikesOf(picked)).toEqual([130, 140, 150, 160, 170]);
    expect(picked).toHaveLength(10);
  });

  it('shifts the window instead of shrinking it at the chain edge', () => {
    expect(strikesOf(pickChainWindow(chain(['2026-11-10']), 95, '2026-11-03', 2))).toEqual([100, 110, 120, 130, 140]);
    expect(strikesOf(pickChainWindow(chain(['2026-11-10']), 999, '2026-11-03', 2))).toEqual([160, 170, 180, 190, 200]);
  });

  it('uses the middle of the chain without a spot price, and nothing once all expiries passed', () => {
    expect(strikesOf(pickChainWindow(chain(['2026-11-10']), 0, '2026-11-03', 1))).toEqual([140, 150, 160]);
    expect(pickChainWindow(chain(['2026-10-27']), 150, '2026-11-03')).toEqual([]);
  });
});
