import dotenv from 'dotenv'
dotenv.config({ path: require('path').resolve(process.cwd(), '.env.local') })
import { Client } from 'pg'

async function inspect() {
  const c = new Client({
    host: 'db.swratbmclahjyekouned.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: (process.env.SUPABASE_DB_PASSWORD || ''),
    ssl: { rejectUnauthorized: false }
  })
  await c.connect()

  const prods = await c.query(`
    SELECT id, name_en, name_ar, canonical_product_key, item_name_complete,
           inner_pack_count, each_size_value, each_size_unit, sale_unit_type,
           brand_name, variant_or_flavor, verification_status
    FROM public.products
    WHERE id IN (3, 5)
    ORDER BY id;
  `)
  console.log('--- PRODUCTS 3 and 5 ---')
  console.log(JSON.stringify(prods.rows, null, 2))

  const kryptonOffer = await c.query(`
    SELECT id, source_offer_id, title_en, title_ar, sale_unit_type,
           each_size_value, each_size_unit, inner_pack_count, catalog_match_status
    FROM public.offers
    WHERE id = 'bb739be3-662a-4d77-a6eb-2aa6abc92031';
  `)
  console.log('\n--- KRYPTON OFFER ---')
  console.log(JSON.stringify(kryptonOffer.rows[0], null, 2))

  await c.end()
}

inspect().catch(console.error)
