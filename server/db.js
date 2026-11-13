/** Credentials (apiKey + apiSecret) live only in the browser's localStorage; the server never persists them. */

export {
  closeDb,
  initDb,
  pingDb,
  query,
  tryHoldNamedAdvisoryLock,
  withAdvisoryLock,
  withNamedAdvisoryLock,
} from './db/pool.js';
export {
  deleteUser,
  getAdminKiteSessions,
  getAdminUsers,
  getUsageStats,
  isUserAdmin,
  upsertUser,
} from './db/users.js';
export {
  activateSubscription,
  adminActivateSubscription,
  adminCancelSubscription,
  adminExtendSubscription,
  getActiveSubscriptionPlans,
  getUserSubscription,
  SubscriptionPlanNotFoundError,
} from './db/subscriptions.js';
export {
  createFeedback,
  getFeedbackCounts,
  getFeedbackList,
  updateFeedbackStatus,
} from './db/feedback.js';
export {
  cleanExpiredSessions,
  deleteSession,
  getSessionById,
  setSessionData,
  touchSession,
} from './db/sessions.js';
export {
  addWatchlistItem,
  createWatchlist,
  deleteWatchlist,
  getWatchlistItems,
  getWatchlists,
  removeWatchlistItem,
  renameWatchlist,
  reorderWatchlistItems,
} from './db/watchlists.js';
export {
  createPriceAlert,
  deletePriceAlert,
  getPriceAlerts,
  resetPriceAlert,
  triggerPriceAlert,
} from './db/priceAlerts.js';
export {
  getStoredAutomatedUsers,
  getStoredAutomationConfig,
  getStoredAutomationConfigs,
  storeAutomationConfig,
} from './db/automationConfigs.js';
export {
  advanceAutoTrade,
  closeAutoTrades,
  createAutoTrade,
  getAutoTradeResults,
  getAutoTrades,
  getExecutedAutoTrades,
  getTodayAutoExits,
  getTodayAutoRealisedPnl,
} from './db/algoTrades.js';
export {
  averageIntoPosition,
  closeOpenPosition,
  findOpenPosition,
  getAllOpenAutoPositions,
  getDailyPnl,
  getOpenAutoPositions,
  getOpenIntradayPositionsBefore,
  getOpenPosition,
  getPositions,
  getPositionStats,
  insertPosition,
  setPositionQuantity,
} from './db/positions.js';
export {
  cancelOpenOrdersPlacedBefore,
  cancelOrder,
  cancelUnfilledOrder,
  claimOrderFill,
  createOrder,
  getOpenOrders,
  getOrders,
  getUserOpenOrders,
  getWaitingAutoOrders,
  recordClosingOrder,
  setOrderPosition,
} from './db/orders.js';
export {
  getAlwaysSnapshotSymbols,
  getCashStock,
  getFnoSymbols,
  getInstruments,
  getInstrumentsDate,
  getMarketReference,
  getStrikeStepSize,
  getUnderlying,
  getUnderlyings,
  saveInstruments,
  setAlwaysSnapshot,
} from './db/instruments.js';
export {
  getLatestOiSnapshotTimestamp,
  getNewestOiSnapshotTimestamp,
  getTodayOiSnapshots,
  getTodayOiSnapshotTokens,
  saveOiSnapshot,
} from './db/oiSnapshots.js';
export {
  createOiHistoryTable,
  deleteOiHistoryByExpiryMonth,
  deleteOiHistoryByMonth,
  deleteOiHistoryByScrip,
  getOiHistoryDataByExpiryMonth,
  getOiHistoryDatesForExpiryMonth,
  getOiHistoryFuturesData,
  getOptionsForAtm,
  getOptionsForStrikes,
  getRecentOiHistoryScrips,
  getStoredOiHistoryExpiryMonths,
  getStoredOiHistoryStrikes,
  insertOiHistoryFuturesRows,
  insertOiHistoryRows,
} from './db/oiHistory.js';
export {
  deleteTradeSetupSignal,
  evaluateTradeSetupSignalOutcomes,
  getTradeSetupSignals,
  saveTradeSetupSignal,
  updateTradeSetupSignalOutcome,
} from './db/tradeSetupSignals.js';
export {
  claimScheduledJobRun,
  finishScheduledJobRun,
  getScheduledJobRuns,
  getScheduledJobRunsByPrefix,
  getScheduledJobRunsOn,
  getScheduledJobStatus,
  runSqlScript,
} from './db/scheduledJobs.js';
export {
  getOpenStockSetupSignals,
  getStockCandles,
  getStockCandleSync,
  getStockScansForUser,
  getStockSetupSignals,
  getStockSetupStats,
  getWatchlistStocks,
  insertStockSetupSignals,
  saveStockCandles,
  saveStockScan,
  updateStockSetupSignal,
} from './db/stocks.js';
