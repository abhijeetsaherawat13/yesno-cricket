# YesNo Cricket - Product Roadmap & Task List
**For:** Abhijeet (Product Lead)
**Date:** 7 Feb 2026
**Current State:** V1 deployed, live at https://accomplished-simplicity-production-5889.up.railway.app

---

## Where We Are Today

The platform is fully functional with:
- Live cricket data from 2 APIs (CricketData.org + dcric99 odds)
- Real-time YES/NO price computation
- Buy/sell trading on match outcomes
- PWA-ready (installable on phones)
- Social sharing (OG tags, share button)
- Live scorecard, sparkline charts, trade tape
- Admin panel for match settlement
- Leaderboard

**What's NOT done:** User authentication (everyone is anonymous), server state resets on redeploy (no database persistence), no custom domain, no error tracking.

---

## PHASE 1: Foundation (Week 1-2) - "Make It Real"
*Goal: Every user has their own identity and portfolio that persists.*

### 1.1 Custom Domain
- [ ] Buy domain (yesno.cricket / yesnocricket.in / yesnocricket.com)
- [ ] Point DNS to Railway (CNAME to Railway-provided domain)
- [ ] Update `ALLOWED_ORIGINS` env var on Railway
- [ ] Update OG tags in `index.html` with new domain
- **Owner:** Eng
- **Priority:** P0
- **Why:** Sharing a railway.app URL kills credibility. Takes 30 min once domain is purchased.

### 1.2 User Authentication (Phone OTP)
- [ ] Connect Supabase project (the auth scaffold already exists in code)
- [ ] Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` env vars
- [ ] Wire up the existing auth flow (splash -> phone -> OTP -> success screens already built)
- [ ] Generate unique userId from Supabase auth session
- [ ] Pass userId to all trade/portfolio API calls (currently hardcoded or anonymous)
- [ ] Test: two different phone numbers should see separate portfolios
- **Owner:** Eng
- **Priority:** P0
- **Why:** Without auth, every user shares the same anonymous state. Leaderboard is meaningless. Can't track real users.
- **Note:** The frontend auth screens (phone input, OTP input, success) are already fully built. The Supabase client is scaffolded in `src/lib/supabase.ts`. This is mostly wiring, not building from scratch.

### 1.3 Server State Persistence
- [ ] **Option A (Quick):** Add Redis on Railway ($5/mo) - store users map, positions, orders
- [ ] **Option B (Better):** Connect Supabase Postgres - run `supabase/schema.sql`, enable server-side writes
- [ ] Ensure portfolios survive server restarts/redeploys
- [ ] Backfill existing in-memory data model into persistent store
- **Owner:** Eng
- **Priority:** P0
- **Why:** Currently every Railway redeploy wipes all user portfolios and trade history. This is the #1 blocker for real usage.

### 1.4 Error Monitoring
- [ ] Add Sentry free tier (or LogRocket/BugSnag)
- [ ] Instrument both frontend (React error boundary) and server
- [ ] Set up Slack/email alerts for errors
- **Owner:** Eng
- **Priority:** P1
- **Why:** Users will hit bugs. Without monitoring, we won't know until they complain (and most won't bother).

---

## PHASE 2: Growth Loop (Week 2-3) - "Make People Come Back"

### 2.1 Onboarding Flow
- [ ] Design 3-screen tutorial explaining: What is a prediction market? How YES/NO works? How to profit?
- [ ] Show on first app open only (store `hasOnboarded` in localStorage)
- [ ] Include a "Try a free trade" CTA that takes user to a live match
- **Owner:** Product (design) + Eng (build)
- **Priority:** P1
- **Why:** Users from WhatsApp shares won't understand prediction markets without education. 90% will bounce without this.

### 2.2 Push Notifications
- [ ] Add service worker to PWA (manifest already exists)
- [ ] Implement web push for: match start, settlement result, price alerts
- [ ] Server-side: emit push events on settlement and major price moves
- [ ] Opt-in prompt after first trade (not on landing)
- **Owner:** Eng
- **Priority:** P1
- **Why:** Re-engagement. Users who traded yesterday need a reason to come back today.

### 2.3 Referral System
- [ ] Generate unique referral code per user
- [ ] Referral link format: `yesno.cricket/r/CODE`
- [ ] Reward: Both referrer and referee get Rs 50 bonus on first trade
- [ ] Track referrals on server (referrer_id field on user)
- [ ] Add "Invite Friends" card on wallet page
- **Owner:** Product (rules) + Eng (build)
- **Priority:** P1
- **Why:** Organic growth. Cricket fans share with cricket fan friends. This is the primary growth mechanism for V1.

### 2.4 WhatsApp Sharing Polish
- [ ] Create shareable match result cards (image generation or deep link previews)
- [ ] Add "Share your P&L" button after settlement (shows green/red result card)
- [ ] Pre-filled WhatsApp message with match link + user's prediction
- **Owner:** Product (copy) + Eng (build)
- **Priority:** P2
- **Why:** Social proof drives virality. "I predicted India to win and made Rs 45" is compelling content.

---

## PHASE 3: Product Depth (Week 3-5) - "Make It Sticky"

### 3.1 More Market Types
- [ ] **Top Batsman** - Who scores the most runs?
- [ ] **Total Runs** - Over/Under on total match runs
- [ ] **Next Wicket** - Which batsman gets out next?
- [ ] **Over-by-Over** - Will this over have 6+ runs?
- **Owner:** Product (which markets) + Eng (pricing model)
- **Priority:** P2
- **Why:** Currently only Match Winner market is active. More markets = more trading volume per match = more engagement.
- **Note:** The UI already has tabs for Sessions, Player, Wickets, Over by Over, Odd/Even. These just need server-side market creation and pricing logic.

### 3.2 Match Alerts & Watchlist
- [ ] "Watch" button on match cards
- [ ] Notify on: match start, innings break, result, big price swing (>10p move)
- [ ] Watchlist filter on markets page
- **Owner:** Eng
- **Priority:** P2

### 3.3 Trade History & P&L Dashboard
- [ ] Detailed trade history page (all buys/sells with timestamps)
- [ ] Daily/weekly/monthly P&L breakdown
- [ ] "Best trade" and "Worst trade" highlights
- [ ] Export to CSV
- **Owner:** Eng
- **Priority:** P3

### 3.4 Social Features
- [ ] Public profiles (username, win rate, total P&L)
- [ ] Follow other traders
- [ ] Activity feed: "User X just bought IND YES at 65p"
- **Owner:** Product + Eng
- **Priority:** P3
- **Why:** Social proof and competition drive engagement. Leaderboard already exists; this extends it.

---

## PHASE 4: Monetization & Scale (Week 5+) - "Make Money"

### 4.1 Real Money Integration
- [ ] Integrate Razorpay/Cashfree for UPI deposits
- [ ] KYC flow (Aadhaar + PAN verification)
- [ ] Automated withdrawals via UPI
- [ ] RBI compliance review
- **Owner:** Product (compliance) + Eng (integration)
- **Priority:** P2 (start research in Phase 2)
- **Why:** Virtual currency is fine for learning, but real money is needed for a real business. Needs legal review first.
- **Regulatory Note:** Prediction markets on cricket outcomes may face regulatory scrutiny in India. Consult legal counsel before enabling real money. Consider "skill-based gaming" classification.

### 4.2 Revenue Model
- [ ] **Platform fee:** 2-5% commission on winning trades (deducted at settlement)
- [ ] **Spread:** Widen the YES/NO spread by 1-2p (built into pricing)
- [ ] **Premium features:** Advanced charts, real-time alerts, API access
- **Owner:** Product
- **Priority:** P3

### 4.3 Infrastructure Scale
- [ ] Move from Railway ($5/mo) to AWS/GCP if traffic exceeds 1000 DAU
- [ ] Add CDN for static assets (Cloudflare)
- [ ] Database read replicas if needed
- [ ] Rate limiting per user (currently per IP)
- **Owner:** Eng
- **Priority:** P3

---

## OPERATIONAL TASKS (Ongoing)

### Daily
- [ ] Check Railway health: `curl https://YOUR-DOMAIN/api/health`
- [ ] Monitor CricketData API quota (100 req/day on free tier)
- [ ] Glance at error logs (once Sentry is set up)

