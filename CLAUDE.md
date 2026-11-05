# CLAUDE.md — OptionTrap

An options research and paper-trading tool for Indian markets (NSE) on the Zerodha Kite Connect API.
It never places real orders. The user is the sole developer; prod (optiontrap.com) runs pushed `master`.

## Stack and layout

- **Frontend** `src/`: React 18 + TypeScript, Vite (port 3000), React Router 6, StrictMode in dev.
  - `pages/` route pages (lazy-loaded in `App.tsx`), `components/<Feature>/` feature components,
    `services/` API clients + pure pricing/analysis logic, `hooks/`, `utils/`, `styles/` (one CSS file per page/area).
  - Import from `src` with the `@/` alias (`@/services/apiClient`). Import `shared/` by relative path (`../../shared/x.js`).
- **Backend** `server/`: Node 22 + Express (port 3001), plain ESM JavaScript. `index.js` holds the routes, auth
  middleware, Kite REST proxy (`/api/*` → api.kite.trade) and WebSocket ticker proxy (`/ws`). `db.js` is all
  Postgres access plus the migrations runner. Schedulers (`*Scheduler.js`, `nightlyJobs.js`) run inside the server.
- **Shared** `shared/`: plain JS used by **both** server and browser (market time, paper trade rules, automation, stock setups).
  Type-checked through JSDoc (`checkJs`), so give it `@typedef`/`@param` annotations and casts until `tsc` is clean.
- **Database**: Postgres 16 in docker (`optiontrap-postgres`, port 5433, user/db/password `optiontrap`).
- Vite proxies `/api`, `/auth`, `/ws` to 3001. In the browser, always call relative URLs (`/api/...`).

## Commands

- `npm run dev`: starts the DB container, the server (`node --watch`) and Vite.
  - The server restarts on edits **only for files in the `--watch-path` list** in `package.json` `dev`/`dev:server`.
    When you add a server or shared module the server imports, add it to both lists.
  - A restart runs startup code (migrations, schedulers) against the real local DB.
- `npx tsc --noEmit -p .` (CI runs `npx tsc -b`): type-check, must be clean.
- `npx vitest run`: all tests, must pass.
- Run both before every commit. CI (`.github/workflows/ci.yml`) runs the type-check, the tests and gitleaks.
- Shell is Windows (PowerShell + Git Bash). In PowerShell, a commit message containing double quotes breaks argument passing;
  commit with `git commit -F -` and a heredoc from Bash.

## Git workflow

- Everyday fixes are committed on `master`. Trade automation work is on branch `trade-automation`; ask before merging it.
- Run `git branch --show-current` before committing.
- **Commit only when asked; push only when explicitly asked** ("commit" and "push" are separate requests). Prod runs pushed master.
- Commit with explicit paths, or check `git diff --cached` first, so unrelated staged work doesn't slip in.
- Commit message style (follow `git log`):
  - Subject: one plain-English imperative sentence describing the behaviour change for the user, no prefixes
    (`feat:` etc.), no trailing period. E.g. "Price holdings from the quote API, not the holdings reply".
  - Body: short prose (or bullets for several changes) saying what changed and why, wrapped at ~72 columns.
    Mention how it was checked when an API changed ("Checked end to end against the dev server as a throwaway user").
  - End with the `Co-Authored-By:` trailer.

## Working rules (the user has asked for these explicitly)

1. **Don't invent requirements or limits.** No range caps, max values, clamping or extra restrictions the user didn't ask for.
   Never silently rewrite an input the user picked: send it as chosen and show a message if it's invalid.
   If a limit seems wise, ask first.
2. **Never break existing functionality.** Before changing shared code (a service, hook, component, `db.js` function,
   shared rule, route, CSS class), find every caller (grep) and make sure each still works the same.
   - Run the full type-check and test suite after every change, not just the tests for the touched file.
   - Changing a reply shape, function signature, column or class name means updating every use in the same change.
   - Migrations must keep existing data and queries working (see Database).
   - If a change could affect another screen or flow, check that flow too (live check for API changes) and say what you checked.
   - If you're unsure whether something depends on the old behaviour, ask instead of guessing.
