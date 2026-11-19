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

async function runAudit() {
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

  console.log('======================================================================')
  console.log('WIFRAN-EXTRACTOR-MVP-001 — PRODUCTION DATABASE INTEGRATION AUDIT')
  console.log('======================================================================\n')

  // 1. Overall Aggregates
  const countsRes = await client.query(`
    SELECT 
      count(*)::int AS total_offers,
      count(CASE WHEN product_id IS NOT NULL THEN 1 END)::int AS verified_links,
      count(CASE WHEN product_id IS NULL THEN 1 END)::int AS unresolved_offers,
      count(CASE WHEN status = 'published' THEN 1 END)::int AS published_offers
    FROM public.offers;
  `)
  console.log('--- 1. Offers Aggregates ---')
  console.log(countsRes.rows[0])

  const prodCountRes = await client.query('SELECT count(*)::int AS total_products FROM public.products;')
  console.log('Products Count:', prodCountRes.rows[0].total_products)

  const imgCountRes = await client.query('SELECT count(*)::int AS total_images FROM public.product_images;')
  console.log('Product Images Count:', imgCountRes.rows[0].total_images)

  // 2. Verified Products (All 11)
  console.log('\n--- 2. All 11 Verified Products in public.products ---')
  const allProdsRes = await client.query(`
    SELECT id, canonical_product_key, item_name_complete, brand_name,
           each_size_value, each_size_unit, inner_pack_count, sale_unit_type,
           approved_primary_image_id
    FROM public.products
    ORDER BY id;
  `)
  console.log(JSON.stringify(allProdsRes.rows, null, 2))

  // 3. The 11 Verified Offers Linked
  console.log('\n--- 3. All 11 Offers with Verified Product Links ---')
  const linkedOffersRes = await client.query(`
    SELECT o.id, o.source_offer_id, o.title_en, o.offer_price, o.product_id,
           p.canonical_product_key, p.approved_primary_image_id
    FROM public.offers o
    JOIN public.products p ON o.product_id = p.id
    ORDER BY o.product_id;
  `)
  console.log(JSON.stringify(linkedOffersRes.rows, null, 2))

  // 4. Carrefour Canary Offers Verification
  console.log('\n--- 4. Carrefour Canary Offers (Product IDs 9, 10, 11) ---')
  const carrefourRes = await client.query(`
    SELECT id, source_offer_id, title_en, offer_price, original_price, discount_percentage,
           product_id, catalog_match_status, catalog_candidate_key
    FROM public.offers
    WHERE id IN (
      '4c2432de-99ac-4447-b150-43e5c7ede1d1',
      '36f4d30d-9801-441d-8803-4216ed837aac',
      'ce862ad4-b563-4080-aa76-a2f4fffb40fd'
    )
    ORDER BY product_id;
  `)
  console.log(JSON.stringify(carrefourRes.rows, null, 2))

  // 5. Historical Noori Offers (Unlinked & Preserved)
  console.log('\n--- 5. Historical Noori Offers (Intact & Unlinked) ---')
  const nooriRes = await client.query(`
    SELECT id, source_offer_id, title_en, offer_price, product_id, catalog_match_status, status
    FROM public.offers
    WHERE id IN (
      'fd865e4e-e9cb-444a-b71a-80c74efc16e4',
      '2ec312c1-634e-4bc0-98f4-ca45681e2a27',
      '3b3915b7-702b-41c0-95e3-464e8fa3b90f'
    )
    ORDER BY source_offer_id;
  `)
  console.log(JSON.stringify(nooriRes.rows, null, 2))

  // 6. Consumer View Contract & RPC Evaluation
  console.log('\n--- 6. Consumer Contract View (v_consumer_offers) ---')
  const vColsRes = await client.query(`
    SELECT count(*)::int AS col_count
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'v_consumer_offers';
  `)
  console.log('v_consumer_offers Column Count:', vColsRes.rows[0].col_count)

  const consumerProjRes = await client.query(`
    SELECT id, title_en, product_id, display_image_url, display_image_kind, image_url
    FROM public.v_consumer_offers
    WHERE id IN (
      '4c2432de-99ac-4447-b150-43e5c7ede1d1',
      '36f4d30d-9801-441d-8803-4216ed837aac',
      'ce862ad4-b563-4080-aa76-a2f4fffb40fd'
    )
    ORDER BY product_id;
  `)
  console.log('Carrefour Offers Consumer Projection:')
  console.log(JSON.stringify(consumerProjRes.rows, null, 2))

  // 7. Test Shopping-Date RPC for Jeddah
  console.log('\n--- 7. Shopping-Date RPC (Jeddah, 2026-11-05) ---')
  const rpcRes = await client.query(`
    SELECT id, title_en, offer_price, product_id, display_image_url, display_image_kind, image_url
    FROM public.get_consumer_offers_for_shopping_date(
      '2026-11-05'::date,
      'a6f7b140-0002-4444-a000-000000000002'::text,
      NULL::text
    )
    ORDER BY title_en;
  `)
  console.log(`Active Offers for Jeddah on 2026-11-05: ${rpcRes.rows.length}`)
  console.log(JSON.stringify(rpcRes.rows, null, 2))

  // 8. Migration 009 Guard
  console.log('\n--- 8. Migration 009 Guard ---')
  const m009Res = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'product_alias_staging'
    ) AS m009_exists;
  `)
  console.log('Migration 009 product_alias_staging exists:', m009Res.rows[0].m009_exists)

  // 9. Approved Images in public.product_images
  console.log('\n--- 9. Approved Product Images (public.product_images) ---')
  const imagesRes = await client.query(`
    SELECT id, product_id, role, storage_bucket, storage_object_path, public_url,
           content_sha256, approval_status, rights_basis, reviewed_by, reviewed_at
    FROM public.product_images
    ORDER BY product_id;
  `)
  console.log(JSON.stringify(imagesRes.rows, null, 2))

  await client.query('ROLLBACK')
  await client.end()
}

runAudit().catch((err) => {
  console.error('Audit failed:', err)
  process.exit(1)
})

