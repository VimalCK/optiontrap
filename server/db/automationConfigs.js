import { firstRow, rows } from './pool.js';

export async function getStoredAutomationConfig(userId) {
  const row = await firstRow('SELECT config FROM algo_configuration WHERE user_id = $1', [userId]);
  return row?.config;
}

/** Store a configuration already checked by parseAutomationConfig, returning it as stored. */
export async function storeAutomationConfig(userId, config) {
  const row = await firstRow(
    `INSERT INTO algo_configuration (user_id, config, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET config = EXCLUDED.config, updated_at = now()
     RETURNING config`,
    [userId, JSON.stringify(config)],
  );
  return row.config;
}

/**
 * Sets the Algo Trading switch alone, or stores `newConfig` (already switched) for a user with none yet; returns the
 * configuration as stored. Served by the primary key.
 * @param {string} userId
 * @param {boolean} enabled
 * @param {object} newConfig
 */
export async function storeAutomationEnabled(userId, enabled, newConfig) {
  const row = await firstRow(
    `INSERT INTO algo_configuration (user_id, config, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET config = jsonb_set(algo_configuration.config, '{enabled}', to_jsonb($3::boolean)), updated_at = now()
     RETURNING config`,
    [userId, JSON.stringify(newConfig), enabled],
  );
  return row.config;
}

/**
 * Switches one strategy on or off alone, or stores `newConfig` (already switched) for a user with none yet; returns
 * the configuration as stored. `settings` are the strategy's settings for a stored configuration that has none for
 * it yet. Served by the primary key.
 * @param {string} userId
 * @param {string} strategyId
 * @param {boolean} active
 * @param {{ newConfig: object, settings: object }} defaults
 */
export async function storeStrategyActive(userId, strategyId, active, { newConfig, settings }) {
  const row = await firstRow(
    `INSERT INTO algo_configuration (user_id, config, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET config = jsonb_set(
       algo_configuration.config, ARRAY['strategies', $3::text],
       COALESCE(algo_configuration.config -> 'strategies' -> $3::text, $4::jsonb) || jsonb_build_object('active', $5::boolean)
     ), updated_at = now()
     RETURNING config`,
    [userId, JSON.stringify(newConfig), strategyId, JSON.stringify(settings), active],
  );
  return row.config;
}

/**
 * Served by the algo_configuration primary key.
 * @param {string[]} userIds
 * @returns {Promise<Map<string, any>>}
 */
export async function getStoredAutomationConfigs(userIds) {
  const result = await rows('SELECT user_id, config FROM algo_configuration WHERE user_id = ANY($1)', [userIds]);
  return new Map(result.map((row) => [row.user_id, row.config]));
}

/**
 * Users with automation on whose stored configuration has this strategy active. Served by algo_configuration_strategies_idx.
 * @param {string} strategyId
 * @returns {Promise<{ userId: string, config: any }[]>}
 */
export async function getStoredAutomatedUsers(strategyId) {
  const result = await rows(
    "SELECT user_id, config FROM algo_configuration WHERE (config->>'enabled') = 'true' AND config->'strategies' @> $1::jsonb",
    [JSON.stringify({ [strategyId]: { active: true } })],
  );
  return result.map((row) => ({ userId: row.user_id, config: row.config }));
}
