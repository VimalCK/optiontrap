import React from 'react';
import { tradingViewUrl } from '@/services/tradingview';
import './TradingViewLink.css';

interface TradingViewLinkProps {
  symbol: string;
  exchange?: string;
  size?: number;
  className?: string;
  /** Custom title tooltip. Defaults to "Open chart on TradingView". */
  title?: string;
}

/**
 * Tiny chart icon that opens the tradingsymbol on TradingView in a new tab.
 * Stops event propagation so it doesn't trigger any parent row/click handlers.
 */
const TradingViewLink: React.FC<TradingViewLinkProps> = ({
  symbol,
  exchange,
  size = 14,
  className = '',
  title,
}) => (
  <a
    className={`tv-link ${className}`}
    href={tradingViewUrl(symbol, exchange)}
    target="_blank"
    rel="noopener noreferrer"
    title={title || 'Open chart on TradingView'}
    onClick={(e) => e.stopPropagation()}
    aria-label={`Open ${symbol} chart on TradingView`}
  >
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 12l3-3 3 2 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 4h3v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </a>
);

export default TradingViewLink;
