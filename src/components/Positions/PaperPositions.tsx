import React, { useCallback, useEffect, useState } from 'react';
import { getPositions, tradeErrorMessage, type Position } from '@/services/positions';
import { exitPosition } from '@/services/orders';
import { computeRiskGroups } from '@/services/positionRisk';
import PaperOrders, { pendingCount, pendingOrders, usePaperOrders } from '@/components/PaperOrders/PaperOrders';
import { useLastPrices } from '@/hooks/useLastPrices';
import TabBar, { type TabBarItem } from '@/components/TabBar/TabBar';
import Message from '@/components/Message/Message';
import { ShimmerGroup, ShimmerTableRows } from '@/components/Shimmer/Shimmer';
import { MessageTone, PaperTab, type PaperTabId } from '@/utils/uiEnums';
import PaperPositionsTable, { PAPER_POSITION_COLUMNS, PaperPositionsFrame } from './PaperPositionsTable';
import PositionsTotal from './PositionsTotal';
import RiskTable from './RiskTable';
import { paperPositionsPnl } from './paperPnl';
import { useSpotPrices } from './useSpotPrices';

export interface PaperTabCounts {
  openPositions: number;
  pendingOrders: number;
  riskGroups: number;
}

const countLabel = (count: number | undefined) => (count === undefined ? '' : ` (${count})`);

/**
 * The paper tabs, each with how many it holds: Open positions, Pending orders still waiting to fill, Position Risk
 * strategies. No counts (null) while the positions load, rather than zeros that aren't true yet.
 */
export const paperTabs = (counts: PaperTabCounts | null): TabBarItem<PaperTabId>[] => [
  { id: PaperTab.Positions, label: `Open${countLabel(counts?.openPositions)}` },
  { id: PaperTab.Orders, label: `Pending${countLabel(counts?.pendingOrders)}` },
  { id: PaperTab.Risk, label: `Position Risk${countLabel(counts?.riskGroups)}` },
];

/** Placeholder rows in the positions table while the positions load. */
const PLACEHOLDER_ROWS = 4;

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

  /** Exit each in turn (every strategy's leg of a combined row), then reload once. */
  const handleExit = async (toExit: Position[]) => {
    setExitError(null);
    try {
      for (const pos of toExit) await exitPosition(pos.id, livePrices.get(pos.instrumentToken) || 0);
    } catch (err) {
      // e.g. the market is closed: say why rather than doing nothing.
      setExitError(tradeErrorMessage(err, 'Failed to exit position'));
    } finally {
      await loadPositions();
    }
  };

  const riskGroups = computeRiskGroups(positions, livePrices);
  const totalPnL = paperPositionsPnl(positions, livePrices);
  const openPositions = positions.filter((pos) => !pos.exited).length;

  const positionsCard = (positionsView: React.ReactNode) => (
    <section className="card" aria-label="Paper positions and orders">
      <div className="positions-paper-tabs">
        <TabBar
          items={paperTabs(loading ? null : { openPositions, pendingOrders: pendingCount(orderBook.orders), riskGroups: riskGroups.length })}
          activeId={tab}
          onChange={setTab}
          className="analytics-tabs analytics-tabs--small"
          tabClassName="analytics-tab"
          ariaLabel="Paper positions and orders"
        />
      </div>
      {tab === PaperTab.Orders && <PaperOrders orders={orderBook.orders} prices={livePrices} error={orderBook.error} onCancel={orderBook.cancel} onModified={orderBook.reload} />}
      {tab === PaperTab.Risk && <RiskTable groups={riskGroups} spotPrices={spotPrices} />}
      {tab === PaperTab.Positions && positionsView}
    </section>
  );

  if (loading) {
    return (
      <>
        <PositionsTotal pnl={0} loading />
        {positionsCard(
          <ShimmerGroup label="Loading paper positions">
            <PaperPositionsFrame><tbody><ShimmerTableRows rows={PLACEHOLDER_ROWS} columns={PAPER_POSITION_COLUMNS.length} /></tbody></PaperPositionsFrame>
          </ShimmerGroup>,
        )}
      </>
    );
  }

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

      <PositionsTotal pnl={totalPnL} />

      {positionsCard(<PaperPositionsTable positions={positions} livePrices={livePrices} onExit={handleExit} />)}
    </>
  );
};

export default PaperPositions;
