/**
 * Build a TradingView chart URL for a given tradingsymbol.
 *
 * TradingView charts equities/indices by `EXCHANGE:SYMBOL`. Indian F&O
 * tradingsymbols (e.g. `NIFTY25O0724500CE`) generally don't resolve on
 * TradingView, so for options/futures we fall back to the underlying
 * — which is what a trader actually wants to see for context. An
 * underlying's TradingView symbol comes from its price row
 * (instruments.tradingview_symbol; e.g. FINNIFTY charts as CNXFINANCE).
 */
import type { Underlying } from './underlyings';

/**
 * Extract the underlying name from an F&O tradingsymbol.
 * Examples:
 *   NIFTY25O0724500CE → NIFTY
 *   RELIANCE25O07FUT  → RELIANCE
 * The convention: strip the trailing digits + expiry code + strike + CE/PE/FUT.
 */
function underlyingFromOption(tradingsymbol: string): string {
  const upper = tradingsymbol.toUpperCase();
  // Strip trailing CE/PE/FUT and anything after the first digit (year prefix)
  const stripped = upper.replace(/\d.*$/, '');
  return stripped || upper;
}

/**
 * Get the TradingView-ready symbol for a given tradingsymbol + exchange.
 * Returns { exchange, symbol } to be joined as `EXCHANGE:SYMBOL`.
 */
function resolveSymbol(tradingsymbol: string, exchange: string | undefined, underlyings: Underlying[]): { exchange: string; symbol: string } {
  const upperEx = (exchange || '').toUpperCase();
  const upperSym = tradingsymbol.toUpperCase();
  const chart = (u: Underlying) => ({ exchange: u.exchange || 'NSE', symbol: u.tradingviewSymbol || u.name });

  // Option/future symbol → chart the underlying
  if (upperEx === 'NFO' || upperEx === 'BFO' || /\d(CE|PE|FUT)$/.test(upperSym) || upperSym.endsWith('FUT')) {
    const name = underlyingFromOption(upperSym);
    const underlying = underlyings.find((u) => u.name === name);
    return underlying ? chart(underlying) : { exchange: 'NSE', symbol: name };
  }

  // An underlying by its F&O name ("NIFTY") or its price row ("NIFTY 50")
  const underlying = underlyings.find((u) => u.name === upperSym || u.tradingsymbol === upperSym);
  if (underlying) return chart(underlying);

  // Regular equity — default to NSE, use BSE only if that's explicitly the exchange
  const ex = upperEx === 'BSE' ? 'BSE' : 'NSE';
  return { exchange: ex, symbol: upperSym };
}

/** Build the full https://www.tradingview.com/chart URL. */
export function tradingViewUrl(tradingsymbol: string, exchange?: string, underlyings: Underlying[] = []): string {
  const { exchange: ex, symbol } = resolveSymbol(tradingsymbol, exchange, underlyings);
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(`${ex}:${symbol}`)}`;
}
