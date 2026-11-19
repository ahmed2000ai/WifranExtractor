// [PRODUCTION SAFETY QUARANTINE] WIFRAN-ENV-ISOLATION-002
// This script is a historical production utility. Execution against production is blocked by default.
// To execute with explicit authorization, provide BOTH:
//   1. Environment variable: WIFRAN_PRODUCTION_MAINTENANCE_CONFIRMED=1
//   2. CLI argument: --allow-production-admin-operation
import { assertProductionMaintenanceAuthorized } from '../src/main/db/databaseEnvironmentResolver'
assertProductionMaintenanceAuthorized(__filename)

import { Client } from 'pg'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

async function verifyPostReset() {
  const host = process.env.SUPABASE_DB_HOST || 'db.swratbmclahjyekouned.supabase.co'
  const port = parseInt(process.env.SUPABASE_DB_PORT || '5432', 10)
  const user = process.env.SUPABASE_DB_USER || 'postgres'
  const password = process.env.SUPABASE_DB_PASSWORD
  const database = 'postgres'
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

  console.log('===============================================================')
  console.log('   POST-RESET VERIFICATION SUITE')
  console.log('===============================================================')

  const client = new Client({
    host,
    port,
    user,
    password,
    database,
    ssl: { rejectUnauthorized: false }
  })
  await client.connect()

  const supabase = createClient(url, serviceKey)

  // 1. Verify 0 records in product and offer tables
  console.log('\n[CHECK 1] Product and Offer Table Counts (MUST BE ZERO):')
  const zeroTables = [
    'offers',
    'products',
    'product_images',
    'offer_display_images',
    'product_aliases',
    'offer_revision_snapshots',
    'offer_status_history',
    'offer_visual_group_members',
    'saved_offers',
    'watched_items',
    'shopping_list_items',
    'shopping_lists',
    'issue_reports',
    'import_rows',
    'import_batches',
    'validation_errors'
  ]

  let allZero = true
  const zeroCounts: Record<string, number> = {}
  for (const t of zeroTables) {
    const res = await client.query(`SELECT count(*)::int as count FROM public."${t}";`)
    const count = res.rows[0].count
    zeroCounts[t] = count
    console.log(`  - ${t.padEnd(30)}: ${count} rows ${count === 0 ? '✓ [PASS]' : '✗ [FAIL]'}`)
    if (count !== 0) allZero = false
  }

  // 2. Verify master reference data tables (MUST BE INTACT)
  console.log('\n[CHECK 2] Master Reference Data Counts (MUST BE PRESERVED):')
  const refTables: Record<string, number> = {
    supermarkets: 13,
    categories: 13,
    cities: 25,
    regions: 5,
    units: 9,
    supermarket_regions: 12,
    legacy_id_crosswalk: 38
  }

  let allRefIntact = true
  const refCounts: Record<string, number> = {}
  for (const [t, expectedMin] of Object.entries(refTables)) {
    const res = await client.query(`SELECT count(*)::int as count FROM public."${t}";`)
    const count = res.rows[0].count
    refCounts[t] = count
    const pass = count >= expectedMin
    console.log(`  - ${t.padEnd(30)}: ${count} rows (expected >= ${expectedMin}) ${pass ? '✓ [PASS]' : '✗ [FAIL]'}`)
    if (!pass) allRefIntact = false
  }

  // 3. Check for any orphaned foreign keys in the database
  console.log('\n[CHECK 3] Referential Integrity & Orphaned Rows Check:')
  const orphanChecks = [
    { name: 'offer_display_images orphaned', sql: 'SELECT count(*)::int FROM public.offer_display_images odi LEFT JOIN public.offers o ON odi.offer_id = o.id WHERE o.id IS NULL;' },
    { name: 'product_images orphaned', sql: 'SELECT count(*)::int FROM public.product_images pi LEFT JOIN public.products p ON pi.product_id = p.id WHERE p.id IS NULL;' },
    { name: 'product_aliases orphaned', sql: 'SELECT count(*)::int FROM public.product_aliases pa LEFT JOIN public.products p ON pa.product_id = p.id WHERE p.id IS NULL;' },
    { name: 'offers orphaned', sql: 'SELECT count(*)::int FROM public.offers o LEFT JOIN public.supermarkets s ON o.supermarket_id = s.id WHERE s.id IS NULL;' }
  ]

  let allOrphansClean = true
  for (const oc of orphanChecks) {
    const res = await client.query(oc.sql)
    const count = res.rows[0].count
    console.log(`  - ${oc.name.padEnd(30)}: ${count} orphans ${count === 0 ? '✓ [PASS]' : '✗ [FAIL]'}`)
    if (count !== 0) allOrphansClean = false
  }

  // 4. Verify RLS policies on tables
  console.log('\n[CHECK 4] Row Level Security (RLS) Policies:')
  const rlsRes = await client.query(`
    SELECT tablename, policyname, permissive, roles, cmd 
    FROM pg_policies 
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname;
  `)
  console.log(`  Total Active RLS Policies: ${rlsRes.rows.length}`)
  console.log(`  - products RLS policies: ${rlsRes.rows.filter((r) => r.tablename === 'products').length}`)
  console.log(`  - offers RLS policies: ${rlsRes.rows.filter((r) => r.tablename === 'offers').length}`)
  console.log(`  - supermarkets RLS policies: ${rlsRes.rows.filter((r) => r.tablename === 'supermarkets').length}`)

  // 5. Normal Application Client Queries via Supabase JS
  console.log('\n[CHECK 5] Application Query Execution (via Supabase JS API):')
  const { data: smData, error: smErr } = await supabase.from('supermarkets').select('id, name_en, name_ar, slug')
  console.log(`  - fetch supermarkets: ${smData?.length || 0} returned ${!smErr ? '✓ [PASS]' : '✗ [FAIL]'}`)

  const { data: catData, error: catErr } = await supabase.from('categories').select('id, name_en, name_ar')
  console.log(`  - fetch categories: ${catData?.length || 0} returned ${!catErr ? '✓ [PASS]' : '✗ [FAIL]'}`)

  const { data: cityData, error: cityErr } = await supabase.from('cities').select('id, name_en, name_ar')
  console.log(`  - fetch cities: ${cityData?.length || 0} returned ${!cityErr ? '✓ [PASS]' : '✗ [FAIL]'}`)

  const { data: emptyProds, error: pErr } = await supabase.from('products').select('id, name_en')
  console.log(`  - fetch products: ${emptyProds?.length || 0} returned (expected 0) ${emptyProds?.length === 0 && !pErr ? '✓ [PASS]' : '✗ [FAIL]'}`)

  const { data: emptyOffers, error: oErr } = await supabase.from('offers').select('id, title_en')
  console.log(`  - fetch offers: ${emptyOffers?.length || 0} returned (expected 0) ${emptyOffers?.length === 0 && !oErr ? '✓ [PASS]' : '✗ [FAIL]'}`)

  // 6. Supabase Storage Object Verification
  console.log('\n[CHECK 6] Storage Object Verification:')
  const { data: remainingProdImgs } = await supabase.storage.from('product-images').list('catalog')
  console.log(`  - product-images/catalog remaining files: ${remainingProdImgs?.length || 0} ${remainingProdImgs?.length === 0 ? '✓ [PASS]' : '✗ [FAIL]'}`)

  const { data: remainingOfferImgs } = await supabase.storage.from('offer-display-images').list('offers')
  console.log(`  - offer-display-images/offers remaining files: ${remainingOfferImgs?.length || 0} ${remainingOfferImgs?.length === 0 ? '✓ [PASS]' : '✗ [FAIL]'}`)

  await client.end()

  const overallPass = allZero && allRefIntact && allOrphansClean && !smErr && !catErr && !cityErr && emptyProds?.length === 0 && emptyOffers?.length === 0
  console.log('\n===============================================================')
  console.log(`   OVERALL POST-RESET VERIFICATION: ${overallPass ? '100% PASS' : 'FAILED'}`)
  console.log('===============================================================')

  return {
    overallPass,
    zeroCounts,
    refCounts,
    rlsCount: rlsRes.rows.length
  }
}

verifyPostReset().catch(console.error)

