import dotenv from 'dotenv'
dotenv.config({ path: require('path').resolve(process.cwd(), '.env.local') })
import * as fs from 'fs'
import * as path from 'path'
import { Client } from 'pg'
import { exportProductsForImageSearch } from '../src/main/db/productImageEnrichmentService'

async function main() {
  console.log('=============================================================')
  console.log('STEP 1 EXPORT VERIFICATION & REPEATABILITY CHECK')
  console.log('=============================================================\n')

  const pgClient = new Client({
    host: 'db.swratbmclahjyekouned.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: (process.env.SUPABASE_DB_PASSWORD || ''),
    ssl: { rejectUnauthorized: false }
  })
  await pgClient.connect()

  // 1. Snapshot DB timestamps and row counts before export
  const beforeProducts = await pgClient.query(`
    SELECT id, canonical_product_key, item_name_complete, verification_status, approved_primary_image_id, updated_at
    FROM public.products
    ORDER BY id ASC;
  `)
  const beforeOffers = await pgClient.query(`
    SELECT id, product_id, catalog_match_status, updated_at
    FROM public.offers
    WHERE supermarket_id = 'c2cc16c2-0008-4444-b000-c00000000008'
    ORDER BY id ASC;
  `)

  console.log(`Initial DB State:`)
  console.log(`- public.products count: ${beforeProducts.rowCount}`)
  console.log(`- public.offers count (Alwafa): ${beforeOffers.rowCount}`)

  // 2. Run export 1
  console.log('\nRunning Export 1...')
  const export1 = await exportProductsForImageSearch()
  console.log(`Export 1 produced ${export1.count} products. Length: ${export1.csvContent.length} bytes.`)

  // 3. Run export 2
  console.log('Running Export 2...')
  const export2 = await exportProductsForImageSearch()
  console.log(`Export 2 produced ${export2.count} products. Length: ${export2.csvContent.length} bytes.`)

  // 4. Assert byte-for-byte identical
  if (export1.csvContent !== export2.csvContent) {
    throw new Error('FAIL: Export 1 and Export 2 are NOT byte-for-byte identical!')
  }
  console.log('✔ PASS: Export 1 and Export 2 are 100% byte-for-byte identical!')

  // 5. Snapshot DB state after export
  const afterProducts = await pgClient.query(`
    SELECT id, canonical_product_key, item_name_complete, verification_status, approved_primary_image_id, updated_at
    FROM public.products
    ORDER BY id ASC;
  `)
  const afterOffers = await pgClient.query(`
    SELECT id, product_id, catalog_match_status, updated_at
    FROM public.offers
    WHERE supermarket_id = 'c2cc16c2-0008-4444-b000-c00000000008'
    ORDER BY id ASC;
  `)

  // Check no modifications occurred
  if (beforeProducts.rowCount !== afterProducts.rowCount) {
    throw new Error('FAIL: Product count changed during export!')
  }
  for (let i = 0; i < beforeProducts.rowCount; i++) {
    const b = beforeProducts.rows[i]
    const a = afterProducts.rows[i]
    if (b.id !== a.id || b.updated_at.toISOString() !== a.updated_at.toISOString()) {
      throw new Error(`FAIL: Product ${b.id} was modified during export!`)
    }
  }
  for (let i = 0; i < beforeOffers.rowCount; i++) {
    const b = beforeOffers.rows[i]
    const a = afterOffers.rows[i]
    if (b.id !== a.id || b.updated_at.toISOString() !== a.updated_at.toISOString()) {
      throw new Error(`FAIL: Offer ${b.id} was modified during export!`)
    }
  }
  console.log('✔ PASS: Zero database rows were modified, inserted, or touched (strictly read-only)!')

  // 6. Assert every Product_ID exists in public.products with verification_status = 'verified'
  for (const p of export1.products) {
    const match = beforeProducts.rows.find((row) => String(row.id) === String(p.id))
    if (!match) {
      throw new Error(`FAIL: Exported Product_ID ${p.id} does not exist in public.products!`)
    }
    if (match.verification_status !== 'verified') {
      throw new Error(`FAIL: Product_ID ${p.id} has verification_status '${match.verification_status}', expected 'verified'!`)
    }
    if (match.approved_primary_image_id !== null) {
      throw new Error(`FAIL: Product_ID ${p.id} already has an approved image!`)
    }
  }
  console.log('✔ PASS: All exported Product_IDs exist in public.products with verification_status = "verified" and no approved image!')

  // 7. Write exported CSV to exports/wifran_v2_products_for_image_search.csv
  const exportDir = path.join(process.cwd(), 'exports')
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true })
  }
  const targetFilePath = path.join(exportDir, 'wifran_v2_products_for_image_search.csv')
  fs.writeFileSync(targetFilePath, export1.csvContent, 'utf-8')
  console.log(`✔ Written CSV to: ${targetFilePath}`)

  // 8. Print full CSV content
  console.log('\n--- VERBATIM CSV CONTENT ---')
  console.log(export1.csvContent)
  console.log('--- END CSV CONTENT ---\n')

  // 9. Fetch detailed row-by-row mapping for report
  const detailedProducts = await pgClient.query(`
    SELECT 
      p.id as product_id,
      p.item_name_complete,
      p.brand_name,
      p.name_en,
      p.name_ar,
      p.variant_or_flavor,
      p.each_size_value,
      p.each_size_unit,
      p.inner_pack_count,
      p.sale_unit_type,
      o.id as offer_id,
      o.title_en as offer_title_en,
      o.title_ar as offer_title_ar
    FROM public.products p
    JOIN public.offers o ON o.product_id = p.id
    WHERE p.verification_status = 'verified'
    ORDER BY p.id ASC;
  `)

  console.log('--- DETAILED EXPORTED PRODUCTS TABLE ---')
  console.table(
    detailedProducts.rows.map((r) => ({
      Product_ID: r.product_id,
      item_name: r.item_name_complete,
      Brand: r.brand_name,
      Title_EN: r.name_en,
      Title_AR: r.name_ar,
      Size: r.each_size_value ? `${r.each_size_value} ${r.each_size_unit}` : 'N/A',
      Pack: r.inner_pack_count ? `${r.inner_pack_count} pk` : '1 pk',
      Offer_ID: r.offer_id
    }))
  )

  // 10. Fetch excluded offers breakdown
  const excludedBreakdown = await pgClient.query(`
    SELECT 
      catalog_match_status,
      catalog_verification_basis,
      count(*) as count
    FROM public.offers
    WHERE supermarket_id = 'c2cc16c2-0008-4444-b000-c00000000008'
    GROUP BY catalog_match_status, catalog_verification_basis
    ORDER BY count DESC;
  `)
  console.log('\n--- OFFERS STATUS BREAKDOWN ---')
  console.table(excludedBreakdown.rows)

  await pgClient.end()
}

main().catch((err) => {
  console.error('ERROR in verify-export-repeatability:', err)
  process.exit(1)
})

