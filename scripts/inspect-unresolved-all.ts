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

  // Group unresolved offers by leaflet / supermarket
  const unresolvedRes = await client.query(`
    SELECT o.id, o.source_offer_id, o.title_en, o.title_ar, o.brand_candidate_text,
           o.sale_unit_type, o.inner_pack_count, o.each_size_value, o.each_size_unit,
           o.offer_price, o.original_price, o.catalog_match_status,
           s.name_en AS supermarket_name
    FROM public.offers o
    LEFT JOIN public.supermarkets s ON s.id = o.supermarket_id
    WHERE o.product_id IS NULL
    ORDER BY s.name_en, o.source_offer_id;
  `)

  console.log(`Total unresolved offers in DB: ${unresolvedRes.rows.length}`)
  console.log('--- Sample Unresolved Offers ---')
  for (const r of unresolvedRes.rows) {
    console.log(`[${r.supermarket_name}] ${r.id} | ${r.source_offer_id} | ${r.title_en} (${r.title_ar}) | Pack: ${r.inner_pack_count}x ${r.each_size_value} ${r.each_size_unit} (${r.sale_unit_type})`)
  }

  await client.query('ROLLBACK')
  await client.end()
}

run().catch((err) => {
  console.error('Inspection failed:', err)
  process.exit(1)
})

