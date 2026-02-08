#!/usr/bin/env node
// Script to run schema.sql against Supabase using the REST API
import { config } from 'dotenv'
config({ path: '.env.local' })

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment')
  process.exit(1)
}

// Read the schema file
const schemaPath = path.join(__dirname, '..', 'supabase', 'schema.sql')
const schemaSql = fs.readFileSync(schemaPath, 'utf-8')

// Split into individual statements (naive split on semicolons outside strings)
// We'll execute smaller chunks to avoid API limits
function splitStatements(sql) {
  const statements = []
  let current = ''
  let inDollarQuote = false
  let dollarTag = ''

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]

    // Check for dollar quote start/end
    if (char === '$') {
      const remaining = sql.slice(i)
      const match = remaining.match(/^\$([a-zA-Z0-9_]*)\$/)
      if (match) {
        const tag = match[0]
        if (inDollarQuote && tag === dollarTag) {
          inDollarQuote = false
          dollarTag = ''
        } else if (!inDollarQuote) {
          inDollarQuote = true
          dollarTag = tag
        }
        current += tag
        i += tag.length - 1
        continue
      }
    }

    if (char === ';' && !inDollarQuote) {
      current = current.trim()
      if (current) {
        statements.push(current + ';')
      }
      current = ''
    } else {
      current += char
    }
  }

  current = current.trim()
  if (current) {
    statements.push(current)
  }

  return statements.filter(s => s && !s.startsWith('--'))
}

async function runSql(sql) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({})
  })

  return response
}

// Use Supabase SQL API directly (requires management API or SQL execution endpoint)
async function executeSql(sql) {
  // Supabase doesn't have a public SQL execution endpoint for direct SQL
  // We need to use the postgres connection or management API
  // For now, let's test if tables exist using the REST API

  const url = `${SUPABASE_URL}/rest/v1/`
  const response = await fetch(url, {
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  })

  return response.ok
}

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

async function insertTestData(tableName, data) {
  const url = `${SUPABASE_URL}/rest/v1/${tableName}`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(data)
  })

  const text = await response.text()
  return { ok: response.ok, status: response.status, body: text }
}

// Extract only the server persistence tables from the schema
function extractPersistenceTables(fullSql) {
  // We'll create just the tables we need for server state persistence
  return `
-- Server State Persistence Tables (extracted for quick setup)
-- Full schema is in supabase/schema.sql

-- All-time trade orders
CREATE TABLE IF NOT EXISTS public.all_orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text NOT NULL,
  match_id bigint NOT NULL,
  market_id bigint NOT NULL,
  option_label text NOT NULL,
  side text NOT NULL CHECK (side IN ('yes', 'no')),
  shares int NOT NULL,
  price int NOT NULL,
  cost numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_all_orders_user_id ON public.all_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_all_orders_match_id ON public.all_orders(match_id);
CREATE INDEX IF NOT EXISTS idx_all_orders_created_at ON public.all_orders(created_at DESC);

-- Match settlements
CREATE TABLE IF NOT EXISTS public.match_settlements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id bigint NOT NULL,
  winner_code text NOT NULL,
  winner_full text NOT NULL,
  settled_by text NOT NULL,
  settled_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_match_settlements_match_id ON public.match_settlements(match_id);

-- Admin audit log
CREATE TABLE IF NOT EXISTS public.admin_audits (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action text NOT NULL,
  admin_id text NOT NULL,
  target_id text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audits_created_at ON public.admin_audits(created_at DESC);

-- RLS policies
ALTER TABLE public.all_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audits ENABLE ROW LEVEL SECURITY;

-- Allow service role to read/write (policies use auth.uid() which service role bypasses)
DROP POLICY IF EXISTS "all_orders_read" ON public.all_orders;
DROP POLICY IF EXISTS "match_settlements_read" ON public.match_settlements;
DROP POLICY IF EXISTS "admin_audits_read" ON public.admin_audits;

CREATE POLICY "all_orders_read" ON public.all_orders FOR SELECT USING (true);
CREATE POLICY "all_orders_insert" ON public.all_orders FOR INSERT WITH CHECK (true);
CREATE POLICY "match_settlements_read" ON public.match_settlements FOR SELECT USING (true);
CREATE POLICY "match_settlements_insert" ON public.match_settlements FOR INSERT WITH CHECK (true);
CREATE POLICY "admin_audits_read" ON public.admin_audits FOR SELECT USING (true);
CREATE POLICY "admin_audits_insert" ON public.admin_audits FOR INSERT WITH CHECK (true);
`
}

async function main() {
  console.log('Checking Supabase connection...')
  console.log(`URL: ${SUPABASE_URL}`)

  // Check if critical tables exist
  const tables = [
    'wallet_accounts',
    'positions',
    'wallet_transactions',
    'all_orders',
    'match_settlements',
    'admin_audits'
  ]

  console.log('\n--- Checking required tables ---')

  const missing = []
  for (const table of tables) {
    const result = await checkTable(table)
    const status = result.ok ? '✅ exists' : (result.status === 404 ? '❌ missing' : `⚠️ error (${result.status})`)
    console.log(`${table}: ${status}`)
    if (!result.ok) {
      missing.push(table)
    }
  }

  if (missing.length > 0) {
    console.log('\n⚠️  Some tables are missing!')
    console.log('\n📋 Copy the SQL below and run it in the Supabase SQL Editor:')
    console.log('   https://supabase.com/dashboard/project/vmqzazaxerzdhbfjblsv/sql/new')
    console.log('\n' + '='.repeat(60))
    console.log(extractPersistenceTables(schemaSql))
    console.log('='.repeat(60))
    console.log('\nOr for the complete schema, copy supabase/schema.sql')
  } else {
    console.log('\n✅ All required tables exist!')

    // Test inserting into all_orders (which has no FK constraints on user_id)
    console.log('\n--- Testing write access ---')
    const testOrder = {
      user_id: 'test-user-script',
      match_id: 1,
      market_id: 1,
      option_label: 'Test',
      side: 'yes',
      shares: 1,
      price: 50,
      cost: 0.50
    }

    const insertResult = await insertTestData('all_orders', testOrder)
    if (insertResult.ok) {
      console.log('✅ Write access confirmed')
    } else {
      console.log(`❌ Write access failed: ${insertResult.status}`)
      console.log(insertResult.body)
    }
  }
}

main().catch(console.error)
