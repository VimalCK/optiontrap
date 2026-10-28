import React, { useLayoutEffect, useRef, useState } from 'react';
import type { OiCellData, OiTableRow } from './types';
import { formatOiWithChg, formatFullDateLabel } from './helpers';
import { patternColor, expiryLabel } from './analysis';
import { describeFlow, flowColor, type FlowReading } from '@/services/oiFlow';
import { PatternGuide } from './PatternGuide';

/** Strikes shown above and below ATM before the grid scrolls vertically. */
const STRIKES_EACH_SIDE = 10;

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
  const scrollRef = useRef<HTMLDivElement>(null);

  // Size the grid to ATM ± STRIKES_EACH_SIDE rows and centre ATM in it. Keyed on the
  // date and ATM (not every row update) so live data doesn't yank the scroll position.
  const atmIndex = rows.findIndex((row) => row.strike === atmStrike);
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const table = scroller?.querySelector('table');
    const bodyRows = table?.tBodies[0]?.rows;
    if (!scroller || !table || !bodyRows || bodyRows.length === 0) return;
    const headHeight = table.tHead?.offsetHeight ?? 0;
    const rowHeight = bodyRows[0].offsetHeight;
    scroller.style.maxHeight = `${headHeight + rowHeight * (STRIKES_EACH_SIDE * 2 + 1)}px`;
    const atmRow = atmIndex >= 0 ? bodyRows[atmIndex] : undefined;
    if (atmRow) scroller.scrollTop = Math.max(0, atmRow.offsetTop - headHeight - rowHeight * STRIKES_EACH_SIDE);
  }, [filterDate, atmIndex, rows.length, expiries.length]);

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

    {showPatternInfo && <PatternGuide />}

      <div ref={scrollRef} className="oi-history__table-scroll oi-history__table-scroll--grid">
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
              // Nearest expiry with a usable reading; a contract on its expiry day has no IV.
              const hasFlow = (token: number | undefined) => { const label = flowFor(token)?.label; return label !== undefined && label !== '-'; };
              const ceFlowExpiry = expiries.find((exp) => hasFlow(cells.get(exp)?.ceToken));
              const peFlowExpiry = expiries.find((exp) => hasFlow(cells.get(exp)?.peToken));
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
