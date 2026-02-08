# Deployment Checklist - State Persistence

This checklist ensures the state persistence implementation is properly deployed.

## Pre-Deployment

### 1. Supabase Setup
- [ ] Supabase project created at https://supabase.com/dashboard
- [ ] SQL schema applied from `supabase/schema.sql`
- [ ] Verify tables exist in Supabase Table Editor:
  - [ ] `wallet_accounts`
  - [ ] `positions`
  - [ ] `wallet_transactions`
  - [ ] `all_orders` (NEW)
  - [ ] `match_settlements` (NEW)
  - [ ] `admin_audits` (NEW)
- [ ] Get Project URL from Settings → API
- [ ] Get Service Role Key from Settings → API (NOT anon key)

### 2. Environment Variables

#### Railway Production
- [ ] Go to Railway project settings
- [ ] Add/update variables:
  ```
  SUPABASE_URL=https://xxxxx.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
  ```
- [ ] Verify other required vars still set:
  - [ ] `CRICKETDATA_API_KEY`
  - [ ] `SERVE_FRONTEND=true`
  - [ ] `ADMIN_API_KEY`

#### Local Development
- [ ] Create `.env` file if doesn't exist
- [ ] Add Supabase credentials:
  ```bash
  SUPABASE_URL=https://xxxxx.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
  ```
- [ ] For testing without OAuth, optionally add:
  ```bash
  DISABLE_AUTH_FOR_TESTING=true
  ```
  See `TESTING_WITHOUT_AUTH.md` for details.

### 3. Code Verification
- [ ] Run `node --check server/index.mjs` → No errors
- [ ] Review changes in `server/index.mjs`:
  - [ ] Buy trade endpoint has Supabase writes
  - [ ] Close position endpoint has Supabase writes
  - [ ] Settlement function has Supabase writes
  - [ ] Bootstrap function exists
  - [ ] Bootstrap called in `bootstrap()` before `refreshGateway()`
  - [ ] Portfolio endpoint syncs from Supabase

## Deployment

### Deploy to Railway
```bash
# Option 1: Auto-deploy from Git
git add .
git commit -m "Add state persistence to Supabase"
git push origin main

# Option 2: Railway CLI
npx @railway/cli up --detach
```

### Monitor Deployment Logs
- [ ] Watch Railway logs for:
  - [ ] ✅ "Bootstrapping state from Supabase..."
  - [ ] ✅ "Restored X wallet account(s)"
  - [ ] ✅ "Restored Y open position(s)"
  - [ ] ✅ "Restored Z match settlement(s)"
  - [ ] ✅ "Bootstrap from Supabase completed successfully"
  - [ ] ✅ "Gateway server started"
  - [ ] ✅ "Socket.io real-time engine active"

- [ ] Check for errors:
  - [ ] ❌ "Failed to load wallet accounts from Supabase"
  - [ ] ❌ "Failed to load positions from Supabase"
  - [ ] ❌ "Bootstrap from Supabase failed"

If errors appear, verify Supabase credentials and network connectivity.

## Post-Deployment Testing

### Test 1: Initial Bootstrap
- [ ] Open Railway logs
- [ ] Restart the service (Railway → Deployments → Restart)
- [ ] Verify bootstrap messages appear
- [ ] Note the restoration counts

### Test 2: Place a Trade
- [ ] Open production app in browser
- [ ] Navigate to a live match
- [ ] Place a trade (e.g., buy IND YES for Rs 10)
- [ ] Verify trade succeeds in UI
- [ ] Go to Supabase → Table Editor
- [ ] Check `all_orders` table → should have new row ✅
- [ ] Check `positions` table → should have new row (status='open') ✅
- [ ] Check `wallet_accounts` table → balance should have decreased ✅
- [ ] Check `wallet_transactions` table → debit transaction present ✅

### Test 3: Restart Persistence
- [ ] Note current balance and open positions from UI
- [ ] Restart Railway service
- [ ] Wait for server to come back up (~30-60 seconds)
- [ ] Reload app in browser
- [ ] Verify balance matches what it was before restart ✅
- [ ] Verify open positions still present ✅
- [ ] **SUCCESS CRITERIA:** Data survived the restart!

### Test 4: Close a Position
- [ ] Close an open position from portfolio
- [ ] Verify position closes in UI
- [ ] Go to Supabase → Table Editor
- [ ] Check `positions` table → position should have:
  - [ ] `status='closed'`
  - [ ] `closed_at` timestamp set
