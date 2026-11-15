import React, { useState, useEffect } from 'react';
import { SubscriptionPlan } from '@/services/kiteAuth';
import { currencySymbol, getPublicPlans, formatDuration } from '@/services/subscription';
import { CheckIcon } from '@/components/icons/Icons';
import { DurationUnit } from '../../../shared/appEnums.js';

// Marketing metadata merged with live plan data from the DB (name/price/duration).
const PLAN_META: Record<string, { badge?: string; features: string[] }> = {
  one_month: { features: ['Full option chain & analytics', 'Paper trading + journal', 'Watchlists & price alerts'] },
  six_months: { badge: 'Most popular', features: ['Everything in 1 Month', 'Priority access to new analytics', 'Longer strategy review window'] },
  twelve_months: { features: ['Everything in 6 Months', 'Annual performance view', 'Priority roadmap access'] },
};

const DEFAULT_FEATURES = ['Full access to all analytics', 'Paper trading + journal', 'Watchlists & alerts'];

// Shown until the live plans load (or if the request fails).
const FALLBACK_PLANS: SubscriptionPlan[] = [
  { id: 'one_month', name: '1 Month', description: null, currency: 'INR', price: 199, durationCount: 1, durationUnit: DurationUnit.Month, isActive: true },
  { id: 'six_months', name: '6 Months', description: null, currency: 'INR', price: 999, durationCount: 6, durationUnit: DurationUnit.Month, isActive: true },
  { id: 'twelve_months', name: '12 Months', description: null, currency: 'INR', price: 1799, durationCount: 12, durationUnit: DurationUnit.Month, isActive: true },
];

const monthsOf = (p: SubscriptionPlan): number => {
  switch (p.durationUnit) {
    case DurationUnit.Year: return p.durationCount * 12;
    case DurationUnit.Week: return (p.durationCount * 7) / 30;
    case DurationUnit.Day: return p.durationCount / 30;
    default: return p.durationCount;
  }
};

/** The landing page's plan cards, priced from the live plans. */
const PricingPlans: React.FC<{ onGetStarted: () => void }> = ({ onGetStarted }) => {
  const [plans, setPlans] = useState<SubscriptionPlan[]>(FALLBACK_PLANS);

  useEffect(() => {
    // Live pricing from the DB (falls back to static plans on failure).
    getPublicPlans()
      .then((data) => { if (data && data.length) setPlans(data); })
      .catch(() => { /* keep fallback */ });
  }, []);

  const baseMonthly = Math.max(...plans.map((p) => Math.round(p.price / monthsOf(p))));

  return (
    <div className="landing__price-grid">
      {plans.map((p) => {
        const months = monthsOf(p);
        const perMonth = Math.round(p.price / months);
        const save = Math.round(baseMonthly * months - p.price);
        const cur = currencySymbol(p.currency);
        const meta = PLAN_META[p.id] || {};
        const features = meta.features || DEFAULT_FEATURES;
        const term = months <= 1 ? 'per month' : `for ${formatDuration(p.durationCount, p.durationUnit)}`;
        return (
          <div className={`price-card ${meta.badge ? 'price-card--featured' : ''}`} key={p.id}>
            {meta.badge && <span className="price-card__badge">{meta.badge}</span>}
            <h3 className="price-card__name">{p.name}</h3>
            <div className="price-card__amount">
              {cur}{p.price.toLocaleString('en-IN')}
            </div>
            <div className="price-card__term">{term}</div>
            <div className="price-card__sub">
              {months <= 1
                ? 'Billed monthly'
                : `≈ ${cur}${perMonth.toLocaleString('en-IN')}/mo${save > 0 ? ` · Save ${cur}${save.toLocaleString('en-IN')}` : ''}`}
            </div>
            <ul className="price-card__features">
              {features.map((f) => (
                <li key={f}>
                  <CheckIcon size={14} strokeWidth={3} />
                  {f}
                </li>
              ))}
            </ul>
            <button className="price-card__cta" onClick={onGetStarted}>Get started</button>
          </div>
        );
      })}
    </div>
  );
};

export default PricingPlans;
