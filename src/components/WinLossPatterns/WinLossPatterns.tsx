/**
 * P&L is after each trade's charges (shared/tradeCharges.js), at the bid / ask fills
 * paper trading uses.
 */
import React, { useEffect, useState } from 'react';
import { addDays, marketDate } from '../../../shared/marketTime.js';
import DateRangePicker, { type DateRange } from '@/components/DateRangePicker/DateRangePicker';
import { rangeProblem } from '@/components/TradeJournal/journalRange';
import { type AutoTradeResults, type ResultGroup, fetchAutoTradeResults } from '@/services/automation';
import { isAbortError } from '@/services/apiClient';
import { useStrategies } from '@/hooks/useStrategies';
import { formatAmount, formatSignedAmount } from '@/utils/formatAmount';
import {
  averageLoss, averagePnl, averageWin, dailyBars, dayLabel, entrySlotLabel, shortDayLabel, exitRuleLabel, profitFactor, setupName,
  sideName, strategyName, winRate,
} from './winLossStats';
import '@/styles/winLoss.css';
import Message from '@/components/Message/Message';
import { MessageTone, ShimmerShape } from '@/utils/uiEnums';
import Shimmer, { ShimmerGroup, ShimmerTableRows, shimmerKeys } from '@/components/Shimmer/Shimmer';

const FETCH_DELAY_MS = 400;
/** The range it opens on: the last 30 IST days, today included. */
const DEFAULT_RANGE_DAYS = 30;

/** The summary's headline figures and smaller stats, named once for the results and their placeholder. */
const KPI = { pnl: 'Total P&L', winRate: 'Win rate', profitFactor: 'Profit factor', drawdown: 'Max drawdown' };
const STAT = { avgWin: 'Avg win', avgLoss: 'Avg loss', best: 'Best trade', worst: 'Worst trade', charges: 'Charges paid' };
const BREAKDOWN_COLUMN_COUNT = 5;
/** Placeholder breakdown panels and rows in each while the results load. */
const PLACEHOLDER_PANELS = 4;
const PLACEHOLDER_ROWS = 3;

const dash = '–';
const amount = (value: number | null) => (value === null ? dash : formatSignedAmount(value));
const percent = (value: number | null) => (value === null ? dash : `${value.toFixed(1)}%`);
const ratio = (value: number | null) => (value === null ? dash : value.toFixed(2));

const toneClass = (value: number | null) => (value === null || value === 0 ? '' : value > 0 ? 'winloss--profit' : 'winloss--loss');

/** Wins and losses as one thin bar; breakeven trades are the rest. */
const WinLossBar: React.FC<{ group: ResultGroup<unknown> }> = ({ group }) => {
  const share = (n: number) => (group.trades > 0 ? (n / group.trades) * 100 : 0);
  return (
    <span className="winloss-bar" aria-hidden="true">
      <span className="winloss-bar__wins" style={{ width: `${share(group.wins)}%` }} />
      <span className="winloss-bar__losses" style={{ width: `${share(group.losses)}%` }} />
    </span>
  );
};

const Kpi: React.FC<{ label: string; value: React.ReactNode; tone?: number | null; note: React.ReactNode }> = ({ label, value, tone = null, note }) => (
  <div className="winloss-kpi">
    <span className="winloss-kpi__label">{label}</span>
    <span className={`winloss-kpi__value ${toneClass(tone)}`}>{value}</span>
    <span className="winloss-kpi__note">{note}</span>
  </div>
);

const Stat: React.FC<{ label: string; value: React.ReactNode; tone?: number | null }> = ({ label, value, tone = null }) => (
  <div className="winloss-stat">
    <span className="winloss-stat__label">{label}</span>
    <span className={`winloss-stat__value ${toneClass(tone)}`}>{value}</span>
  </div>
);