3. **Add tests where they add real value**, not for every change:
   - **Always** when fixing a bug: a test that fails before the fix and passes after, so it can't come back.
   - For new or changed logic with real risk: calculations (P&L, pricing, quantities), rules/validation, merges,
     state transitions, date/IST handling, SQL-building, API routes and their error paths.
   - When a test is the only practical way to prove the change doesn't break existing behaviour.
   - **Skip** tests that add little: pure copy/markup/CSS tweaks, moving an element, renames, or tests that only
     restate the implementation. Update existing tests the change breaks instead of piling on new ones.
   - For API changes, also do a live check against the dev server (see Testing).
4. **Design for production scale.** Many users; **assume every table holds millions of rows**, even though the local DB is tiny.
   - Never skip an index because a table is "small" today.
   - **Every new table, column or query gets its indexes in the same change (in the migration).** For each query you add
     or change, check that an index covers it, and add one if not (see "Indexes" under Database).
   - The browser never fetches a full history: filter, page and aggregate on the server, and fetch on demand.
5. **Local dev isn't prod.** Missing local data (snapshots, nightly runs) usually means the laptop or server was off.
   Ask before diagnosing, and don't add timeouts, retries or catch-up code for it.
6. **Market time is IST, always.** The user is in Ireland (4.5–5.5 h behind IST).
   - Never use browser or server local time for market logic. NSE is open 09:15–15:30 IST.
   - Browser helpers: `istDateString`, `istTimeLabel`, `istDaysUntil`, `formatCalendarDate`, `getMarketStatus`, `isMarketLive`
     in `src/utils/marketStatus.ts`.
   - Shared helpers: `shared/marketTime.js` (`marketClock`, `marketDate`, `isMarketOpen`, `isTradingDay`, `MARKET_TIME_ZONE`).
   - Server helpers: `server/marketClock.js` (`istClock`).
   - Convert any local time the user mentions to IST before reasoning about it.
7. **One code path per concept.** When two screens show the same data (e.g. Portfolio and Dashboard holdings), share a
   hook/service, so the screens can't disagree. Extend the shared one; don't fork logic per page.
8. **Ask before touching the local database** (deletes, edits, resets). Test DB code on a scratch database in the docker
   container (create it, run the code, drop it), not on `optiontrap`.
9. Stay in scope. Postponed items (see memory) aren't implemented unasked. Mention them when relevant.
10. When a claim turns out wrong, correct it plainly. Don't guess at causes; prove them (e.g. compare real API replies).

## No hardcoded symbols

**Logic must never depend on a hardcoded symbol.** No index/symbol names (`NIFTY…`, `BANKNIFTY`, `SENSEX`, …) or
instrument tokens in conditions, lookups, keys, defaults, maps, URLs, SQL filters or any other code that decides behaviour.
- Which symbols are indices, their labels, TradingView symbols, lot sizes, `always_snapshot` and `is_market_reference`
  all come from the **instruments table** (migration 017), via `getUnderlying(s)` / `GET /api/underlyings` / `useUnderlyings`.
  If logic needs to treat a symbol specially, add a column/flag to the table, not an `if (symbol === …)`.
- **Quoting a symbol as information is fine:** comments, docs, help notes, examples or explanatory text shown to the user
  (e.g. "e.g. NIFTY weekly options"), test data and migrations may name symbols. The rule is about behaviour, not text.
- `shared/noHardcodedSymbols.test.js` guards this, but it can't tell text from logic: it flags any symbol in a string
  outside comments. For a genuine informational string in app code, add the file to its `ALLOWED` map with the reason
  (like the Login demo card); never use that to let symbol logic through.

## Database and migrations

- Schema changes are numbered SQL files in `server/migrations/NNN_description.sql`, applied on startup in order and
  recorded with a checksum in `schema_migrations`. Line endings are normalised to LF (`.gitattributes`: `*.sql eol=lf`).
- An applied migration whose content changes **blocks server startup**.
- **If the latest migration hasn't reached prod yet, edit it instead of adding a new file.** Check with
  `git log origin/master..HEAD`. On `trade-automation`, `019_trade_automation.sql` is unpushed, so fold automation schema
  changes into it.
  - After editing it, the local DB's row for it must be deleted so it re-applies. The user does this themselves; tell them the command:
    `docker exec optiontrap-postgres psql -U optiontrap -d optiontrap -c "DELETE FROM schema_migrations WHERE name = '<file>'"`.
