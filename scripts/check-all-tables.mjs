#!/usr/bin/env node
import { config } from 'dotenv'
config({ path: '.env.local' })

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const tables = [
  'profiles',
  'wallet_accounts',
  'wallets',
  'matches',
  'markets',
  'positions',
  'wallet_transactions',
  'user_notifications',
  'kyc_records',
  'withdrawal_requests',
  'all_orders',
  'match_settlements',
  'admin_audits'
]

async function checkTable(tableName) {
  const url = `${SUPABASE_URL}/rest/v1/${tableName}?select=*&limit=1`
  const response = await fetch(url, {
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  })
  return { ok: response.ok, status: response.status }
}

async function main() {
  console.log('Checking all tables in Supabase...\n')

  for (const table of tables) {
    const result = await checkTable(table)
    const status = result.ok ? '✅' : '❌'
    console.log(`${status} ${table}`)
  }
}

main().catch(console.error)
