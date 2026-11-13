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
 * Served by the algo_configuration primary key.
 * @param {string[]} userIds
 * @returns {Promise<Map<string, any>>}
 */
export async function getStoredAutomationConfigs(userIds) {
  const result = await rows('SELECT user_id, config FROM algo_configuration WHERE user_id = ANY($1)', [userIds]);
  return new Map(result.map((row) => [row.user_id, row.config]));
}

/**
 * Served by algo_configuration_enabled_idx.
 * @returns {Promise<{ userId: string, config: any }[]>}
 */
export async function getStoredAutomatedUsers() {
  const result = await rows("SELECT user_id, config FROM algo_configuration WHERE (config->>'enabled') = 'true'");
  return result.map((row) => ({ userId: row.user_id, config: row.config }));
}
