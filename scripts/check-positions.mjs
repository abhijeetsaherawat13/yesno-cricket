#!/usr/bin/env node
import { config } from 'dotenv'
config({ path: '.env.local' })

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

async function main() {
  // Get table columns
  const url = `${SUPABASE_URL}/rest/v1/positions?select=*&limit=0`
  const response = await fetch(url, {
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Prefer': 'return=representation'
    }
  })

  console.log('Status:', response.status)
  console.log('Headers:', Object.fromEntries(response.headers.entries()))

  // Try to get the column info from content-profile header or similar
  const text = await response.text()
  console.log('Body:', text)
}

main().catch(console.error)
