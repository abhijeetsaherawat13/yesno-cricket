# YesNo Cricket - Prediction Market Platform

**Live URL:** https://accomplished-simplicity-production-5889.up.railway.app
**Railway Account:** rahejaluv@gmail.com
**Railway Project:** accomplished-simplicity (ID: `dd519dd9-eb14-44df-bafe-5b52f68e5d49`)

---

## What This Is

A mobile-first cricket prediction market where users trade YES/NO positions on live match outcomes. Think Probo/Polymarket but for cricket.

**Current state:** Fully functional, deployed, pulling live match data from 2 cricket APIs (CricketData.org + dcric99), computing real-time YES/NO prices, supporting buy/sell trading with full state persistence to Supabase (user balances, positions, and settlements survive server restarts).

### V1 Business Rules
- No real money deposits
- Rs 100 signup bonus for every new user
- Manual withdrawals only when earned balance >= Rs 500
- All trading uses virtual currency

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript 5.9, Vite 7 |
| State | Zustand 5 with localStorage persistence |
| Styling | Single CSS file (`src/styles/prototype.css`) - no Tailwind/modules |
| Server | Express 5, Node.js 20+, Socket.io |
| Real-time | Socket.io (primary) + HTTP polling (fallback, 30s) |
| Data | CricketData.org API + dcric99 live odds |
| Database | Supabase Postgres (active, persists user data) |
| Hosting | Railway |

---

## Project Structure

```
yesno-web-app/
  server/index.mjs          # ~3600 lines - Express API + Socket.io + cricket data polling
  src/
    components/              # Shared UI (BottomNav, MatchCard, Toast, Modal, etc.)
    data/mockData.ts         # Demo/fallback data when APIs unavailable
    hooks/                   # useAppNavigation, useBackendBootstrap
    lib/                     # chartUtils, formatters, portfolioStats, supabase client
    pages/                   # All page components (markets, trading, wallet, admin, etc.)
    services/
      backend.ts             # Orchestrator - routes to gateway/supabase/mock
      gateway.ts             # HTTP client for server REST APIs
      liveFeeds.ts           # Direct cricket API clients (fallback path)
      socket.ts              # Socket.io connection + event listeners
    store/useAppStore.ts     # Zustand store (balance, positions, transactions, etc.)
    styles/prototype.css     # All CSS in one file
    types/app.ts             # TypeScript interfaces
  public/                    # PWA manifest, icons, OG image
  supabase/schema.sql        # Database schema (for future Supabase setup)
  Procfile                   # Railway start command
```

---

## Quick Start (Local Development)

```bash
# 1. Install dependencies
npm install

# 2. Copy environment variables
cp .env.example .env
# Edit .env - at minimum set CRICKETDATA_API_KEY for live data

# 3. Start (frontend + API on one server)
npm run live
# Opens at http://localhost:8787

# 4. Or for hot-reload dev mode:
npm run dev:full
```

### Key Environment Variables

| Variable | Required | Description |
|---|---|---|
| `CRICKETDATA_API_KEY` | Yes (for live data) | CricketData.org API key |
| `VITE_ENABLE_GATEWAY` | Yes | Set to `true` to use the Express server |
| `SERVE_FRONTEND` | Yes (prod) | Server serves built frontend from `/dist` |
| `ADMIN_API_KEY` | Optional | Protects admin endpoints |
| `STARTING_BALANCE` | Optional | Default: 100 (signup bonus in Rs) |
| `DCRIC99_ENABLED` | Optional | Default: true (external odds provider) |
| `POLL_INTERVAL_MS` | Optional | Default: 30000 (cricket data polling interval) |

See `.env.example` for the full list.

---

## Deployment (Railway)

The app is already deployed. To redeploy after changes:

```bash
# Login to Railway (if not already)
npx @railway/cli login

# Link to existing project
npx @railway/cli link

# Deploy
npx @railway/cli up --detach
```

**Railway environment variables already set:**
- `NODE_VERSION=20`
- `CRICKETDATA_API_KEY` (current key)
- `SERVE_FRONTEND=true`
- `VITE_ENABLE_GATEWAY=true`
- `DCRIC99_ENABLED=true`
- `ALLOWED_ORIGINS` (production URL)
- `SUPABASE_URL` (configured)
- `SUPABASE_SERVICE_ROLE_KEY` (configured)

**Important:**
- Node >= 20 is required. Express 5 uses undici which needs the `File` global (not available in Node 18).
- Supabase credentials must be set for state persistence to work. See `PERSISTENCE_IMPLEMENTATION.md` for details.

---

## Architecture Overview

### Data Flow
```
CricketData.org API ----\
                         +---> server/index.mjs ---> In-memory state
dcric99 odds API -------/         |                      |
                                  |                      |
                            Socket.io push          REST APIs
                                  |                      |
                                  v                      v
                              React Frontend (Zustand store)
```

### How Pricing Works
1. Server polls CricketData.org every 30s for live match scores
2. Server polls dcric99 for external betting odds
3. If external odds exist, they are converted to YES/NO prices (0-100 paisa)
4. If no external odds, server computes modeled prices from score/overs/wickets/match phase
5. Price history is stored in `state.historyByMarketKey` (480 points per market)
6. Frontend receives prices via Socket.io push or HTTP polling fallback

### Key Server State (`server/index.mjs`)
- `state.matches` - Live match list with scores and prices (in-memory, from APIs)
- `state.users` - User balances and portfolios (persisted to Supabase)
- `state.orders` - Complete trade history (persisted to Supabase)
- `state.positionsByUser` - Open/closed/settled positions (persisted to Supabase)
- `state.settlementsByMatch` - Match settlement records (persisted to Supabase)
- `state.historyByMarketKey` - Price history per market (in-memory, 480 points)
- **Critical state persists** - balances, positions, settlements survive restarts

