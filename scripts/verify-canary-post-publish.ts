import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
import { Client } from 'pg'

async function verifyCanaryPostPublish() {
  console.log('======================================================================')
  console.log('WIFRAN-EXTRACTOR-IDENTITY-001N — INDEPENDENT POST-PUBLISH AUDIT')
  console.log('======================================================================\n')

  const client = new Client({
    host: 'db.swratbmclahjyekouned.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: process.env.SUPABASE_DB_PASSWORD || '',
    ssl: { rejectUnauthorized: false }
  })

  await client.connect()

  // 1. Total counts in database
  const countRes = await client.query(`
    SELECT
      (SELECT count(*) FROM public.offers) AS total_offers,
      (SELECT count(*) FROM public.offers WHERE source_offer_id LIKE 'noori%') AS noori_offers,
      (SELECT count(*) FROM public.offers WHERE status = 'published') AS published_offers,
      (SELECT count(*) FROM public.products) AS total_products,
      (SELECT count(*) FROM public.product_aliases) AS total_aliases,
      (SELECT count(*) FROM public.product_images) AS total_product_images,
      (SELECT count(*) FROM public.offer_display_images) AS total_display_images,
      (SELECT count(*) FROM public.v_consumer_offers) AS consumer_view_rows,
      (SELECT count(*) FROM public.v_consumer_offers WHERE source_offer_id LIKE 'noori%') AS noori_in_consumer_view,
      (SELECT count(*) FROM public.v_consumer_offers WHERE product_id IS NOT NULL) AS verified_products_in_view;
  `)
  console.log('Database Snapshot Counts:', countRes.rows[0])

  // 2. Inspect the 3 canary offers in v_consumer_offers
  const canaryInViewRes = await client.query(`
    SELECT 
      id,
      source_offer_id,
      supermarket_name_en,
      supermarket_slug,
      city_name_en,
      title_en,
      offer_price,
      currency,
      product_id,
      display_image_url,
      display_image_kind,
      image_url,
      thumbnail_url,
      quantity_limit,
      quantity_limit_value,
      valid_from,
      valid_to
    FROM public.v_consumer_offers
    WHERE source_offer_id LIKE 'noori%'
    ORDER BY source_offer_id;
  `)
  console.log('\nCanary Offers in v_consumer_offers:')
  console.table(canaryInViewRes.rows)

  // 3. Test RPC get_consumer_offers_for_shopping_date for Jeddah
  const rpcRes = await client.query(`
    SELECT 
      id,
      source_offer_id,
      title_en,
      offer_price,
      product_id,
      supermarket_name_en,
      city_name_en
    FROM public.get_consumer_offers_for_shopping_date(
      '2026-11-05'::date,
      'a6f7b140-0002-4444-a000-000000000002'::text
    )
    WHERE source_offer_id LIKE 'noori%'
    ORDER BY source_offer_id;
  `)
  console.log(`\nRPC get_consumer_offers_for_shopping_date returned ${rpcRes.rows.length} Noori offers:`)
  console.table(rpcRes.rows)

  // 4. Verify baseline offers were NOT modified (compare updated_at or counts)
  const baselineCheck = await client.query(`
    SELECT count(*) AS untouched_baseline_offers
    FROM public.offers
    WHERE NOT (source_offer_id LIKE 'noori%');
  `)
  console.log('\nUntouched Baseline Offers:', baselineCheck.rows[0].untouched_baseline_offers)

  await client.end()
}

verifyCanaryPostPublish().catch(console.error)

