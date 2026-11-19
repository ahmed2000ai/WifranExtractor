// [PRODUCTION SAFETY QUARANTINE] WIFRAN-ENV-ISOLATION-002
// This script is a historical production utility. Execution against production is blocked by default.
// To execute with explicit authorization, provide BOTH:
//   1. Environment variable: WIFRAN_PRODUCTION_MAINTENANCE_CONFIRMED=1
//   2. CLI argument: --allow-production-admin-operation
import { assertProductionMaintenanceAuthorized } from '../src/main/db/databaseEnvironmentResolver'
assertProductionMaintenanceAuthorized(__filename)

import dotenv from 'dotenv'
dotenv.config({ path: require('path').resolve(process.cwd(), '.env.local') })
import { Client } from 'pg'

async function run() {
  const client = new Client({
    host: 'db.swratbmclahjyekouned.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: (process.env.SUPABASE_DB_PASSWORD || ''),
    ssl: { rejectUnauthorized: false }
  })
  await client.connect()

  const resAliases = await client.query('SELECT count(*) FROM public.product_aliases;')
  console.log('product_aliases count:', resAliases.rows[0].count)

  const resImages = await client.query('SELECT count(*) FROM public.product_images;')
  console.log('product_images count:', resImages.rows[0].count)

  const resProducts = await client.query('SELECT id, canonical_product_key, item_name_complete FROM public.products ORDER BY id ASC;')
  console.log('products count:', resProducts.rowCount)
  console.log('products:', resProducts.rows)

  const resOffers = await client.query('SELECT id, title_en, product_id, catalog_match_status FROM public.offers WHERE supermarket_id = \'c2cc16c2-0008-4444-b000-c00000000008\' ORDER BY id ASC;')
  console.log('Alwafa offers total:', resOffers.rowCount)
  const linked = resOffers.rows.filter(r => r.product_id != null)
  console.log('offers with product_id:', linked.length)

  await client.end()
}

run().catch(console.error)

