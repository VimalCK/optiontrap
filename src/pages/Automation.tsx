/**
 * Automated trades and their lifecycle (selected → validated → executed → closed).
 * Rules: shared/automation.js; strategies: GET /api/strategies.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { marketDate } from '../../shared/marketTime.js';
import { rangeProblem } from '@/components/TradeJournal/journalRange';
import IconButton from '@/components/IconButton/IconButton';
import EmptyState from '@/components/EmptyState/EmptyState';
import DateRangePicker, { type DateRange } from '@/components/DateRangePicker/DateRangePicker';
import Badge from '@/components/Badge/Badge';
import TradeHorizon from '@/components/TradeSource/TradeHorizon';
import { AnalyticsIcon, AutomationIcon, ChevronDownIcon, SettingsIcon } from '@/components/icons/Icons';
import {
  closedPnl, eventSummary, sideLabel, sideTone, stageIsLive, stageLabel, stageTone, stepTone, tradesByDay, type TradeDay,
} from '@/components/Automation/autoTradeView';
import { AutomationConfig, AutoTrade, fetchAutomationConfig, fetchAutoTrades } from '@/services/automation';
import { isAbortError } from '@/services/apiClient';
import { useStrategies } from '@/hooks/useStrategies';
import type { StrategyInfo } from '@/services/strategies';
import { formatAmount, formatSignedAmount } from '@/utils/formatAmount';
import { formatCalendarDate, istTimeLabel } from '@/utils/marketStatus';
import { AnalyticsTab, MessageTone } from '@/utils/uiEnums';
import Message from '@/components/Message/Message';
import '@/styles/automation.css';
import LoadingState from '@/components/LoadingState/LoadingState';

const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);


const price = (value: number | null) => (value == null ? '–' : formatAmount(value));

const dayLabel = (day: string) => formatCalendarDate(day, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const tradeCount = (n: number) => `${n} ${n === 1 ? 'trade' : 'trades'}`;
const eventTime = (at: string) => istTimeLabel(new Date(at));

/** Wait this long after the last range change before fetching. */
const FETCH_DELAY_MS = 400;

const TRADE_COLUMNS = 9;
/** Columns before P&L, so a day's P&L lines up under it. */
const PNL_COLUMN = 6;

const PnlCell: React.FC<{ pnl: number | null }> = ({ pnl }) => {
  const tone = pnl == null ? '' : pnl >= 0 ? ' automation-trades__pnl--profit' : ' automation-trades__pnl--loss';
  return <td className={`automation-trades__num${tone}`}>{pnl == null ? '–' : formatSignedAmount(pnl)}</td>;
};

/** One trade's lifecycle, oldest first, as a timeline of plain sentences. */
const TradeTimeline: React.FC<{ trade: AutoTrade }> = ({ trade }) => {
  const { strategies } = useStrategies();
  return (
  <ol className="automation-timeline">
    {trade.events.map((event, i) => (
      <li key={i} className={`automation-timeline__step automation-timeline__step--${stepTone(event.stage).toLowerCase()}`}>
        <span className="automation-timeline__marker" aria-hidden="true" />
        <div className="automation-timeline__body">
          <div className="automation-timeline__head">
            <Badge tone={stepTone(event.stage)}>{stageLabel(event.stage)}</Badge>
          </div>
          <p className="automation-timeline__text">{eventSummary(event, strategies ?? [])}</p>
        </div>
      </li>
    ))}
  </ol>
  );
};

/** One trade's row; clicking it (or its chevron) shows the lifecycle beneath. */
export const TradeRow: React.FC<{ trade: AutoTrade; open: boolean; onToggle: () => void }> = ({ trade: t, open, onToggle }) => {
  return (
    <>
      <tr className={`automation-trades__row${open ? ' automation-trades__row--open' : ''}`} onClick={onToggle}>
        <td><span className="automation-trades__time">{eventTime(t.createdAt)}</span></td>
        <td>
          <span className="automation-trades__symbol">
            {t.tradingsymbol}
            <TradeHorizon horizon={t.horizon} />
          </span>
        </td>
        <td><Badge tone={sideTone(t.side)}>{sideLabel(t.side)}</Badge></td>
        <td className="automation-trades__num">{t.quantity}</td>
        <td className="automation-trades__num">{price(t.entryPrice)}</td>
        <td className="automation-trades__num">{price(t.exitPrice)}</td>
        <PnlCell pnl={closedPnl(t)} />
        <td className="automation-trades__stage"><Badge tone={stageTone(t.stage)} dot={stageIsLive(t.stage)}>{stageLabel(t.stage)}</Badge></td>
        <td className="automation-trades__toggle" onClick={(e) => e.stopPropagation()}>
          <IconButton
            icon={<ChevronDownIcon />}
            label={open ? 'Hide lifecycle' : 'Show lifecycle'}
            expanded={open}
            onClick={onToggle}
            className="automation-trades__chevron"
          />
        </td>
      </tr>
      {open && (
        <tr className="automation-trades__details">
          <td colSpan={TRADE_COLUMNS}><TradeTimeline trade={t} /></td>
        </tr>
      )}
    </>
  );
};

