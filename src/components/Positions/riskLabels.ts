import type { RiskGroup } from '@/services/positionRisk';
import { formatSignedAmount } from '@/utils/formatAmount';
import { formatCalendarDate } from '@/utils/marketStatus';

/** A group's worst case at expiry: "Unlimited" when unbounded, "—" when it can't lose. */
export const maxLossLabel = (g: RiskGroup) => (g.maxLoss == null ? 'Unlimited' : g.maxLoss >= 0 ? '—' : formatSignedAmount(g.maxLoss));

/** A group's best case at expiry: "Unlimited" when unbounded, "—" when it can't gain. */
export const maxProfitLabel = (g: RiskGroup) => (g.maxProfit == null ? 'Unlimited' : g.maxProfit <= 0 ? '—' : formatSignedAmount(g.maxProfit));

/** The prices where the expiry payoff crosses zero, or "—". */
export const breakevenLabel = (g: RiskGroup) => (g.breakevens.length === 0 ? '—' : g.breakevens.map((b) => b.toLocaleString('en-IN')).join(' / '));

export const expiryLabel = (iso: string) => formatCalendarDate(iso, { day: '2-digit', month: 'short' });

export const legCountLabel = (g: RiskGroup) => `${g.legs.length} leg${g.legs.length > 1 ? 's' : ''}`;

/** The profit/loss colour class for a value: `positive`, `negative`, or none for zero and unknown. */
export const pnlTone = (value: number | null) => (value == null ? '' : value > 0 ? 'positive' : value < 0 ? 'negative' : '');
