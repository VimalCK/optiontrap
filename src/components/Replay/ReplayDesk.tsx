import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppSelect from '@/components/AppSelect/AppSelect';
import Message from '@/components/Message/Message';
import { PauseIcon, PlayIcon } from '@/components/icons/Icons';
import { IndexChart, OiFlowChart, PremiumChart, type ChartMark } from './ReplayCharts';
import {
  advance, atmStrike, canBuy, oiFlow, oiSinceOpen, optionSeries, parseLots, placeEntry, placeExit, positionValue, startState,
  type ClosedTrade, type ReplayPosition, type ReplayState,
} from './replayEngine';
import { REPLAY_REASONS, replayReasonLabel, type ReplayReasonId } from '../../../shared/appEnums.js';
import { replayTradeResult } from '../../../shared/replay.js';
import { OptionType, type OptionTypeId } from '../../../shared/tradeEnums.js';
import { finishReplaySession, saveReplayTrade, type ReplayDay, type ReplaySession } from '@/services/replay';
import { formatAmount, formatSignedAmount, formatSignedRupees } from '@/utils/formatAmount';
import { MessageTone } from '@/utils/uiEnums';

/** Real-time milliseconds per replayed minute. */
const SPEEDS = [
  { value: 3000, label: '1 min / 3 s' },
  { value: 1500, label: '1 min / 1.5 s' },
  { value: 800, label: '1 min / 0.8 s' },
  { value: 400, label: '1 min / 0.4 s' },
];
const DEFAULT_SPEED = 1500;
const SKIP_MINUTES = 10;
const CHART_HEIGHT = { index: 380, premium: 150, flow: 120 };
const NO_READING = '– · –';

const signedClass = (value: number) => (value >= 0 ? 'replay--profit' : 'replay--loss');
const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);

interface ReplayDeskProps {
  day: ReplayDay;
  session: ReplaySession;
  onFinished: (session: ReplaySession) => void;
}

