import React from 'react';
import type { TradeSetupChecklistItem } from './types';
import { readinessScore, setupReadinessLabel, setupReadinessWidth } from './tradeSetup';
import { TradeSetupStatus, type TradeSetupStatusId } from '../../../shared/analysisEnums.js';
import type { SideId } from '../../../shared/tradeEnums.js';

/** What the buying and selling setups share: their status, plan and checklist. */
export interface SetupPlan {
  status: TradeSetupStatusId;
  action: string;
  trigger: string;
  invalidation: string;
  target: string;
  checklist: TradeSetupChecklistItem[];
}

interface SetupModeCardProps {
  title: string;
  /** What kind of trade the setup is, shown before its status. */
  setupName: string;
  meterLabel: string;
  setup: SetupPlan;
  summary: React.ReactNode;
  /** How to trade it, e.g. the strategy. */
  approach: { label: string; value: string };
  /** The trade button, or null when the setup has no trade to place. */
  trade: { side: SideId; label: string } | null;
  onTrade: (side: SideId) => void;
}

/** One way to trade the strike (buying or selling options): readiness, the evidence, the plan and its trade button. */
export const SetupModeCard: React.FC<SetupModeCardProps> = ({ title, setupName, meterLabel, setup, summary, approach, trade, onTrade }) => {
  const readiness = readinessScore(setup.checklist);
  return (
    <div className={`oi-history__setup-mode-card oi-history__setup-mode-card--${setup.status.toLowerCase()}`}>
      <div className="oi-history__setup-mode-card-head">
        <span>{title}</span>
        <strong>{setupName} {setup.status === TradeSetupStatus.Avoid ? 'No Trade' : setup.status}</strong>
      </div>
      <div className="oi-history__readiness-meter">
        <span>{meterLabel}</span>
        <strong>{setupReadinessLabel(setup.status, readiness)}</strong>
        <div><span style={{ width: setupReadinessWidth(setup.status, readiness) }} /></div>
      </div>
      <p>{setup.action}</p>
      {summary}
      <div className="oi-history__setup-primary-action">
        <span>{approach.label}</span>
        <strong>{approach.value}</strong>
      </div>
      <div className="oi-history__setup-mini-plan">
        <div>
          <span>Trigger</span>
          <strong>{setup.trigger}</strong>
        </div>
        <div>
          <span>Stop</span>
          <strong>{setup.invalidation}</strong>
        </div>
        <div>
          <span>Target</span>
          <strong>{setup.target}</strong>
        </div>
      </div>
      {trade && (
        <button
          type="button"
          className={`oi-history__setup-trade-btn oi-history__setup-trade-btn--${trade.side.toLowerCase()}`}
          onClick={() => onTrade(trade.side)}
        >
          {trade.label}
        </button>
      )}
    </div>
  );
};