### Per Match (Settlement)
- [ ] After match ends, go to `/admin` and settle the match (pick winner)
- [ ] Verify payouts look correct in admin audit trail
- [ ] Note: Auto-settlement is NOT implemented yet. This is manual.

### Weekly
- [ ] Review leaderboard for suspicious activity (bot trading, exploitation)
- [ ] Check Railway billing
- [ ] Review user feedback (if sharing link publicly)

---

## DECISION LOG (Needs Abhijeet's Input)

| # | Decision | Options | Recommendation | Status |
|---|---|---|---|---|
| D1 | Domain name | yesno.cricket / yesnocricket.in / yesnocricket.com | yesno.cricket (short, memorable) | PENDING |
| D2 | Auth provider | Supabase OTP / Firebase Auth / Custom OTP | Supabase (already scaffolded) | PENDING |
| D3 | Persistence | Redis ($5/mo) / Supabase Postgres (free tier) | Supabase Postgres (already have schema) | PENDING |
| D4 | Real money timeline | Phase 2 / Phase 4 / Never | Phase 4 (after legal review) | PENDING |
| D5 | Target DAU for Phase 2 | 50 / 100 / 500 | 100 DAU before starting Phase 3 | PENDING |
| D6 | Referral bonus amount | Rs 25 / Rs 50 / Rs 100 | Rs 50 each (referrer + referee) | PENDING |
| D7 | Auto-settlement | Build it in Phase 1 / Keep manual | Phase 2 (manual is fine for <100 DAU) | PENDING |

---

## METRICS TO TRACK (Once Auth is Live)

| Metric | How to Measure | Target (Phase 1) |
|---|---|---|
| Daily Active Users | Unique userIds with API calls per day | 20+ |
| Trades per User per Day | Total orders / unique users | 3+ |
| Session Duration | Time between first and last API call per session | 5+ min |
| D1 Retention | % of users who return next day | 30%+ |
| D7 Retention | % of users who return after 7 days | 15%+ |
| Referral Rate | % of users who share at least once | 10%+ |
| Avg Portfolio Value | Mean balance + position value | Rs 150+ |

---

## FILE INVENTORY (What's in This Handoff)

```
YesNo-Cricket-Handoff/
  README.md                    <- This technical readme (for developers)
  TASKS-FOR-ABHIJEET.md        <- This file (product roadmap)
  .env.example                 <- Environment variable template
  package.json                 <- Dependencies and scripts
  server/index.mjs             <- The entire backend (~3600 lines)
  src/                         <- All frontend source code
  public/                      <- PWA icons, manifest, OG image
  supabase/schema.sql          <- Database schema for when we add persistence
```

**To get running:** `npm install && cp .env.example .env` (add API key) `&& npm run live`

**To deploy:** `npx @railway/cli login && npx @railway/cli link && npx @railway/cli up --detach`
