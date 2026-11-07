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

  // Inspect products table count and columns
  const prodCount = await client.query('SELECT count(*)::int AS total FROM public.products;')
  console.log(`Total products in public.products: ${prodCount.rows[0].total}`)

  const prods = await client.query(`
    SELECT id, canonical_product_key, item_name_complete, name_en, name_ar, brand_name,
           variant_or_flavor, each_size_value, each_size_unit, inner_pack_count, sale_unit_type,
           verification_status, approved_primary_image_id, default_image_url
    FROM public.products
    ORDER BY id;
  `)
  console.log('--- All Products in public.products ---')
  console.log(JSON.stringify(prods.rows, null, 2))

  // Inspect product_images table count
  const imgCount = await client.query('SELECT count(*)::int AS total FROM public.product_images;')
  console.log(`Total product_images: ${imgCount.rows[0].total}`)

  const prodImages = await client.query(`
    SELECT id, product_id, role, storage_bucket, storage_object_path, public_url,
           content_sha256, approval_status, rights_basis, reviewed_by
    FROM public.product_images;
  `)
  console.log('--- All Product Images in public.product_images ---')
  console.log(JSON.stringify(prodImages.rows, null, 2))

  // Inspect offer_display_images table count
  const offerImgCount = await client.query('SELECT count(*)::int AS total FROM public.offer_display_images;')
  console.log(`Total offer_display_images: ${offerImgCount.rows[0].total}`)

  // Inspect the 8 verified linked offers
  const verifiedOffers = await client.query(`
    SELECT id, source_offer_id, title_en, title_ar, product_id, catalog_match_status,
           catalog_verification_basis, catalog_verified_by, catalog_verified_at
    FROM public.offers
    WHERE product_id IS NOT NULL
    ORDER BY id;
  `)
  console.log('--- Verified Linked Offers in public.offers ---')
  console.log(JSON.stringify(verifiedOffers.rows, null, 2))

  await client.query('ROLLBACK')
  await client.end()
}

run().catch((err) => {
  console.error('Inspection failed:', err)
  process.exit(1)
})

