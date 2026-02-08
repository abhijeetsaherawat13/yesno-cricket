#!/usr/bin/env node
/**
 * Setup Supabase tables for server state persistence
 * Run with: node scripts/setup-supabase.mjs
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local')
  process.exit(1)
}

console.log('Connecting to Supabase:', SUPABASE_URL)

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function testConnection() {
  console.log('\n1. Testing connection...')

  // Try to query any table to see if we have access
  const { data, error } = await supabase
    .from('wallet_accounts')
    .select('count')
    .limit(1)

  if (error && error.code === '42P01') {
    console.log('   Tables do not exist yet - will create them')
    return false
  } else if (error) {
    console.log('   Connection test result:', error.message)
    return false
  }

  console.log('   Connected successfully!')
  return true
}

async function checkExistingTables() {
  console.log('\n2. Checking existing tables...')

  const tables = [
    'wallet_accounts',
    'positions',
    'all_orders',
    'match_settlements',
    'admin_audits',
    'wallet_transactions'
  ]

  const existing = []

  for (const table of tables) {
    const { error } = await supabase.from(table).select('*').limit(1)
    if (!error) {
      existing.push(table)
      console.log(`   ✓ ${table} exists`)
    } else if (error.code === '42P01') {
      console.log(`   ✗ ${table} does not exist`)
    } else {
      console.log(`   ? ${table}: ${error.message}`)
    }
  }

  return existing
}

async function createServerPersistenceTables() {
  console.log('\n3. Creating server persistence tables...')

  // Since we can't run raw SQL via the JS client, we need to use the REST API
  // The service role key bypasses RLS, so we can insert/select directly

  // Test inserting into all_orders to see if table exists
  const { error: ordersError } = await supabase
    .from('all_orders')
    .select('id')
    .limit(1)

  if (ordersError && ordersError.code === '42P01') {
    console.log('\n   ⚠️  Tables need to be created via Supabase SQL Editor.')
    console.log('   Please run the following SQL in your Supabase dashboard:\n')

    const sqlPath = path.join(__dirname, '..', 'supabase', 'migrations', '20240209000000_initial_schema.sql')
    if (fs.existsSync(sqlPath)) {
      console.log(`   SQL file: ${sqlPath}`)
    }

    console.log(`
   Go to: https://supabase.com/dashboard/project/vmqzazaxerzdhbfjblsv/sql

   Then paste the contents of:
   - supabase/migrations/20240209000000_initial_schema.sql

   OR use the Supabase CLI:
   npx supabase db push
    `)
    return false
  }

  console.log('   ✓ Server persistence tables already exist')
  return true
}

async function testServerPersistence() {
  console.log('\n4. Testing server persistence operations...')

  // Test wallet_accounts with test user format
  const testUserId = 'test-user-setup-check'

  // Test all_orders
  const { error: insertError } = await supabase
    .from('all_orders')
    .insert({
      user_id: testUserId,
      match_id: 1,
      market_id: 1,
      option_label: 'Test',
      side: 'yes',
      shares: 1,
      price: 50,
      cost: 0.50
    })

  if (insertError) {
    console.log(`   ✗ all_orders insert failed: ${insertError.message}`)
    return false
  }

  console.log('   ✓ all_orders insert works')

  // Clean up test record
  await supabase.from('all_orders').delete().eq('user_id', testUserId)
  console.log('   ✓ Cleaned up test record')

  // Test match_settlements
  const { error: settlementError } = await supabase
    .from('match_settlements')
    .insert({
      match_id: 99999,
      winner_code: 'TST',
      winner_full: 'Test Team',
      settled_by: 'setup-script'
    })

  if (settlementError) {
    console.log(`   ✗ match_settlements insert failed: ${settlementError.message}`)
    return false
  }

  console.log('   ✓ match_settlements insert works')

  // Clean up
  await supabase.from('match_settlements').delete().eq('match_id', 99999)
  console.log('   ✓ Cleaned up test settlement')

  // Test admin_audits
  const { error: auditError } = await supabase
    .from('admin_audits')
    .insert({
      action: 'setup_test',
      admin_id: 'setup-script',
      target_id: 'test',
      details: { test: true }
    })

  if (auditError) {
    console.log(`   ✗ admin_audits insert failed: ${auditError.message}`)
    return false
  }

  console.log('   ✓ admin_audits insert works')

  // Clean up
  await supabase.from('admin_audits').delete().eq('action', 'setup_test')
  console.log('   ✓ Cleaned up test audit')

  return true
}

async function main() {
  console.log('='.repeat(60))
  console.log('Supabase Server Persistence Setup')
  console.log('='.repeat(60))

  await testConnection()
  const existing = await checkExistingTables()

  if (existing.includes('all_orders') && existing.includes('match_settlements')) {
    const success = await testServerPersistence()

    if (success) {
      console.log('\n' + '='.repeat(60))
      console.log('✅ All server persistence tables are ready!')
      console.log('='.repeat(60))
      console.log('\nYou can now start the server with:')
      console.log('  DISABLE_AUTH_FOR_TESTING=true npm run server')
      console.log('\nOr build and run full stack:')
      console.log('  DISABLE_AUTH_FOR_TESTING=true npm run live')
    }
  } else {
    await createServerPersistenceTables()
    console.log('\n' + '='.repeat(60))
    console.log('⚠️  Please create tables via Supabase SQL Editor first')
    console.log('='.repeat(60))
  }
}

main().catch(console.error)
