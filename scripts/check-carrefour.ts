import { Client } from 'pg'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function check() {
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
    SELECT id, name_ar, name_en, slug, is_active
    FROM public.supermarkets
    WHERE slug ILIKE '%carrefour%' OR name_en ILIKE '%carrefour%' OR name_ar ILIKE '%كارفور%';
  `)
  console.log('Carrefour in DB:', res.rows)

  // Also check all supermarkets to see what exists
  const allSm = await client.query(`SELECT id, slug, name_en FROM public.supermarkets ORDER BY id;`)
  console.log('All supermarkets:', allSm.rows)

  // Collision check for Carrefour offers
  const offRes = await client.query(`
    SELECT id, source_offer_id, title_en
    FROM public.offers
    WHERE source_offer_id ILIKE '%carrefour%'
       OR title_en ILIKE '%nestle%pure%life%'
       OR title_en ILIKE '%nadec%cooking%cream%'
       OR title_en ILIKE '%sadia%chicken%900%';
  `)
  console.log('Potential collisions:', offRes.rows)

  await client.end()
}

check().catch(console.error)

