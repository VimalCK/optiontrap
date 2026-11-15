import React, { useState, useEffect } from 'react';

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
  const total = shots.length + 1;

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

export default Showcase;
