import { describe, it, expect } from 'vitest';
import { engineLogEntry } from './engineLog.js';

const AT = new Date('2026-11-05T06:40:05Z'); // Thu 12:10:05 IST
const PURPLE = '\x1b[35m';
const RESET = '\x1b[0m';

describe('engineLogEntry', () => {
  it('prints a purple header with the IST time, then one aligned line per detail', () => {
    expect(engineLogEntry('Engine', 'executed', { trade: 'SELL 75 NIFTY26NOV24000PE', price: 119.85, strategy: 'option-analyzer' }, AT)).toBe([
      `${PURPLE}[Algo 12:10:05 IST] Engine · executed`,
      '    trade     SELL 75 NIFTY26NOV24000PE',
      '    price     119.85',
      `    strategy  option-analyzer${RESET}`,
    ].join('\n'));
  });

  it('leaves out empty details, and prints only the header when there are none', () => {
    expect(engineLogEntry('Monitor', 'market closed', { feed: 'stopped watching', last: null, user: undefined }, AT))
      .toBe(`${PURPLE}[Algo 12:10:05 IST] Monitor · market closed\n    feed  stopped watching${RESET}`);
    expect(engineLogEntry('Engine', 'run done', {}, AT)).toBe(`${PURPLE}[Algo 12:10:05 IST] Engine · run done${RESET}`);
  });
});
