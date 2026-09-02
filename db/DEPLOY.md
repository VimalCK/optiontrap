# Deploying the database to production (Railway)

This replaces the production database with an exact copy of your current local
Docker Postgres (schema + all data). Prod has no important data yet, so a full
replace is safe.

The dump/restore runs `pg_dump`/`psql` **inside the local Docker container**, so
you do NOT need Postgres installed on your machine.

## 1. Provision Postgres on Railway

1. Railway project → **New** → **Database** → **Add PostgreSQL**.
2. Open the Postgres service → **Variables** → copy `DATABASE_URL`
   (looks like `postgresql://postgres:PASS@HOST:PORT/railway`).

## 2. Point the app at it

On the OptionTrap **app** service in Railway, set an environment variable:

```
DATABASE_URL = <the Postgres DATABASE_URL from step 1>
```

The app reads `DATABASE_URL` (see `server/db.js`). On boot it auto-creates the
schema via `ensureBaseSchema`, so a fresh DB needs no manual schema step — but
we still load the data below.

## 3. Dump local data

```powershell
powershell -ExecutionPolicy Bypass -File db/dump-local.ps1
```

Creates `db/optiontrap-dump.sql` (git-ignored). The dump uses
`--clean --if-exists --no-owner --no-privileges`, so it drops existing objects
first and is portable to Railway's DB user.

## 4. Restore into production

```powershell
$env:PROD_DATABASE_URL = "postgresql://postgres:PASS@HOST:PORT/railway"
powershell -ExecutionPolicy Bypass -File db/restore-to-prod.ps1
```

This fully replaces the prod database contents with your dump.

> If Railway gives an internal vs public host, use the **public** URL from your
> machine. The app service itself should use the **internal** URL Railway injects.

## 5. Deploy / restart the app

Redeploy (or restart) the Railway app service so it picks up `DATABASE_URL`.
On boot you should see:

```
[DB] PostgreSQL initialised
Server OptionTrap running on port ...
```

## 6. Verify

Connect with any Postgres client (or `psql`) to the prod `DATABASE_URL` and check
counts match local:

```sql
SELECT count(*) FROM instruments;   -- ~42k
SELECT count(*) FROM oi_history;     -- ~20k
```

## Re-running later

Repeat steps 3–4 anytime to refresh prod from local. The restore is idempotent
(drops + recreates), so it always ends in an exact copy of the dump.
