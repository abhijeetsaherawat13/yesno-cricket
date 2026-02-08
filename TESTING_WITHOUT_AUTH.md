# Testing Persistence Without OAuth

This guide explains how to test the Supabase persistence implementation without setting up OAuth/authentication.

## The Problem

When Supabase is configured (which we need for persistence), the server's `requireAuth` middleware normally requires a valid JWT token. But we don't have OAuth set up yet, so we can't generate valid tokens.

## The Solution: Test Mode

We've added a special **test mode** that bypasses authentication while still keeping Supabase persistence active.

### How It Works

When `DISABLE_AUTH_FOR_TESTING=true` is set:
- ✅ Supabase persistence is ACTIVE (data gets saved)
- ✅ All API endpoints work without auth tokens
- ✅ All requests use hardcoded `'user-123'` as the user ID
- ✅ Bootstrap function automatically creates a wallet for `user-123` if needed
- ⚠️ A warning appears in logs: "Authentication bypassed, using hardcoded user-123"

## Setup Instructions

### For Local Development

1. **Create/Update `.env` file:**
   ```bash
   # Supabase credentials (required for persistence)
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...your-service-role-key

   # Enable test mode (bypasses auth)
   DISABLE_AUTH_FOR_TESTING=true

   # Other required vars
   CRICKETDATA_API_KEY=your-cricket-api-key
   SERVE_FRONTEND=true
   ADMIN_API_KEY=admin-local-key
   ```

2. **Run Supabase schema:**
   - Go to Supabase dashboard → SQL Editor
   - Copy contents of `supabase/schema.sql`
   - Execute the SQL

3. **Start the server:**
   ```bash
   npm run start
   ```

4. **Check logs for:**
   ```
   ⚠️  DISABLE_AUTH_FOR_TESTING=true — Authentication bypassed, using hardcoded user-123. DO NOT USE IN PRODUCTION!
   Bootstrapping state from Supabase...
   Test mode: Creating wallet for user-123
   Restored 1 wallet account(s)
   Restored 0 open position(s)
   Restored 0 match settlement(s)
   Bootstrap from Supabase completed successfully
   Gateway server started
   ```

### For Railway (Temporary Testing)

1. **Add environment variable:**
   - Go to Railway project settings
   - Add: `DISABLE_AUTH_FOR_TESTING=true`
   - Deploy

2. **⚠️ IMPORTANT:** Remove this variable once testing is done!

## Testing Steps

### Test 1: Initial Setup
```bash
# Check that server started in test mode
curl https://your-app.railway.app/api/health
# Should return 200 OK
```

### Test 2: Check Portfolio (Initial State)
```bash
curl https://your-app.railway.app/api/trades/portfolio
# Should return:
# {
#   "ok": true,
#   "user": {
#     "userId": "user-123",
#     "balance": 100,
#     "suspended": false,
#     "exposure": 0
#   },
#   "positions": []
# }
```

### Test 3: Place a Trade
1. Open app in browser
2. Navigate to a live match
3. Click "Buy YES" or "Buy NO"
4. Enter amount (e.g., Rs 10)
5. Confirm trade

**Expected Result:**
- Trade succeeds ✅
- Balance decreases ✅
- Position appears in portfolio ✅

**Check Supabase:**
- Go to Table Editor
- `all_orders` → Should have new row with user_id='user-123'
- `positions` → Should have new row (status='open')
- `wallet_accounts` → balance should be 90
- `wallet_transactions` → Should have debit transaction

### Test 4: Verify Persistence (Server Restart)
1. Note your current balance and positions
2. Restart server (Railway: Deployments → Restart, or local: Ctrl+C → npm run start)
3. Wait 30 seconds
4. Reload app in browser
5. Check portfolio

**Expected Result:**
- Balance is the same ✅
- Open positions still there ✅
- **SUCCESS!** Data survived the restart!

### Test 5: Close a Position
1. Go to Portfolio tab
2. Click on an open position
3. Click "Close Position"
4. Confirm

**Expected Result:**
- Position closes ✅
- Balance increases ✅
- P&L calculated correctly ✅

**Check Supabase:**
- `positions` → status='closed', closed_at set
- `wallet_accounts` → balance updated
- `wallet_transactions` → credit transaction added

### Test 6: Settlement
1. Go to `/admin` panel
2. Use admin key: `admin-local-key`
3. Find a completed match
4. Click "Settle Match"
5. Pick winner
6. Confirm

**Expected Result:**
- Settlement succeeds ✅
- Affected positions updated ✅
- Balances updated for winners ✅
- Match marked as settled ✅

**Check Supabase:**
- `match_settlements` → new row
- `positions` → affected positions have status='settled', outcome, payout
- `wallet_accounts` → balances updated
- `wallet_transactions` → payout transactions
- `admin_audits` → settlement logged

### Test 7: Restart After Settlement
1. Restart server
2. Go to `/admin` panel
3. Check settled matches

**Expected Result:**
- Settled matches don't appear in "Settle Match" dropdown ✅
- Settlement persisted across restart ✅

