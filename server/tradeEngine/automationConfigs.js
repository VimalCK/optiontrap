/**
 * Users' automation configurations, completed with the defaults for the trade
 * engine's strategies (and the shared general, entry and exit rules).
 *
 * db.js stores and returns the configuration as saved; a saved one can predate a
 * strategy or rule, so everything that reads one goes through here and sees a
 * complete configuration. The defaults themselves live in shared/automation.js.
 */
import { defaultAutomationConfig, withDefaults, withStrategyActive } from '../../shared/automation.js';
import {
  getStoredAutomatedUsers,
  getStoredAutomationConfig,
  getStoredAutomationConfigs,
  storeAutomationConfig,
  storeAutomationEnabled,
  storeStrategyActive,
} from '../db.js';
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

/** The Algo Trading switch alone, over every strategy; a user with no configuration yet gets the defaults with it. */
export async function setAutomationEnabled(/** @type {string} */ userId, /** @type {boolean} */ enabled) {
  const newConfig = { ...defaultAutomationConfig(strategyInfos()), enabled };
  return complete(await storeAutomationEnabled(userId, enabled, newConfig));
}

/**
 * Switch one of the user's strategies on or off alone (Settings): the configuration as saved, or why it can't be
 * switched on.
 * @param {string} userId
 * @param {import('./strategies/index.js').StrategyInfo} strategy
 * @param {boolean} active
 * @returns {Promise<{ config: AutomationConfig, error?: undefined } | { error: string, config?: undefined }>}
 */
export async function setStrategyActive(userId, strategy, active) {
  const switched = withStrategyActive(await getAutomationConfig(userId), strategy, active);
  if (switched.error !== undefined) return { error: switched.error };
  const defaults = { newConfig: switched.config, settings: switched.config.strategies[strategy.id] };
  return { config: complete(await storeStrategyActive(userId, strategy.id, active, defaults)) };
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
 * Users with automation on and this strategy active. The database picks those whose stored configuration has it
 * active; completing can still turn it off (a stored setting no longer valid falls back to inactive), so check again.
 * @param {string} strategyId
 * @returns {Promise<{ userId: string, config: AutomationConfig }[]>}
 */
export async function getAutomatedUsers(strategyId) {
  return (await getStoredAutomatedUsers(strategyId))
    .map(({ userId, config }) => ({ userId, config: complete(config) }))
    .filter(({ config }) => config.enabled && config.strategies[strategyId]?.active);
}