/** Plays a day minute by minute with an order ticket; each closed trade is saved to the session. */
const ReplayDesk: React.FC<ReplayDeskProps> = ({ day, session, onFinished }) => {
  const [state, setState] = useState<ReplayState>(startState);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [lots, setLots] = useState('1');
  const [reasons, setReasons] = useState<ReplayReasonId[]>([]);
  const [note, setNote] = useState('');
  const [tagged, setTagged] = useState<{ reasons: ReplayReasonId[]; note: string }[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saves = useRef<Promise<unknown>>(Promise.resolve());
  const saved = useRef(0);
  const finishedSent = useRef(false);
  const tags = useRef({ reasons, note });
  tags.current = { reasons, note };

  const flow = useMemo(() => day.times.map((_, minute) => oiFlow(day, minute)), [day]);
  const sinceOpen = useMemo(() => day.times.map((_, minute) => oiSinceOpen(day, minute)), [day]);

  const step = useCallback(() => setState((s) => advance(day, s)), [day]);

  useEffect(() => {
    if (!playing || state.finished) return undefined;
    const timer = setInterval(step, speed);
    return () => clearInterval(timer);
  }, [playing, speed, step, state.finished]);

  // Each trade closed by the replay is saved with the tags and note the player had given it, in order.
  useEffect(() => {
    const fresh = state.closed.slice(saved.current);
    if (!fresh.length) return;
    saved.current = state.closed.length;
    const { reasons: tradeReasons, note: tradeNote } = tags.current;
    setTagged((list) => [...list, ...fresh.map(() => ({ reasons: tradeReasons, note: tradeNote }))]);
    setReasons([]);
    setNote('');
    for (const trade of fresh) {
      saves.current = saves.current.then(() => saveReplayTrade(session.id, { ...trade, reasons: tradeReasons, note: tradeNote.trim() || null }))
        .catch((err: Error) => setSaveError(`A trade wasn't saved: ${err.message}`));
    }
  }, [state.closed, session.id]);

  useEffect(() => {
    if (!state.finished || finishedSent.current) return;
    finishedSent.current = true;
    setPlaying(false);
    saves.current = saves.current.then(() => finishReplaySession(session.id)).then(onFinished)
      .catch((err: Error) => setSaveError(`The session wasn't closed: ${err.message}`));
  }, [state.finished, session.id, onFinished]);

  const lotCount = parseLots(lots);
  const buy = useCallback((optionType: OptionTypeId) => {
    if (lotCount == null) return;
    setState((s) => advance(day, placeEntry(day, s, optionType, lotCount)));
  }, [day, lotCount]);
  const exit = useCallback(() => setState((s) => advance(day, placeExit(s))), [day]);
  const skip = () => { setPlaying(false); setState((s) => Array.from({ length: SKIP_MINUTES }).reduce<ReplayState>((acc) => advance(day, acc), s)); };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === 'Space') { event.preventDefault(); setPlaying((p) => !p); }
      else if (event.key === 'ArrowRight') { setPlaying(false); step(); }
      else if (event.key.toLowerCase() === 'c') buy(OptionType.CE);
      else if (event.key.toLowerCase() === 'p') buy(OptionType.PE);
      else if (event.key.toLowerCase() === 'x') exit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [buy, exit, step]);

  const { minute, position } = state;
  const atm = atmStrike(day, minute);
  const bar = day.index[minute];
  const change = bar[3] - (day.prevClose ?? day.index[0][0]);
  const value = position ? positionValue(day, position, minute) : null;
  const marks: ChartMark[] = [
    ...state.closed.flatMap((t) => [
      { minute: day.times.indexOf(t.entryTime), optionType: t.optionType, entry: true },
      { minute: day.times.indexOf(t.exitTime), optionType: t.optionType, entry: false },
    ]),
    ...(position ? [{ minute: position.entryMinute, optionType: position.optionType, entry: true }] : []),
  ];
  const premiumStrike = position?.strike ?? atm;
  const quote = (optionType: OptionTypeId) => optionSeries(day, optionType, atm)?.[minute]?.[1];
  const progress = day.times.length > 1 ? (minute / (day.times.length - 1)) * 100 : 100;

  return (
    <div className="replay-desk">
      <div className="replay-card replay-desk__strip">
        <section className="replay-desk__block" aria-labelledby="replay-ticket">
          <h3 className="replay-card__title" id="replay-ticket">Expiry {day.expiry}</h3>
          <div className="replay-ticket">
            {[OptionType.CE, OptionType.PE].map((optionType) => (
              <button
                key={optionType}
                type="button"
                className={`replay-ticket__buy replay-ticket__buy--${optionType.toLowerCase()}`}
                onClick={() => buy(optionType)}
                disabled={lotCount == null || !canBuy(day, state, optionType)}
              >
                <span className="replay-ticket__side">Buy {optionType}</span>
                <span className="replay-ticket__price">{formatAmount(quote(optionType) ?? 0)}</span>
                <small>Strike {atm}</small>
              </button>
            ))}
          </div>
          <div className="replay-ticket__lots">
            <span>Lot size <strong>{day.lotSize}</strong></span>
            <input type="number" min={1} step={1} value={lots} onChange={(e) => setLots(e.target.value)} aria-label="Lots" />
            <span className="replay-ticket__total">Total <strong>{lotCount == null ? '–' : lotCount * day.lotSize}</strong></span>
          </div>
          {lotCount == null && <Message tone={MessageTone.Error} className="replay-ticket__message">Lots must be a whole number of 1 or more.</Message>}
        </section>

        <section className="replay-desk__block" aria-labelledby="replay-position">
          <h3 className="replay-card__title" id="replay-position">Position</h3>
          <PositionSummary held={position && value ? { position, value } : null} exitWaiting={Boolean(state.pending)} onExit={exit} />
        </section>

        <section className="replay-desk__block replay-desk__block--reasons" aria-labelledby="replay-reasons">
          <h3 className="replay-card__title" id="replay-reasons">Why this trade (optional)</h3>
          <div className="replay-reasons">
            {REPLAY_REASONS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={`replay-reasons__chip${reasons.includes(id) ? ' replay-reasons__chip--on' : ''}`}
                aria-pressed={reasons.includes(id)}
                onClick={() => setReasons((list) => (list.includes(id) ? list.filter((r) => r !== id) : [...list, id]))}
              >
                {label}
              </button>
            ))}
          </div>
          <textarea aria-label="What did you see?" className="replay-reasons__note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you see? e.g. held the low twice, puts being written" rows={2} />
        </section>
      </div>

      <section className="replay-card replay-desk__charts" aria-label="Charts">
        <div className="replay-desk__bar">
          <div className="replay-desk__clock">
            <span className="replay-desk__time">{day.times[minute]}</span>
            <span className="replay-desk__zone">IST</span>
          </div>
          <button type="button" className="app-btn app-btn--primary replay-desk__play" onClick={() => setPlaying((p) => !p)} disabled={state.finished}>
            {playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
            {playing ? 'Pause' : 'Play'}
          </button>
          <div className="replay-desk__steps">
            <button type="button" className="replay-desk__step" onClick={() => { setPlaying(false); step(); }} disabled={state.finished}>+1 min</button>
            <button type="button" className="replay-desk__step" onClick={skip} disabled={state.finished}>+{SKIP_MINUTES} min</button>
          </div>
          <AppSelect value={speed} options={SPEEDS} onChange={(v) => setSpeed(Number(v))} ariaLabel="Replay speed" className="replay-desk__speed" />
        </div>
        <div className="replay-desk__progress" role="progressbar" aria-label="Session played" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
          <span style={{ width: `${progress}%` }} />
        </div>

        <div className="replay-panel">
          <div className="replay-panel__head">
            <span className="replay-panel__value">
              <strong>{formatAmount(bar[3])}</strong>
              <span className={`replay-panel__change ${signedClass(change)}`}>{formatSignedAmount(change)}</span>
            </span>
            <span className="replay-panel__ohlc">O {formatAmount(bar[0])} · H {formatAmount(bar[1])} · L {formatAmount(bar[2])}</span>
          </div>
          <IndexChart day={day} minute={minute} marks={marks} height={CHART_HEIGHT.index} />
        </div>
        <div className="replay-panel">
          <div className="replay-panel__head">
            <span className="replay-panel__title">{premiumStrike} premiums <small>{position ? 'your position' : 'ATM now'}</small></span>
            <span className="replay-panel__value">
              <span className="replay-panel__pill replay-panel__pill--ce">CE {formatAmount(day.calls[premiumStrike]?.[minute]?.[1] ?? 0)}</span>
              <span className="replay-panel__pill replay-panel__pill--pe">PE {formatAmount(day.puts[premiumStrike]?.[minute]?.[1] ?? 0)}</span>
            </span>
          </div>
          <PremiumChart day={day} minute={minute} strike={premiumStrike} entryPrice={position?.entryPrice ?? null} entryType={position?.optionType ?? null} height={CHART_HEIGHT.premium} />
        </div>
        <div className="replay-panel">
          <div className="replay-panel__head">
            <span className="replay-panel__title">OI near the money <small>bars: put − call OI added in 5 min (% of OI) · line: since the open</small></span>
            <span className="replay-panel__value">
              <span className={signedClass(flow[minute] ?? 0)}>{formatSignedAmount(flow[minute] ?? 0)}%</span>
              <span className={signedClass(sinceOpen[minute])}>{formatSignedAmount(sinceOpen[minute])} L</span>
            </span>
          </div>
          <OiFlowChart day={day} minute={minute} flow={flow} sinceOpen={sinceOpen} height={CHART_HEIGHT.flow} />
        </div>
        <p className="replay-desk__keys">
          <kbd>Space</kbd> play <kbd>→</kbd> one minute <kbd>C</kbd> buy CE <kbd>P</kbd> buy PE <kbd>X</kbd> exit
        </p>
      </section>

      <section className="replay-card replay-desk__trades" aria-labelledby="replay-trades">
        <SessionTrades day={day} trades={state.closed} tagged={tagged} finished={state.finished} />
        {saveError && <Message tone={MessageTone.Error} className="replay-desk__message">{saveError}</Message>}
      </section>
    </div>
  );
};