/** A day's heading row; clicking it hides or shows that day's trades. */
export const DayRow: React.FC<{ group: TradeDay; expanded: boolean; onToggle: () => void }> = ({ group, expanded, onToggle }) => (
  <tr className={`automation-trades__day${expanded ? '' : ' automation-trades__day--collapsed'}`} onClick={onToggle}>
    <th scope="colgroup" colSpan={PNL_COLUMN}>
      {dayLabel(group.day)}
      <span className="automation-trades__day-count"> · {tradeCount(group.trades.length)}</span>
    </th>
    <PnlCell pnl={group.pnl} />
    <td />
    <td className="automation-trades__toggle" onClick={(e) => e.stopPropagation()}>
      <IconButton
        icon={<ChevronDownIcon />}
        label={expanded ? "Hide this day's trades" : "Show this day's trades"}
        expanded={expanded}
        onClick={onToggle}
        className="automation-trades__chevron"
      />
    </td>
  </tr>
);

export const AutoTradesTable: React.FC<{ trades: AutoTrade[]; loading?: boolean; error?: string | null; controls?: React.ReactNode }> = ({ trades, loading, error, controls }) => {
  const [open, setOpen] = useState<string | null>(null);
  // Every day starts expanded; these are the ones the user folded away.
  const [collapsedDays, setCollapsedDays] = useState<ReadonlySet<string>>(() => new Set());
  const toggleDay = (day: string) => setCollapsedDays((days) => {
    const next = new Set(days);
    if (!next.delete(day)) next.add(day);
    return next;
  });

  return (
    <section className="card automation-trades-card" aria-labelledby="automation-trades-title">
      <div className="automation-section__head">
        <h3 id="automation-trades-title" className="card__title">Automated trades</h3>
        {controls}
      </div>
      {error && <Message tone={MessageTone.Error}>{error}</Message>}
      {loading && <LoadingState />}
      {!loading && !error && trades.length === 0 && (
        <EmptyState
          icon={<AutomationIcon size={64} />}
          title="No automated trades in this range"
          description="Each one will show here with every stage of its lifecycle."
        />
      )}
      {trades.length > 0 && (
        <div className="automation-trades__scroll">
          <table className="automation-table automation-trades">
            <thead>
              <tr>
                <th>Time</th>
                <th>Instrument</th>
                <th>Side</th>
                <th className="automation-trades__num">Qty</th>
                <th className="automation-trades__num">Entry</th>
                <th className="automation-trades__num">Exit</th>
                <th className="automation-trades__num">P&amp;L</th>
                <th className="automation-trades__stage">Stage</th>
                <th><span className="automation-trades__sr">Lifecycle</span></th>
              </tr>
            </thead>
            {tradesByDay(trades).map((group) => (
              <tbody key={group.day}>
                <DayRow group={group} expanded={!collapsedDays.has(group.day)} onToggle={() => toggleDay(group.day)} />
                {!collapsedDays.has(group.day) && group.trades.map((t) => (
                  <TradeRow key={t.id} trade={t} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} />
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </section>
  );
};

/** "On" or "Off", and whether anything can trade: a strategy must exist and be active. */
export function automationStatus(config: AutomationConfig | null, strategies: Pick<StrategyInfo, 'id'>[] | null): string {
  if (!config || !strategies) return 'Loading…';
  const onOff = config.enabled ? 'On' : 'Off';
  if (strategies.length === 0) return `${onOff} · no strategies yet, nothing trades`;
  const active = strategies.filter((s) => config.strategies[s.id]?.active).length;
  if (active === 0) return `${onOff} · no strategy active`;
  return `${onOff} · ${active} strateg${active === 1 ? 'y' : 'ies'} active`;
}

const Automation: React.FC = () => {
  const navigate = useNavigate();
  const [config, setConfig] = useState<AutomationConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const { strategies, error: strategiesError } = useStrategies();
  // Opens on today's trades; From / To fetches any other range.
  const [range, setRange] = useState<DateRange>(() => ({ from: marketDate(), to: marketDate() }));
  const [trades, setTrades] = useState<AutoTrade[]>([]);
  const [tradesLoading, setTradesLoading] = useState(true);
  const [tradesError, setTradesError] = useState<string | null>(null);
  const problem = rangeProblem(range.from, range.to);

  useEffect(() => {
    const controller = new AbortController();
    fetchAutomationConfig(controller.signal)
      .then(setConfig)
      .catch((err) => { if (!isAbortError(err)) setConfigError(errorText(err, 'Could not load the settings')); });
    return () => controller.abort();
  }, []);

  // Fetch exactly the range picked, shortly after the last change to it.
  useEffect(() => {
    if (problem) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setTradesLoading(true);
      setTradesError(null);
      fetchAutoTrades(range, controller.signal)
        .then(setTrades)
        .catch((err) => { if (!isAbortError(err)) setTradesError(errorText(err, 'Could not load automated trades')); })
        .finally(() => { if (!controller.signal.aborted) setTradesLoading(false); });
    }, FETCH_DELAY_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [range, problem]);

  return (
    <div className="automation automation--trades">
      <header className="automation-header">
        <h1 className="automation-header__title">Algo Trading</h1>
        <span className="automation-header__status">{configError || strategiesError ? 'Settings could not be loaded' : automationStatus(config, strategies)}</span>
      </header>

      <AutoTradesTable
        trades={trades}
        loading={tradesLoading && !problem}
        error={problem ?? tradesError}
        controls={(
          <div className="automation-section__actions">
            <DateRangePicker range={range} onChange={setRange} />
            <IconButton
              icon={<AnalyticsIcon size={18} />}
              label="Win/Loss Patterns"
              onClick={() => navigate(`/analytics?tab=${AnalyticsTab.WinLoss}`)}
            />
            <IconButton
              icon={<SettingsIcon size={18} />}
              label="Algo Trading settings"
              onClick={() => navigate('/automation/settings')}
            />
          </div>
        )}
      />
    </div>
  );
};

export default Automation;