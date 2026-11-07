import { Client } from 'pg'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

async function verify() {
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

  console.log('=== POST-CATALOG-003 READ-ONLY PRODUCTION VERIFICATION ===\n')

  // 1. Inspect newly created products
  console.log('--- 1. Newly Created Products (IDs 9, 10, 11) ---')
  const prodRes = await client.query(`
    SELECT id, canonical_product_key, item_name_complete, brand_name,
           each_size_value, each_size_unit, inner_pack_count, sale_unit_type,
           verification_status, verification_basis, verified_by, verified_at,
           approved_primary_image_id, default_image_url
    FROM public.products
    WHERE id IN (9, 10, 11)
    ORDER BY id;
  `)
  console.log(JSON.stringify(prodRes.rows, null, 2))

  // 2. Inspect the 3 linked Carrefour offers
  console.log('\n--- 2. Linked Carrefour Offers ---')
  const offerRes = await client.query(`
    SELECT id, source_offer_id, title_en, title_ar, offer_price, original_price, discount_percentage,
           product_id, catalog_match_status, catalog_candidate_key, catalog_verification_basis,
           catalog_verified_by, catalog_verified_at, status
    FROM public.offers
    WHERE id IN (
      '4c2432de-99ac-4447-b150-43e5c7ede1d1',
      '36f4d30d-9801-441d-8803-4216ed837aac',
      'ce862ad4-b563-4080-aa76-a2f4fffb40fd'
    )
    ORDER BY product_id;
  `)
  console.log(JSON.stringify(offerRes.rows, null, 2))

  // 3. Inspect aggregate database counts
  console.log('\n--- 3. Database Aggregates ---')
  const baseCounts = await client.query(`
    SELECT 
      count(*)::int AS total_offers,
      count(CASE WHEN product_id IS NOT NULL THEN 1 END)::int AS verified_links,
      count(CASE WHEN status = 'published' THEN 1 END)::int AS published_offers
    FROM public.offers;
  `)
  console.log('Offers:', baseCounts.rows[0])

  const prodCount = await client.query('SELECT count(*)::int AS total_products FROM public.products;')
  console.log('Products:', prodCount.rows[0])

  const imgCount = await client.query('SELECT count(*)::int AS total_images FROM public.product_images;')
  console.log('Product Images:', imgCount.rows[0])

  // 4. Verify historical Noori offers intact
  console.log('\n--- 4. Historical Noori Offers (Untouched) ---')
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

  // 5. Verify v_consumer_offers contract & projection
  console.log('\n--- 5. Consumer View v_consumer_offers Projection ---')
  const colRes = await client.query(`
    SELECT count(*)::int AS col_count
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'v_consumer_offers';
  `)
  console.log('Consumer View Column Count:', colRes.rows[0].col_count)

  const consumerRes = await client.query(`
    SELECT id, title_en, product_id, display_image_url, display_image_kind, image_url
    FROM public.v_consumer_offers
    WHERE id IN (
      '4c2432de-99ac-4447-b150-43e5c7ede1d1',
      '36f4d30d-9801-441d-8803-4216ed837aac',
      'ce862ad4-b563-4080-aa76-a2f4fffb40fd'
    )
    ORDER BY product_id;
  `)
  console.log(JSON.stringify(consumerRes.rows, null, 2))

  await client.query('ROLLBACK')
  await client.end()
}

verify().catch((err) => {
  console.error('Verification error:', err)
  process.exit(1)
})

