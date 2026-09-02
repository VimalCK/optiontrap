import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import ParticleNetwork from '@/components/ParticleNetwork/ParticleNetwork';
import { getLoginUrl, getLastAvatarUrl, saveCredentials, hasCredentials, getCredentials } from '@/services/kiteAuth';
import {
  ShieldIcon, AnalyticsIcon, TradesIcon, WatchlistIcon,
  PaperTradingIcon, DashboardIcon, LogoIcon,
} from '@/components/icons/Icons';
import '@/styles/login.css';

// ─── Feature highlights ─────────────────────────────────────────────────────

const FEATURES = [
  { icon: <AnalyticsIcon />, title: 'Live Option Chain', text: 'Real-time OI, intraday velocity and Greeks across every strike.' },
  { icon: <ShieldIcon />, title: 'Trap Analyzer', text: 'Spot option traps forming before they spring.' },
  { icon: <DashboardIcon />, title: 'Smart Sell Signals', text: 'Edge-scored sell setups from OI, max pain and PCR.' },
  { icon: <TradesIcon />, title: 'OI History', text: 'Intraday snapshots and daily OI history you can replay.' },
  { icon: <PaperTradingIcon />, title: 'Paper Trading + Journal', text: 'Trade on live, tick-by-tick data — identical to real execution, with zero risk. Every fill is journaled on a P&L heatmap.' },
  { icon: <WatchlistIcon />, title: 'Watchlists & Alerts', text: 'Track instruments and get notified on price moves.' },
];

// ─── Animated app showcase (CSS/JS mockup, replaced by real screenshots later) ─

const STRIKES = [
  { strike: 24300, ce: 42, pe: 78 },
  { strike: 24400, ce: 58, pe: 64 },
  { strike: 24500, ce: 91, pe: 52, atm: true },
  { strike: 24600, ce: 66, pe: 39 },
  { strike: 24700, ce: 48, pe: 27 },
];

// Real product screenshots — drop the files into public/showcase/.
const SHOTS = [
  { src: '/showcase/oi-history.png', label: 'OI Price History', sub: 'Per-strike CE/PE open interest & price over time' },
  { src: '/showcase/pnl-journal.png', label: 'Trade Journal', sub: 'Tick-accurate paper P&L, win rate & heatmap' },
];

