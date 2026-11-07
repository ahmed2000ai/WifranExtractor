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
    ssl: { rejectUnauthorized: false }
  })
  await client.connect()
  const res = await client.query(`
    SELECT o.id, o.source_offer_id, o.title_en, o.title_ar, o.product_id,
           o.sale_unit_type, o.inner_pack_count, o.each_size_value, o.each_size_unit,
           s.name_en AS supermarket
    FROM public.offers o
    LEFT JOIN public.supermarkets s ON s.id = o.supermarket_id
    WHERE o.assortment_status = 'single_product'
    ORDER BY s.name_en, o.source_offer_id;
  `)
  console.log(`Total single_product offers: ${res.rows.length}`)
  const bySm: Record<string, number> = {}
  for (const r of res.rows) {
    bySm[r.supermarket] = (bySm[r.supermarket] || 0) + 1
  }
  console.log(bySm)
  console.log('\n--- Sample single_product offers ---')
  for (const r of res.rows.slice(0, 20)) {
    console.log(`[${r.supermarket}] ID: ${r.id} | linked: ${r.product_id ? 'YES(P' + r.product_id + ')' : 'NO'} | ${r.title_en} | ${r.inner_pack_count}x ${r.each_size_value} ${r.each_size_unit}`)
  }
  await client.end()
}
run()

