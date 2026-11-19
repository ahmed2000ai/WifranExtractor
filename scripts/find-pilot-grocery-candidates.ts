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
import { buildCanonicalProductKey, buildItemNameComplete } from '../src/main/db/productCatalogResolutionService'

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
    SELECT o.id, o.source_offer_id, o.title_en, o.title_ar, o.brand_candidate_text,
           o.sale_unit_type, o.inner_pack_count, o.each_size_value, o.each_size_unit,
           o.offer_price, o.original_price, o.product_id, o.catalog_match_status,
           o.assortment_status, s.name_en AS supermarket
    FROM public.offers o
    LEFT JOIN public.supermarkets s ON s.id = o.supermarket_id
    ORDER BY s.name_en, o.source_offer_id;
  `)

  console.log(`Total offers: ${res.rows.length}`)

  // Filter for genuine packaged grocery items
  const candidates: any[] = []

  for (const o of res.rows) {
    const title = (o.title_en || '').toLowerCase()
    const isPerKg = o.sale_unit_type === 'kg' || title.includes('/ kg') || title.includes('/kg') || title.includes('per kg')
    const isAssorted = title.includes('asstd') || title.includes('assorted') || title.includes(' / ') || title.includes('5+1 free')
    const isGeneralMerchOrBakery =
      title.includes('cake') || title.includes('tv') || title.includes('phone') ||
      title.includes('pad') || title.includes('airpods') || title.includes('earbuds') ||
      title.includes('flashlight') || title.includes('trimmer') || title.includes('mixer') ||
      title.includes('peeling') || title.includes('pan') || title.includes('drainer') ||
      title.includes('shoes') || title.includes('bed sheet') || title.includes('plane') ||
      title.includes('backpack') || title.includes('managesh') || title.includes('petit four') ||
      title.includes('baraziq') || title.includes('bag 16in') || title.includes('fan') ||
      title.includes('dryer') || title.includes('tab')

    if (isPerKg || isAssorted || isGeneralMerchOrBakery) {
      continue
    }

    // Must have size or pack count
    const hasSize = o.each_size_value != null && Number(o.each_size_value) > 0
    const hasPack = o.inner_pack_count != null && Number(o.inner_pack_count) > 0

    if (!hasSize && !hasPack) {
      continue
    }

    candidates.push({
      id: o.id,
      source_offer_id: o.source_offer_id,
      supermarket: o.supermarket,
      title_en: o.title_en,
      title_ar: o.title_ar,
      brand: o.brand_candidate_text,
      inner_pack: o.inner_pack_count,
      size_val: o.each_size_value,
      size_unit: o.each_size_unit,
      sale_unit: o.sale_unit_type,
      product_id: o.product_id,
      catalog_match_status: o.catalog_match_status
    })
  }

  console.log(`Found ${candidates.length} distinct packaged grocery candidates:`)
  console.log(JSON.stringify(candidates, null, 2))

  await client.end()
}
run()

