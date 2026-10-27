import React from 'react';
import '@/styles/infoguide.css';

export type GuideTone = 'bull' | 'bear' | 'warn' | 'violet' | 'accent' | 'muted' | 'plain';

export interface GuideRow {
  label: string;
  tone: GuideTone;
  /** Short condition shown in monospace, e.g. "OI ↑ · Price ↑". */
  rule?: string;
  meaning: React.ReactNode;
}

export interface GuideTerm {
  term: string;
  meaning: React.ReactNode;
}

/** Explainer panel behind an ⓘ button: a title, an intro and a grid of sections. */
export const InfoGuide: React.FC<{ title: string; intro?: React.ReactNode; children: React.ReactNode }> = ({ title, intro, children }) => (
  <div className="info-guide">
    <div className="info-guide__intro">
      <h4 className="info-guide__title">{title}</h4>
      {intro && <p>{intro}</p>}
    </div>
    {children}
  </div>
);

export const GuideGrid: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="info-guide__grid">{children}</div>
);

export const GuideSection: React.FC<{ title: string; subtitle?: string; wide?: boolean; children: React.ReactNode }> = ({ title, subtitle, wide, children }) => (
  <section className={`info-guide__section ${wide ? 'info-guide__section--wide' : ''}`}>
    <header className="info-guide__section-header">
      <h5 className="info-guide__section-title">{title}</h5>
      {subtitle && <span className="info-guide__section-subtitle">{subtitle}</span>}
    </header>
    {children}
  </section>
);

/** Coloured label chips with an optional rule and a meaning. `twoCol` lays rows out in two columns. */
export const GuideRows: React.FC<{ rows: GuideRow[]; twoCol?: boolean }> = ({ rows, twoCol }) => {
  const hasRule = rows.some((row) => row.rule);
  return (
    <ul className={`info-guide__rows ${hasRule ? '' : 'info-guide__rows--no-rule'} ${twoCol ? 'info-guide__rows--two-col' : ''}`}>
      {rows.map((row) => (
        <li key={row.label} className="info-guide__row">
          <span className={`info-guide__chip info-guide__chip--${row.tone}`}>{row.label}</span>
          {hasRule && <span className="info-guide__rule">{row.rule ?? ''}</span>}
          <span className="info-guide__meaning">{row.meaning}</span>
        </li>
      ))}
    </ul>
  );
};

/** Term / meaning pairs. */
export const GuideTerms: React.FC<{ terms: GuideTerm[] }> = ({ terms }) => (
  <dl className="info-guide__terms">
    {terms.map((t) => (
      <React.Fragment key={t.term}>
        <dt>{t.term}</dt>
        <dd>{t.meaning}</dd>
      </React.Fragment>
    ))}
  </dl>
);

/** Callout: amber for caveats, `info` for neutral tips. */
export const GuideNote: React.FC<{ info?: boolean; children: React.ReactNode }> = ({ info, children }) => (
  <p className={`info-guide__note ${info ? 'info-guide__note--info' : ''}`}>{children}</p>
);

export const GuideFooter: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="info-guide__footer">{children}</p>
);
