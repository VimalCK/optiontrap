import React, { useCallback, useEffect, useState } from 'react';
import { getPositions, tradeErrorMessage, type Position } from '@/services/positions';
import { exitPosition } from '@/services/orders';
import { computeRiskGroups } from '@/services/positionRisk';
import PaperOrders, { pendingCount, pendingOrders, usePaperOrders } from '@/components/PaperOrders/PaperOrders';
import { useLastPrices } from '@/hooks/useLastPrices';
import TabBar, { type TabBarItem } from '@/components/TabBar/TabBar';
import Message from '@/components/Message/Message';
import LoadingState from '@/components/LoadingState/LoadingState';
import { formatSignedAmount } from '@/utils/formatAmount';
import { MessageTone, PaperTab, type PaperTabId } from '@/utils/uiEnums';
import PaperPositionsTable from './PaperPositionsTable';
import RiskTable from './RiskTable';
import { paperPositionsPnl } from './paperPnl';
import { pnlTone } from './riskLabels';
import { useSpotPrices } from './useSpotPrices';

/** The paper tabs, each with how many it holds: Open positions, Pending orders still waiting to fill, Position Risk strategies. */
export const paperTabs = (openPositions: number, pendingOrders: number, riskGroups: number): TabBarItem<PaperTabId>[] => [
  { id: PaperTab.Positions, label: `Open (${openPositions})` },
  { id: PaperTab.Orders, label: `Pending (${pendingOrders})` },
  { id: PaperTab.Risk, label: `Position Risk (${riskGroups})` },
];

const PaperPositions: React.FC = () => {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [exitError, setExitError] = useState<string | null>(null);
  const [tab, setTab] = useState<PaperTabId>(PaperTab.Positions);

  const loadPositions = useCallback(async () => {
    // Server already excludes positions exited before today (IST).
    setPositions(await getPositions());
    setLoading(false);
  }, []);

  useEffect(() => { loadPositions(); }, [loadPositions]);

  // Loaded whichever tab shows, so a fill reloads the positions either way.
  const orderBook = usePaperOrders(loadPositions);
  // One price feed for the positions and the orders waiting to fill, so both show the same LTP.
  const livePrices = useLastPrices('paper-positions', [...positions, ...pendingOrders(orderBook.orders)]);
  const spotPrices = useSpotPrices(positions);

  const handleExit = async (pos: Position) => {
    setExitError(null);
    try {
      await exitPosition(pos.id, livePrices.get(pos.instrumentToken) || 0);
      await loadPositions();
    } catch (err) {
      // e.g. the market is closed: say why rather than doing nothing.
      setExitError(tradeErrorMessage(err, 'Failed to exit position'));
    }
  };

  const riskGroups = computeRiskGroups(positions, livePrices);
  const totalPnL = paperPositionsPnl(positions, livePrices);
  const openPositions = positions.filter((pos) => !pos.exited).length;

  const positionsCard = (positionsView: React.ReactNode) => (
    <section className="card" aria-label="Paper positions and orders">
      <div className="positions-paper-tabs">
        <TabBar
          items={paperTabs(openPositions, pendingCount(orderBook.orders), riskGroups.length)}
          activeId={tab}
          onChange={setTab}
          className="analytics-tabs analytics-tabs--small"
          tabClassName="analytics-tab"
          ariaLabel="Paper positions and orders"
        />
      </div>
      {tab === PaperTab.Orders && <PaperOrders orders={orderBook.orders} prices={livePrices} error={orderBook.error} onCancel={orderBook.cancel} />}
      {tab === PaperTab.Risk && <RiskTable groups={riskGroups} spotPrices={spotPrices} />}
      {tab === PaperTab.Positions && positionsView}
    </section>
  );

  if (loading) return <div className="card"><LoadingState label="Loading positions…" /></div>;

  if (positions.length === 0) {
    return positionsCard(
      <>
        <h3 className="card__title">No Open Positions</h3>
        <p className="card__description">Click on any LTP cell in the Option Chain to add a position.</p>
      </>,
    );
  }

  return (
    <>
      {exitError && <Message tone={MessageTone.Error} className="positions-exit-error">{exitError}</Message>}

      <div className="card" style={{ marginBottom: 'var(--card-gap)' }}>
        <div className="positions-summary">
          <div className="positions-summary__item">
            <span className="positions-summary__label">Total P&L</span>
            <span className={`positions-summary__value ${pnlTone(totalPnL)}`}>{formatSignedAmount(totalPnL)}</span>
          </div>
        </div>
      </div>

      {positionsCard(<PaperPositionsTable positions={positions} livePrices={livePrices} onExit={handleExit} />)}
    </>
  );
};

export default PaperPositions;
