import React, { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AppSelect from '@/components/AppSelect/AppSelect';
import DateInput from '@/components/DateInput/DateInput';
import DateRangePicker, { type DateRange } from '@/components/DateRangePicker/DateRangePicker';
import EmptyState from '@/components/EmptyState/EmptyState';
import Message from '@/components/Message/Message';
import Shimmer, { ShimmerGroup } from '@/components/Shimmer/Shimmer';
import TabBar from '@/components/TabBar/TabBar';
import { ReplayIcon } from '@/components/icons/Icons';
import ReplayDesk from '@/components/Replay/ReplayDesk';
import ReplayResults from '@/components/Replay/ReplayResults';
import { useUnderlyings } from '@/hooks/useUnderlyings';
import { fetchReplayDay, startReplaySession, type ReplayDay, type ReplaySession } from '@/services/replay';
import { addDays } from '../../shared/marketTime.js';
import { istDateString } from '@/utils/marketStatus';
import { MessageTone, ReplayTab, ShimmerShape, enumFromParam, type ReplayTabId } from '@/utils/uiEnums';
import '@/styles/analytics.css'; // reuse the shared tab-bar CSS
import '@/styles/replay.css';

const TABS: { id: ReplayTabId; label: string }[] = [
  { id: ReplayTab.Play, label: 'Replay' },
  { id: ReplayTab.Results, label: 'Results' },
];
/** The days the Results tab opens on; the player can change them. */
const DEFAULT_RESULTS_DAYS = 28;
/** How far back the day picker goes: Kite keeps option prices only for contracts still trading, a few weeks back. */
const REPLAY_DAYS_BACK = 30;
const ALL_UNDERLYINGS = '';

interface Playing {
  day: ReplayDay;
  session: ReplaySession;
}

const Replay: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = enumFromParam(ReplayTab, searchParams.get('tab'), ReplayTab.Play);
  const underlyings = useUnderlyings();
  const today = istDateString();
  const [range, setRange] = useState<DateRange>(() => ({ from: addDays(today, -DEFAULT_RESULTS_DAYS), to: today }));
  const [picked, setPicked] = useState<string | null>(null);
  const [resultsUnderlying, setResultsUnderlying] = useState(ALL_UNDERLYINGS);
  const [pickedDate, setPickedDate] = useState('');
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fallback = underlyings.find((u) => u.isMarketReference) ?? underlyings.find((u) => u.isIndex) ?? underlyings[0];
  const underlying = picked ?? fallback?.name ?? null;
  const options = useMemo(() => underlyings.map((u) => ({ value: u.name, label: u.label })), [underlyings]);
  const rangeValid = Boolean(range.from && range.to && range.from <= range.to);

  const open = useCallback(async () => {
    if (!underlying || !pickedDate) return;
    setLoading(true);
    setError(null);
    setPlaying(null);
    try {
      const day = await fetchReplayDay(underlying, pickedDate);
      const session = await startReplaySession(day);
      setPlaying({ day, session });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [underlying, pickedDate]);

  const onFinished = useCallback((session: ReplaySession) => setPlaying((p) => (p ? { ...p, session } : p)), []);

  return (
    <div className="replay">
      <TabBar items={TABS} activeId={tab} onChange={(next) => setSearchParams({ tab: next })} className="analytics-tabs" tabClassName="analytics-tab" ariaLabel="Replay sections" />

      {tab === ReplayTab.Play && (
        <>
          <section className="replay-card replay-controls" aria-label="Pick a day">
            <div className="replay-controls__row">
              <AppSelect value={underlying ?? ''} options={options} onChange={(v) => setPicked(String(v))} searchable placeholder="Pick an underlying" ariaLabel="Underlying" className="replay-controls__underlying" />
              <DateInput label="Day to replay" value={pickedDate} min={addDays(today, -REPLAY_DAYS_BACK)} max={today} onChange={setPickedDate} />
              <button type="button" className="app-btn app-btn--primary" onClick={open} disabled={loading || !underlying || !pickedDate}>
                Open
              </button>
            </div>
          </section>

          {error && <Message tone={MessageTone.Error}>{error}</Message>}

          {loading && (
            <ShimmerGroup label="Fetching the day from Kite" className="replay-card replay-loading">
              <Shimmer shape={ShimmerShape.Block} height={280} />
              <Shimmer shape={ShimmerShape.Block} height={150} />
              <Shimmer shape={ShimmerShape.Block} height={120} />
            </ShimmerGroup>
          )}

          {!loading && playing && (
            <ReplayDesk key={playing.session.id} day={playing.day} session={playing.session} onFinished={onFinished} />
          )}

          {!loading && !playing && !error && (
            <EmptyState
              icon={<ReplayIcon size={64} />}
              title="Replay a past session minute by minute"
              description="Pick a day and press Open. Buy the ATM call or put when you would trade it live, exit when you would, and see on Results whether your trades make money after charges."
            />
          )}
        </>
      )}

      {tab === ReplayTab.Results && (
        <>
          <section className="replay-card replay-controls" aria-label="Results range">
            <label className="replay-controls__field">
              Underlying
              <AppSelect
                value={resultsUnderlying}
                options={[{ value: ALL_UNDERLYINGS, label: 'All underlyings' }, ...options]}
                onChange={(v) => setResultsUnderlying(String(v))}
                searchable
              />
            </label>
            <div className="replay-controls__field">
              Days played
              <DateRangePicker range={range} onChange={setRange} />
            </div>
          </section>
          {rangeValid
            ? <ReplayResults range={{ from: range.from, to: range.to, underlying: resultsUnderlying || undefined }} />
            : <Message tone={MessageTone.Error}>Pick a range whose start is not after its end.</Message>}
        </>
      )}
    </div>
  );
};

export default Replay;
