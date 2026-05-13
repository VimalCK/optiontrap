import { getCredentials, getSession } from './kiteAuth';

export interface Tick {
  instrumentToken: number;
  lastPrice: number;
  lastQuantity?: number;
  averagePrice?: number;
  volume?: number;
  buyQuantity?: number;
  sellQuantity?: number;
  openPrice?: number;
  highPrice?: number;
  lowPrice?: number;
  closePrice?: number;
  oi?: number;
}

type TickCallback = (ticks: Tick[]) => void;

export class KiteTicker {
  private ws: WebSocket | null = null;
  private instrumentTokens: number[] = [];
  private onTickCallback: TickCallback | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;

  connect(instrumentTokens: number[], onTick: TickCallback): void {
    const creds = getCredentials();
    const session = getSession();
    if (!creds || !session) {
      console.error('[KiteTicker] Not authenticated');
      return;
    }

    this.instrumentTokens = instrumentTokens;
    this.onTickCallback = onTick;
    this.shouldReconnect = true;

    const url = `wss://ws.kite.trade?api_key=${creds.apiKey}&access_token=${session.accessToken}`;
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      console.log('[KiteTicker] Connected');
      this.subscribe(instrumentTokens);
      this.setMode('full', instrumentTokens);
    };

    this.ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        const ticks = this.parseBinary(event.data);
        if (ticks.length > 0 && this.onTickCallback) {
          this.onTickCallback(ticks);
        }
      }
      // Ignore text messages (postbacks, heartbeats)
    };

    this.ws.onerror = (err) => {
      console.error('[KiteTicker] Error:', err);
    };

    this.ws.onclose = () => {
      console.log('[KiteTicker] Disconnected');
      if (this.shouldReconnect) {
        this.reconnectTimer = setTimeout(() => this.reconnect(), 5000);
      }
    };
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    console.log('[KiteTicker] Closed');
  }

  private reconnect(): void {
    if (this.onTickCallback && this.instrumentTokens.length > 0) {
      console.log('[KiteTicker] Reconnecting...');
      this.connect(this.instrumentTokens, this.onTickCallback);
    }
  }

  private subscribe(tokens: number[]): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ a: 'subscribe', v: tokens }));
    }
  }

  private setMode(mode: 'ltp' | 'quote' | 'full', tokens: number[]): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ a: 'mode', v: [mode, tokens] }));
    }
  }

  private parseBinary(buffer: ArrayBuffer): Tick[] {
    const data = new DataView(buffer);
    const ticks: Tick[] = [];

    // First 2 bytes: number of packets
    if (buffer.byteLength < 2) return ticks;
    const numPackets = data.getInt16(0);

    let offset = 2;

    for (let i = 0; i < numPackets; i++) {
      if (offset + 2 > buffer.byteLength) break;

      // 2 bytes: packet length
      const packetLength = data.getInt16(offset);
      offset += 2;

      if (offset + packetLength > buffer.byteLength) break;

      const tick = this.parsePacket(data, offset, packetLength);
      if (tick) {
        ticks.push(tick);
      }

      offset += packetLength;
    }

    return ticks;
  }

  private parsePacket(data: DataView, start: number, length: number): Tick | null {
    if (length < 8) return null;

    const instrumentToken = data.getInt32(start);
    const divisor = this.getDivisor(instrumentToken);
    const lastPrice = data.getInt32(start + 4) / divisor;

    const tick: Tick = { instrumentToken, lastPrice };

    // LTP mode: 8 bytes
    if (length >= 44) {
      // Quote mode: 44 bytes
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

    // Full mode: 184 bytes — includes OI
    if (length >= 60) {
      tick.oi = data.getInt32(start + 48);
    }

    return tick;
  }

  private getDivisor(instrumentToken: number): number {
    // Currency segment tokens need division by 10000000
    // Others by 100
    const segment = instrumentToken & 0xff;
    // CDS segment = 3, BCD segment = 6
    if (segment === 3 || segment === 6) {
      return 10000000;
    }
    return 100;
  }
}
