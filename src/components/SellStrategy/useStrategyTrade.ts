import { useCallback } from 'react';
import type { OptionChainRow, OptionInstrument } from '@/services/optionChain';
import type { BuyRecommendation, SellRecommendation } from '@/services/sellStrategy';
import { tradeErrorMessage } from '@/services/positions';
import { placeMarketTrade, placedOrderMessage, placedOrderRefused, type PaperOrder } from '@/services/orders';
import { Horizon, OptionType, OrderStatus, Side, TradingMode, type OptionTypeId, type SideId, type TradingModeId } from '../../../shared/tradeEnums.js';
import { StrategyMode, type StrategyModeId } from '../../../shared/appEnums.js';
import { ToastColor, type ToastColorId } from '@/utils/uiEnums';
import { SINGLE_OPTION_SETUPS, STRADDLE_SETUPS, STRANGLE_SETUPS } from './strategySetups';

interface StrategyTradeOptions {
  chain: OptionChainRow[];
  effectivePrices: Map<number, number>;
  orderMode: TradingModeId;
  expiry: string;
  mode: StrategyModeId;
  onToast: (text: string, color: ToastColorId) => void;
}

/** What every leg of one recommendation shares. */
interface LegOrder {
  side: SideId;
  expiry: string;
  note: string;
  confidence: number;
}

/** Places one leg as an intraday paper market order for one lot. */
const placeLeg = (instrument: OptionInstrument, strike: number, optionType: OptionTypeId, order: LegOrder): Promise<PaperOrder> =>
  placeMarketTrade({
    tradingsymbol: instrument.tradingsymbol,
    instrumentToken: instrument.instrumentToken,
    strike,
    optionType,
    side: order.side,
    quantity: instrument.lotSize,
    expiry: order.expiry,
    horizon: Horizon.Intraday,
    note: order.note,
    confidence: order.confidence,
  });

/** Places a recommendation as intraday paper market orders, one per leg, and toasts the result. */
export function useStrategyTrade({ chain, effectivePrices, orderMode, expiry, mode, onToast }: StrategyTradeOptions) {
  /**
   * The toast for a two-leg trade: `filledTitle` when both legs filled at once,
   * otherwise what happened to each leg (e.g. orders waiting for the open).
   */
  const showLegs = useCallback((filledTitle: string, legs: [PaperOrder, string][]) => {
    const refused = legs.some(([placed]) => placedOrderRefused(placed));
    const allFilled = legs.every(([placed]) => placed.status === OrderStatus.Filled);
    const text = allFilled ? filledTitle : legs.map(([placed, label]) => placedOrderMessage(placed, label)).join(' · ');
    onToast(text, refused ? ToastColor.Red : ToastColor.Green);
  }, [onToast]);

  return useCallback(async (rec: SellRecommendation | BuyRecommendation) => {
    if (orderMode !== TradingMode.Paper || !expiry) return;

    const side = mode === StrategyMode.Sell ? Side.SELL : Side.BUY;
    const verb = side;
    const order: LegOrder = {
      side,
      expiry,
      note: rec.reasons.slice(0, 3).join(' | '),
      confidence: Math.max(0, Math.min(100, Math.round(rec.score))),
    };

    try {
      const type = rec.type;
      const optionType = SINGLE_OPTION_SETUPS[type];
      if (optionType) {
        const row = chain.find((r) => r.strike === rec.strikes[0]);
        const instrument = optionType === OptionType.CE ? row?.ce : row?.pe;
        if (!instrument) return;
        const placed = await placeLeg(instrument, rec.strikes[0], optionType, order);
        onToast(placedOrderMessage(placed, `${verb} ${rec.strikes[0]}${optionType}`), placedOrderRefused(placed) ? ToastColor.Red : ToastColor.Green);
      } else if (STRADDLE_SETUPS.includes(type)) {
        const row = chain.find((r) => r.strike === rec.strikes[0]);
        if (!row?.ce || !row?.pe) return;
        const ceLtp = effectivePrices.get(row.ce.instrumentToken) ?? 0;
        const peLtp = effectivePrices.get(row.pe.instrumentToken) ?? 0;
        const ceLeg = await placeLeg(row.ce, rec.strikes[0], OptionType.CE, order);
        const peLeg = await placeLeg(row.pe, rec.strikes[0], OptionType.PE, order);
        showLegs(`${verb} Straddle ${rec.strikes[0]} CE@${ceLtp.toFixed(0)} PE@${peLtp.toFixed(0)}`, [
          [ceLeg, `${verb} ${rec.strikes[0]}CE`],
          [peLeg, `${verb} ${rec.strikes[0]}PE`],
        ]);
      } else if (STRANGLE_SETUPS.includes(type)) {
        const ceRow = chain.find((r) => r.strike === rec.strikes[0]);
        const peRow = chain.find((r) => r.strike === rec.strikes[1]);
        if (!ceRow?.ce || !peRow?.pe) return;
        const ceLtp = effectivePrices.get(ceRow.ce.instrumentToken) ?? 0;
        const peLtp = effectivePrices.get(peRow.pe.instrumentToken) ?? 0;
        const ceLeg = await placeLeg(ceRow.ce, rec.strikes[0], OptionType.CE, order);
        const peLeg = await placeLeg(peRow.pe, rec.strikes[1], OptionType.PE, order);
        showLegs(`${verb} Strangle ${rec.strikes[0]}CE@${ceLtp.toFixed(0)} ${rec.strikes[1]}PE@${peLtp.toFixed(0)}`, [
          [ceLeg, `${verb} ${rec.strikes[0]}CE`],
          [peLeg, `${verb} ${rec.strikes[1]}PE`],
        ]);
      }
    } catch (err) {
      onToast(tradeErrorMessage(err), ToastColor.Red);
    }
  }, [chain, effectivePrices, orderMode, expiry, onToast, mode, showLegs]);
}