const MockChain: React.FC = () => {
  const [spot, setSpot] = useState(24512.35);
  const [edge, setEdge] = useState(72);
  const [rows, setRows] = useState(STRIKES);

  // Light "live" ticking so the mock feels alive
  useEffect(() => {
    const id = setInterval(() => {
      setSpot((prev) => +(prev + (Math.random() - 0.5) * 6).toFixed(2));
      setEdge((prev) => Math.min(96, Math.max(48, prev + Math.round((Math.random() - 0.5) * 8))));
      setRows((prev) => prev.map((r) => ({
        ...r,
        ce: Math.min(99, Math.max(15, r.ce + Math.round((Math.random() - 0.5) * 6))),
        pe: Math.min(99, Math.max(15, r.pe + Math.round((Math.random() - 0.5) * 6))),
      })));
    }, 1600);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="showcase__mock">
      <div className="showcase__spot">
        <span>NIFTY 50</span>
        <strong>{spot.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
      </div>

      <div className="showcase__chain">
        <div className="showcase__chain-head">
          <span>CE OI</span><span>Strike</span><span>PE OI</span>
        </div>
        {rows.map((r) => (
          <div key={r.strike} className={`showcase__row ${r.atm ? 'showcase__row--atm' : ''}`}>
            <div className="showcase__oi showcase__oi--ce">
              <span className="showcase__bar-fill showcase__bar-fill--ce" style={{ width: `${r.ce}%` }} />
              <em>{r.ce}k</em>
            </div>
            <span className="showcase__strike">{r.strike}</span>
            <div className="showcase__oi showcase__oi--pe">
              <span className="showcase__bar-fill showcase__bar-fill--pe" style={{ width: `${r.pe}%` }} />
              <em>{r.pe}k</em>
            </div>
          </div>
        ))}
      </div>

      <div className="showcase__footer">
        <div className="showcase__gauge" style={{ ['--edge' as string]: `${edge}` }}>
          <span className="showcase__gauge-value">{edge}</span>
        </div>
        <div className="showcase__footer-copy">
          <span className="showcase__footer-label">Edge Score</span>
          <span className="showcase__footer-sub">Sell signal · high conviction</span>
        </div>
        <div className="showcase__heatmap">
          {Array.from({ length: 21 }).map((_, i) => (
            <span key={i} className={`showcase__cell showcase__cell--${(i * 7) % 3}`} style={{ animationDelay: `${i * 0.08}s` }} />
          ))}
        </div>
      </div>
    </div>
  );
};

const Showcase: React.FC = () => {
  const [slide, setSlide] = useState(0);
  // Only include screenshots that actually exist so we never show blank slides.
  const [shots, setShots] = useState<typeof SHOTS>([]);
  const total = shots.length + 1; // mock + available screenshots

  useEffect(() => {
    let active = true;
    const found = new Set<string>();
    let pending = SHOTS.length;
    if (pending === 0) return;

    SHOTS.forEach((s) => {
      const img = new Image();
      const done = () => {
        if (--pending === 0 && active) setShots(SHOTS.filter((x) => found.has(x.src)));
      };
      img.onload = () => { found.add(s.src); done(); };
      img.onerror = done;
      img.src = s.src;
    });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (total <= 1) return;
    const id = setInterval(() => setSlide((s) => (s + 1) % total), 4500);
    return () => clearInterval(id);
  }, [total]);

  const shot = slide > 0 ? shots[slide - 1] : null;
  const label = shot ? shot.label : 'Live Option Chain';
  const sub = shot ? shot.sub : 'Real-time OI, velocity & Greeks';

  return (
    <div className="showcase">
      <div className="showcase__frame">
        <div className="showcase__bar">
          <span className="showcase__dot" /><span className="showcase__dot" /><span className="showcase__dot" />
          <span className="showcase__url">optiontrap · {label}</span>
          <span className="showcase__live"><i />LIVE</span>
        </div>

        <div className="showcase__stage">
          {shot
            ? <img className="showcase__shot" src={shot.src} alt={shot.label} loading="lazy" />
            : <MockChain />}
        </div>

        <div className="showcase__caption">
          <span>{label}</span>
          <small>{sub}</small>
        </div>

        <div className="showcase__dots">
          {Array.from({ length: total }).map((_, i) => (
            <button
              key={i}
              type="button"
              className={`showcase__dot-nav ${i === slide ? 'is-active' : ''}`}
              onClick={() => setSlide(i)}
              aria-label={`Show slide ${i + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── Login / landing page ─────────────────────────────────────────────────────

const Login: React.FC = () => {
  const [searchParams] = useSearchParams();
  const expired = searchParams.get('expired') === '1';

  const existingCreds = getCredentials();
  const [apiKey, setApiKey] = useState(existingCreds?.apiKey ?? '');
  const [apiSecret, setApiSecret] = useState(existingCreds?.apiSecret ?? '');
  const [showSecret, setShowSecret] = useState(false);
  const [credsSaved, setCredsSaved] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(expired);

  useEffect(() => {
    const lastAvatar = getLastAvatarUrl();
    if (lastAvatar) setAvatarUrl(lastAvatar);
    if (hasCredentials()) setCredsSaved(true);
  }, []);

  const openAuth = () => {
    setError(null);
    setAuthOpen(true);
  };

  const handleSave = () => {
    setError(null);
    saveCredentials(apiKey.trim(), apiSecret.trim());
    setCredsSaved(true);
  };

  const handleLogin = async () => {
    setLoginLoading(true);
    setError(null);
    try {
      const url = await getLoginUrl();
      window.location.href = url;
    } catch {
      setError('Failed to get login URL. Is the server running?');
      setLoginLoading(false);
    }
  };

  const hasCreds = apiKey.trim().length > 0 && apiSecret.trim().length > 0;
  const ctaLabel = credsSaved ? 'Login with Kite' : 'Connect with Kite';

  return (
    <div className="landing">
      <ParticleNetwork />

      <header className="landing__nav">
        <div className="landing__brand">
          <span className="landing__brand-mark"><LogoIcon size={20} /></span>
          OptionTrap
        </div>
        <button className="landing__nav-cta" onClick={openAuth}>{ctaLabel}</button>
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

      <footer className="landing__footer">
        &copy; 2026 OptionTrap · Built for Zerodha Kite Connect
      </footer>

      {authOpen && (
        <div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
          <button type="button" className="auth-modal__backdrop" onClick={() => setAuthOpen(false)} aria-label="Close" />
          <div className="auth-modal__card">
            <div className="auth-modal__header">
              <div className="auth-modal__icon">
                {avatarUrl ? <img src={avatarUrl} alt="" /> : <ShieldIcon size={26} />}
              </div>
              <h2 id="auth-title">{credsSaved ? 'Welcome back' : 'Connect your Kite account'}</h2>
              <p>{credsSaved
                ? 'Continue to Kite to authorise this session.'
                : 'OptionTrap connects to your Zerodha account using Kite Connect.'}</p>
            </div>

            {error && <div className="auth-modal__error">{error}</div>}

            {credsSaved ? (
              <>
                <button className="auth-modal__primary" onClick={handleLogin} disabled={loginLoading}>
                  {loginLoading ? 'Redirecting...' : 'Login with Kite'}
                </button>
                <button className="auth-modal__link" type="button" onClick={() => setCredsSaved(false)}>
                  Change credentials
                </button>
              </>
            ) : (
              <div className="auth-form">
                <p className="auth-form__hint">
                  Enter your Kite Connect API credentials.{' '}
                  <a href="https://developers.kite.trade" target="_blank" rel="noopener noreferrer">Get keys</a>
                </p>

                <div className="form-field">
                  <label className="form-field__label" htmlFor="login-api-key">API Key</label>
                  <input
                    id="login-api-key"
                    type="text"
                    className="form-field__input"
                    placeholder="Enter your Kite API key"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    autoComplete="off"
                  />
                </div>

                <div className="form-field">
                  <label className="form-field__label" htmlFor="login-api-secret">API Secret</label>
                  <div className="form-field__input-wrapper">
                    <input
                      id="login-api-secret"
                      type={showSecret ? 'text' : 'password'}
                      className="form-field__input"
                      placeholder="Enter your Kite API secret"
                      value={apiSecret}
                      onChange={(e) => setApiSecret(e.target.value)}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="form-field__toggle-visibility"
                      onClick={() => setShowSecret((prev) => !prev)}
                      aria-label={showSecret ? 'Hide secret' : 'Show secret'}
                    >
                      {showSecret ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                <p className="auth-form__privacy">
                  Stored only in this browser. Never sent to our servers for storage.
                </p>

                <button className="auth-modal__primary" onClick={handleSave} disabled={!hasCreds}>
                  Save &amp; Continue
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Login;
