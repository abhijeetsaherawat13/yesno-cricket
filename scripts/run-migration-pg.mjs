#!/usr/bin/env node
/**
 * Apply SQL migration directly to Supabase PostgreSQL using pg
 *
 * Usage:
 *   export SUPABASE_DB_PASSWORD="your-password"
 *   node scripts/run-migration-pg.mjs supabase/migrations/20260216_price_history.sql
 */

import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Supabase connection details
const PROJECT_REF = 'vmqzazaxerzdhbfjblsv'
const DB_HOST = `db.${PROJECT_REF}.supabase.co`
const DB_PORT = 5432
const DB_NAME = 'postgres'
const DB_USER = 'postgres'
const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD

if (!DB_PASSWORD) {
  console.error('Error: SUPABASE_DB_PASSWORD environment variable is required')
  console.error('')
  console.error('Set it with:')
  console.error('  export SUPABASE_DB_PASSWORD="your-database-password"')
  console.error('')
  console.error('You can find the password in Supabase Dashboard:')
  console.error('  Settings > Database > Connection string > Password')
  process.exit(1)
}

// Get migration file from args or use default
const migrationArg = process.argv[2] || 'supabase/migrations/20260216_price_history.sql'
const migrationPath = path.resolve(__dirname, '..', migrationArg)

if (!fs.existsSync(migrationPath)) {
  console.error(`Error: Migration file not found: ${migrationPath}`)
  process.exit(1)
}

const sql = fs.readFileSync(migrationPath, 'utf-8')

console.log('='.repeat(60))
console.log('Applying Migration via PostgreSQL')
console.log('='.repeat(60))
console.log(`Host: ${DB_HOST}`)
console.log(`File: ${migrationArg}`)
console.log('')

const client = new pg.Client({
  host: DB_HOST,
  port: DB_PORT,
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD,
  ssl: { rejectUnauthorized: false }
})

try {
  console.log('Connecting to database...')
  await client.connect()
  console.log('Connected!\n')

  console.log('Executing migration...')
  await client.query(sql)
  console.log('Migration applied successfully!\n')

  // Verify the table exists
  const result = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'server_price_history'
  `)

  if (result.rows.length > 0) {
    console.log('Verified: server_price_history table exists')
  } else {
    console.warn('Warning: Could not verify table creation')
  }

} catch (err) {
  console.error('Migration failed:', err.message)
  process.exit(1)
} finally {
  await client.end()
}

console.log('\nDone!')
