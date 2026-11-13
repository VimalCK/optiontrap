import { JobRunStatus } from '../../shared/appEnums.js';
import { MARKET_TIME_ZONE } from '../../shared/marketTime.js';
import { sqlEnum } from '../sql.js';
import { firstRow, pool, query, rows } from './pool.js';

/**
 * Claim today's run of a job. Returns false when it already finished, or is
 * running elsewhere and started within the last two hours. A failed or
 * stale run is claimed again.
 */
export async function claimScheduledJobRun(job, runDate) {
  const row = await firstRow(
    `INSERT INTO scheduled_job_runs (job, run_date, status)
     VALUES ($1, $2, ${sqlEnum(JobRunStatus.Running)})
     ON CONFLICT (job, run_date) DO UPDATE
       SET status = ${sqlEnum(JobRunStatus.Running)}, detail = '{}'::jsonb, finished_at = NULL,
           started_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
     WHERE scheduled_job_runs.status = ${sqlEnum(JobRunStatus.Failed)}
        OR (scheduled_job_runs.status = ${sqlEnum(JobRunStatus.Running)}
            AND scheduled_job_runs.started_at < to_char(now() - interval '2 hours', 'YYYY-MM-DD HH24:MI:SS'))
     RETURNING job`,
    [job, runDate],
  );
  return Boolean(row);
}

/** Status of a job's run for a date (JobRunStatus in shared/appEnums.js), or null if it hasn't run. */
export async function getScheduledJobStatus(job, runDate) {
  const row = await firstRow('SELECT status FROM scheduled_job_runs WHERE job = $1 AND run_date = $2', [job, runDate]);
  return row?.status ?? null;
}

export async function finishScheduledJobRun(job, runDate, status, detail = {}) {
  await query(
    `UPDATE scheduled_job_runs
     SET status = $3, detail = $4, finished_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
     WHERE job = $1 AND run_date = $2`,
    [job, runDate, status, JSON.stringify(detail)],
  );
}

/**
 * Run a SQL script (one or more statements) in a single transaction, giving
 * up after `timeoutMs`. Returns the total rows affected.
 */
export async function runSqlScript(sql, timeoutMs) {
  if (!pool) throw new Error('Database not initialised');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = ${Math.round(timeoutMs)}`);
    // Scripts work in market time: now(), date_trunc and to_char use this zone.
    await client.query(`SET LOCAL TIME ZONE '${MARKET_TIME_ZONE}'`);
    const result = await client.query(sql);
    await client.query('COMMIT');
    const results = Array.isArray(result) ? result : [result];
    return results.reduce((sum, r) => sum + (r.rowCount || 0), 0);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * These jobs' runs for one date ({ job, status, detail }), for the admin
 * health page; one primary-key (job, run_date) lookup per job.
 */
export async function getScheduledJobRunsOn(jobs, runDate) {
  const found = await rows('SELECT job, status, detail FROM scheduled_job_runs WHERE job = ANY($1) AND run_date = $2', [jobs, runDate]);
  return found.map((row) => ({ job: row.job, status: row.status, detail: row.detail }));
}

export async function getScheduledJobRunsByPrefix(prefix, limit = 50) {
  return rows(
    `SELECT job, run_date, status, detail, started_at, finished_at FROM scheduled_job_runs
     WHERE left(job, length($1)) = $1 ORDER BY run_date DESC, job LIMIT $2`,
    [prefix, limit],
  );
}

export async function getScheduledJobRuns(job, limit = 10) {
  return rows(
    'SELECT run_date, status, detail, started_at, finished_at FROM scheduled_job_runs WHERE job = $1 ORDER BY run_date DESC LIMIT $2',
    [job, limit],
  );
}
