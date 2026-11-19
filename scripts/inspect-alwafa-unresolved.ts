// [PRODUCTION SAFETY QUARANTINE] WIFRAN-ENV-ISOLATION-002
// This script is a historical production utility. Execution against production is blocked by default.
// To execute with explicit authorization, provide BOTH:
//   1. Environment variable: WIFRAN_PRODUCTION_MAINTENANCE_CONFIRMED=1
//   2. CLI argument: --allow-production-admin-operation
import { assertProductionMaintenanceAuthorized } from '../src/main/db/databaseEnvironmentResolver'
assertProductionMaintenanceAuthorized(__filename)

import dotenv from 'dotenv'
dotenv.config({ path: require('path').resolve(process.cwd(), '.env.local') })
import { Client } from 'pg'

async function run() {
  const c = new Client({
    host: 'db.swratbmclahjyekouned.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: (process.env.SUPABASE_DB_PASSWORD || ''),
    ssl: { rejectUnauthorized: false }
  })
  await c.connect()

  const res = await c.query(`
    SELECT id, source_offer_id, title_en, title_ar, sale_unit_type, each_size_value, each_size_unit, inner_pack_count,
           contract_v2->'product_facts' as product_facts,
           contract_v2->'assortment' as assortment
    FROM public.offers
    WHERE source_offer_id LIKE 'alwafa-%' AND product_id IS NULL
    ORDER BY source_offer_id ASC, id ASC;
  `)
  
  console.log(`Found ${res.rows.length} unresolved Alwafa offers:`)
  for (const r of res.rows) {
    console.log(JSON.stringify({
      id: r.id,
      source_offer_id: r.source_offer_id,
      title_en: r.title_en,
      title_ar: r.title_ar,
      sale_unit_type: r.sale_unit_type,
      each_size: `${r.each_size_value || ''} ${r.each_size_unit || ''}`.trim(),
      assortment_status: r.assortment?.status,
      composition: r.assortment?.composition_type
    }, null, 2))
  }

  await c.end()
}

run().catch(console.error)

