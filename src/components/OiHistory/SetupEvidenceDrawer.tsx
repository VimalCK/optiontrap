import React from 'react';
import type { TradeSetupData } from './types';
import { formatPct, formatPcr } from './helpers';
import { checklistStatusText, sortChecklistByStatus, readinessScore, setupReadinessLabel } from './tradeSetup';
import { expiryLabel } from './expiries';
import type { SetupPlan } from './SetupModeCard';

const ChecklistSection: React.FC<{ title: string; className: string; setup: Pick<SetupPlan, 'status' | 'checklist'> }> = ({ title, className, setup }) => (
  <div className={`oi-history__setup-detail-section ${className}`}>
    <div className="oi-history__setup-section-heading">
      <span>{title}</span>
      <strong>{setupReadinessLabel(setup.status, readinessScore(setup.checklist))}</strong>
    </div>
    <div className="oi-history__setup-signal-strip">
      {sortChecklistByStatus(setup.checklist).map((item) => (
        <div key={item.label} className={`oi-history__signal-tile oi-history__signal-tile--${item.status.toLowerCase()}`}>
          <span>{item.label}</span>
          <strong>{checklistStatusText(item.status)}</strong>
          <em>{item.answer}</em>
        </div>
      ))}
    </div>
  </div>
);

interface SetupEvidenceDrawerProps {
  setup: TradeSetupData;
  expiries: string[];
  isMonthlyExpiry: (expiry: string) => boolean;
}

/** "Why this setup?": each setup's checklist, the trend and flow behind them, and what to watch. */
export const SetupEvidenceDrawer: React.FC<SetupEvidenceDrawerProps> = ({ setup, expiries, isMonthlyExpiry }) => (
  <details className="oi-history__setup-detail-drawer">
    <summary>
      <span>Why this setup?</span>
      <em>Evidence, risk checks, and market context</em>
    </summary>
    <div className="oi-history__setup-evidence-grid">
      <ChecklistSection title="Option buying" className="oi-history__setup-detail-section--buying" setup={setup.tradeSetup} />
      <ChecklistSection title="Option selling" className="oi-history__setup-detail-section--selling" setup={setup.sellingSetup} />
    </div>
    <div className="oi-history__setup-context">
      <div className={`oi-history__setup-context-item oi-history__setup-context-item--${setup.tradeBias.bias.toLowerCase()}`}>
        <span>Trade bias</span>
        <strong>{setup.tradeBias.title}</strong>
        <em>{setup.tradeBias.action} {setup.tradeBias.reason}</em>
      </div>
      <div className={`oi-history__setup-context-item oi-history__setup-context-item--${setup.priceTrend.direction.toLowerCase()}`}>
        <span>Price trend</span>
        <strong>{setup.priceTrend.direction} - {setup.priceTrend.strength}</strong>
        <em>
          {setup.priceTrend.reason} Start {setup.priceTrend.startPrice !== null ? setup.priceTrend.startPrice.toFixed(2) : '-'} | End {setup.priceTrend.endPrice !== null ? setup.priceTrend.endPrice.toFixed(2) : '-'} | Change {formatPct(setup.priceTrend.changePct)} | Recent {formatPct(setup.priceTrend.recentChangePct)} | Sessions {setup.priceTrend.sessions}
        </em>
      </div>
      <div className={`oi-history__setup-context-item oi-history__setup-context-item--${setup.biasSummary.bias.toLowerCase()}`}>
        <span>Option flow</span>
        <strong>{setup.biasSummary.bias} - {setup.biasSummary.strength}</strong>
        <em>
          {setup.biasSummary.reason} Confidence {setup.biasSummary.confidence}% | Days {setup.biasSummary.bullishDays}/{setup.biasSummary.bearishDays}/{setup.biasSummary.neutralDays} | CE OI {formatPct(setup.biasSummary.ceOiChangePct)} | PE OI {formatPct(setup.biasSummary.peOiChangePct)} | PCR {formatPcr(setup.biasSummary.pcrStart)} -&gt; {formatPcr(setup.biasSummary.pcrEnd)} | Score {setup.biasSummary.score}
        </em>
      </div>
    </div>
    <div className="oi-history__setup-details">
      <div>
        <span>Recent 3-session lean</span>
        <strong className={`oi-history__bias-text--${setup.biasSummary.recentBias.toLowerCase()}`}>
          {setup.biasSummary.recentBias} ({setup.biasSummary.recentScore > 0 ? '+' : ''}{setup.biasSummary.recentScore})
        </strong>
      </div>
      <div>
        <span>Main driver</span>
        <strong>{setup.biasSummary.driver}</strong>
      </div>
      <div>
        <span>Visible expiries</span>
        <strong>{expiries.map((exp) => expiryLabel(exp, isMonthlyExpiry(exp))).join(', ')}</strong>
      </div>
      {setup.biasSummary.warning && (
        <div className="oi-history__bias-warning">
          <span>Watch</span>
          <strong>{setup.biasSummary.warning}</strong>
        </div>
      )}
    </div>
  </details>
);
