# Nightly jobs

Every file here runs once a night from 22:00 IST, in filename order
(`010_…`, `020_…`). The runner (`server/nightlyJobs.js`) doesn't know what a
job does — add a file to add a job.

## Job files

**`.sql`** — runs in one transaction (10-minute statement timeout). The run
records the rows affected.

```sql
-- 010_purge_old_job_runs.sql
DELETE FROM scheduled_job_runs
WHERE run_date < to_char(now() - interval '90 days', 'YYYY-MM-DD');
```

**`.js`** — exports a default async function. The returned object is saved
with the run.

```js
// 020_example.js
export default async function run({ query, date, log }) {
  const { rowCount } = await query('DELETE FROM something WHERE ...');
  log(`removed ${rowCount}`);
  return { removed: rowCount };
}
```

- `query(text, params)` — pg query against the app's pool
- `date` — tonight's IST date, `YYYY-MM-DD`
- `log(...)` — console log prefixed with the job's file name

JS jobs can also import anything from `../../db.js` or other server modules.

## Rules

- **Pause** a job by renaming it with a leading `_`. **Remove** it by deleting it.
- New and edited files take effect the same night; no restart needed.
- A job runs at most once per IST date. A **failed** job is not retried until
  the next night. Check runs at `GET /api/admin/scheduled-jobs/nightly`.
- Write jobs so a second run is harmless: a server crash mid-job is retried
  once the run has been stale for two hours. For emails, record who was sent
  what for `date` and skip them.
