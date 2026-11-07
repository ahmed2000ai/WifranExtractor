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
    SELECT id, source_offer_id, title_en, assortment_status, sale_unit_type, brand_candidate_text
    FROM public.offers
    WHERE source_offer_id LIKE 'carrefour%' OR source_offer_id LIKE 'noori%'
    ORDER BY source_offer_id;
  `)
  console.log(JSON.stringify(res.rows, null, 2))
  await client.end()
}
run()

