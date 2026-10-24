import React, { useMemo, useState } from 'react';
import type { FuturesHistoryRow } from './types';
import { FUTURES_LINE_COLORS, buildFuturesSeries, formatMonthLabel, formatFullDateLabel, formatOiCompact } from './helpers';
import { ChartXAxis } from './ChartXAxis';

interface FuturesContextProps {
  futuresData: FuturesHistoryRow[];
  filterDate: string;
  scrip: string;
}

/** Futures Context card: every month's contract on the selected date (table) or across dates (chart). */
export const FuturesContext: React.FC<FuturesContextProps> = ({ futuresData, filterDate, scrip }) => {
  const [showFuturesInfo, setShowFuturesInfo] = useState(false);
  const [futuresView, setFuturesView] = useState<'table' | 'chart'>('table');
  const [futuresHover, setFuturesHover] = useState<{ date: string; x: number; oi: number; volume: number; closes: { label: string; color: string; close: number }[] } | null>(null);

  /** Futures contracts loaded for M-1 (if stored) and the current-through-selected month range, oldest first. */
  const futuresContracts = useMemo(() => {
    const contracts = new Map<string, string>();
    for (const row of futuresData) {
      if (row.expiry && !contracts.has(row.expiry)) contracts.set(row.expiry, row.tradingsymbol);
    }
    return [...contracts].map(([expiry, tradingsymbol]) => ({ expiry, tradingsymbol })).sort((a, b) => a.expiry.localeCompare(b.expiry));
  }, [futuresData]);

  // Changes are computed within each contract so rollover days don't show false jumps.
  const futuresRowsByContract = useMemo(() => {
    const byContract = new Map<string, ReturnType<typeof buildFuturesSeries>>();
    for (const { expiry } of futuresContracts) {
      byContract.set(expiry, buildFuturesSeries(futuresData.filter((row) => row.expiry === expiry)));
    }
    return byContract;
  }, [futuresData, futuresContracts]);

  /** Table view shows every contract on the selected date, like the OI Snapshot. */
  const futuresDateRows = useMemo(() => {
    return futuresContracts
      .map(({ expiry }) => futuresRowsByContract.get(expiry)?.find((row) => row.date === filterDate))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
  }, [futuresContracts, futuresRowsByContract, filterDate]);

  /** Chart view plots every month's price on a shared date axis; bars are total OI/volume across months. */
  const futuresChart = useMemo(() => {
    const dates = [...new Set(futuresData.map((row) => row.date))].sort();
    if (dates.length === 0) return null;
    const prices = futuresData.map((row) => row.close).filter((price) => Number.isFinite(price) && price > 0);
    if (prices.length === 0) return null;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || Math.max(max * 0.01, 1);
    const padding = range * 0.12;
    const low = min - padding;
    const high = max + padding;
    const left = 50;
    const right = 50;
    const top = 16;
    const bottom = 30;
    const width = 700;
    const height = 162;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const stepX = plotWidth / dates.length;
    const xByDate = new Map(dates.map((date, index) => [date, left + (index + 0.5) * stepX]));
    const toY = (close: number) => top + ((high - close) / (high - low)) * plotHeight;
    const lines = futuresContracts.map(({ expiry, tradingsymbol }, index) => ({
      expiry,
      tradingsymbol,
      label: formatMonthLabel(expiry.slice(0, 7)),
      color: FUTURES_LINE_COLORS[index % FUTURES_LINE_COLORS.length],
      points: (futuresRowsByContract.get(expiry) || [])
        .filter((row) => row.close > 0)
        .map((row) => ({ date: row.date, close: row.close, x: xByDate.get(row.date)!, y: toY(row.close) })),
    }));
    const days = dates.map((date) => {
      const rows = futuresData.filter((row) => row.date === date);
      return {
        date,
        x: xByDate.get(date)!,
        oi: rows.reduce((sum, row) => sum + (row.oi || 0), 0),
        volume: rows.reduce((sum, row) => sum + (row.volume || 0), 0),
        closes: lines.flatMap((line) => {
          const point = line.points.find((item) => item.date === date);
          return point ? [{ label: line.label, color: line.color, close: point.close }] : [];
        }),
      };
    });
    const maxOi = Math.max(1, ...days.map((day) => day.oi));
    const maxVolume = Math.max(1, ...days.map((day) => day.volume));
    return { lines, days, low, high, left, right, top, bottom, width, height, plotWidth, plotHeight, maxOi, maxVolume };
  }, [futuresData, futuresContracts, futuresRowsByContract]);

  if (futuresContracts.length === 0) return null;

  return (
    <div className="oi-history__table-wrap card" style={{ marginBottom: 16 }}>
      <div className="oi-history__table-header">
        <div className="oi-history__table-header-left">
          <div>
            <div className="oi-history__table-title">Futures Context</div>
            <div className="oi-history__table-subtitle">
              {futuresView === 'chart'
                ? `${futuresContracts.length} month${futuresContracts.length === 1 ? '' : 's'} · Daily price, OI, and volume history`
                : <>{filterDate ? formatFullDateLabel(filterDate) : 'Select a date'}<span>Daily price, OI, and volume confirmation</span></>}
            </div>
          </div>
        </div>
        <div className="oi-history__table-meta">
          <div className="oi-history__metric-toggle" role="group" aria-label="Futures view">
            <button type="button" className={`oi-history__volume-toggle ${futuresView === 'table' ? 'oi-history__volume-toggle--active' : ''}`} onClick={() => setFuturesView('table')} aria-pressed={futuresView === 'table'}>Table</button>
            <button type="button" className={`oi-history__volume-toggle ${futuresView === 'chart' ? 'oi-history__volume-toggle--active' : ''}`} onClick={() => setFuturesView('chart')} aria-pressed={futuresView === 'chart'}>Chart</button>
          </div>
          <button
            type="button"
            className="app-btn app-btn--icon oi-history__futures-info-button"
            onClick={() => setShowFuturesInfo((visible) => !visible)}
            title="Explain futures signals"
            aria-label="Explain futures signals"
            aria-expanded={showFuturesInfo}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
            </svg>
          </button>
        </div>
      </div>
      {showFuturesInfo && (
        <div className="oi-history__futures-info" role="note">
          <div className="oi-history__futures-info-title">How futures signals are calculated</div>
          <div className="oi-history__futures-info-grid">
            <div className="oi-history__futures-info-item oi-history__futures-info-item--bullish">
              <strong>Long buildup</strong>
              <span>Price ↑ and OI ↑</span>
              <small>New buyers are entering. Generally bullish.</small>
            </div>
            <div className="oi-history__futures-info-item oi-history__futures-info-item--bearish">
              <strong>Short buildup</strong>
              <span>Price ↓ and OI ↑</span>
              <small>New sellers are entering. Generally bearish.</small>
            </div>
            <div className="oi-history__futures-info-item oi-history__futures-info-item--bearish">
              <strong>Long unwinding</strong>
              <span>Price ↓ and OI ↓</span>
              <small>Existing buyers are closing positions. Signals weakness.</small>
            </div>
            <div className="oi-history__futures-info-item oi-history__futures-info-item--bullish">
              <strong>Short covering</strong>
              <span>Price ↑ and OI ↓</span>
              <small>Existing sellers are closing positions. Can support a rebound.</small>
            </div>
          </div>
          <div className="oi-history__futures-volume-note">
            <strong>Active volume:</strong> today’s volume is at least the average of the previous five trading days. This indicates stronger participation, not direction by itself.
          </div>
        </div>
      )}
      {futuresView === 'chart' && futuresChart ? (
        <div className="oi-history__chart-wrap oi-history__chart-wrap--futures">
          <div className="oi-history__chart-header">
            <div className="oi-history__chart-title">Futures Price History</div>
          </div>
          <svg className="oi-history__chart-svg" viewBox={`0 0 ${futuresChart.width} ${futuresChart.height}`} role="img" aria-label={`${scrip} futures price chart by month`}>
            {[0, 0.5, 1].map((fraction) => {
              const y = futuresChart.top + fraction * futuresChart.plotHeight;
              const value = futuresChart.high - fraction * (futuresChart.high - futuresChart.low);
              return (
                <g key={fraction}>
                  <line x1={futuresChart.left} x2={futuresChart.width - futuresChart.right} y1={y} y2={y} stroke="var(--card-border)" strokeWidth="0.5" />
                  <text x={futuresChart.left - 4} y={y + 3} textAnchor="end" fontSize="6" fill="var(--text-secondary)">{value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</text>
                </g>
              );
            })}
            <line x1={futuresChart.left} x2={futuresChart.width - futuresChart.right} y1={futuresChart.top + futuresChart.plotHeight} y2={futuresChart.top + futuresChart.plotHeight} stroke="var(--text-secondary)" strokeWidth="0.5" opacity="0.5" />
            <line x1={futuresChart.left} x2={futuresChart.width - futuresChart.right} y1={futuresChart.top + futuresChart.plotHeight} y2={futuresChart.top + futuresChart.plotHeight} stroke="var(--text-secondary)" strokeWidth="0.5" opacity="0.5" />
            {futuresChart.days.map((day) => {
              const slotWidth = futuresChart.plotWidth / futuresChart.days.length;
              const barWidth = Math.min(slotWidth * 0.32, 6);
              const oiHeight = (day.oi / futuresChart.maxOi) * futuresChart.plotHeight;
              const volumeHeight = (day.volume / futuresChart.maxVolume) * futuresChart.plotHeight;
              return (
                <g key={`bars-${day.date}`} onMouseEnter={() => setFuturesHover(day)} onMouseLeave={() => setFuturesHover(null)}>
                  <rect x={day.x - barWidth} y={futuresChart.top + futuresChart.plotHeight - oiHeight} width={Math.max(barWidth, 0.5)} height={oiHeight} fill="#8b5cf6" opacity="0.45" rx="1" />
                  <rect x={day.x} y={futuresChart.top + futuresChart.plotHeight - volumeHeight} width={Math.max(barWidth, 0.5)} height={volumeHeight} fill="#06b6d4" opacity="0.45" rx="1" />
                </g>
              );
            })}
            {futuresChart.lines.map((line) => (
              <g key={`line-${line.expiry}`}>
                <polyline points={line.points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke={line.color} strokeWidth="1.2" strokeLinejoin="round" />
                {line.points.map((point) => (
                  <circle key={point.date} cx={point.x} cy={point.y} r="2.5" fill={line.color} onMouseEnter={() => setFuturesHover(futuresChart.days.find((day) => day.date === point.date) || null)} onMouseLeave={() => setFuturesHover(null)} />
                ))}
              </g>
            ))}
            {futuresHover && (() => {
              const tooltipWidth = 150;
              const tooltipHeight = 28 + futuresHover.closes.length * 12;
              const tooltipX = Math.min(Math.max(futuresHover.x - tooltipWidth / 2, futuresChart.left), futuresChart.width - futuresChart.right - tooltipWidth);
              return (
                <g pointerEvents="none">
                  <rect x={tooltipX} y={futuresChart.top + 3} width={tooltipWidth} height={tooltipHeight} rx="3" fill="var(--card-bg-solid, #111827)" stroke="var(--card-border)" />
                  <text x={tooltipX + 7} y={futuresChart.top + 14} fontSize="8" fill="var(--text-primary)">{formatFullDateLabel(futuresHover.date)}</text>
                  {futuresHover.closes.map((item, index) => (
                    <text key={item.label} x={tooltipX + 7} y={futuresChart.top + 26 + index * 12} fontSize="8" fill={item.color}>{item.label}: {item.close.toLocaleString('en-IN')}</text>
                  ))}
                  <text x={tooltipX + 7} y={futuresChart.top + 26 + futuresHover.closes.length * 12} fontSize="8" fill="var(--text-secondary)">Total OI: {formatOiCompact(futuresHover.oi)} · Vol: {formatOiCompact(futuresHover.volume)}</text>
                </g>
              );
            })()}
            <ChartXAxis dates={futuresChart.days.map((day) => day.date)} padL={futuresChart.left} plotW={futuresChart.plotWidth} h={futuresChart.height} />
          </svg>
          <div className="oi-history__chart-legend">
            <span className="oi-history__chart-legend-item"><span className="oi-history__chart-legend-swatch" style={{ background: '#8b5cf6' }} /> Total OI</span>
            <span className="oi-history__chart-legend-item"><span className="oi-history__chart-legend-swatch" style={{ background: '#06b6d4' }} /> Total volume</span>
            {futuresChart.lines.map((line) => (
              <span key={line.expiry} className="oi-history__chart-legend-item" title={line.tradingsymbol}><span className="oi-history__chart-legend-swatch" style={{ background: line.color }} /> {line.label}</span>
            ))}
          </div>
        </div>
      ) : futuresDateRows.length === 0 ? (
        <div className="oi-history__status">No futures data for {filterDate ? formatFullDateLabel(filterDate) : 'the selected date'}.</div>
      ) : (
      <div className="oi-history__table-scroll">
        <table className="oi-history__table oi-history__futures-table">
          <thead><tr>
            <th className="oi-history__futures-th--date">Month</th>
            <th className="oi-history__futures-th--price">Close</th>
            <th className="oi-history__futures-th--price">Price</th>
            <th className="oi-history__futures-th--oi">OI</th>
            <th className="oi-history__futures-th--oi">OI change</th>
            <th className="oi-history__futures-th--volume">Volume</th>
            <th className="oi-history__futures-th--signal">Signal</th>
          </tr></thead>
          <tbody>{futuresDateRows.map((row) => (
            <tr key={row.expiry}>
              <td className="oi-history__futures-date" title={row.tradingsymbol}>{formatMonthLabel(row.expiry.slice(0, 7))}</td>
              <td className="oi-history__futures-close">{row.close?.toLocaleString('en-IN') || '-'}</td>
              <td className={row.priceChangePct !== null && row.priceChangePct >= 0 ? 'oi-history__futures-positive' : 'oi-history__futures-negative'}>
                <span className="oi-history__cell-primary">{row.priceChangePct === null ? '-' : `${row.priceChangePct >= 0 ? '+' : ''}${row.priceChangePct.toFixed(2)}%`}</span>
              </td>
              <td className="oi-history__futures-oi">{row.oi?.toLocaleString('en-IN') || '-'}</td>
              <td className={row.oiChangePct !== null && row.oiChangePct >= 0 ? 'oi-history__futures-positive' : 'oi-history__futures-negative'}>
                <span className="oi-history__cell-primary">{row.oiChangePct === null ? '-' : `${row.oiChangePct >= 0 ? '+' : ''}${row.oiChangePct.toFixed(2)}%`}</span>
              </td>
              <td className="oi-history__futures-volume">{row.volume?.toLocaleString('en-IN') || '-'}</td>
              <td className={`oi-history__futures-signal ${row.interpretation === 'Long buildup' || row.interpretation === 'Short covering' ? 'oi-history__futures-signal--bullish' : row.interpretation === 'Short buildup' || row.interpretation === 'Long unwinding' ? 'oi-history__futures-signal--bearish' : ''}`}>
                {row.interpretation}{row.avgVolume && row.volume >= row.avgVolume ? ' · active volume' : ''}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      )}
    </div>
  );
};
