# OptionTrap Multi-User Roadmap

Goal: make OptionTrap safe and reliable for many concurrent Kite users.

This roadmap is based on the current code. Some parts are already multi-user
ready; the main risk is the `sql.js` in-memory + full-file-write storage model.

---

## Current state (audit summary)

Already user-scoped (good):
- `watchlists` / `watchlist_items` — filtered by `user_id`, ownership checked via join.
- `positions` — every read/write/delete filters by `user_id`.
- Sessions — per-cookie, stored in SQLite `sessions` table.

Shared / global (market data — acceptable to share):
- `instruments`, `instruments_meta`
- `oi_history`
- `oi_snapshots`

Main risks:
1. `sql.js` keeps the whole DB in memory and rewrites the ENTIRE file on every
   `persist()`. This does not support multiple server replicas and can lose
   writes under heavy concurrency.
2. Destructive shared endpoints are exposed to every user:
   - `DELETE /api/oi-history` (delete all for a scrip)
   - `DELETE /api/oi-history/old`
   - `POST /api/oi-history/fetch` (any user triggers global fetch)
3. Full-file write cost grows with DB size (instruments + oi_history are large),
   so writes get slower as data grows.

---

## Phase 0 — Make it safe to share NOW (0.5–1 day)

Low effort, prevents the worst problems. Keeps `sql.js`.

- [ ] Force Railway to run a SINGLE replica (no horizontal scaling).
- [ ] Use Railway volume with `DATABASE_PATH=/data/optiontrap.db`.
- [ ] Add `ADMIN_USER_IDS` env var + `requireAdmin` guard.
- [ ] Protect destructive/shared endpoints with `requireAdmin`:
      OI history delete + delete-old (+ optionally fetch).
- [ ] Hide OI History `Delete All` / `Clean Old` buttons for non-admins.
- [ ] Add basic backup: scheduled copy of the DB file.

Outcome: safe for a small trusted group on one instance.

Estimated: **1 day**

---

## Phase 1 — Serialize writes + safer persistence (2–4 days)

Still `sql.js`, but remove the lost-update and slow-write risks on one instance.

- [ ] Add a write queue/mutex so all DB writes are serialized.
- [ ] Debounce `persist()` (e.g. write to disk at most every N seconds / after
      batches) instead of writing the full file on every mutation.
- [ ] Write to a temp file then atomic rename to avoid corrupt DB on crash.
- [ ] Add graceful shutdown flush (persist on SIGTERM/SIGINT).
- [ ] Add structured logging + error capture around DB ops.

Outcome: reliable single-instance multi-user with dozens of users.

Estimated: **2–4 days**

---

## Phase 2 — Migrate to a real concurrent database (1–2 weeks)

This is the real fix for scale and true concurrency.

Option A (recommended): PostgreSQL
- [ ] Add a `db` layer abstraction (repository functions already centralized in
      `server/db.js`, so swap internals, keep exports).
- [ ] Provision Postgres (Railway Postgres plugin).
- [ ] Port schema + migrations (reuse the `server/migrations` SQL concept).
- [ ] Port each exported function to parameterized SQL via `pg`.
- [ ] Move session store to Postgres (`connect-pg-simple`).
- [ ] Data migration script: local SQLite → Postgres.
- [ ] Enable multiple replicas safely.

Option B (lighter): better-sqlite3 (native) + WAL
- [ ] Real disk-backed SQLite with row-level locking + WAL.
- [ ] Removes full-file rewrite problem.
- [ ] Still single-instance (SQLite file), but far more robust.
- [ ] Faster + safer than `sql.js`.

Outcome:
- Postgres → horizontal scale, many users, cloud-managed backups.
- better-sqlite3 → strong single-instance, low ops, cheaper.

Estimated:
- better-sqlite3: **3–5 days**
- Postgres: **1–2 weeks**

---

## Phase 3 — Multi-user product hardening (1–2 weeks)

- [ ] Per-user rate limiting keyed by user (partially exists).
- [ ] Ownership audit + tests for every user-scoped endpoint.
- [ ] Shared OI fetch coordination (dedupe concurrent fetches / lock per scrip).
- [ ] Background jobs for OI/instrument refresh instead of user-triggered.
- [ ] Observability: request logs, error tracking, DB metrics.
- [ ] Automated DB backups + restore test.
- [ ] Load test with simulated concurrent users.

Estimated: **1–2 weeks**

---

## Phase 4 — Optional: accounts + billing (if commercial)

- [ ] App-level identity (email/password or magic link) separate from Kite.
- [ ] Subscription + entitlement gating.
- [ ] Admin dashboard for users/subscriptions.
- [ ] Terms / privacy / disclaimer pages.

Estimated: **1–2 weeks**

---

## Timeline summary

| Goal | Approach | Time |
|------|----------|------|
| Safe for small trusted group | Phase 0 | ~1 day |
| Reliable single instance | Phase 0 + 1 | ~1 week |
| True multi-user, scalable | Phase 0–2 (Postgres) | ~2–3 weeks |
| Production-grade multi-user | Phase 0–3 | ~4–5 weeks |
| Commercial SaaS | Phase 0–4 | ~6–8 weeks |

Recommended path for you now:
1. Do **Phase 0** immediately (share safely).
2. Then **Phase 1** (reliability).
3. Then decide **better-sqlite3** (fast, cheap) vs **Postgres** (scalable) for
   Phase 2 based on how many users you expect.
