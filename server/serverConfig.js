import 'dotenv/config';
import { resolveSessionSecret } from './sessionSecret.js';

export const PORT = parseInt(process.env.PORT || '3001', 10);
export const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';
export const IS_PROD = process.env.NODE_ENV === 'production';
export const APP_VERSION = (process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || 'local').slice(0, 7);

const sessionSecret = resolveSessionSecret({ secret: process.env.SESSION_SECRET, isProd: IS_PROD });
if (sessionSecret.error) throw new Error(sessionSecret.error);
export const SESSION_SECRET = sessionSecret.value;

export const SESSION_COOKIE = 'optiontrap_sid';
