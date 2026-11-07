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

  const res = await c.query(`
    SELECT s.name_en, count(*) as total_offers,
           count(CASE WHEN o.product_id IS NOT NULL THEN 1 END) as linked_offers,
           count(CASE WHEN o.product_id IS NULL THEN 1 END) as unresolved_offers
    FROM public.offers o
    LEFT JOIN public.supermarkets s ON o.supermarket_id = s.id
    GROUP BY s.name_en;
  `)
  console.table(res.rows)

  const alwafa = await c.query(`
    SELECT count(*) as alwafa_total,
           count(CASE WHEN o.product_id IS NOT NULL THEN 1 END) as alwafa_linked,
           count(CASE WHEN o.product_id IS NULL THEN 1 END) as alwafa_unresolved
    FROM public.offers o
    WHERE o.source_offer_id LIKE 'alwafa-%';
  `)
  console.table(alwafa.rows)

  await c.end()
}

run().catch(console.error)
