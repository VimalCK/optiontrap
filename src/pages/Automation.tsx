/**
 * Automation — automated paper trading.
 *
 * Step 1: the page and its layout. One panel for each part of the plan; each
 * is filled in as that part is built. Nothing trades from here yet.
 */
import React from 'react';
import '@/styles/automation.css';

export type AutomationPartStatus = 'coming-next' | 'live';

export interface AutomationPart {
  id: 'signals' | 'execution' | 'monitor' | 'risk' | 'scorecard';
  title: string;
  summary: string;
  points: string[];
  status: AutomationPartStatus;
}

/** The plan, in build order. */
export const AUTOMATION_PARTS: AutomationPart[] = [
  {
    id: 'signals',
    title: 'Signal engine',
    summary: 'At each 10-minute snapshot, decides whether to enter, with the reasons recorded.',
    points: [
      'Intraday data: OI change speed, PCR, max pain, OI walls',
      'OI History: daily buildup patterns and the trade-setup signals already logged',
      'The same strategy scoring as the screen, so one set of rules serves both',
    ],
    status: 'coming-next',
  },
  {
    id: 'execution',
    title: 'Paper execution',
    summary: 'Fills automated trades as paper positions, marked as automated.',
    points: [
      'Fills at the quoted price plus a small slippage assumption',
      'Lot sizes from the instruments table',
    ],
    status: 'coming-next',
  },
  {
    id: 'monitor',
    title: 'Trade monitor',
    summary: 'Runs on the server every minute, so it works with the laptop closed.',
    points: [
      'Cutting losses: a stop loss on every trade from the moment it opens',
      'Riding profits: a trailing stop that moves up as the price rises',
      'Time exits: close everything before 15:20 IST, stricter on expiry day',
    ],
    status: 'coming-next',
  },
  {
    id: 'risk',
    title: 'Risk limits',
    summary: 'If the system goes wrong, it stops itself.',
    points: [
      'A cap on losses per day',
      'A cap on trades per day',
      'A cap on open positions',
    ],
    status: 'coming-next',
  },
  {
    id: 'scorecard',
    title: 'Scorecard',
    summary: 'Every entry, exit and reason logged, to find out whether the system works.',
    points: [
      'Win rate',
      'Average win compared with average loss',
      'Largest peak-to-trough drop in paper capital',
      'Results by strategy and by symbol',
    ],
    status: 'coming-next',
  },
];

const STATUS_LABEL: Record<AutomationPartStatus, string> = {
  'coming-next': 'Coming next',
  live: 'Live',
};

const Automation: React.FC = () => (
  <div className="automation">
    <header className="automation-header">
      <h1 className="automation-header__title">Automation</h1>
      <span className="automation-header__status">Paper trading · not running yet</span>
    </header>

    <div className="automation-grid">
      {AUTOMATION_PARTS.map((part, index) => (
        <section key={part.id} className={`card automation-part automation-part--${part.id}`} aria-labelledby={`automation-${part.id}`}>
          <div className="automation-part__top">
            <span className="automation-part__step">{index + 1}</span>
            <h3 id={`automation-${part.id}`} className="card__title automation-part__title">{part.title}</h3>
            <span className={`automation-part__badge automation-part__badge--${part.status}`}>{STATUS_LABEL[part.status]}</span>
          </div>
          <p className="card__description">{part.summary}</p>
          <ul className="automation-part__points">
            {part.points.map((point) => <li key={point}>{point}</li>)}
          </ul>
        </section>
      ))}
    </div>
  </div>
);

export default Automation;