### Key Frontend Patterns
- **Navigation:** Hash-based routing via Zustand `routeData` + `useAppNavigation` hook
- **State persistence:** Zustand persist middleware with localStorage key `yesno-app-state-v1`
- **Real-time:** Socket.io for price/match/portfolio updates, with 30s HTTP polling fallback
- **Toasts:** `addToast(message, variant)` via Zustand slice, auto-dismiss 3s, max 3 visible
- **Modal:** `setModal({ title, text, actions })` via Zustand slice

---

## Completed Milestones

| Milestone | What |
|---|---|
| M1: Stabilize | Project scaffold, file structure, TypeScript |
| M2: Real-Time | Socket.io + HTTP polling for live data |
| M3: Settlement | Match settlement flow with payouts |
| M4: Enhanced Odds | External odds providers (dcric99, scraper) |
| M5: Persistence | Supabase integration - balances/positions/settlements survive restarts |
| M5: Portfolio | Stats tab, equity curve chart, leaderboard |
| M6: Production | Railway deployment, server hardening |
| M7: Soft Launch | Toasts, loading states, validation, text overflow |
| M8: Share-Ready | PWA manifest, OG/Twitter cards, share button, sparklines, trade tape, live P&L, portfolio sync |

---

## State Persistence

As of February 8, 2026, critical server state is now persisted to Supabase Postgres:

**What Survives Restarts:**
- ✅ User balances (wallet_accounts)
- ✅ Open positions (positions)
- ✅ Closed positions (positions)
- ✅ Settled positions (positions)
- ✅ Trade history (all_orders)
- ✅ Match settlements (match_settlements)
- ✅ Admin audit trail (admin_audits)

**What Stays In-Memory:**
- ⚡ Live match data (fetched from APIs)
- ⚡ Market prices & price history
- ⚡ WebSocket connections
- ⚡ Rate limit tracking

**How It Works:**
1. On startup: Server loads data from Supabase into in-memory state
2. During operations: All changes written to both in-memory state AND Supabase (async)
3. On restart: Server restores state from Supabase

**Implementation:** See `PERSISTENCE_IMPLEMENTATION.md` for complete documentation.

---

## Known Limitations / Tech Debt

1. ~~**In-memory server state**~~ - ✅ FIXED: Critical state now persisted to Supabase.
2. **No user authentication** - Everyone shares anonymous state. Supabase OTP auth is scaffolded but not wired up.
3. **Single server file** - `server/index.mjs` is ~3600 lines. Should be split into modules.
4. **No error monitoring** - No Sentry or equivalent. Crashes are silent.
5. **Bundle size** - ~560KB. Chunk splitting not configured (Vite warning expected).
6. **Server positions use `p.stake`** not `p.cost` (client-side field name). Mapping happens in `fetchGatewayPortfolioSnapshot()`.
7. **CricketData API free tier** - 100 requests/day. Check usage at cricketdata.org dashboard.

---

## Common Gotchas for Developers

- **TypeScript strict mode** - Unused variables cause build failure (TS6133). Clean up before deploying.
- **Server file is huge** - Use grep to find specific sections rather than reading the whole file.
- **Position ID mismatch** - Server and client both generate IDs via `Date.now()`. After buy, always use the server-returned position ID (see `syncBuyTrade()` in `backend.ts`).
- **Market key format** - `${matchId}:${marketId}:${normalizedLabel}:${side}` (used for price history lookup)
- **Match Winner market** always has `id: 1` with `match.teamA` as the first option.

---

## Admin Console

Navigate to `/admin` in the app. Features:
- View all live matches with trading status
- Pause/resume trading on any match
- Suspend/unsuspend users
- Manually settle matches (pick winner)
- View audit trail

Requires `VITE_GATEWAY_ADMIN_KEY` to be set (matches `ADMIN_API_KEY` on server).

---

## API Reference (Key Endpoints)

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | GET | Health check with feed status |
| `/api/live/matches` | GET | All matches with prices + sparklines |
| `/api/live/markets/:matchId` | GET | Markets for a specific match |
| `/api/live/history` | GET | Price history (query: matchId, marketId, optionLabel, side) |
| `/api/live/trades/:matchId` | GET | Recent trades for a match (trade tape) |
| `/api/trades/orders` | POST | Place a buy order |
| `/api/trades/positions/:id/close` | POST | Sell/close a position |
| `/api/trades/portfolio` | GET | User portfolio (query: userId) |
| `/api/leaderboard` | GET | Top traders leaderboard |
| `/api/withdrawals` | POST | Request withdrawal |
| `/api/admin/*` | Various | Admin endpoints (require x-admin-key header) |

---

## Supabase Setup (Optional - for persistent data)

1. Create a Supabase project
2. Run `supabase/schema.sql` in Supabase SQL Editor
3. Set env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
4. For server-side JWT verification: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
5. Without these, app runs fully on in-memory server state

## Odds Scraper Setup (Optional)

Set `ODDS_SCRAPER_SITES_JSON` on backend for additional odds sources:

```bash
ODDS_SCRAPER_SITES_JSON='[{
  "name": "site-a",
  "url": "https://example.com/odds",
  "format": "html",
  "eventSelector": ".event-row",
  "homeSelector": ".home-name",
  "awaySelector": ".away-name",
  "homeOddsSelector": ".home-odds",
  "awayOddsSelector": ".away-odds"
}]'
```

Supported formats: `html` (CSS selectors) and `json` (path-based extraction).