interface HeldPosition {
  position: ReplayPosition;
  value: ReturnType<typeof positionValue>;
}

/** The held position's P&L after charges, prices and time held, or empty readings with Exit off while nothing is held. */
const PositionSummary: React.FC<{ held: HeldPosition | null; exitWaiting: boolean; onExit: () => void }> = ({ held, exitWaiting, onExit }) => {
  const net = held?.value.net ?? null;
  return (
    <div className="replay-position">
      <div className={net == null ? 'replay-position__hero' : `replay-position__hero replay-position__hero--${net >= 0 ? 'up' : 'down'}`}>
        <span className={`replay-position__pnl ${net == null ? 'replay-position__pnl--none' : signedClass(net)}`}>
          {net == null ? `₹${formatAmount(0)}` : formatSignedRupees(net)}
        </span>
      </div>
      <div className="replay-position__row">
        <span>Entry · last</span>
        <span>{held ? `${formatAmount(held.position.entryPrice)} · ${formatAmount(held.value.last)}` : NO_READING}</span>
      </div>
      <div className="replay-position__row">
        <span>Points · held</span>
        <span>{held ? `${formatSignedAmount(held.value.points)} · ${held.value.heldMinutes} min` : NO_READING}</span>
      </div>
      <button type="button" className="app-btn app-btn--danger" onClick={onExit} disabled={!held || exitWaiting}>Exit</button>
    </div>
  );
};

