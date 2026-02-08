#!/usr/bin/env node
/**
 * Apply SQL migration to Supabase using the REST API
 */

import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  process.exit(1)
}

// Extract project ref from URL
const projectRef = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1]
if (!projectRef) {
  console.error('Error: Could not extract project ref from SUPABASE_URL')
  process.exit(1)
}

const migrationFile = process.argv[2] || 'supabase/migrations/20240209000002_server_persistence_fix.sql'
const sqlPath = path.resolve(__dirname, '..', migrationFile)

if (!fs.existsSync(sqlPath)) {
  console.error(`Error: Migration file not found: ${sqlPath}`)
  process.exit(1)
}

const sql = fs.readFileSync(sqlPath, 'utf-8')

console.log('='.repeat(60))
console.log('Applying Migration to Supabase')
console.log('='.repeat(60))
console.log(`Project: ${projectRef}`)
console.log(`File: ${migrationFile}`)
console.log()

// Use the Supabase Management API to execute SQL
// Note: This requires the service role key and the SQL endpoint
async function executeSQL(sql) {
  // The REST API for executing arbitrary SQL is at /rest/v1/rpc
  // But we need to create a function first, or use the pg connection directly

  // For Supabase, we can use the PostgREST endpoint with a custom RPC function
  // But since that function doesn't exist, we'll output instructions instead

  console.log('To apply this migration, please do ONE of the following:\n')

  console.log('Option 1: Use Supabase Dashboard')
  console.log('-'.repeat(40))
  console.log(`1. Go to: https://supabase.com/dashboard/project/${projectRef}/sql/new`)
  console.log('2. Paste the following SQL and click "Run":\n')

  // Print the SQL with line numbers
  const lines = sql.split('\n')
  lines.forEach((line, i) => {
    if (line.trim()) {
      console.log(`   ${line}`)
    }
  })

  console.log('\n')
  console.log('Option 2: Use Supabase CLI')
  console.log('-'.repeat(40))
  console.log('npx supabase db push')
  console.log()

  // Actually, let's try using fetch to call the database endpoint
  console.log('Option 3: Attempting direct execution...')
  console.log('-'.repeat(40))

  try {
    // Split SQL into individual statements and execute each
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('--'))

    console.log(`Found ${statements.length} SQL statements to execute`)

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i]
      if (!stmt || stmt.startsWith('--')) continue

      // Extract the command type for logging
      const cmdMatch = stmt.match(/^(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|GRANT)/i)
      const cmdType = cmdMatch ? cmdMatch[1].toUpperCase() : 'SQL'

      // For CREATE TABLE IF NOT EXISTS, we can try using the REST API indirectly
      // But actually the best approach is to check if tables exist using regular queries

      console.log(`  [${i + 1}/${statements.length}] ${cmdType}: ${stmt.slice(0, 50)}...`)
    }

    console.log('\nDirect execution not available via REST API.')
    console.log('Please use Option 1 (Dashboard) or Option 2 (CLI) above.')

  } catch (err) {
    console.error('Error:', err.message)
  }
}

executeSQL(sql)
