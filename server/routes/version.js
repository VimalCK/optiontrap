import { asyncRouter } from '../asyncRoutes.js';
import { APP_VERSION } from '../serverConfig.js';
import { sendOk } from '../replies.js';

export const versionRoutes = asyncRouter();

versionRoutes.get('/api/version', (_req, res) => {
  sendOk(res, { version: APP_VERSION });
});
