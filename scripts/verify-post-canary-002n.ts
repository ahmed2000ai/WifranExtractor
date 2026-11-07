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
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
  })

  await client.connect()
  await client.query('SET statement_timeout = 15000')
  await client.query('BEGIN READ ONLY')

  const offersRes = await client.query(`
    SELECT id, source_offer_id, title_en, title_ar, offer_price, original_price, discount_percentage,
           sale_unit_type, inner_pack_count, each_size_value, each_size_unit,
           product_id, catalog_match_status, status, supermarket_id, city_id, region_id,
           offer_start_date, offer_end_date, published_at
    FROM public.offers
    WHERE id IN (
      '4c2432de-99ac-4447-b150-43e5c7ede1d1',
      '36f4d30d-9801-441d-8803-4216ed837aac',
      'ce862ad4-b563-4080-aa76-a2f4fffb40fd'
    )
    ORDER BY source_offer_id;
  `)

  console.log('--- Inserted Carrefour Offers (Full Row Data) ---')
  console.log(JSON.stringify(offersRes.rows, null, 2))

  const baselineRes = await client.query(`
    SELECT count(*)::int AS total_offers,
           count(CASE WHEN product_id IS NOT NULL THEN 1 END)::int AS verified_links,
           count(CASE WHEN status = 'published' THEN 1 END)::int AS published_offers
    FROM public.offers;
  `)
  console.log('--- Aggregate Offer Counts ---')
  console.log(JSON.stringify(baselineRes.rows[0], null, 2))

  const nooriRes = await client.query(`
    SELECT id, source_offer_id, title_en, offer_price, status, product_id, catalog_match_status
    FROM public.offers
    WHERE id IN (
      'fd865e4e-e9cb-444a-b71a-80c74efc16e4',
      '2ec312c1-634e-4bc0-98f4-ca45681e2a27',
      '3b3915b7-702b-41c0-95e3-464e8fa3b90f'
    )
    ORDER BY id;
  `)
  console.log('--- Historical Noori Offers ---')
  console.log(JSON.stringify(nooriRes.rows, null, 2))

  const rpcRes = await client.query(`
    SELECT id, source_offer_id, title_en, offer_price, supermarket_name_en, city_name_en
    FROM public.get_consumer_offers_for_shopping_date(
      '2026-11-07'::date,
      'a6f7b140-0002-4444-a000-000000000002'::text
    )
    ORDER BY source_offer_id;
  `)
  console.log(`--- Consumer RPC for Jeddah (Total: ${rpcRes.rows.length}) ---`)
  console.log(JSON.stringify(rpcRes.rows, null, 2))

  await client.query('ROLLBACK')
  await client.end()
}

run().catch((err) => {
  console.error('Audit failed:', err)
  process.exit(1)
})

