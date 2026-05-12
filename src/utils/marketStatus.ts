import { MARKET_HOLIDAYS_2026 } from '@/data/marketHolidays';

export type MarketStatus = 'live' | 'closed' | 'pre-open' | 'post-close';

/**
 * Get the current IST date/time components
 */
function getISTTime(): { day: number; hours: number; minutes: number; dateStr: string } {
  const now = new Date();
  // Convert to IST
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = ist.getDay(); // 0=Sun, 6=Sat
  const hours = ist.getHours();
  const minutes = ist.getMinutes();

  // Format as YYYY-MM-DD for holiday lookup
  const year = ist.getFullYear();
  const month = String(ist.getMonth() + 1).padStart(2, '0');
  const date = String(ist.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${date}`;

  return { day, hours, minutes, dateStr };
}

/**
 * Check if today is a market holiday
 */
function isHoliday(dateStr: string): boolean {
  return MARKET_HOLIDAYS_2026.includes(dateStr);
}

/**
 * Get the current market status
 * - NSE/BSE hours: 9:15 AM – 3:30 PM IST, Mon–Fri
 * - Pre-open: 9:00 AM – 9:15 AM
 */
export function getMarketStatus(): MarketStatus {
  const { day, hours, minutes, dateStr } = getISTTime();

  // Weekend
  if (day === 0 || day === 6) return 'closed';

  // Holiday
  if (isHoliday(dateStr)) return 'closed';

  const timeInMinutes = hours * 60 + minutes;

  // Pre-open: 9:00 AM (540) to 9:15 AM (555)
  if (timeInMinutes >= 540 && timeInMinutes < 555) return 'pre-open';

  // Market hours: 9:15 AM (555) to 3:30 PM (930)
  if (timeInMinutes >= 555 && timeInMinutes <= 930) return 'live';

  // Post-close: 3:30 PM to 4:00 PM (960)
  if (timeInMinutes > 930 && timeInMinutes <= 960) return 'post-close';

  return 'closed';
}

/**
 * Simple boolean check: is the market currently open for trading?
 */
export function isMarketLive(): boolean {
  return getMarketStatus() === 'live';
}
