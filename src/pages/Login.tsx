import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getCredentials, getLoginUrl } from '@/services/kiteAuth';
import { ShieldIcon } from '@/components/icons/Icons';
import '@/styles/login.css';

const KITE_STORAGE_KEY = 'optiontrap_kite_credentials';

interface Credentials {
  apiKey: string;
  apiSecret: string;
}

// ─── Particle network canvas ──────────────────────────────────────────────────

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

const PARTICLE_COUNT = 55;
const MAX_DIST = 130;
const PARTICLE_COLOR = 'rgba(99, 102, 241,';
const LINE_COLOR = 'rgba(99, 102, 241,';

const ParticleNetwork: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);
  const rafRef = useRef<number>(0);

  const init = useCallback((w: number, h: number) => {
    particles.current = Array.from({ length: PARTICLE_COUNT }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      r: Math.random() * 1.5 + 1,
    }));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      init(canvas.width, canvas.height);
    };

    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const pts = particles.current;

      // Move
      for (const p of pts) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
      }

      // Lines
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x;
          const dy = pts[i].y - pts[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < MAX_DIST) {
            const alpha = (1 - dist / MAX_DIST) * 0.25;
            ctx.beginPath();
            ctx.strokeStyle = `${LINE_COLOR}${alpha})`;
            ctx.lineWidth = 0.8;
            ctx.moveTo(pts[i].x, pts[i].y);
            ctx.lineTo(pts[j].x, pts[j].y);
            ctx.stroke();
          }
        }
      }

      // Dots
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `${PARTICLE_COLOR}0.55)`;
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(rafRef.current);
    };
  }, [init]);

  return <canvas ref={canvasRef} className="login-particle-canvas" aria-hidden="true" />;
};

// ─── Login page ───────────────────────────────────────────────────────────────

const Login: React.FC = () => {
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hasStoredCreds, setHasStoredCreds] = useState(false);

  useEffect(() => {
    const creds = getCredentials();
    if (creds) {
      setApiKey(creds.apiKey);
      setApiSecret(creds.apiSecret);
      setHasStoredCreds(true);
    }
  }, []);

  const handleSave = () => {
    const credentials: Credentials = { apiKey: apiKey.trim(), apiSecret: apiSecret.trim() };
    localStorage.setItem(KITE_STORAGE_KEY, JSON.stringify(credentials));
    setHasStoredCreds(true);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleLogin = () => {
    const url = getLoginUrl();
    if (url) {
      window.location.href = url;
    }
  };

  const hasCreds = apiKey.trim().length > 0 && apiSecret.trim().length > 0;

  return (
    <div className="login-page">
      <ParticleNetwork />
      <div className="login-card">
        <div className="login-card__header">
          <div className="login-card__icon">
            <ShieldIcon />
          </div>
          <h1 className="login-card__title">OptionTrap</h1>
          <p className="login-card__subtitle">Connect to Kite to start analysing</p>
        </div>

        {hasStoredCreds ? (
          <div className="login-card__body">
            <p className="login-card__status">API credentials configured.</p>
            <button className="btn btn--primary login-card__login-btn" onClick={handleLogin}>
              Login with Kite
            </button>
            <button
              className="login-card__change-creds"
              type="button"
              onClick={() => setHasStoredCreds(false)}
            >
              Change credentials
            </button>
          </div>
        ) : (
          <div className="login-card__body">
            <p className="login-card__status">
              Enter your Kite Connect API credentials.{' '}
              <a
                href="https://developers.kite.trade"
                target="_blank"
                rel="noopener noreferrer"
                className="settings-link"
              >
                Get keys
              </a>
            </p>

            <div className="settings-form">
              <div className="form-field">
                <label className="form-field__label" htmlFor="login-api-key">
                  API Key
                </label>
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
                <label className="form-field__label" htmlFor="login-api-secret">
                  API Secret
                </label>
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

              <div className="form-actions">
                <button
                  className="btn btn--primary"
                  onClick={handleSave}
                  disabled={!hasCreds}
                >
                  {saved ? 'Saved' : 'Save & Continue'}
                </button>
                {saved && (
                  <span className="form-actions__feedback">
                    Credentials saved
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Login;
