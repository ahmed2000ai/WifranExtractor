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

async function audit() {
  const client = new Client({
    host: 'db.swratbmclahjyekouned.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: (process.env.SUPABASE_DB_PASSWORD || ''),
    ssl: { rejectUnauthorized: false }
  })
  await client.connect()

  const alwafaSupermarketId = 'c2cc16c2-0008-4444-b000-c00000000008'

  // 1. Check public.product_images
  console.log('=== 1. PUBLIC.PRODUCT_IMAGES AUDIT ===')
  const imgRes = await client.query('SELECT * FROM public.product_images')
  console.log(`Total rows in public.product_images: ${imgRes.rows.length}`)
  for (const img of imgRes.rows) {
    console.log(`- ID: ${img.id} | Product ID: ${img.product_id} | Path: ${img.storage_object_path} | Reviewed By: ${img.reviewed_by}`)
  }

  // 2. Check public.products
  console.log('\n=== 2. PUBLIC.PRODUCTS AUDIT ===')
  const prodRes = await client.query('SELECT * FROM public.products ORDER BY canonical_product_key ASC')
  console.log(`Total rows in public.products: ${prodRes.rows.length}`)
  for (const p of prodRes.rows) {
    console.log({
      id: p.id,
      key: p.canonical_product_key,
      item_name_complete: p.item_name_complete,
      brand_name: p.brand_name,
      variant: p.variant_or_flavor,
      size: `${p.each_size_value} ${p.each_size_unit}`,
      pack: `${p.inner_pack_count}x ${p.sale_unit_type}`,
      name_en: p.name_en,
      name_ar: p.name_ar,
      approved_primary_image_id: p.approved_primary_image_id,
      verification_status: p.verification_status
    })
  }

  // 3. Check 42 Alwafa offers and their links
  console.log('\n=== 3. 42 ALWAFA OFFERS AUDIT ===')
  const offerRes = await client.query(`
    SELECT o.id, o.source_offer_id, o.title_en, o.title_ar, o.product_id, o.catalog_match_status,
           o.catalog_candidate_key, o.brand_candidate_text, o.each_size_value, o.each_size_unit,
           o.inner_pack_count, o.sale_unit_type, o.assortment_status
    FROM public.offers o
    WHERE o.supermarket_id = $1 AND o.status = 'published'
    ORDER BY o.catalog_match_status, o.title_en
  `, [alwafaSupermarketId])

  console.log(`Total published Alwafa offers: ${offerRes.rows.length}`)
  const statusCounts: Record<string, number> = {}
  for (const o of offerRes.rows) {
    statusCounts[o.catalog_match_status] = (statusCounts[o.catalog_match_status] || 0) + 1
  }
  console.log('Status counts:', statusCounts)

  console.log('\nLinked offers:')
  for (const o of offerRes.rows.filter(r => r.catalog_match_status === 'verified_linked')) {
    console.log(`- Offer [${o.id}] "${o.title_en}" (source: ${o.source_offer_id}) -> Product [${o.product_id}]`)
  }

  console.log('\nExcluded/Unresolved offers:')
  for (const o of offerRes.rows.filter(r => r.catalog_match_status !== 'verified_linked')) {
    console.log(`- Offer [${o.id}] "${o.title_en}" (status: ${o.catalog_match_status})`)
  }

  await client.end()
}

audit().catch(err => {
  console.error(err)
  process.exit(1)
})

