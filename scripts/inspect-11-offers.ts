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

async function inspect11() {
  const client = new Client({
    host: 'db.swratbmclahjyekouned.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: (process.env.SUPABASE_DB_PASSWORD || ''),
    ssl: { rejectUnauthorized: false }
  })
  await client.connect()

  const res = await client.query(`
    SELECT o.id as offer_id, o.source_offer_id, o.title_en, o.title_ar,
           o.brand_candidate_text, o.exact_identity_status, o.product_attributes,
           o.sale_unit_type, o.each_size_value, o.each_size_unit, o.inner_pack_count,
           o.image_url, o.image_path, o.contract_v2,
           p.id as product_id, p.canonical_product_key, p.item_name_complete,
           p.name_en as p_name_en, p.name_ar as p_name_ar, p.brand_name as p_brand
    FROM public.offers o
    JOIN public.products p ON p.id = o.product_id
    WHERE o.catalog_match_status = 'verified_linked'
    ORDER BY p.canonical_product_key
  `)

  console.log(`Linked offers count: ${res.rows.length}\n`)
  for (const r of res.rows) {
    console.log(`=============================================================`)
    console.log(`Offer ID: ${r.offer_id} | Source: ${r.source_offer_id}`)
    console.log(`Title EN: "${r.title_en}"`)
    console.log(`Title AR: "${r.title_ar}"`)
    console.log(`Product ID: ${r.product_id}`)
    console.log(`Product Key: ${r.canonical_product_key}`)
    console.log(`Brand: ${r.brand_candidate_text} | Product Brand: ${r.p_brand}`)
    console.log(`Size: ${r.each_size_value} ${r.each_size_unit} | Pack: ${r.inner_pack_count}x ${r.sale_unit_type}`)
    console.log(`Attributes:`, r.product_attributes)
    console.log(`Exact Identity Status: ${r.exact_identity_status}`)
    console.log(`Facts Model/Scent/Flavor:`, r.contract_v2?.product_facts?.attributes)
    console.log(`Crop Image URL:`, r.image_url)
  }

  await client.end()
}

inspect11().catch(err => {
  console.error(err)
  process.exit(1)
})

