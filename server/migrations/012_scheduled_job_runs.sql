-- One row per scheduled server job per IST date, so a restart doesn't repeat
-- a finished run and two servers can't run the same job at once.
CREATE TABLE IF NOT EXISTS scheduled_job_runs (
  job         TEXT NOT NULL,
  run_date    TEXT NOT NULL,
  status      TEXT NOT NULL,            -- running | done | failed
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at  TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
  finished_at TEXT,
  PRIMARY KEY (job, run_date)
);
