// [PRODUCTION SAFETY QUARANTINE] WIFRAN-ENV-ISOLATION-002
// This script is a historical production utility. Execution against production is blocked by default.
// To execute with explicit authorization, provide BOTH:
//   1. Environment variable: WIFRAN_PRODUCTION_MAINTENANCE_CONFIRMED=1
//   2. CLI argument: --allow-production-admin-operation
import { assertProductionMaintenanceAuthorized } from '../src/main/db/databaseEnvironmentResolver'
assertProductionMaintenanceAuthorized(__filename)

import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
import { Client } from 'pg'
import fs from 'fs'

async function runReadOnlyPreflightAndSnapshot() {
  console.log('======================================================================')
  console.log('WIFRAN-EXTRACTOR-IDENTITY-002F — READ-ONLY PRODUCTION PREFLIGHT')
  console.log('======================================================================\n')

  const host = process.env.SUPABASE_DB_HOST || 'db.swratbmclahjyekouned.supabase.co'
  const expectedProject = 'swratbmclahjyekouned'

  if (!host.includes(expectedProject)) {
    throw new Error(`Target host "${host}" does not match authorized project "${expectedProject}". Execution aborted.`)
  }
  console.log(`✅ Project identity confirmed: ${expectedProject} (Host: ${host})`)

  const client = new Client({
    host,
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: process.env.SUPABASE_DB_PASSWORD || '',
    ssl: { rejectUnauthorized: false }
  })

  await client.connect()
  console.log('✅ Connected to target database.')

  // Enforce strictly read-only transaction at session level
  await client.query('BEGIN TRANSACTION READ ONLY;')
  const roCheck = await client.query('SHOW transaction_read_only;')
  if (roCheck.rows[0].transaction_read_only !== 'on') {
    throw new Error('Failed to set transaction to read-only mode!')
  }
  console.log('✅ Enforced read-only transaction: transaction_read_only = ON.')

  // Verify write safety: attempt a dummy write in read-only transaction (must fail)
  let writeBlocked = false
  try {
    await client.query("UPDATE public.products SET name_en = name_en WHERE id = -999;")
  } catch (err: any) {
    if (err.message.includes('read-only transaction') || err.code === '25006') {
      writeBlocked = true
      console.log('✅ Database engine verified: writes are blocked in read-only transaction (SQLSTATE 25006).')
    }
  }

  // Restart clean read-only transaction
  await client.query('ROLLBACK;')
  await client.query('BEGIN TRANSACTION READ ONLY;')

  // 1. Capture baseline counts
  const baselineQuery = await client.query(`
    SELECT
      (SELECT count(*)::int FROM public.offers) AS total_offers,
      (SELECT count(*)::int FROM public.offers WHERE status = 'published') AS published_offers,
      (SELECT count(*)::int FROM public.offers WHERE product_id IS NOT NULL) AS verified_offers,
      (SELECT count(*)::int FROM public.products) AS total_products,
      (SELECT count(*)::int FROM public.product_aliases) AS total_aliases,
      (SELECT count(*)::int FROM public.product_images) AS total_product_images,
      (SELECT count(*)::int FROM public.offer_display_images) AS total_display_images,
      (SELECT count(*)::int FROM public.v_consumer_offers) AS consumer_view_rows,
      (SELECT count(*)::int FROM public.v_consumer_offers WHERE product_id IS NOT NULL) AS verified_in_consumer_view;
  `)
  const baseline = baselineQuery.rows[0]
  console.log('Production Baseline Snapshot Counts:', baseline)

  // Check columns of products table
  const prodCols = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products'
    ORDER BY ordinal_position;
  `)
  console.log('Product table columns:', prodCols.rows.map(r => r.column_name))

  // Verify view contract column count
  const viewColQuery = await client.query(`
    SELECT count(*)::int as col_count
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'v_consumer_offers';
  `)
  const colCount = viewColQuery.rows[0].col_count
  console.log(`Consumer view v_consumer_offers column count: ${colCount} (expected: 98)`)

  // 2. Fetch all products
  const productsQuery = await client.query(`
    SELECT * FROM public.products ORDER BY id;
  `)
  const products = productsQuery.rows
  console.log(`Fetched ${products.length} products.`)

  // 3. Fetch all offers
  const offersQuery = await client.query(`
    SELECT * FROM public.offers ORDER BY id;
  `)
  const offers = offersQuery.rows
  console.log(`Fetched ${offers.length} offers.`)

  // 4. Fetch brands and categories
  const brandsQuery = await client.query(`SELECT * FROM public.brands;`)
  const categoriesQuery = await client.query(`SELECT * FROM public.categories;`)

  // 5. Fetch product_aliases (should be 0)
  const aliasesQuery = await client.query(`SELECT * FROM public.product_aliases;`)

  // Rollback and close read-only transaction cleanly
  await client.query('ROLLBACK;')
  await client.end()
  console.log('✅ Closed read-only database connection cleanly.')

  // Save snapshot to local temp folder
  const snapshotDir = path.resolve(process.cwd(), 'temp')
  if (!fs.existsSync(snapshotDir)) {
    fs.mkdirSync(snapshotDir, { recursive: true })
  }
  const snapshotPath = path.join(snapshotDir, 'production-shadow-snapshot-002f.json')
  fs.writeFileSync(snapshotPath, JSON.stringify({
    capturedAt: new Date().toISOString(),
    project: expectedProject,
    host,
    baseline,
    colCount,
    products,
    offers,
    brands: brandsQuery.rows,
    categories: categoriesQuery.rows,
    aliases: aliasesQuery.rows
  }, null, 2))
  console.log(`✅ Production snapshot saved to ${snapshotPath}`)
}

runReadOnlyPreflightAndSnapshot().catch(err => {
  console.error('Fatal preflight error:', err)
  process.exit(1)
})
