/**
 * Kite ticker binary messages → ticks.
 *
 * Kite's WebSocket ticker (wss://ws.kite.trade) sends prices as binary
 * messages. Both the browser (src/services/kiteTicker.ts, through the /ws
 * proxy) and the server's own feed (server/kiteTickerFeed.js, for the trade
 * monitor) read them with this one parser, so they agree on every price.
 *
 * Message: int16 packet count, then per packet an int16 length and the packet.
 * Packet sizes: 8 (ltp mode), 28 / 32 (index quote / full), 44 (quote),
 * 184 (full, with OI and market depth). Prices are in paise (÷100), or ÷10^7
 * for currency segments.
 */

/**
 * @typedef {{
 *   instrumentToken: number,
 *   lastPrice: number,
 *   lastQuantity?: number,
 *   averagePrice?: number,
 *   volume?: number,
 *   buyQuantity?: number,
 *   sellQuantity?: number,
 *   openPrice?: number,
 *   highPrice?: number,
 *   lowPrice?: number,
 *   closePrice?: number,
 *   oi?: number,
 * }} Tick
 */

const LTP_PACKET = 8;
const INDEX_QUOTE_PACKET = 28;
const INDEX_FULL_PACKET = 32;
const QUOTE_PACKET = 44;
const PACKET_WITH_OI = 60;

/** Kite segment ids (low byte of the token) whose prices are in 10^-7 units: CDS and BCD. */
const CURRENCY_SEGMENTS = [3, 6];
const CURRENCY_DIVISOR = 10000000;
const PAISE_DIVISOR = 100;

/** @param {number} instrumentToken */
const priceDivisor = (instrumentToken) => (CURRENCY_SEGMENTS.includes(instrumentToken & 0xff) ? CURRENCY_DIVISOR : PAISE_DIVISOR);

/**
 * One packet as a tick, or null when it's too short to hold a price.
 * @param {DataView} data
 * @param {number} start
 * @param {number} length
 * @returns {Tick | null}
 */
function parsePacket(data, start, length) {
  if (length < LTP_PACKET) return null;

  const instrumentToken = data.getInt32(start);
  const divisor = priceDivisor(instrumentToken);
  /** @type {Tick} */
  const tick = { instrumentToken, lastPrice: data.getInt32(start + 4) / divisor };

  // Index quote / full: OHLC only, no volume or OI.
  if (length === INDEX_QUOTE_PACKET || length === INDEX_FULL_PACKET) {
    tick.highPrice = data.getInt32(start + 8) / divisor;
    tick.lowPrice = data.getInt32(start + 12) / divisor;
    tick.openPrice = data.getInt32(start + 16) / divisor;
    tick.closePrice = data.getInt32(start + 20) / divisor;
    return tick;
  }

  if (length >= QUOTE_PACKET) {
    tick.lastQuantity = data.getInt32(start + 8);
    tick.averagePrice = data.getInt32(start + 12) / divisor;
    tick.volume = data.getInt32(start + 16);
    tick.buyQuantity = data.getInt32(start + 20);
    tick.sellQuantity = data.getInt32(start + 24);
    tick.openPrice = data.getInt32(start + 28) / divisor;
    tick.highPrice = data.getInt32(start + 32) / divisor;
    tick.lowPrice = data.getInt32(start + 36) / divisor;
    tick.closePrice = data.getInt32(start + 40) / divisor;
  }

  if (length >= PACKET_WITH_OI) {
    tick.oi = data.getInt32(start + 48);
  }

  return tick;
}

/**
 * Every tick in one binary ticker message; a cut-off packet ends the list.
 * @param {ArrayBuffer} buffer
 * @returns {Tick[]}
 */
export function parseTicks(buffer) {
  /** @type {Tick[]} */
  const ticks = [];
  if (buffer.byteLength < 2) return ticks;

  const data = new DataView(buffer);
  const packets = data.getInt16(0);
  let offset = 2;

  for (let i = 0; i < packets; i++) {
    if (offset + 2 > buffer.byteLength) break;
    const length = data.getInt16(offset);
    offset += 2;
    if (offset + length > buffer.byteLength) break;

    const tick = parsePacket(data, offset, length);
    if (tick) ticks.push(tick);
    offset += length;
  }

  return ticks;
}
