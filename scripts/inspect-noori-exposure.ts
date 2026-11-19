// [PRODUCTION SAFETY QUARANTINE] WIFRAN-ENV-ISOLATION-002
// This script is a historical production utility. Execution against production is blocked by default.
// To execute with explicit authorization, provide BOTH:
//   1. Environment variable: WIFRAN_PRODUCTION_MAINTENANCE_CONFIRMED=1
//   2. CLI argument: --allow-production-admin-operation
import { assertProductionMaintenanceAuthorized } from '../src/main/db/databaseEnvironmentResolver'
assertProductionMaintenanceAuthorized(__filename)

import { Client } from 'pg'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

const deadline = setTimeout(() => {
  console.error('[DEADLINE] 25s reached')
  process.exit(1)
}, 25000)
deadline.unref()

async function main() {
  const client = new Client({
    host: 'db.swratbmclahjyekouned.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: process.env.SUPABASE_DB_PASSWORD || '',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
  })

  await client.connect()
  await client.query('SET statement_timeout = 15000')
  await client.query('BEGIN READ ONLY')

  console.log('--- 0. COLUMNS OF PUBLIC.OFFERS ---')
  const colsRes = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'offers'
    ORDER BY ordinal_position;
  `)
  console.log('Offers columns:', colsRes.rows.map(r => `${r.column_name} (${r.data_type})`))

  console.log('--- 1. EXACT OFFERS TABLE ROWS ---')
  const offersRes = await client.query(`
    SELECT *
    FROM public.offers
    WHERE id IN (
      'fd865e4e-e9cb-444a-b71a-80c74efc16e4',
      '2ec312c1-634e-4bc0-98f4-ca45681e2a27',
      '3b3915b7-702b-41c0-95e3-464e8fa3b90f'
    )
    ORDER BY source_offer_id;
  `)
  console.log(JSON.stringify(offersRes.rows, null, 2))

  console.log('--- 2. V_CONSUMER_OFFERS COLUMNS ---')
  const vColsRes = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'v_consumer_offers'
    ORDER BY ordinal_position;
  `)
  console.log('v_consumer_offers columns:', vColsRes.rows.map(r => `${r.column_name} (${r.data_type})`))

  console.log('--- 2b. V_CONSUMER_OFFERS ROWS ---')
  const consumerRes = await client.query(`
    SELECT *
    FROM public.v_consumer_offers
    WHERE id IN (
      'fd865e4e-e9cb-444a-b71a-80c74efc16e4',
      '2ec312c1-634e-4bc0-98f4-ca45681e2a27',
      '3b3915b7-702b-41c0-95e3-464e8fa3b90f'
    )
    ORDER BY source_offer_id;
  `)
  console.log(JSON.stringify(consumerRes.rows, null, 2))

  console.log('--- 3. RPC GET_CONSUMER_OFFERS_FOR_SHOPPING_DATE (2026-11-07, JEDDAH) ---')
  const rpcRes = await client.query(`
    SELECT *
    FROM public.get_consumer_offers_for_shopping_date(
      '2026-11-07'::date,
      'a6f7b140-0002-4444-a000-000000000002'::text
    );
  `)
  console.log('Total returned by RPC:', rpcRes.rows.length)
  const nooriInRpc = rpcRes.rows.filter(r => r.source_offer_id?.startsWith('noori'))
  console.log('Noori offers in RPC result:', JSON.stringify(nooriInRpc.map(r => ({
    id: r.id,
    source_offer_id: r.source_offer_id,
    title_en: r.title_en,
    offer_price: r.offer_price,
    source_reported_original_price: r.source_reported_original_price,
    deal_score: r.deal_score,
    supermarket_name_en: r.supermarket_name_en,
    city_name_en: r.city_name_en,
    publication_status: r.publication_status,
    temporal_lifecycle_state: r.temporal_lifecycle_state
  })), null, 2))
  console.log('Top 5 overall in RPC result:')
  console.log(JSON.stringify(rpcRes.rows.slice(0, 5).map(r => ({
    id: r.id,
    source_offer_id: r.source_offer_id,
    title_en: r.title_en,
    offer_price: r.offer_price,
    source_reported_original_price: r.source_reported_original_price,
    deal_score: r.deal_score,
    supermarket_name_en: r.supermarket_name_en
  })), null, 2))

  console.log('--- 4. CHECK STATUS CONSTRAINTS ON PUBLIC.OFFERS ---')
  const constRes = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) as def
    FROM pg_constraint
    WHERE conrelid = 'public.offers'::regclass
      AND (conname LIKE '%status%' OR conname LIKE '%active%');
  `)
  console.log(JSON.stringify(constRes.rows, null, 2))

  console.log('--- 5. V_CONSUMER_OFFERS DEFINITION WHERE CLAUSE ---')
  const viewDefRes = await client.query(`
    SELECT pg_get_viewdef('public.v_consumer_offers'::regclass, true) as def;
  `)
  const def = viewDefRes.rows[0].def
  console.log('WHERE clause:', def.substring(def.indexOf('WHERE ')))

  console.log('--- 6. TRIGGERS ON PUBLIC.OFFERS ---')
  const trgRes = await client.query(`
    SELECT tgname, pg_get_triggerdef(oid) as def
    FROM pg_trigger
    WHERE tgrelid = 'public.offers'::regclass AND NOT tgisinternal;
  `)
  console.log('Triggers on public.offers:', JSON.stringify(trgRes.rows, null, 2))

  await client.query('ROLLBACK')
  await client.end()
}

main().catch(err => {
  console.error('Inspection error:', err)
  process.exit(1)
})
