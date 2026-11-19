// [PRODUCTION SAFETY QUARANTINE] WIFRAN-ENV-ISOLATION-002
// This script is a historical production utility. Execution against production is blocked by default.
// To execute with explicit authorization, provide BOTH:
//   1. Environment variable: WIFRAN_PRODUCTION_MAINTENANCE_CONFIRMED=1
//   2. CLI argument: --allow-production-admin-operation
import { assertProductionMaintenanceAuthorized } from '../src/main/db/databaseEnvironmentResolver'
assertProductionMaintenanceAuthorized(__filename)

import dotenv from 'dotenv'
dotenv.config({ path: require('path').resolve(process.cwd(), '.env.local') })
import * as fs from 'fs'
import * as path from 'path'
import { Client } from 'pg'
import { exportProductsForImageSearch } from '../src/main/db/productImageEnrichmentService'

async function verify() {
  console.log('=============================================================')
  console.log('VERIFYING WIFRAN-07J STEP 1 HYBRID EXPORT REPEATABILITY')
  console.log('=============================================================\n')

  const client = new Client({
    host: 'db.swratbmclahjyekouned.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: (process.env.SUPABASE_DB_PASSWORD || ''),
    ssl: { rejectUnauthorized: false }
  })
  await client.connect()

  // 1. Audit Alwafa counts baseline in database
  const baseline = await client.query(`
    SELECT
      count(*) as total_offers,
      count(CASE WHEN product_id IS NOT NULL THEN 1 END) as linked_offers,
      count(CASE WHEN product_id IS NULL THEN 1 END) as unresolved_offers
    FROM public.offers
    WHERE source_offer_id LIKE 'alwafa-%';
  `)
  console.log('Alwafa Database Baseline:')
  console.table(baseline.rows)

  const prodBaseline = await client.query(`
    SELECT count(*) as verified_products_count
    FROM public.products
    WHERE verification_status = 'verified' AND approved_primary_image_id IS NULL;
  `)
  console.log('Verified Products (no approved image):')
  console.table(prodBaseline.rows)

  // Record MD5 / updated_at baseline of products and offers
  const preOffers = await client.query(`
    SELECT id, updated_at FROM public.offers WHERE source_offer_id LIKE 'alwafa-%' ORDER BY id;
  `)
  const preProducts = await client.query(`
    SELECT id, updated_at FROM public.products ORDER BY id;
  `)

  // 2. First Export Run
  console.log('\n--- Running Step 1 Export (Run 1) ---')
  const res1 = await exportProductsForImageSearch({
    sourcePrefix: 'alwafa-'
  })
  console.log(`Run 1 Count: ${res1.count} rows (P: ${res1.pCount}, O: ${res1.oCount}, Grouped Exclusions: ${res1.groupedOffersCount})`)

  // 3. Second Export Run
  console.log('\n--- Running Step 1 Export (Run 2) ---')
  const res2 = await exportProductsForImageSearch({
    sourcePrefix: 'alwafa-'
  })
  console.log(`Run 2 Count: ${res2.count} rows (P: ${res2.pCount}, O: ${res2.oCount}, Grouped Exclusions: ${res2.groupedOffersCount})`)

  // 4. Assert Byte-for-Byte Identical Output
  const isIdentical = res1.csvContent === res2.csvContent
  console.log(`\nByte-for-byte identical output between Run 1 and Run 2: ${isIdentical ? 'PASS (EXACT MATCH)' : 'FAIL (DIFFERENT)'}`)
  if (!isIdentical) {
    throw new Error('Run 1 and Run 2 CSV outputs differ!')
  }

  // 5. Assert Zero DB Mutations on products and offers
  const postOffers = await client.query(`
    SELECT id, updated_at FROM public.offers WHERE source_offer_id LIKE 'alwafa-%' ORDER BY id;
  `)
  const postProducts = await client.query(`
    SELECT id, updated_at FROM public.products ORDER BY id;
  `)

  let offersMutated = false
  for (let i = 0; i < preOffers.rows.length; i++) {
    if (preOffers.rows[i].updated_at?.getTime() !== postOffers.rows[i].updated_at?.getTime()) {
      offersMutated = true
      break
    }
  }

  let productsMutated = false
  for (let i = 0; i < preProducts.rows.length; i++) {
    if (preProducts.rows[i].updated_at?.getTime() !== postProducts.rows[i].updated_at?.getTime()) {
      productsMutated = true
      break
    }
  }

  console.log(`Read-Only Check on public.offers: ${!offersMutated ? 'PASS (0 rows mutated)' : 'FAIL (mutated)'}`)
  console.log(`Read-Only Check on public.products: ${!productsMutated ? 'PASS (0 rows mutated)' : 'FAIL (mutated)'}`)

  // 6. Write CSV outputs to exports/ directory
  const exportsDir = path.resolve(process.cwd(), 'exports')
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true })
  }

  const hybridCsvPath = path.join(exportsDir, 'wifran_v2_hybrid_image_refs_for_search.csv')
  const legacyCsvPath = path.join(exportsDir, 'wifran_v2_products_for_image_search.csv')

  fs.writeFileSync(hybridCsvPath, res1.csvContent, 'utf8')
  fs.writeFileSync(legacyCsvPath, res1.csvContent, 'utf8')

  console.log(`\nSaved CSV to: ${hybridCsvPath}`)
  console.log(`Saved CSV to: ${legacyCsvPath}`)

  // 7. Print literal CSV contents
  console.log('\n=============================================================')
  console.log('LITERAL CSV CONTENTS:')
  console.log('=============================================================')
  console.log(res1.csvContent)
  console.log('=============================================================')

  await client.end()
}

verify().catch((err) => {
  console.error('Verification failed:', err)
  process.exit(1)
})