const ResultsSummary: React.FC<{ results: AutoTradeResults }> = ({ results: { summary, maxDrawdown } }) => (
  <div className="winloss-summary">
    <div className="winloss-kpis">
      <Kpi label={KPI.pnl} value={amount(summary.pnl)} tone={summary.pnl} note={`${summary.trades} closed trades`} />
      <Kpi label={KPI.winRate} value={percent(winRate(summary))}
        note={<><WinLossBar group={summary} />{summary.wins} won · {summary.losses} lost</>} />
      <Kpi label={KPI.profitFactor} value={ratio(profitFactor(summary))} note="Gross profit ÷ gross loss" />
      <Kpi label={KPI.drawdown} value={maxDrawdown > 0 ? formatAmount(-maxDrawdown) : dash} tone={-maxDrawdown} note="Biggest fall from a peak" />
    </div>
    <div className="winloss-stats">
      <Stat label={STAT.avgWin} value={amount(averageWin(summary))} tone={averageWin(summary)} />
      <Stat label={STAT.avgLoss} value={amount(averageLoss(summary))} tone={averageLoss(summary)} />
      <Stat label={STAT.best} value={amount(summary.best)} tone={summary.best} />
      <Stat label={STAT.worst} value={amount(summary.worst)} tone={summary.worst} />
      <Stat label={STAT.charges} value={formatAmount(summary.charges)} />
    </div>
  </div>
);

