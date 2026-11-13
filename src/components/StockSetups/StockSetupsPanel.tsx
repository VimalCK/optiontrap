import React, { useEffect, useState } from 'react';
import { ChevronLeftIcon, InfoIcon } from '@/components/icons/Icons';
import { formatNumericDate } from '@/utils/marketStatus';
import { MIN_CANDLES } from '../../../shared/stockSetups.js';
import { LevelSide } from '../../../shared/analysisEnums.js';
import StockSetupsGuide from './StockSetupsGuide';
import SetupScorecard from './SetupScorecard';
import TradingViewLink from '@/components/TradingViewLink/TradingViewLink';
import { StockSetupsView, type StockSetupsViewId } from '@/utils/uiEnums';
import PriceLadder from './PriceLadder';
import ZoneList, { type SetAlert } from './ZoneList';
import SetupCards from './SetupCards';
import MoveStats from './MoveStats';
import { IndicatorStats, StockOverview } from './StockOverview';
import { rupees } from './setupDetails';
import { useStockSetups } from './useStockSetups';
import { useSetupBacktest } from './useSetupBacktest';
// Also opened from OI History, where the watchlist styles aren't otherwise loaded.
import '@/styles/watchlist.css';

interface StockSetupsPanelProps {
  instrumentToken: number;
  tradingsymbol: string;
  /** Live price from the watchlist ticker; the last close is used without it. */
  livePrice: number | undefined;
  onClose: () => void;
  /** Where the zone bells lead; without it (outside the watchlist) the bells are hidden. */
  onSetAlert?: SetAlert;
}

const StockSetupsPanel: React.FC<StockSetupsPanelProps> = ({ instrumentToken, tradingsymbol, livePrice, onClose, onSetAlert }) => {
  const [view, setView] = useState<StockSetupsViewId>(StockSetupsView.Details);
  const { data, error, analysis, expectedMove, expectedDaily, volatility } = useStockSetups(instrumentToken, tradingsymbol, livePrice);
  const backtest = useSetupBacktest(instrumentToken, () => setView(StockSetupsView.Scorecard));
  const history = backtest.state;

  useEffect(() => { setView(StockSetupsView.Details); }, [instrumentToken]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const lastDate = data?.candles[data.candles.length - 1]?.date;
  const onDetails = view === StockSetupsView.Details;
  const guideToggleLabel = onDetails ? 'How to read this panel' : 'Back to setup details';

  return (
    <div className="wl-alert-modal-overlay wl-sz-overlay" onMouseDown={onClose}>
      <div className="wl-sz" role="dialog" aria-modal="true" aria-labelledby="wl-sz-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="wl-sz__header">
          <div className="wl-sz__title">
            <h3 id="wl-sz-title">{tradingsymbol}</h3>
            <TradingViewLink symbol={tradingsymbol} size={16} className="wl-sz__chart-link" />
            <button
              className={`wl-sz__icon-btn wl-sz__icon-btn--small ${onDetails ? '' : 'wl-sz__icon-btn--active'}`}
              onClick={() => setView((v) => (v === StockSetupsView.Details ? StockSetupsView.Guide : StockSetupsView.Details))}
              aria-label={guideToggleLabel}
              title={guideToggleLabel}
            >
              {onDetails ? <InfoIcon size={14} /> : <ChevronLeftIcon size={14} />}
            </button>
            {backtest.backtested ? (
              // Already backtested: open the scorecard rather than replaying the same year again.
              <button
                className={`wl-sz__pill-btn${view === StockSetupsView.Scorecard ? ' wl-sz__pill-btn--active' : ''}`}
                onClick={() => setView(StockSetupsView.Scorecard)}
                aria-label={`Show the ${tradingsymbol} setup scorecard`}
                title="Show how each setup type has played out on this stock"
              >
                Scorecard
              </button>
            ) : (
              <button
                className={`wl-sz__pill-btn wl-sz__pill-btn--cta${!history.running && !history.error ? ' wl-sz__pill-btn--pulse' : ''}`}
                onClick={backtest.run}
                disabled={history.running}
                aria-label={`Backtest the past year of ${tradingsymbol} setups into the scorecard`}
                title="Replay the past year's sessions and add each setup, with how it turned out, to the scorecard"
              >
                {history.running ? 'Backtesting…' : 'Backtest 1Y'}
              </button>
            )}
          </div>
          {analysis && (
            <div className="wl-sz__quote">
              <span className="wl-sz__price">{rupees(analysis.price)}</span>
              <span className="wl-sz__quote-meta">
                <span className={`wl-sz-state wl-sz-state--${analysis.state.toLowerCase()}`}>{analysis.state}</span>
                {livePrice === undefined && `Close ${formatNumericDate(analysis.date)}`}
              </span>
            </div>
          )}
        </div>

        {view === StockSetupsView.Guide && (
          <div className="wl-sz__body">
            <StockSetupsGuide />
          </div>
        )}

        {view === StockSetupsView.Scorecard && (
          <div className="wl-sz__body">
            {history.message && <div className="wl-sz-message">{history.message}</div>}
            <SetupScorecard instrumentToken={instrumentToken} tradingsymbol={tradingsymbol} refreshKey={0} inSetupsPanel />
          </div>
        )}

        <div className="wl-sz__body" hidden={!onDetails}>
          {error && <div className="wl-sz-message wl-sz-message--error">{error}</div>}
          {history.running && <div className="wl-sz-message">Backtesting the past year: replaying each session and adding its setups to the scorecard…</div>}
          {history.message && <div className={`wl-sz-message${history.error ? ' wl-sz-message--error' : ''}`}>{history.message}</div>}
          {!data && !error && (
            <div className="wl-sz-loading">
              <span className="wl-sz-loading__spinner" />
              Loading daily candles…
            </div>
          )}
          {data?.warning && <div className="wl-sz-message wl-sz-message--warn">Couldn&apos;t refresh from Kite ({data.warning}). Showing stored candles up to {lastDate && formatNumericDate(lastDate)}.</div>}
          {data && !analysis && <div className="wl-sz-message">Not enough history yet: zones need at least {MIN_CANDLES} trading days ({data.candles.length} stored).</div>}

          {analysis && (
            <>
              <StockOverview analysis={analysis} tradingsymbol={tradingsymbol} marketLabel={data?.marketLabel} />
              <PriceLadder analysis={analysis} />
              <SetupCards analysis={analysis} />
              <div className="wl-sz-columns">
                <ZoneList
                  title="Support · buy zones"
                  side={LevelSide.Support}
                  zones={analysis.supports}
                  price={analysis.price}
                  empty="No support zone below the price in the stored history."
                  onSetAlert={onSetAlert}
                />
                <ZoneList
                  title="Resistance · exit zones"
                  side={LevelSide.Resistance}
                  zones={analysis.resistances}
                  price={analysis.price}
                  empty="No resistance zone above: the price is at or near its highs."
                  onSetAlert={onSetAlert}
                />
              </div>
              <MoveStats price={analysis.price} volatility={volatility} expectedMove={expectedMove} expectedDaily={expectedDaily} />
              <IndicatorStats indicators={analysis.indicators} />
            </>
          )}
        </div>

        <div className="wl-sz__footer">
          Based on {data ? `${data.candles.length} trading days` : 'past prices'}{lastDate ? ` up to ${formatNumericDate(lastDate)}` : ''}. Zones improve the odds, not certainty; sell setups on cash stocks are exits, not shorts.
        </div>
      </div>
    </div>
  );
};

export default StockSetupsPanel;