- [ ] Check `wallet_accounts` → balance increased ✅
- [ ] Check `wallet_transactions` → credit transaction present ✅

### Test 5: Settlement Flow
- [ ] Go to `/admin` panel
- [ ] Select a completed match
- [ ] Click "Settle Match" and pick winner
- [ ] Verify settlement succeeds
- [ ] Go to Supabase → Table Editor
- [ ] Check `match_settlements` table → new row present ✅
- [ ] Check `positions` table → affected positions should have:
  - [ ] `status='settled'`
  - [ ] `outcome='win'/'lose'/'void'`
  - [ ] `payout` amount set
  - [ ] `settled_at` timestamp set
- [ ] Check `wallet_accounts` → balances updated for winners ✅
- [ ] Check `wallet_transactions` → payout transactions present ✅
- [ ] Check `admin_audits` → settlement action logged ✅

### Test 6: Settlement Persistence
- [ ] Note a settled match ID
- [ ] Restart Railway service
- [ ] Go to `/admin` panel
- [ ] Verify settled match doesn't appear in "Settle Match" options
- [ ] **SUCCESS CRITERIA:** Match stays settled after restart!

### Test 7: Error Handling (Optional)
- [ ] Temporarily change `SUPABASE_SERVICE_ROLE_KEY` to invalid value
- [ ] Restart service
- [ ] Verify logs show "Supabase not configured — starting with empty state"
- [ ] Place a trade → should still work (in-memory)
- [ ] Check logs for "Failed to persist to Supabase" warnings
- [ ] Restore correct `SUPABASE_SERVICE_ROLE_KEY`
- [ ] Restart service
- [ ] Verify bootstrap succeeds
- [ ] **SUCCESS CRITERIA:** Graceful degradation, no crashes!

## Rollback Plan

If something goes wrong:

### Level 1: Disable Supabase Writes (Quick Fix)
Railway → Environment Variables:
- Remove `SUPABASE_URL`
- Remove `SUPABASE_SERVICE_ROLE_KEY`
- Restart service

Server will run in pure in-memory mode (pre-persistence behavior).

### Level 2: Code Rollback
```bash
git revert HEAD
git push origin main
```

### Level 3: Database Cleanup
If tables cause issues:
```sql
DROP TABLE IF EXISTS public.all_orders CASCADE;
DROP TABLE IF EXISTS public.match_settlements CASCADE;
DROP TABLE IF EXISTS public.admin_audits CASCADE;
```

## Success Metrics

✅ All tests pass
✅ No errors in Railway logs
✅ Bootstrap restoration counts > 0 after placing trades
✅ Data survives multiple restarts
✅ Admin panel settlement flow works
✅ No performance degradation (response times < 200ms)

## Post-Launch Monitoring

### First 24 Hours
- [ ] Check Railway logs every 2-4 hours
- [ ] Monitor for "Failed to persist" errors
- [ ] Verify bootstrap succeeds on each restart
- [ ] Check Supabase dashboard for table growth

### First Week
- [ ] Check Supabase storage usage
- [ ] Verify no RLS policy issues
- [ ] Monitor for database connection errors
- [ ] Review table sizes:
  - `all_orders` should grow with every trade
  - `positions` should grow with open positions
  - `match_settlements` should grow with settled matches

### Ongoing
- [ ] Set up Supabase alerts for database issues
- [ ] Monitor Railway logs for persistence errors
- [ ] Review table growth weekly
- [ ] Consider archiving old data after 3-6 months

## Documentation

- [x] `PERSISTENCE_IMPLEMENTATION.md` - Complete technical documentation
- [x] `README.md` - Updated with persistence info
- [x] `supabase/schema.sql` - Extended with new tables
- [x] This checklist

## Notes

- Bootstrap adds ~200-500ms to startup time (acceptable)
- All Supabase writes are async fire-and-forget (zero impact on response time)
- In-memory state remains source of truth during operations
- Supabase provides durability and restore capabilities
- Service role key bypasses RLS policies (required for server operations)

## Completion

Once all tests pass:
- [ ] Mark deployment as successful
- [ ] Notify team/stakeholders
- [ ] Update project status
- [ ] Consider implementing user authentication (next phase)
