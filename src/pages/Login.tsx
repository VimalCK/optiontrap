import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getLoginUrl, getLastAvatarUrl } from '@/services/kiteAuth';
import { ShieldIcon } from '@/components/icons/Icons';
import '@/styles/login.css';

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

      for (const p of pts) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
      }

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
  const [searchParams] = useSearchParams();
  const expired = searchParams.get('expired') === '1';
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const lastAvatar = getLastAvatarUrl();
    if (lastAvatar) setAvatarUrl(lastAvatar);
  }, []);

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

  return (
    <div className="login-page">
      <ParticleNetwork />
      <div className="login-card">
        <div className="login-card__header">
          <div className="login-card__icon">
            {avatarUrl
              ? <img src={avatarUrl} alt="Profile" className="login-card__avatar" />
              : <ShieldIcon size={30} />
            }
          </div>
          <h1 className="login-card__title">OptionTrap</h1>
          <p className="login-card__subtitle">Connect to Kite to start analysing</p>
        </div>

        <div className="login-card__body">
          {expired && (
            <div className="login-card__banner login-card__banner--expired">
              Session expired. Please login again.
            </div>
          )}

          {error && (
            <div className="login-card__banner login-card__banner--error">
              {error}
            </div>
          )}

          <button
            className="btn btn--primary login-card__login-btn"
            onClick={handleLogin}
            disabled={loginLoading}
          >
            {loginLoading ? 'Redirecting...' : 'Login with Kite'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Login;
