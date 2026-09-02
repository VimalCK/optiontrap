import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { notifySessionChange } from '@/hooks/useKiteSession';
import { SubscriptionPlan, SubscriptionStatus } from '@/services/kiteAuth';
import { activateSubscription, getSubscriptionPlans, getSubscriptionStatus } from '@/services/subscription';
import '@/styles/subscribe.css';

const getPlanPriceLabel = (plan: SubscriptionPlan) => `${plan.currency} ****/${plan.interval}`;

const planMeta: Record<string, { badge?: string; features: string[] }> = {
  one_month: {
    features: ['Full platform access', 'Live Kite data', 'Paper trading journal'],
  },
  six_months: {
    badge: 'Recommended',
    features: ['Everything in 1 Month', 'Longer access window', 'Priority for upcoming features'],
  },
  twelve_months: {
    badge: 'Best Value',
    features: ['Everything in 6 Months', 'Annual access', 'Ready for future premium benefits'],
  },
};

const Subscribe: React.FC = () => {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState('one_month');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getSubscriptionPlans(), getSubscriptionStatus()])
      .then(([planData, status]) => {
        setPlans(planData);
        setSubscription(status);
        setSelectedPlanId(status.planId || planData[0]?.id || 'one_month');
      })
      .catch((err) => setError(err.message || 'Failed to load subscription details.'))
      .finally(() => setLoading(false));
  }, []);

  const handleActivate = async () => {
    setActivating(true);
    setError(null);

    try {
      const status = await activateSubscription(selectedPlanId);
      setSubscription(status);
      notifySessionChange();
      navigate('/portfolio', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to activate subscription.');
    } finally {
      setActivating(false);
    }
  };

  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId);
  const isActive = subscription?.active === true;

  return (
    <div className="subscribe-page">
      <section className="subscribe-shell">
        <div className="subscribe-hero">
          <span className="subscribe-card__eyebrow">OptionTrap Membership</span>
          <h1>Choose your market cockpit</h1>
          <p className="subscribe-card__intro">
            Unlock dashboards, portfolio tools, analytics, watchlists, paper trades, and live Kite data behind one subscription layer.
          </p>
        </div>

        {error && <div className="subscribe-error">{error}</div>}

        {loading ? (
          <div className="subscribe-loading">Loading plans...</div>
        ) : plans.length > 0 ? (
          <div className="subscribe-plans">
            {plans.map((plan) => (
              <button
                type="button"
                key={plan.id}
                className={`subscribe-plan ${selectedPlanId === plan.id ? 'subscribe-plan--selected' : ''}`}
                onClick={() => setSelectedPlanId(plan.id)}
              >
                {planMeta[plan.id]?.badge && <span className="subscribe-plan__badge">{planMeta[plan.id].badge}</span>}
                <div className="subscribe-plan__content">
                  <span className="subscribe-plan__check" aria-hidden="true">{selectedPlanId === plan.id ? '✓' : ''}</span>
                  <h2>{plan.name}</h2>
                  <p>{plan.description || 'OptionTrap access plan.'}</p>
                </div>
                <div className="subscribe-plan__price subscribe-plan__price--blurred">{getPlanPriceLabel(plan)}</div>
                <ul className="subscribe-plan__features">
                  {(planMeta[plan.id]?.features || ['Full OptionTrap access']).map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
              </button>
            ))}
          </div>
        ) : (
          <div className="subscribe-error">No active plans are available.</div>
        )}

        <button
          className="subscribe-button"
          disabled={loading || activating || isActive || !selectedPlan}
          onClick={handleActivate}
        >
          {isActive ? 'Subscription Active' : activating ? 'Activating...' : `Activate ${selectedPlan?.name || 'Plan'}`}
        </button>

        <p className="subscribe-card__note">
          Payment integration is coming later. For now, selected plan activation is handled internally.
        </p>
      </section>
    </div>
  );
};

export default Subscribe;