function BreakdownTable<K>({ title, column, groups, label }: {
  title: string; column: string; groups: ResultGroup<K>[]; label: (key: K) => string;
}) {
  return (
    <section className="winloss-panel">
      <h4 className="winloss-panel__title">{title}</h4>
      <div className="winloss-panel__scroll">
        <table className="winloss-table">
          <thead className="sticky-head">
            <tr><th>{column}</th><th>Trades</th><th>Win rate</th><th>P&amp;L</th><th>Avg P&amp;L</th></tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={String(g.key)}>
                <td>{label(g.key)}</td>
                <td>{g.trades}</td>
                <td><span className="winloss-table__rate">{percent(winRate(g))}<WinLossBar group={g} /></span></td>
                <td className={toneClass(g.pnl)}>{amount(g.pnl)}</td>
                <td className={toneClass(averagePnl(g))}>{amount(averagePnl(g))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export const DailyPnl: React.FC<{ days: AutoTradeResults['byDay'] }> = ({ days }) => {
  const bars = dailyBars(days);
  const hasLosses = days.some((d) => d.pnl < 0);
  const sides = !hasLosses ? '' : days.some((d) => d.pnl > 0) ? ' winloss-chart--both' : ' winloss-chart--losses';
  const total = bars.length > 0 ? bars[bars.length - 1].total : 0;
  return (
    <section className="winloss-panel winloss-panel--wide">
      <div className="winloss-panel__head">
        <h4 className="winloss-panel__title">Daily P&amp;L</h4>
        <span className="winloss-panel__aside">
          <span className={toneClass(total)}>{amount(total)}</span> over {days.length} day{days.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className={`winloss-chart${sides}`} role="img"
        aria-label={`Daily P&L for ${days.length} days, ${amount(total)} in all`}>
        {bars.map((d) => (
          <div key={d.key} className="winloss-chart__day"
            title={`${dayLabel(d.key)}\nP&L ${amount(d.pnl)} · ${d.trades} trades\nRunning total ${amount(d.total)}`}>
            <div className="winloss-chart__up">
              {d.pnl > 0 && <span className="winloss-chart__bar winloss-chart__bar--profit" style={{ height: `${d.height}%` }} />}
            </div>
            <div className="winloss-chart__down">
              {d.pnl < 0 && <span className="winloss-chart__bar winloss-chart__bar--loss" style={{ height: `${d.height}%` }} />}
            </div>
            <span className="winloss-chart__label">{d.labelled ? shortDayLabel(d.key) : ''}</span>
          </div>
        ))}
      </div>
      <details className="winloss-details">
        <summary>Show as table</summary>
        <table className="winloss-table">
          <thead className="sticky-head">
            <tr><th>Day</th><th>Trades</th><th>Win rate</th><th>P&amp;L</th><th>Running total</th></tr>
          </thead>
          <tbody>
            {bars.map((d) => (
              <tr key={d.key}>
                <td>{dayLabel(d.key)}</td>
                <td>{d.trades}</td>
                <td>{percent(winRate(d))}</td>
                <td className={toneClass(d.pnl)}>{amount(d.pnl)}</td>
                <td className={toneClass(d.total)}>{amount(d.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
};

/** The results' summary and panels in outline while they load: real labels, shimmering figures, tables and chart. */
const ResultsShimmer: React.FC = () => (
  <ShimmerGroup label="Loading results">
    <div className="winloss-summary">
      <div className="winloss-kpis">
        {Object.values(KPI).map((label) => <Kpi key={label} label={label} value={<Shimmer width="5em" />} note={<Shimmer width="70%" />} />)}
      </div>
      <div className="winloss-stats">
        {Object.values(STAT).map((label) => <Stat key={label} label={label} value={<Shimmer width="4em" />} />)}
      </div>
    </div>
    <div className="winloss-panels">
      <section className="winloss-panel winloss-panel--wide">
        <h4 className="winloss-panel__title">Daily P&amp;L</h4>
        <Shimmer shape={ShimmerShape.Block} className="winloss-chart-shimmer" />
      </section>
      {shimmerKeys(PLACEHOLDER_PANELS).map((panel) => (
        <section key={panel} className="winloss-panel">
          <h4 className="winloss-panel__title"><Shimmer width="7em" /></h4>
          <table className="winloss-table">
            <tbody><ShimmerTableRows rows={PLACEHOLDER_ROWS} columns={BREAKDOWN_COLUMN_COUNT} /></tbody>
          </table>
        </section>
      ))}
    </div>
  </ShimmerGroup>
);

export const ResultsView: React.FC<{ results: AutoTradeResults }> = ({ results }) => {
  const { strategies } = useStrategies();
  return (
  <>
    <ResultsSummary results={results} />
    <div className="winloss-panels">
      <DailyPnl days={results.byDay} />
      <BreakdownTable title="By setup" column="Setup" groups={results.bySetup} label={setupName} />
      <BreakdownTable title="By exit" column="Closed by" groups={results.byExitRule} label={exitRuleLabel} />
      <BreakdownTable title="By entry time (IST)" column="Entered" groups={results.byEntrySlot} label={entrySlotLabel} />
      <BreakdownTable title="By strategy" column="Strategy" groups={results.byStrategy} label={(id) => strategyName(id, strategies ?? [])} />
      <BreakdownTable title="By side" column="Side" groups={results.bySide} label={sideName} />
    </div>
  </>
  );
};

const WinLossPatterns: React.FC = () => {
  const [range, setRange] = useState<DateRange>(() => ({ from: addDays(marketDate(), 1 - DEFAULT_RANGE_DAYS), to: marketDate() }));
  const [results, setResults] = useState<AutoTradeResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const problem = rangeProblem(range.from, range.to);

  // Fetch exactly the range picked, shortly after the last change to it.
  useEffect(() => {
    if (problem) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      fetchAutoTradeResults(range, controller.signal)
        .then(setResults)
        .catch((err) => { if (!isAbortError(err)) setError(err instanceof Error ? err.message : 'Could not load the results'); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, FETCH_DELAY_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [range, problem]);

  const message = problem ?? error;
  return (
    <section className="card winloss" aria-labelledby="winloss-title">
      <div className="winloss__head">
        <div>
          <h3 id="winloss-title" className="card__title">Win/Loss Patterns</h3>
          <p className="card__description">Closed automated trades entered in this range · P&amp;L after charges</p>
        </div>
        <DateRangePicker range={range} onChange={setRange} />
      </div>
      {message && <Message tone={MessageTone.Error}>{message}</Message>}
      {!message && loading && <ResultsShimmer />}
      {!message && !loading && results?.summary.trades === 0 && (
        <p className="winloss__empty">No closed automated trades in this range.</p>
      )}
      {!message && !loading && results && results.summary.trades > 0 && <ResultsView results={results} />}
    </section>
  );
};

export default WinLossPatterns;
