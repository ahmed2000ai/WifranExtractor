/**
 * Inspect Test Records (Development Target)
 *
 * Uses guarded DEVELOPMENT_TEST database context exclusively.
 * Hard runtime guards prevent this script from ever targeting production.
 */

import { createGuardedPgClient, resolveDatabaseConfig, DEVELOPMENT_PROJECT_REF } from '../src/main/db/databaseEnvironmentResolver'

async function inspectRecords() {
  const config = resolveDatabaseConfig('DEVELOPMENT_TEST')
  console.log('===============================================================')
  console.log('   INSPECT TEST RECORDS (DEVELOPMENT ENVIRONMENT)')
  console.log('===============================================================')
  console.log(`[TARGET] Context: ${config.context}`)
  console.log(`[TARGET] Project Ref: ${config.projectRef}`)
  console.log(`[TARGET] Host: ${config.dbHost}:${config.dbPort}`)

  if (config.projectRef !== DEVELOPMENT_PROJECT_REF) {
    throw new Error(`SAFETY ERROR: Expected dev ref ${DEVELOPMENT_PROJECT_REF}, got ${config.projectRef}`)
  }

  const client = createGuardedPgClient('DEVELOPMENT_TEST')
  await client.connect()

  console.log('\n=== PRODUCTS ===')
  const prods = await client.query('SELECT * FROM public.products ORDER BY id LIMIT 5;')
  console.log(`Total products returned: ${prods.rows.length}`)
  if (prods.rows.length > 0) {
    console.table(prods.rows.map((r) => ({ id: r.id, name_en: r.name_en, name_ar: r.name_ar, created_at: r.created_at })))
  } else {
    console.log('  (0 products in development catalog)')
  }

  console.log('\n=== OFFERS ===')
  const offers = await client.query('SELECT id, title_en, title_ar, offer_price, original_price, supermarket_id, product_id, created_at FROM public.offers ORDER BY created_at DESC LIMIT 5;')
  console.log(`Total offers returned: ${offers.rows.length}`)
  if (offers.rows.length > 0) {
    console.table(offers.rows)
  } else {
    console.log('  (0 offers in development catalog)')
  }

  console.log('\n=== PRODUCT IMAGES ===')
  const pImgs = await client.query('SELECT * FROM public.product_images ORDER BY id LIMIT 5;')
  console.log(`Total product images returned: ${pImgs.rows.length}`)
  if (pImgs.rows.length > 0) {
    console.table(pImgs.rows)
  } else {
    console.log('  (0 product images in development catalog)')
  }

  console.log('\n=== OFFER DISPLAY IMAGES ===')
  const oImgs = await client.query('SELECT * FROM public.offer_display_images ORDER BY id LIMIT 5;')
  console.log(`Total offer display images returned: ${oImgs.rows.length}`)
  if (oImgs.rows.length > 0) {
    console.table(oImgs.rows)
  } else {
    console.log('  (0 offer display images in development catalog)')
  }

  await client.end()
}

inspectRecords().catch((err) => {
  console.error('[FATAL ERROR]:', err)
  process.exit(1)
})
