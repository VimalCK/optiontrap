/**
 * Kite WebSocket Ticker — connects to our backend's /ws proxy.
 *
 * The server handles authentication (injects api_key + access_token)
 * and proxies the binary stream from wss://ws.kite.trade.
 * The client never sees credentials in the WebSocket URL. Messages are read
 * with the parser shared with the server (shared/kiteTicks.js).
 */
import { apiClient } from './apiClient';
import { handleKiteAuthFailure } from './authSession';
import { parseTicks, type Tick } from '../../shared/kiteTicks.js';

/** Close code the server sends when Kite rejects the access token (see server/index.js). */
const WS_SESSION_EXPIRED = 4001;

export type { Tick } from '../../shared/kiteTicks.js';

type TickCallback = (ticks: Tick[]) => void;

export class KiteTicker {
  private ws: WebSocket | null = null;
  private instrumentTokens: number[] = [];
  private onTickCallback: TickCallback | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;

  connect(instrumentTokens: number[], onTick: TickCallback): void {
    this.instrumentTokens = instrumentTokens;
    this.onTickCallback = onTick;
    this.shouldReconnect = true;

    // Connect to our own server's WebSocket proxy — no credentials in the URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws`;
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      console.log('[KiteTicker] Connected via proxy');
      // Use this.instrumentTokens (not the captured parameter) so tokens
      // updated via updateSubscriptions() during CONNECTING are picked up.
      this.subscribe(this.instrumentTokens);
      this.setMode('full', this.instrumentTokens);
    };

    this.ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        const ticks = parseTicks(event.data);
        if (ticks.length > 0 && this.onTickCallback) {
          this.onTickCallback(ticks);
        }
      }
      // Ignore text messages (postbacks, heartbeats)
    };

    this.ws.onerror = (err) => {
      console.error('[KiteTicker] Error:', err);
    };

    this.ws.onclose = (event) => {
      console.log('[KiteTicker] Disconnected');
      if (event.code === WS_SESSION_EXPIRED) {
        // The Kite token expired: reconnecting can't help, so go to login.
        this.shouldReconnect = false;
        handleKiteAuthFailure();
        return;
      }
      if (event.code === 1006) {
        // Abnormal close, e.g. the server refused the upgrade because the session
        // is gone. A 401 here makes apiClient send the user to login.
        apiClient.get('/auth/me').catch(() => {});
      }
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

  /** Whether the WebSocket is open and ready to send messages */
  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /** Whether a WebSocket exists (open, connecting, or closing) */
  get active(): boolean {
    return this.ws !== null;
  }

  /**
   * Update the subscribed token set without disconnecting.
   * If connected, sends incremental subscribe/unsubscribe/mode messages.
   * If still connecting, updates the stored tokens so onopen uses the latest set.
   */
  updateSubscriptions(newTokens: number[]): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const oldSet = new Set(this.instrumentTokens);
      const newSet = new Set(newTokens);
      const toRemove = this.instrumentTokens.filter((t) => !newSet.has(t));
      const toAdd = newTokens.filter((t) => !oldSet.has(t));

      if (toRemove.length > 0) this.unsubscribe(toRemove);
      if (toAdd.length > 0) {
        this.subscribe(toAdd);
        this.setMode('full', toAdd);
      }
    }
    // Always update stored tokens so reconnects/onopen use the latest set
    this.instrumentTokens = newTokens;
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

  private unsubscribe(tokens: number[]): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ a: 'unsubscribe', v: tokens }));
    }
  }

  private setMode(mode: 'ltp' | 'quote' | 'full', tokens: number[]): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ a: 'mode', v: [mode, tokens] }));
    }
  }
}