- Migrations must work on an existing DB with data: `IF NOT EXISTS`, backfill before `NOT NULL`, add constraints in a
  `DO` block guarded by an existence check, and don't fail on odd legacy rows.
- Comment each migration block: what it's for and which query/route it serves (see `018_lookup_indexes.sql`).
- **Indexes** (all tables are assumed to hold millions of rows):
  - Create them in the migration that adds the table/column/query, not "later". `CREATE INDEX IF NOT EXISTS`.
  - Match the query: equality columns first (`user_id`, `mode`, `status`…), then the range/sort column
    (`created_at DESC`, `trade_date`), so the query reads one index range in order, with no sort and no full scan.
  - Every foreign key column gets an index (Postgres doesn't create one), so joins and `ON DELETE CASCADE` stay fast.
  - Use a partial index (`WHERE status = 'open'`) when queries only touch a small slice, and a `UNIQUE` index where the
    data must be unique (also used for upserts with `ON CONFLICT`).
  - Cross-user scans (schedulers, jobs) need their own index or a redesign; never a sequential scan over all users' rows.
  - Don't add duplicate indexes: a composite index on `(a, b)` already serves queries on `a` alone.
  - Prove it: `EXPLAIN` the query with synthetic rows in a rolled-back transaction on a scratch DB and check it uses the index.
- `db.js` conventions:
  - Use the `query` / `rows` / `firstRow` helpers with `$n` parameters only, never string-built values.
  - Every user-owned query filters by `user_id`.
  - Map snake_case rows to camelCase objects in a `mapXRow` / `toX` function.
  - Use transactions (`BEGIN`/`COMMIT`/`ROLLBACK` on a pool client) for multi-statement writes.
  - Use `withAdvisoryLock` / `withNamedAdvisoryLock` for jobs that must not run twice.
  - bigint and numeric come back as JS numbers (type parsers at the top of the file).

## Server API conventions

- **Every endpoint follows REST:**
  - URLs name resources, not actions: plural nouns, kebab-case (`/api/watchlists`, `/api/price-alerts/:id`,
    `/api/watchlists/:id/items`). No verbs in paths (`/api/getTrades`, `/api/positions/exit` are wrong).
  - Methods: `GET` list/read (no side effects), `POST` create (answer **201** with the created resource), `PUT` replace a
    whole resource (e.g. a user's config), `PATCH` partial update. State changes like exit/trigger are a `PATCH` with a
    body (`{ status: 'closed' }`), `DELETE` removes (answer 200 with data, or 204).
  - Nest only for real ownership (`/watchlists/:id/items`), at most one level deep.
  - Filtering, sorting, paging and ranges go in query parameters (`?mode=paper&from=…&to=…`), not the path.
  - Lists that can grow are paged or range-limited on the server (by the user's chosen range, never an invented cap).
  - The resource belongs to the logged-in user; the user id comes from the session, never from the URL or body.
- Every reply is `{ status: 'ok', data }` or `{ status: 'error', message }` (plus `code` when callers branch on it,
  e.g. `SUBSCRIPTION_REQUIRED`, rule codes). Use 400 for bad input, 401 not logged in, 402 no subscription,
  403 not admin, 404 not found, 500 server failure.
- Middleware: `requireAuth`, `requireSubscription` (app features), `requireAdmin`. Own routes go **before** the Kite proxy.
- Validate and parse request bodies in pure functions (in `shared/` when the browser can use them too), returning
  `{ value }`/`{ error }`-style results that routes map to HTTP status codes. Never trust server-owned fields from the body
  (e.g. a paper trade's `source` is set by the caller, never read from input).
- Business rules live as **data** in one place: paper trade rules in `shared/paperTradeRules.js`
  (`{ id, appliesTo, code, check }`), run by `server/paperTrading.js`. Change the list, don't add checks in callers.
- Kite quirks: holdings/positions replies can carry a stale `last_price`, so price from the quote API (`EXCHANGE:SYMBOL` keys)
  and live ticks. Kite 403 `PermissionException` is an ordinary error, not a logout (`isLoginEnded` in apiClient).
- Credentials (Kite API key/secret) live only in the browser; the server never stores them.

## Frontend conventions

- **API calls** go through `apiClient` (`src/services/apiClient.ts`). It unwraps `data`, throws `ApiError` with the
  server's message, and handles login expiry. One typed function per endpoint in `src/services/<area>.ts`, taking an
  optional `signal`.
- **Cancellation:** every load passes an `AbortSignal` (an `AbortController` in the effect, or `useAbortSignal()`).
  Ignore `isAbortError(err)` in catch blocks, and don't set state after abort.
- **Live prices** go through the shared engine `useLivePriced` (load → price from quotes → apply ticks while the market
  is live, re-subscribing only when the token set changes), wrapped by `useHoldings` / `useLivePositions`. Ticks come
  from the `tickerSingleton` (`tickerSubscribe`). Don't open new sockets or poll quotes per page.
- Pure logic (pricing, P&L, ranges, analysis) goes in plain functions in `services/` or a component folder's `*.ts`,
  separate from JSX, so it can be unit-tested. Formatting: `formatAmount` / `formatSignedAmount` (`src/utils/formatAmount.ts`).
  Money shows two decimals.
- Components: `React.FC` with typed props, function components and hooks only. Pages are default exports. Export small
  pieces (and pure helpers) that tests need.
- Forms: settings-style screens are full pages reached from a gear icon, with Save (returns to the parent screen) and Cancel.
  Errors stay on the page with the server's message.
- **Reusable controls: build once, use everywhere.** Any UI element that appears (or will appear) on more than one
  screen is a shared component in its own folder, like the existing ones (`src/components/AppSelect/`,
  `src/components/TabBar/`, `src/components/TradingViewLink/`), with its own styles in one shared CSS file. Pages use the component; they don't copy markup or add page-specific CSS for the same look.
  - Example: the settings **gear button** (icon-only button with tooltip and `aria-label`) is one component used by every
    screen that has settings, not a per-page `automation-settings-btn` class. The same goes for icon buttons, status
    pills/badges, on/off switches, Save/Cancel form footers, loading/error/empty states, section headers with an action.
  - Before writing new markup or CSS, search for an existing component or class that does the job and reuse or extend it
    (add a prop/variant), rather than making a near-copy.
  - When you find two pages styling the same thing separately, mention it and offer to pull it into a shared control.
  - Shared controls take props for the variation (size, variant, label, onClick), use theme variables, and get a test.
- **UI building blocks:** reuse what exists, don't add libraries.
  - `AppSelect` instead of a native `<select>` (supports `searchable` and multi-select).
  - The shared `TabBar` for page tabs. `MarketStrip`.
  - SVG icons in `src/components/icons/Icons.tsx`: add new ones there in the same style (24 viewBox, `currentColor`
    stroke, `aria-hidden`).
  - Buttons `app-btn`, `app-btn--primary|--secondary|--danger|--icon`. Cards `card`, `card__title`, `card__description`.
- **CSS:**
  - Plain CSS, one file per area in `src/styles/`, imported by the page/component.
  - BEM-style names prefixed by area (`automation-header__title`, `positions-table__source`, `automation-stage--rejected`).
  - Use the theme variables from `global.css` (`--text-primary`, `--text-secondary`, `--accent`, `--card-bg`, `--card-border`,
    `--radius`, `--card-gap`), never hard-coded theme colours, so dark/light and accent themes work. Colours that don't
    change with the theme are hard-coded: profit/ok `#22c55e`, loss/error `#ef4444`.
  - Every page's first row is `--page-top-row-height` tall at `--page-top-offset`, lining up with the sidebar brand.
    Put page actions inside the content cards, not over the top-right strip.
- Accessibility: buttons have `type="button"`; icon-only buttons have `aria-label` and `title`; sections use
  `aria-labelledby`; form controls have labels.
- New pages: lazy route in `App.tsx`, nav entry in `Sidebar.tsx` if top-level.
- Dates/times shown to the user are IST (see rule 6).

## Clean code

- Small functions that do one thing, named for what they do; a function that needs "and" in its name is two functions.
- Single responsibility per module: routes parse/validate and map to HTTP, `db.js` does SQL, services hold the logic,
  components render. Don't mix SQL into routes or business logic into JSX.
- DRY: no copy-pasted logic, markup or styles. Extract a shared function/hook/component the second time something repeats.
- Pure functions for logic, side effects at the edges, so the logic is testable without mocks.
- Clear names over comments; no abbreviations except well-known domain ones (LTP, OI, P&L, IST).
- No magic numbers or strings: name them as constants (`FETCH_DELAY_MS`), or keep them as data (rules lists, kinds).
- Early returns instead of deep nesting; no flags that switch a function between two behaviours.
- Handle errors where you can act on them; never swallow one silently (abort errors are the expected exception).
- No dead code, commented-out code, unused exports or leftover debug logging. Delete it; git has the history.
- Keep the change focused: no unrelated refactors or reformatting in the same change; mention them instead.

## Code style

- TypeScript `strict` with `noUnusedLocals`/`noUnusedParameters`; no `any` unless unavoidable (shared JS uses JSDoc types).
- 2-space indent, single quotes, semicolons, trailing commas in multi-line literals, arrow functions for small helpers.
  Long single-line expressions are accepted; match the surrounding file.
- Every module starts with a `/** … */` header explaining **what it is for and why**, and where related rules live.
  Exported functions get a one-line JSDoc. Comments explain intent and non-obvious reasons; don't narrate the code.
- Names are plain and domain-specific (`heldQuantity`, `positionPnl`, `openPaperTrade`).
- User-facing copy is short, plain English; middle dot `·` separates status fragments ("Off · engine not built yet").
  Unavailable options are shown disabled with a reason, not hidden.
- **Line endings:** files are mixed CRLF/LF (`core.autocrlf=true`; e.g. `Dashboard.tsx` is CRLF). When editing by script,
  normalise `\r\n`, edit, and write back with the file's original EOL. Git Bash `sed`/`grep` hide `\r`.

## Testing

- Vitest, no DOM environment: test components with `renderToStaticMarkup` (wrap in `MemoryRouter` when they use the router)
  and assert on the markup. Match tags order-independently (find the tag, then check its attributes).
- Test files sit next to the code: `x.ts` → `x.test.ts`, `server/x.js` → `server/x.test.js`.
- Server tests mock `./db.js` with `vi.mock` and dynamic `await import(...)` after the mock. For mocks that reject once, use
  `mockResolvedValueOnce(...).mockRejectedValueOnce(...)`.
- Inject time (`{ now }`) instead of reading the clock. Write fixed instants with the IST meaning in a comment
  (`new Date('2026-11-05T06:30:00Z') // Thu 12:00 IST`).
- Cover boundaries and error paths. Test the frontend path with the real `apiClient` and a stubbed `fetch`.
- **Live check for API changes:** run against the dev server as a throwaway user (a session cookie signed with the dev
  session secret), exercise each new route, then delete everything it created. Mention it in the commit body.
- DB code: check SQL and migrations on a scratch database in the docker container, then drop it.
  Check query plans with synthetic rows in a rolled-back transaction.

## Domain notes

- Paper positions: `instrument_type` CE/PE/FUT/EQ, `exchange` (EQ→NSE, else NFO), `source` manual/auto, `mode` paper.
  Same-instrument trades merge into one position at the average price, **only within the same source** (auto↔auto,
  manual↔manual, never across).
- Share count for holdings: `quantity + t1_quantity + collateral_quantity − used_quantity`.
- Live position P&L (Kite's formula): `sell_value − buy_value + quantity × ltp × multiplier`.
- OI snapshots are taken every 10 minutes in market hours by `oiSnapshotScheduler.js`. OI history is fetched after close.
  Nightly jobs and the instrument sync run at 08:30 IST.
- Automation (`trade-automation` branch): `shared/automation.js` defines trade kinds, sides, horizons (positional later),
  execution modes (live later) and the lifecycle selected → validated/rejected → executed → closed (`canMoveTo`: no skipping
  validation, nothing rejected after executed). Automated trades go to paper trading only.
