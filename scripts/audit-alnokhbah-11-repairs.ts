// [PRODUCTION SAFETY QUARANTINE] WIFRAN-ENV-ISOLATION-002
import { assertProductionMaintenanceAuthorized } from '../src/main/db/databaseEnvironmentResolver'
assertProductionMaintenanceAuthorized(__filename)

import { Client } from 'pg'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

async function auditAlNokhbahRepairs() {
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

  console.log('Querying Al Nokhbah published offers from production...')

  // Fetch all 30 published offers for Al Nokhbah
  const offersRes = await client.query(`
    SELECT 
      o.id as offer_id,
      o.source_offer_id,
      o.title_en as o_title_en,
      o.title_ar as o_title_ar,
      o.offer_price,
      o.image_url as o_image_url,
      o.thumbnail_url as o_thumbnail_url,
      o.product_id,
      p.name_en as p_name_en,
      p.name_ar as p_name_ar,
      p.brand_name as p_brand_name,
      p.canonical_product_key,
      pi.public_url as pi_public_url,
      odi.public_url as odi_public_url,
      vco.image_url as vco_image_url
    FROM public.offers o
    LEFT JOIN public.products p ON o.product_id = p.id
    LEFT JOIN public.product_images pi ON pi.product_id = p.id AND pi.role = 'primary' AND pi.approval_status = 'approved'
    LEFT JOIN public.offer_display_images odi ON odi.offer_id = o.id AND odi.approval_status = 'approved'
    LEFT JOIN public.v_consumer_offers vco ON vco.id = o.id
    WHERE o.source_offer_id LIKE 'doc_982ef82677fe1d5d:%'
       OR o.supermarket_id = (SELECT id FROM public.supermarkets WHERE slug = 'al-nokhbah' LIMIT 1)
    ORDER BY o.source_offer_id;
  `)

  console.log(`Found ${offersRes.rows.length} Al Nokhbah offers in production.\n`)
  for (const r of offersRes.rows) {
    console.log(JSON.stringify(r))
  }

  await client.query('ROLLBACK')
  await client.end()
}

auditAlNokhbahRepairs().catch(err => {
  console.error('Audit error:', err)
  process.exit(1)
})
