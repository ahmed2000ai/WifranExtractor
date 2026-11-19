// [PRODUCTION SAFETY QUARANTINE] WIFRAN-ENV-ISOLATION-002
// This script is a historical production utility. Execution against production is blocked by default.
// To execute with explicit authorization, provide BOTH:
//   1. Environment variable: WIFRAN_PRODUCTION_MAINTENANCE_CONFIRMED=1
//   2. CLI argument: --allow-production-admin-operation
import { assertProductionMaintenanceAuthorized } from '../src/main/db/databaseEnvironmentResolver'
assertProductionMaintenanceAuthorized(__filename)

import path from 'path'
import dotenv from 'dotenv'
import { Client } from 'pg'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

async function run() {
  const client = new Client({
    host: 'db.swratbmclahjyekouned.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: process.env.SUPABASE_DB_PASSWORD || '',
    ssl: { rejectUnauthorized: false }
  })
  await client.connect()
  const res = await client.query(`
    SELECT o.id, o.source_offer_id, o.title_en, o.title_ar, o.product_id,
           o.sale_unit_type, o.inner_pack_count, o.each_size_value, o.each_size_unit
    FROM public.offers o
    WHERE o.supermarket_id = 'c2cc16c2-0008-4444-b000-c00000000008'
      AND o.assortment_status = 'single_product'
    ORDER BY o.source_offer_id;
  `)
  console.log(`Hyper Alwafa single_product offers: ${res.rows.length}`)
  for (const r of res.rows) {
    console.log(`ID: ${r.id} | linked: ${r.product_id ? 'YES(P' + r.product_id + ')' : 'NO'} | ${r.title_en} (${r.title_ar}) | ${r.inner_pack_count}x ${r.each_size_value} ${r.each_size_unit} (${r.sale_unit_type})`)
  }
  await client.end()
}
run()
