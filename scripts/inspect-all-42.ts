import dotenv from 'dotenv'
dotenv.config({ path: require('path').resolve(process.cwd(), '.env.local') })
import { Client } from 'pg'

async function inspectAll42() {
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

  const res = await client.query(`
    SELECT o.id, o.source_offer_id, o.title_en, o.title_ar,
           o.brand_candidate_text, o.exact_identity_status,
           o.sale_unit_type, o.each_size_value, o.each_size_unit, o.inner_pack_count,
           o.assortment_status, o.catalog_match_status, o.product_id
    FROM public.offers o
    WHERE o.supermarket_id = $1 AND o.status = 'published'
    ORDER BY o.source_offer_id
  `, [alwafaSupermarketId])

  console.log(`Total: ${res.rows.length}`)
  for (const r of res.rows) {
    console.log(`${r.source_offer_id}: "${r.title_en}" | AR: "${r.title_ar}" | Brand: ${r.brand_candidate_text} | Size: ${r.each_size_value} ${r.each_size_unit} | Pack: ${r.inner_pack_count}x ${r.sale_unit_type} | Assort: ${r.assortment_status} | Status: ${r.catalog_match_status} | Prod: ${r.product_id}`)
  }

  await client.end()
}

inspectAll42().catch(console.error)

