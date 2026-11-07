import dotenv from 'dotenv'
dotenv.config({ path: require('path').resolve(process.cwd(), '.env.local') })
import { Client } from 'pg'

async function update() {
  console.log('====================================================')
  console.log('UPDATING PRODUCTS 3 & 5 WITH LEAFLET CROP EVIDENCE')
  console.log('====================================================\n')

  const client = new Client({
    host: 'db.swratbmclahjyekouned.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: (process.env.SUPABASE_DB_PASSWORD || ''),
    ssl: { rejectUnauthorized: false }
  })
  await client.connect()

  // 1. Update Product 5 (Fakieh Frozen Chicken 600g - 1 pc individual retail bag, not 2x twin-pack)
  console.log('Updating Product 5 (Fakieh)...')
  const res5 = await client.query(`
    UPDATE public.products
    SET
      inner_pack_count = 1,
      sale_unit_type = 'each',
      canonical_product_key = 'fakieh:fakieh-frozen-chicken-600gm:whole:600gram:1xeach',
      item_name_complete = 'Fakieh Frozen Chicken 600Gm - دجاج فقيه مجمد ٦٠٠ ج (600 gram)',
      name_en = 'Fakieh Frozen Chicken 600Gm',
      name_ar = 'دجاج فقيه مجمد ٦٠٠ ج',
      updated_at = now()
    WHERE id = 5
    RETURNING id, canonical_product_key, item_name_complete, inner_pack_count, sale_unit_type;
  `)
  console.log('Updated Product 5:', res5.rows[0])

  // 2. Update Product 3 (Entaj Fresh Chicken Drumsticks 450g)
  console.log('\nUpdating Product 3 (Entaj)...')
  const res3 = await client.query(`
    UPDATE public.products
    SET
      inner_pack_count = 1,
      sale_unit_type = 'each',
      canonical_product_key = 'entaj:entaj-fresh-chicken-drumsticks-450gm:drumsticks:450gram:1xeach',
      item_name_complete = 'Entaj Fresh Chicken Drumsticks 450Gm - إنتاج سيقان دجاج طازجة ٤٥٠ جرام',
      name_en = 'Entaj Fresh Chicken Drumsticks 450Gm',
      name_ar = 'إنتاج سيقان دجاج طازجة ٤٥٠ جرام',
      updated_at = now()
    WHERE id = 3
    RETURNING id, canonical_product_key, item_name_complete, inner_pack_count, sale_unit_type;
  `)
  console.log('Updated Product 3:', res3.rows[0])

  // Verify that IDs remain exactly 3 and 5
  console.log('\nVerifying Product IDs on public.products:')
  const verify = await client.query('SELECT id, item_name_complete FROM public.products ORDER BY id;')
  console.table(verify.rows)

  await client.end()
}

update().catch(console.error)

