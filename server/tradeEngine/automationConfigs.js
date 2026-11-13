/**
 * Users' automation configurations, completed with the defaults for the trade
 * engine's strategies (and the shared entry/exit rules and trade types).
 *
 * db.js stores and returns the configuration as saved; a saved one can predate a
 * strategy or rule, so everything that reads one goes through here and sees a
 * complete configuration. The defaults themselves live in shared/automation.js.
 */
import { withDefaults } from '../../shared/automation.js';
import { getStoredAutomatedUsers, getStoredAutomationConfig, getStoredAutomationConfigs, storeAutomationConfig } from '../db.js';
import { strategyInfos } from './strategies/index.js';

/** @typedef {import('../../shared/automation.js').AutomationConfig} AutomationConfig */

/** @param {any} stored @returns {AutomationConfig} */
const complete = (stored) => withDefaults(stored, strategyInfos());

export async function getAutomationConfig(/** @type {string} */ userId) {
  return complete(await getStoredAutomationConfig(userId));
}

export async function saveAutomationConfig(/** @type {string} */ userId, /** @type {AutomationConfig} */ config) {
  return complete(await storeAutomationConfig(userId, config));
}

/**
 * The automation configurations of these users (defaults for those who saved none), by user id.
 * @param {string[]} userIds
 * @returns {Promise<Map<string, AutomationConfig>>}
 */
export async function getAutomationConfigs(userIds) {
  const stored = await getStoredAutomationConfigs(userIds);
  return new Map(userIds.map((userId) => [userId, complete(stored.get(userId))]));
}

/**
 * @returns {Promise<{ userId: string, config: AutomationConfig }[]>}
 */
export async function getAutomatedUsers() {
  return (await getStoredAutomatedUsers()).map(({ userId, config }) => ({ userId, config: complete(config) }));
}
