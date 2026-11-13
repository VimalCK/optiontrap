import { adminRoutes } from './admin.js';
import { authRoutes } from './auth.js';
import { automationRoutes } from './automation.js';
import { feedbackRoutes } from './feedback.js';
import { instrumentRoutes } from './instruments.js';
import { oiHistoryRoutes } from './oiHistory.js';
import { oiSnapshotRoutes } from './oiSnapshots.js';
import { orderRoutes } from './orders.js';
import { positionRoutes } from './positions.js';
import { priceAlertRoutes } from './priceAlerts.js';
import { stockRoutes } from './stocks.js';
import { subscriptionRoutes } from './subscriptions.js';
import { versionRoutes } from './version.js';
import { watchlistRoutes } from './watchlists.js';

/** The app's own routes, mounted before the Kite proxy so they answer first. Add a router by adding it here. */
export const ROUTERS = [
  authRoutes,
  versionRoutes,
  subscriptionRoutes,
  feedbackRoutes,
  adminRoutes,
  watchlistRoutes,
  automationRoutes,
  priceAlertRoutes,
  positionRoutes,
  orderRoutes,
  oiSnapshotRoutes,
  oiHistoryRoutes,
  stockRoutes,
  instrumentRoutes,
];
