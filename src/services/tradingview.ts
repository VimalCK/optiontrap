/**
 * Build a TradingView chart URL for a given tradingsymbol.
 *
 * TradingView charts equities/indices by `EXCHANGE:SYMBOL`. Indian F&O
 * tradingsymbols (e.g. `NIFTY25O0724500CE`) generally don't resolve on
 * TradingView, so for options/futures we fall back to the underlying on NSE
 * — which is what a trader actually wants to see for context.
 */

const INDEX_SYMBOLS: Record<string, string> = {
  NIFTY: 'NIFTY',
  NIFTY50: 'NIFTY',
  BANKNIFTY: 'BANKNIFTY',
  FINNIFTY: 'CNXFINANCE',
  MIDCPNIFTY: 'NIFTY_MID_SELECT',
  SENSEX: 'SENSEX',
  BANKEX: 'BANKEX',
};

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
function resolveSymbol(tradingsymbol: string, exchange?: string): { exchange: string; symbol: string } {
  const upperEx = (exchange || '').toUpperCase();
  const upperSym = tradingsymbol.toUpperCase();

  // Option/future symbol → chart the underlying on NSE
  if (upperEx === 'NFO' || upperEx === 'BFO' || /\d(CE|PE|FUT)$/.test(upperSym) || upperSym.endsWith('FUT')) {
    const underlying = underlyingFromOption(upperSym);
    if (INDEX_SYMBOLS[underlying]) return { exchange: 'NSE', symbol: INDEX_SYMBOLS[underlying] };
    return { exchange: 'NSE', symbol: underlying };
  }

  // Known indices
  if (INDEX_SYMBOLS[upperSym]) return { exchange: 'NSE', symbol: INDEX_SYMBOLS[upperSym] };

  // Regular equity — default to NSE, use BSE only if that's explicitly the exchange
  const ex = upperEx === 'BSE' ? 'BSE' : 'NSE';
  return { exchange: ex, symbol: upperSym };
}

/** Build the full https://www.tradingview.com/chart URL. */
export function tradingViewUrl(tradingsymbol: string, exchange?: string): string {
  const { exchange: ex, symbol } = resolveSymbol(tradingsymbol, exchange);
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(`${ex}:${symbol}`)}`;
}
