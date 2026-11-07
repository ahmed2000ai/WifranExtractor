import dotenv from 'dotenv'
dotenv.config({ path: require('path').resolve(process.cwd(), '.env.local') })
import { Client } from 'pg'

async function run() {
  const c = new Client({
    host: 'db.swratbmclahjyekouned.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: (process.env.SUPABASE_DB_PASSWORD || ''),
    ssl: { rejectUnauthorized: false }
  })
  await c.connect()

  const res1 = await c.query("SELECT id, source_offer_id, title_en, title_ar, contract_v2, image_url FROM public.offers WHERE id = 'd8d8d79a-1177-47c7-9bf1-b65a85d16118'")
  console.log('--- LOREAL OFFER ---')
  console.log(JSON.stringify(res1.rows[0], null, 2))

  const res2 = await c.query("SELECT id, source_offer_id, title_en, title_ar, contract_v2, image_url FROM public.offers WHERE id = '062cdc51-c4ff-42dc-bd48-60f5d2c31308'")
  console.log('--- MINI FAN OFFER ---')
  console.log(JSON.stringify(res2.rows[0], null, 2))

  await c.end()
}

run().catch(console.error)
