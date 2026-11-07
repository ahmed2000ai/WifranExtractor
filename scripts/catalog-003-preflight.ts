import { Client } from 'pg'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

async function preflight() {
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

  console.log('--- 1. Target Carrefour Offers (Unresolved State) ---')
  const targetOffers = await client.query(`
    SELECT id, source_offer_id, title_en, title_ar, offer_price, original_price,
           product_id, catalog_match_status, catalog_candidate_key, status
    FROM public.offers
    WHERE id IN (
      '4c2432de-99ac-4447-b150-43e5c7ede1d1',
      '36f4d30d-9801-441d-8803-4216ed837aac',
      'ce862ad4-b563-4080-aa76-a2f4fffb40fd'
    )
    ORDER BY source_offer_id;
  `)
  console.log(JSON.stringify(targetOffers.rows, null, 2))

  console.log('\n--- 2. Canonical Product Key Pre-existence Check ---')
  const existingProds = await client.query(`
    SELECT id, canonical_product_key, item_name_complete
    FROM public.products
    WHERE canonical_product_key IN (
      'nestle:nestle-pure-life-water-330ml-x-40:std:330ml:40xpack',
      'nadec:nadec-cooking-cream-1l:cooking:1l:1xeach',
      'sadia:sadia-frozen-chicken-10x900g:whole:900g:10xpack'
    );
  `)
  console.log('Conflicting Products Found:', existingProds.rows.length)

  console.log('\n--- 3. Total Baseline Counts ---')
  const counts = await client.query(`
    SELECT 
      count(*)::int AS total_offers,
      count(CASE WHEN product_id IS NOT NULL THEN 1 END)::int AS verified_links,
      count(CASE WHEN status = 'published' THEN 1 END)::int AS published_offers
    FROM public.offers;
  `)
  console.log('Offers Baseline:', counts.rows[0])

  const prodCount = await client.query('SELECT count(*)::int AS total_products FROM public.products;')
  console.log('Products Baseline:', prodCount.rows[0])

  const imgCount = await client.query('SELECT count(*)::int AS total_images FROM public.product_images;')
  console.log('Product Images Baseline:', imgCount.rows[0])

  console.log('\n--- 4. Migration 009 Staging Check ---')
  const m009 = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'product_alias_staging'
    ) AS m009_exists;
  `)
  console.log('Migration 009 Table Exists:', m009.rows[0].m009_exists)

  console.log('\n--- 5. v_consumer_offers Column Count ---')
  const cols = await client.query(`
    SELECT count(*)::int AS col_count
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'v_consumer_offers';
  `)
  console.log('Consumer View Column Count:', cols.rows[0].col_count)

  await client.query('ROLLBACK')
  await client.end()
}

preflight().catch((err) => {
  console.error('Preflight error:', err)
  process.exit(1)
})