const SessionTrades: React.FC<{ day: ReplayDay; trades: ClosedTrade[]; tagged: { reasons: ReplayReasonId[]; note: string }[]; finished: boolean }> = ({
  day, trades, tagged, finished,
}) => {
  const rows = trades.map((trade) => ({ trade, ...replayTradeResult({ date: day.date, ...trade, quantity: trade.lots * day.lotSize }) }));
  const net = rows.reduce((sum, row) => sum + row.net, 0);
  const wins = rows.filter((row) => row.net > 0).length;
  return (
    <>
      <div className="replay-desk__summary">
        <h3 className="replay-card__title" id="replay-trades">{finished ? 'Session over' : "This session's trades"}</h3>
        {rows.length > 0 && <span className={signedClass(net)}>{rows.length} trades · {wins} won · net {formatSignedRupees(net)}</span>}
      </div>
      {rows.length === 0 ? (
        <p className="replay-card__empty">{finished ? 'No trades this session.' : 'Trades you close appear here.'}</p>
      ) : (
        <div className="replay-table-scroll">
          <table className="replay-table">
            <thead className="sticky-head"><tr><th>Option</th><th>In</th><th>Out</th><th>Entry</th><th>Exit</th><th>Points</th><th>Charges</th><th>Net ₹</th><th>Why</th></tr></thead>
            <tbody>
              {rows.map(({ trade, points, charges, net: tradeNet }, i) => (
                <tr key={`${trade.entryTime}-${i}`}>
                  <td>{trade.strike} {trade.optionType} × {trade.lots}</td>
                  <td>{trade.entryTime}</td>
                  <td>{trade.exitTime}</td>
                  <td>{formatAmount(trade.entryPrice)}</td>
                  <td>{formatAmount(trade.exitPrice)}</td>
                  <td>{formatSignedAmount(points)}</td>
                  <td>{formatAmount(charges)}</td>
                  <td className={signedClass(tradeNet)}>{formatSignedAmount(tradeNet)}</td>
                  <td className="replay-table__why">
                    {[...(tagged[i]?.reasons ?? []).map(replayReasonLabel), tagged[i]?.note].filter(Boolean).join(' · ') || '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

export default ReplayDesk;
