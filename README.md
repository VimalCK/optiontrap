# OptionTrap

An options research and decision tool for Indian markets (NSE), built on the
[Zerodha Kite Connect API](https://kite.trade). OptionTrap analyses option
chains, open interest and prices so you can decide on a trade; it does not
place orders on your account.

![OI History](public/showcase/oi-history.png)

## Features

| Area | What it does |
|------|--------------|
| **Option Analyzer** | Live option chain with IV-based OI flow (buyers/writers adding or exiting), option fair value and trap analysis |
| **OI History** | Daily OI and price history per strike and expiry, the OI Snapshot grid, futures context, trade-setup signals with outcome tracking |
| **Fair value** | Each option's IV against an SVI volatility curve, priced with Black-76 on a put-call-parity forward (see `src/services/fairValue.ts`) |
| **Positions & journal** | Paper positions with a risk panel and payoff curve, trade journal, P&L heatmap, win/loss patterns |
| **Portfolio & watchlist** | Holdings, real Kite positions, watchlists with live ticks |
| **Accounts** | Kite OAuth login, subscriptions, admin pages (users, feedback inbox) |

After the market closes, the server fetches the day's OI history for every
tracked scrip (`server/oiHistoryScheduler.js`), so a day nobody fetched by hand
isn't lost when its contracts expire.

## Stack

- **Frontend:** React 18 + TypeScript, Vite, React Router (`src/`)
- **Backend:** Node.js + Express, WebSocket proxy to Kite's ticker (`server/`)
- **Database:** PostgreSQL 16, with versioned SQL migrations applied on startup
  (`server/migrations/`, see [`db/README.md`](db/README.md))

## Requirements

- Node.js 22
- Docker (for the local Postgres)
- A Zerodha account with a [Kite Connect](https://developers.kite.trade/) app
  (API key and secret). Users enter these on the login page; they stay in the
  browser and are not stored on the server.

## Getting started

```bash
git clone https://github.com/VimalCK/optiontrap.git
cd optiontrap
npm install
cp .env.example .env
npm run dev
```

`npm run dev` starts the local Postgres container (`scripts/start-db.mjs`),
then the API server on <http://localhost:3001> and the app on
<http://localhost:3000>. A fresh database needs no setup: migrations create the
schema on first boot.

In your Kite Connect app settings, set the redirect URL to
`http://localhost:3000/redirect`.

### Environment

All variables go in the root `.env`:

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | — | Postgres connection string (local: `postgres://optiontrap:optiontrap@localhost:5433/optiontrap`) |
| `SESSION_SECRET` | insecure dev value | Session cookie signing key. **Set a random 32+ character string in production.** |
| `PORT` | `3001` | API server port |
| `FRONTEND_ORIGIN` | `http://localhost:3000` | Allowed CORS origin in development |
| `PG_POOL_MAX` | — | Optional Postgres pool size |

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Database, API server (restarts on server edits) and Vite dev server |
| `npm test` | Unit tests (Vitest) |
| `npm run build` | Type-check and production build |
| `npm start` | Run the API server only (production) |

## Tests and CI

```bash
npm test          # vitest
npx tsc -b        # type-check
```

Every push runs the type-check, the tests and a [gitleaks](https://github.com/gitleaks/gitleaks)
secret scan (`.github/workflows/ci.yml`).

## Project layout

```text
src/
  pages/          route-level pages (Portfolio, Analytics, Watchlist, Admin, …)
  components/     feature components (OiHistory, OptionChain, TrapAnalyzer, …)
  services/       pricing and analysis (fairValue, oiFlow, positionRisk, …) and API clients
server/
  index.js        Express app, auth, Kite proxy, WebSocket gate
  db.js           Postgres access and migrations runner
  migrations/     numbered schema migrations
db/               local Postgres (docker-compose)
scripts/          dev helpers
```

## Disclaimer

OptionTrap is an analysis tool, not investment advice. Option trading carries
substantial risk. Not affiliated with Zerodha.
