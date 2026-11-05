import { describe, it, expect } from 'vitest';
import { parseTicks } from './kiteTicks.js';

/** A binary ticker message with one packet per list of int32 fields (prices in paise). */
function message(...packets) {
  const size = 2 + packets.reduce((sum, fields) => sum + 2 + fields.length * 4, 0);
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  view.setInt16(0, packets.length);
  let offset = 2;
  for (const fields of packets) {
    view.setInt16(offset, fields.length * 4);
    offset += 2;
    for (const value of fields) {
      view.setInt32(offset, value);
      offset += 4;
    }
  }
  return buffer;
}

describe('parseTicks', () => {
  it('reads LTP-mode packets (what the server feed subscribes to), several per message', () => {
    expect(parseTicks(message([12345, 12050], [67890, 9905]))).toEqual([
      { instrumentToken: 12345, lastPrice: 120.5 },
      { instrumentToken: 67890, lastPrice: 99.05 },
    ]);
  });

  it('divides currency-segment prices by 10^7, not 100', () => {
    const cdsToken = (1000 << 8) | 3; // segment 3: CDS
    expect(parseTicks(message([cdsToken, 834512345]))[0].lastPrice).toBeCloseTo(83.4512345);
  });

  it('stops at a cut-off packet and skips packets too short to hold a price', () => {
    const full = message([12345, 12050], [67890, 9905]);
    expect(parseTicks(full.slice(0, full.byteLength - 2))).toEqual([{ instrumentToken: 12345, lastPrice: 120.5 }]);
    expect(parseTicks(message([1]))).toEqual([]);
    expect(parseTicks(new ArrayBuffer(1))).toEqual([]);
  });
});