## Verifying Database Tables

### Via Supabase Dashboard

1. **Go to Table Editor**
2. **Check each table:**

   **wallet_accounts:**
   ```
   user_id   | balance | bonus_balance | held_balance
   ----------|---------|---------------|-------------
   user-123  | 90.00   | 0.00          | 0.00
   ```

   **positions:**
   ```
   id | user_id  | match_id | option_label | side | shares | status | created_at
   ---|----------|----------|--------------|------|--------|--------|------------
   1  | user-123 | 1        | IND          | yes  | 15     | open   | 2026-02-08...
   ```

   **all_orders:**
   ```
   id | user_id  | match_id | side | shares | price | cost  | created_at
   ---|----------|----------|------|--------|-------|-------|------------
   1  | user-123 | 1        | yes  | 15     | 65    | 10.00 | 2026-02-08...
   ```

   **wallet_transactions:**
   ```
   id | user_id  | type  | amount | description           | created_at
   ---|----------|-------|--------|-----------------------|------------
   1  | user-123 | debit | 10.00  | Bought IND YES        | 2026-02-08...
   ```

### Via SQL Editor

```sql
-- Check wallet balance
SELECT * FROM wallet_accounts WHERE user_id = 'user-123';

-- Check open positions
SELECT * FROM positions WHERE user_id = 'user-123' AND status = 'open';

-- Check trade history
SELECT * FROM all_orders WHERE user_id = 'user-123' ORDER BY created_at DESC LIMIT 10;

-- Check settlements
SELECT * FROM match_settlements ORDER BY settled_at DESC;

-- Check audit trail
SELECT * FROM admin_audits ORDER BY created_at DESC LIMIT 10;
```

## Troubleshooting

### Issue: "Missing authorization token"

**Problem:** `DISABLE_AUTH_FOR_TESTING` is not set or set to 'false'

**Solution:**
```bash
# Add to .env or Railway
DISABLE_AUTH_FOR_TESTING=true
```

### Issue: "Wallet not found" when placing trade

**Problem:** `user-123` doesn't have a wallet account in Supabase

**Solution:** Server should auto-create on startup, but you can manually insert:
```sql
INSERT INTO wallet_accounts (user_id, balance, bonus_balance, held_balance)
VALUES ('user-123', 100, 0, 0)
ON CONFLICT (user_id) DO NOTHING;
```

### Issue: Server logs show "Failed to load wallet accounts"

**Problem:** Supabase credentials are incorrect or network issue

**Solution:**
1. Verify `SUPABASE_URL` is correct (should end with `.supabase.co`)
2. Verify `SUPABASE_SERVICE_ROLE_KEY` is the SERVICE ROLE key, not anon key
3. Check Supabase project status (not paused)
4. Check network connectivity

### Issue: Data not persisting after restart

**Problem:** Supabase writes are failing silently

**Solution:**
1. Check server logs for "Failed to persist to Supabase" errors
2. Verify Supabase tables exist (run schema.sql)
3. Check Supabase project logs for RLS policy errors
4. Verify service role key has full access

### Issue: Bootstrap shows "0 wallet account(s)"

**Problem:** No data in Supabase yet, or tables don't exist

**Solution:**
1. Run `supabase/schema.sql` in SQL Editor
2. Place at least one trade to seed data
3. Restart server to verify bootstrap

## Switching to Real Authentication

Once you're ready to implement real OAuth:

1. **Remove test mode:**
   ```bash
   # In .env or Railway
   DISABLE_AUTH_FOR_TESTING=false
   # Or just remove the variable entirely
   ```

2. **Implement frontend auth:**
   - Set up Supabase Auth in frontend
   - Store auth token in localStorage
   - Send token in Authorization header

3. **Update user IDs:**
   - Real user IDs from Supabase Auth are UUIDs
   - Migrate 'user-123' data to real users if needed
   - Update `wallet_accounts` table to use UUID type (optional)

4. **Test with real users:**
   - Sign up → should create wallet automatically
   - Trade → should persist under real user ID
   - Log out → data should persist
   - Log back in → data should load

## Security Note

**⚠️ NEVER USE TEST MODE IN PRODUCTION!**

Test mode bypasses all authentication:
- Anyone can access any endpoint
- All users share the same 'user-123' account
- No privacy or security whatsoever

**Always set:**
```bash
DISABLE_AUTH_FOR_TESTING=false
```
(or remove the variable entirely) before deploying to production.

## Summary

With `DISABLE_AUTH_FOR_TESTING=true`:
- ✅ You can test persistence without implementing OAuth
- ✅ All API endpoints work without auth tokens
- ✅ Data persists across server restarts
- ✅ All CRUD operations (create, read, update, delete) work
- ✅ Bootstrap function works correctly
- ⚠️ Everyone uses the same 'user-123' account
- ⚠️ No security - FOR TESTING ONLY

This lets you verify the entire persistence implementation works correctly before investing time in OAuth setup!
