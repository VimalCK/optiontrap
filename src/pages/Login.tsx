import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import ParticleNetwork from '@/components/ParticleNetwork/ParticleNetwork';
import Showcase from '@/components/Landing/Showcase';
import PricingPlans from '@/components/Landing/PricingPlans';
import KiteLoginModal from '@/components/Landing/KiteLoginModal';
import { hasCredentials } from '@/services/kiteAuth';
import { AnalyticsIcon, DashboardIcon, LogoIcon, PaperTradingIcon, ShieldIcon, TradesIcon, WatchlistIcon } from '@/components/icons/Icons';
import '@/styles/login.css';

const FEATURES = [
  { icon: <AnalyticsIcon />, title: 'Live Option Chain', text: 'Real-time OI, intraday velocity and Greeks across every strike.' },
  { icon: <ShieldIcon />, title: 'Trap Analyzer', text: 'Spot option traps forming before they spring.' },
  { icon: <DashboardIcon />, title: 'Smart Sell Signals', text: 'Edge-scored sell setups from OI, max pain and PCR.' },
  { icon: <TradesIcon />, title: 'OI History', text: 'Intraday snapshots and daily OI history you can replay.' },
  { icon: <PaperTradingIcon />, title: 'Paper Trading + Journal', text: 'Trade on live, tick-by-tick data — identical to real execution, with zero risk. Every fill is journaled on a P&L heatmap.' },
  { icon: <WatchlistIcon />, title: 'Watchlists & Alerts', text: 'Track instruments and get notified on price moves.' },
];

const Login: React.FC = () => {
  const [searchParams] = useSearchParams();
  const expired = searchParams.get('expired') === '1';

  const [credsSaved, setCredsSaved] = useState(false);
  const [authOpen, setAuthOpen] = useState(expired);

  useEffect(() => {
    if (hasCredentials()) setCredsSaved(true);
  }, []);

  const openAuth = () => setAuthOpen(true);
  const ctaLabel = credsSaved ? 'Login with Kite' : 'Connect with Kite';

  return (
    <div className="landing">
      <ParticleNetwork />

      <header className="landing__nav">
        <div className="landing__brand">
          <span className="landing__brand-mark"><LogoIcon size={20} /></span>
          OptionTrap
        </div>
        <nav className="landing__nav-links">
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          <button className="landing__nav-cta" onClick={openAuth}>{ctaLabel}</button>
        </nav>
      </header>

      <main className="landing__hero">
        <div className="landing__hero-copy">
          <span className="landing__eyebrow">Option analytics for Zerodha Kite</span>
          <h1 className="landing__title">
            See the options market<br />the way <span>pros</span> do.
          </h1>
          <p className="landing__lede">
            OptionTrap turns raw Kite data into a live cockpit — open-interest traps,
            intraday velocity, smart sell signals and a paper-trading journal, all in one place.
          </p>

          {expired && (
            <div className="landing__banner">Your session expired. Please login again.</div>
          )}

          <div className="landing__cta-row">
            <button className="landing__cta" onClick={openAuth}>{ctaLabel}</button>
            <a className="landing__cta-ghost" href="#features">Explore features</a>
          </div>

          <div className="landing__trust">
            <ShieldIcon size={15} />
            Your Kite API key &amp; secret stay in your browser — never stored on our servers.
          </div>
        </div>

        <div className="landing__hero-visual">
          <Showcase />
        </div>
      </main>

      <section className="landing__features" id="features">
        <h2 className="landing__section-title">Everything you need to read the option chain</h2>
        <div className="landing__feature-grid">
          {FEATURES.map((f) => (
            <div className="landing__feature" key={f.title}>
              <span className="landing__feature-icon">{f.icon}</span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing__pricing" id="pricing">
        <h2 className="landing__section-title">Simple pricing, full access</h2>
        <p className="landing__section-sub">
          One subscription unlocks every tool. Longer plans cost less per month.
        </p>

        <PricingPlans onGetStarted={openAuth} />

        <p className="landing__price-note">
          Payment integration is coming soon — early users get full access on activation.
        </p>
      </section>

      <footer className="landing__footer">
        &copy; 2026 OptionTrap · Built for Zerodha Kite Connect
      </footer>

      {authOpen && (
        <KiteLoginModal credsSaved={credsSaved} onCredsSavedChange={setCredsSaved} onClose={() => setAuthOpen(false)} />
      )}
    </div>
  );
};

export default Login;
