// [PRODUCTION SAFETY QUARANTINE] WIFRAN-ENV-ISOLATION-002
// This script is a historical production utility. Execution against production is blocked by default.
// To execute with explicit authorization, provide BOTH:
//   1. Environment variable: WIFRAN_PRODUCTION_MAINTENANCE_CONFIRMED=1
//   2. CLI argument: --allow-production-admin-operation
import { assertProductionMaintenanceAuthorized } from '../src/main/db/databaseEnvironmentResolver'
assertProductionMaintenanceAuthorized(__filename)

import { Client } from 'pg'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

async function inspectDb() {
  const host = process.env.SUPABASE_DB_HOST || 'db.swratbmclahjyekouned.supabase.co'
  const port = parseInt(process.env.SUPABASE_DB_PORT || '5432', 10)
  const user = process.env.SUPABASE_DB_USER || 'postgres'
  const password = process.env.SUPABASE_DB_PASSWORD
  const database = 'postgres'

  console.log(`[INSPECT] Connecting to ${host}:${port} as ${user}...`)

  const client = new Client({
    host,
    port,
    user,
    password,
    database,
    ssl: { rejectUnauthorized: false }
  })

  await client.connect()

  // 1. All public tables
  const tablesRes = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `)
  const tables = tablesRes.rows.map((r) => r.table_name)
  console.log(`\n=== ALL PUBLIC BASE TABLES (${tables.length}) ===`)

  const rowCounts: Record<string, number> = {}
  for (const t of tables) {
    try {
      const cRes = await client.query(`SELECT COUNT(*)::int as count FROM public."${t}";`)
      rowCounts[t] = cRes.rows[0].count
    } catch (e: any) {
      console.warn(`Could not count rows in ${t}:`, e.message)
      rowCounts[t] = -1
    }
  }

  for (const [table, count] of Object.entries(rowCounts)) {
    console.log(`  - ${table.padEnd(35)}: ${count} rows`)
  }

  // 2. All foreign keys referencing products or offers, or referencing other tables
  const fkRes = await client.query(`
    SELECT
      tc.table_name AS source_table,
      kcu.column_name AS source_column,
      ccu.table_name AS target_table,
      ccu.column_name AS target_column,
      rc.delete_rule,
      rc.update_rule,
      tc.constraint_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.referential_constraints AS rc
      ON tc.constraint_name = rc.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    ORDER BY ccu.table_name, tc.table_name;
  `)

  console.log(`\n=== ALL FOREIGN KEY CONSTRAINTS IN PUBLIC (${fkRes.rows.length}) ===`)
  for (const r of fkRes.rows) {
    console.log(`  ${r.source_table}.${r.source_column} -> ${r.target_table}.${r.target_column} [ON DELETE ${r.delete_rule}] (${r.constraint_name})`)
  }

  // 3. Check for any triggers on products or offers
  const triggerRes = await client.query(`
    SELECT 
      event_object_table,
      trigger_name,
      event_manipulation,
      action_timing,
      action_statement
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
    ORDER BY event_object_table, trigger_name;
  `)

  console.log(`\n=== ALL TRIGGERS IN PUBLIC (${triggerRes.rows.length}) ===`)
  for (const tr of triggerRes.rows) {
    console.log(`  ${tr.event_object_table}: ${tr.trigger_name} [${tr.action_timing} ${tr.event_manipulation}]`)
  }

  await client.end()
}

inspectDb().catch(console.error)

