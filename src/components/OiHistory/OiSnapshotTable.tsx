import React, { useState } from 'react';
import type { OiCellData, OiTableRow } from './types';
import { formatOiWithChg, formatFullDateLabel } from './helpers';
import { patternColor, expiryLabel } from './analysis';
import { describeFlow, flowColor, type FlowReading } from '@/services/oiFlow';

interface OiSnapshotTableProps {
  rows: OiTableRow[];
  expiries: string[];
  isMonthlyExpiry: (expiry: string) => boolean;
  filterDate: string;
  atmStrike: number | null;
  spotClose: number | null;
  maxConsolidatedOi: number;
  /** IV-based flow per instrument token for the selected date. */
  flowByToken: Map<number, FlowReading>;
  selectedStrike: number | null;
  onSelectStrike: (strike: number) => void;
  onTrade: (cell: OiCellData, optionType: 'CE' | 'PE', side: 'BUY' | 'SELL', strike: number, expiry: string) => void;
}

/** Strike × expiry OI table for the selected date, with CE/PE patterns and buy/sell buttons. */
export const OiSnapshotTable: React.FC<OiSnapshotTableProps> = ({
  rows,
  expiries,
  isMonthlyExpiry,
  filterDate,
  atmStrike,
  spotClose,
  maxConsolidatedOi,
  flowByToken,
  selectedStrike,
  onSelectStrike,
  onTrade,
}) => {
  const [showPatternInfo, setShowPatternInfo] = useState(false);

  const flowFor = (token: number | undefined) => (token !== undefined ? flowByToken.get(token) : undefined);
  const flowTitle = (heading: string, reading: FlowReading | undefined) =>
    reading ? [`${heading}: ${reading.label}`, ...describeFlow(reading)].join('\n') : '';

  return (
    <div className="oi-history__table-wrap card">
      <div className="oi-history__table-header">
        <div className="oi-history__table-header-left">
          <div>
            <div className="oi-history__table-title">OI Snapshot</div>
            <div className="oi-history__table-subtitle">
              {filterDate ? formatFullDateLabel(filterDate) : 'Select a date'}
              <span>Daily change vs previous session</span>
            </div>
          </div>
        </div>
        <div className="oi-history__table-meta">
          <span className="oi-history__table-count">{rows.length} strikes</span>
          <span className="oi-history__table-count">{expiries.length} expiries</span>
          <button
            type="button"
            className="app-btn app-btn--icon oi-history__pattern-info-button"
            onClick={() => setShowPatternInfo((visible) => !visible)}
            title="Explain OI Snapshot patterns"
            aria-label="Explain OI Snapshot patterns"
            aria-expanded={showPatternInfo}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
            </svg>
          </button>
        </div>
      </div>

    {showPatternInfo && (
      <div className="trap-info-detail" style={{ marginBottom: 12 }}>
        <h4>Pattern Definitions</h4>
        <p>Patterns classify <strong>who</strong> is active at each strike based on day-over-day OI change and option price movement.</p>

        <h5>OI + Price Signals (single expiry / monthly scrips)</h5>
        <ul>
          <li><strong style={{ color: '#22c55e' }}>Long Buildup</strong> — OI ↑ + Price ↑ — New buyers entering aggressively. Bullish for the option.</li>
          <li><strong style={{ color: '#ef4444' }}>Short Buildup</strong> — OI ↑ + Price ↓ — New sellers entering aggressively. Bearish for the option.</li>
          <li><strong style={{ color: '#ef4444' }}>Long Unwinding</strong> — OI ↓ + Price ↓ — Buyers exiting, giving up. Weakness in that direction.</li>
          <li><strong style={{ color: '#22c55e' }}>Short Covering</strong> — OI ↓ + Price ↑ — Sellers exiting, bears retreating. Bullish reversal signal.</li>
        </ul>

        <h5>IV Flow (second line, nearest expiry)</h5>
        <p>Option premiums also move with spot, time decay and chain-wide IV, so OI + Price can mislabel. IV Flow solves implied volatility from each premium and compares the strike&apos;s IV change with the ATM IV change of the same expiry, leaving only strike-specific demand or supply.</p>
        <ul>
          <li><strong style={{ color: '#22c55e' }}>Buyers Adding</strong> — OI ↑ + IV ↑ vs ATM — buyers are paying up for this strike.</li>
          <li><strong style={{ color: '#ef4444' }}>Writers Adding</strong> — OI ↑ + IV ↓ vs ATM — writers are pressing premiums down.</li>
          <li><strong style={{ color: '#ef4444' }}>Buyers Exiting</strong> — OI ↓ + IV ↓ vs ATM — longs closing out.</li>
          <li><strong style={{ color: '#22c55e' }}>Writers Covering</strong> — OI ↓ + IV ↑ vs ATM — shorts buying back.</li>
          <li><strong style={{ color: 'var(--text-secondary)' }}>Unclear</strong> — OI moved but IV did not move against ATM (under 0.5 pts).</li>
          <li><strong style={{ color: 'var(--text-secondary)' }}>Stable</strong> — OI change is normal for this strike (under 1.5× its usual daily change, or under 2% without enough history).</li>
        </ul>
        <p>Hover a CE or PE cell for its IV, delta-weighted OI change (50K at ATM outweighs 50K far OTM), how unusual the change is for that strike, OI change as a share of volume (low means intraday churn), and how much of the OI was added in the last 3 sessions. OI never shows why a position exists — covered calls, spread legs, hedges and arbitrage look the same — so treat these as hints, not verdicts.</p>

        <h5>Rollover Patterns (multiple expiries / weekly scrips)</h5>
        <ul>
          <li><strong style={{ color: 'var(--accent)' }}>Rolling Over (Short)</strong> — Writers moving positions to next expiry. Strike is being actively defended.</li>
          <li><strong style={{ color: 'var(--accent)' }}>Rolling Over (Long)</strong> — Buyers moving to next expiry. Directional conviction maintained.</li>
          <li><strong style={{ color: '#ef4444' }}>Exiting (Long Unwind)</strong> — Buyers closing out, no new positions. Support/resistance weakening.</li>
          <li><strong style={{ color: '#ef4444' }}>Exiting (Short Cover)</strong> — Sellers closing out, the wall is being abandoned.</li>
          <li><strong style={{ color: '#22c55e' }}>Fresh Build (Short)</strong> — New sellers at far expiry. New wall being established.</li>
          <li><strong style={{ color: '#22c55e' }}>Fresh Build (Long)</strong> — New buyers at far expiry. New directional bet.</li>
          <li><strong style={{ color: '#22c55e' }}>Doubling Down (Long)</strong> — OI rising across multiple expiries while option price is rising. Buyers are adding conviction across expiries.</li>
          <li><strong style={{ color: '#ef4444' }}>Doubling Down (Short)</strong> — OI rising across multiple expiries while option price is falling. Sellers are adding conviction across expiries.</li>
          <li><strong style={{ color: '#ef4444' }}>Unwinding</strong> — OI falling across all expiries because existing positions are being closed. No meaningful new positions are replacing them.</li>
          <li><strong style={{ color: 'var(--text-secondary)' }}>Stable</strong> — No significant change (&lt;2%). Positions held steady.</li>
        </ul>

        <h5>How to Read</h5>
        <ul>
          <li><strong>CE Short Buildup</strong> at 1800 = call sellers adding positions, expecting price won't cross 1800. Resistance forming.</li>
          <li><strong>PE Long Buildup</strong> at 1700 = put buyers entering, expecting price to fall below 1700. Bearish bet.</li>
          <li><strong>PE Short Covering</strong> at 1700 = put sellers exiting, support at 1700 weakening.</li>
          <li><strong>CE Long Unwinding</strong> at 1800 = call buyers giving up on 1800 breakout.</li>
        </ul>
        <p>Dimmed rows have OI below 5% of the max — less significant strikes. Click any row to see its OI &amp; price chart across dates.</p>
      </div>
    )}

      <div className="oi-history__table-scroll">
        <table className="oi-history__table">
          <thead>
            <tr>
              <th className="oi-history__th-pattern">CE Pattern</th>
              {expiries.map((exp) => (
                <th key={`ce-${exp}`} className="oi-history__th-group oi-history__th-group--ce">
                  {expiryLabel(exp, isMonthlyExpiry(exp))}
                </th>
              ))}
              <th className="oi-history__th-strike">Strike</th>
              {expiries.map((exp) => (
                <th key={`pe-${exp}`} className="oi-history__th-group oi-history__th-group--pe">
                  {expiryLabel(exp, isMonthlyExpiry(exp))}
                </th>
              ))}
              <th className="oi-history__th-pattern">PE Pattern</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ strike, cells, cePattern, pePattern, ceConsolidatedOi, peConsolidatedOi, dimmed }) => {
              const isAtm = strike === atmStrike;
              const isCeItm = spotClose !== null && spotClose > 0 && strike < spotClose;
              const isPeItm = spotClose !== null && spotClose > 0 && strike > spotClose;
              const ceBarWidth = maxConsolidatedOi > 0 ? (ceConsolidatedOi / maxConsolidatedOi) * 50 : 0;
              const peBarWidth = maxConsolidatedOi > 0 ? (peConsolidatedOi / maxConsolidatedOi) * 50 : 0;
              const ceFlowExpiry = expiries.find((exp) => cells.get(exp)?.ceToken !== undefined);
              const peFlowExpiry = expiries.find((exp) => cells.get(exp)?.peToken !== undefined);
              const ceFlow = ceFlowExpiry ? flowFor(cells.get(ceFlowExpiry)?.ceToken) : undefined;
              const peFlow = peFlowExpiry ? flowFor(cells.get(peFlowExpiry)?.peToken) : undefined;
              const flowHeading = (side: string, exp: string | undefined) =>
                `${side} IV flow (${exp ? expiryLabel(exp, isMonthlyExpiry(exp)) : '-'})`;
              return (
                <tr
                  key={strike}
                  className={`${isAtm ? 'oi-history__row--atm' : ''} ${selectedStrike === strike ? 'oi-history__row--selected' : ''} ${dimmed ? 'oi-history__row--dimmed' : ''}`}
                  onClick={() => onSelectStrike(strike)}
                >
                  {/* CE Pattern */}
                  <td
                    className="oi-history__cell--pattern oi-history__cell--pattern-ce"
                    style={{ color: patternColor(cePattern) }}
                    title={[`CE pattern: ${cePattern}`, flowTitle(flowHeading('CE', ceFlowExpiry), ceFlow)].filter(Boolean).join('\n\n')}
                  >
                    {cePattern}
                    {ceFlow && ceFlow.label !== '-' && (
                      <div className="oi-history__flow-label" style={{ color: flowColor(ceFlow.label) }}>IV: {ceFlow.label}</div>
                    )}
                  </td>

                  {/* CE data per expiry */}
                  {expiries.map((exp) => {
                    const cell = cells.get(exp);
                    const { text, chgCls } = formatOiWithChg(cell?.ceOi || 0, cell?.cePrevOi);
                    const closePrice = cell?.ceClose || 0;
                    return (
                      <td key={`ce-${exp}`} title={flowTitle('CE IV flow', flowFor(cell?.ceToken)) || undefined} className={`oi-history__cell--ce oi-history__cell--tradeable ${isCeItm ? 'oi-history__cell--itm-ce' : ''} ${chgCls}`}>
                        <div className="oi-history__cell-content">
                          <span className="oi-history__cell-primary">{text}</span>
                          {closePrice > 0 && <span className="oi-history__cell-price">₹{closePrice.toFixed(closePrice < 10 ? 2 : closePrice < 100 ? 1 : 0)}</span>}
                        </div>
                        {cell?.ceToken && closePrice > 0 && (
                          <div className="oi-history__cell-actions">
                            <button className="oi-history__action-btn oi-history__action-btn--buy" onClick={(e) => { e.stopPropagation(); onTrade(cell!, 'CE', 'BUY', strike, exp); }}>B</button>
                            <button className="oi-history__action-btn oi-history__action-btn--sell" onClick={(e) => { e.stopPropagation(); onTrade(cell!, 'CE', 'SELL', strike, exp); }}>S</button>
                          </div>
                        )}
                      </td>
                    );
                  })}

                  {/* Strike */}
                  <td className={`oi-history__cell--strike ${isAtm ? 'oi-history__cell--strike-atm' : ''}`} title={isAtm ? 'At-the-money strike' : `Strike ${strike}`}>
                    <div className="oi-history__strike-bars" style={{ '--oi-history-expiry-count': expiries.length } as React.CSSProperties}>
                      <div className="oi-history__oi-bar oi-history__oi-bar--ce" style={{ width: `${ceBarWidth}%` }} />
                      <div className="oi-history__oi-bar oi-history__oi-bar--pe" style={{ width: `${peBarWidth}%` }} />
                    </div>
                    {strike}
                  </td>

                  {/* PE data per expiry */}
                  {expiries.map((exp) => {
                    const cell = cells.get(exp);
                    const { text, chgCls } = formatOiWithChg(cell?.peOi || 0, cell?.pePrevOi);
                    const closePrice = cell?.peClose || 0;
                    return (
                      <td key={`pe-${exp}`} title={flowTitle('PE IV flow', flowFor(cell?.peToken)) || undefined} className={`oi-history__cell--pe oi-history__cell--tradeable ${isPeItm ? 'oi-history__cell--itm-pe' : ''} ${chgCls}`}>
                        <div className="oi-history__cell-content">
                          <span className="oi-history__cell-primary">{text}</span>
                          {closePrice > 0 && <span className="oi-history__cell-price">₹{closePrice.toFixed(closePrice < 10 ? 2 : closePrice < 100 ? 1 : 0)}</span>}
                        </div>
                        {cell?.peToken && closePrice > 0 && (
                          <div className="oi-history__cell-actions">
                            <button className="oi-history__action-btn oi-history__action-btn--buy" onClick={(e) => { e.stopPropagation(); onTrade(cell!, 'PE', 'BUY', strike, exp); }}>B</button>
                            <button className="oi-history__action-btn oi-history__action-btn--sell" onClick={(e) => { e.stopPropagation(); onTrade(cell!, 'PE', 'SELL', strike, exp); }}>S</button>
                          </div>
                        )}
                      </td>
                    );
                  })}

                  {/* PE Pattern */}
                  <td
                    className="oi-history__cell--pattern oi-history__cell--pattern-pe"
                    style={{ color: patternColor(pePattern) }}
                    title={[`PE pattern: ${pePattern}`, flowTitle(flowHeading('PE', peFlowExpiry), peFlow)].filter(Boolean).join('\n\n')}
                  >
                    {pePattern}
                    {peFlow && peFlow.label !== '-' && (
                      <div className="oi-history__flow-label" style={{ color: flowColor(peFlow.label) }}>IV: {peFlow.label}</div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
