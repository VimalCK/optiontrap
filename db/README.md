# OptionTrap database (PostgreSQL)

OptionTrap uses PostgreSQL for all persistence. Local development runs Postgres
in Docker; production uses a managed Postgres (e.g. Railway).

## Files

- `docker-compose.yml` — local Postgres 16 for development (port `5433`).
- `schema.sql` — full database schema (used to provision a fresh database).

## Local development workflow

1. Start Postgres:

   ```bash
   docker compose -f db/docker-compose.yml up -d
   ```

2. Apply the schema (only needed for a brand-new/empty database):

   ```bash
   docker exec -i optiontrap-postgres psql -U optiontrap -d optiontrap -v ON_ERROR_STOP=1 < db/schema.sql
   ```

3. Run the app. It reads `DATABASE_URL` from the root `.env`:

   ```text
   DATABASE_URL=postgres://optiontrap:optiontrap@localhost:5433/optiontrap
   ```

   ```bash
   npm run dev
   ```

The app also creates any missing tables automatically on startup
(`ensureBaseSchema` in `server/db.js`), so `schema.sql` is mainly a reference /
manual provisioning aid.

## Connection string

Local:

```text
postgres://optiontrap:optiontrap@localhost:5433/optiontrap
```

Production (Railway): use the `DATABASE_URL` provided by the Railway Postgres
plugin.

## GUI access

Use any PostgreSQL client (DBeaver, pgAdmin, TablePlus):

| Field    | Value        |
|----------|--------------|
| Host     | `localhost`  |
| Port     | `5433`       |
| Database | `optiontrap` |
| User     | `optiontrap` |
| Password | `optiontrap` |
