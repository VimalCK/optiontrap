# OptionTrap database (PostgreSQL)

OptionTrap uses PostgreSQL for all persistence. Local development runs Postgres
in Docker; production uses a managed Postgres (e.g. Railway).

## Files

- `docker-compose.yml` — local Postgres 16 for development (port `5433`).
- `../server/migrations/*.sql` — versioned schema migrations, applied on startup.

## Schema migrations

The schema is defined by numbered SQL files in `server/migrations/`
(e.g. `001_init_schema.sql`). On startup the app runs any migration that has not
yet been applied, in filename order, and records it in the `schema_migrations`
table. Restarts skip already-applied files.

To change the schema (add a column, table, index, etc.), create a **new**
numbered file — for example `002_add_positions_tags.sql`. Never edit a migration
that has already run; the app will refuse to start if an applied file's contents
change (checksum mismatch).

## Local development workflow

1. Start Postgres:

   ```bash
   docker compose -f db/docker-compose.yml up -d
   ```

2. Run the app. It reads `DATABASE_URL` from the root `.env` and applies any
   pending migrations automatically on boot:

   ```text
   DATABASE_URL=postgres://optiontrap:optiontrap@localhost:5433/optiontrap
   ```

   ```bash
   npm run dev
   ```

A brand-new/empty database needs no manual setup — `001_init_schema.sql` creates
all tables on first boot.

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
