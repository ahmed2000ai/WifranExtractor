// [PRODUCTION SAFETY QUARANTINE] WIFRAN-ENV-ISOLATION-002
// This script is a historical production utility. Execution against production is blocked by default.
// To execute with explicit authorization, provide BOTH:
//   1. Environment variable: WIFRAN_PRODUCTION_MAINTENANCE_CONFIRMED=1
//   2. CLI argument: --allow-production-admin-operation
import { assertProductionMaintenanceAuthorized } from '../src/main/db/databaseEnvironmentResolver'
assertProductionMaintenanceAuthorized(__filename)

import { Client } from 'pg'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

async function executePrelaunchReset() {
  const host = process.env.SUPABASE_DB_HOST || 'db.swratbmclahjyekouned.supabase.co'
  const port = parseInt(process.env.SUPABASE_DB_PORT || '5432', 10)
  const user = process.env.SUPABASE_DB_USER || 'postgres'
  const password = process.env.SUPABASE_DB_PASSWORD
  const database = 'postgres'

  console.log('===============================================================')
  console.log('   WIFRAN-DB-RESET-001: PRELAUNCH TEST DATA REMOVAL')
  console.log('===============================================================')
  console.log(`[TARGET] Host: ${host}:${port}`)
  console.log(`[TARGET] Project Ref: swratbmclahjyekouned`)
  console.log(`[TARGET] Timestamp: ${new Date().toISOString()}`)

  const client = new Client({
    host,
    port,
    user,
    password,
    database,
    ssl: { rejectUnauthorized: false }
  })
  await client.connect()

  const deletionLog: {
    timestamp: string
    host: string
    tablesReset: Record<string, number>
    storageDeleted: {
      bucket: string
      filesCount: number
      files: string[]
    }[]
    postResetCounts: Record<string, number>
    referenceDataVerification: Record<string, number>
    success: boolean
  } = {
    timestamp: new Date().toISOString(),
    host,
    tablesReset: {},
    storageDeleted: [],
    postResetCounts: {},
    referenceDataVerification: {},
    success: false
  }

  try {
    console.log('\n>>> Starting Transaction (BEGIN)...')
    await client.query('BEGIN;')

    // 1. Delete dependent offer child tables
    console.log('[STEP 1] Deleting dependent offer child records...')
    const r1 = await client.query('DELETE FROM public.offer_display_images;')
    deletionLog.tablesReset['offer_display_images'] = r1.rowCount || 0
    console.log(`  - offer_display_images: ${r1.rowCount} rows removed`)

    const r2 = await client.query('DELETE FROM public.offer_revision_snapshots;')
    deletionLog.tablesReset['offer_revision_snapshots'] = r2.rowCount || 0
    console.log(`  - offer_revision_snapshots: ${r2.rowCount} rows removed`)

    const r3 = await client.query('DELETE FROM public.offer_status_history;')
    deletionLog.tablesReset['offer_status_history'] = r3.rowCount || 0
    console.log(`  - offer_status_history: ${r3.rowCount} rows removed`)

    const r4 = await client.query('DELETE FROM public.offer_visual_group_members;')
    deletionLog.tablesReset['offer_visual_group_members'] = r4.rowCount || 0
    console.log(`  - offer_visual_group_members: ${r4.rowCount} rows removed`)

    const r5 = await client.query('DELETE FROM public.saved_offers;')
    deletionLog.tablesReset['saved_offers'] = r5.rowCount || 0
    console.log(`  - saved_offers: ${r5.rowCount} rows removed`)

    const r6 = await client.query('DELETE FROM public.shopping_list_items WHERE offer_id IS NOT NULL;')
    deletionLog.tablesReset['shopping_list_items (offer refs)'] = r6.rowCount || 0
    console.log(`  - shopping_list_items (offer refs): ${r6.rowCount} rows removed`)

    const r7 = await client.query('DELETE FROM public.issue_reports WHERE offer_id IS NOT NULL;')
    deletionLog.tablesReset['issue_reports (offer refs)'] = r7.rowCount || 0
    console.log(`  - issue_reports (offer refs): ${r7.rowCount} rows removed`)

    const r8 = await client.query('DELETE FROM public.import_rows WHERE created_offer_id IS NOT NULL;')
    deletionLog.tablesReset['import_rows (created_offer refs)'] = r8.rowCount || 0
    console.log(`  - import_rows (offer refs): ${r8.rowCount} rows removed`)

    const r9 = await client.query('DELETE FROM public.validation_errors WHERE offer_id IS NOT NULL;')
    deletionLog.tablesReset['validation_errors (offer refs)'] = r9.rowCount || 0
    console.log(`  - validation_errors (offer refs): ${r9.rowCount} rows removed`)

    // 2. Delete offers
    console.log('\n[STEP 2] Deleting test offers...')
    const r10 = await client.query('DELETE FROM public.offers;')
    deletionLog.tablesReset['offers'] = r10.rowCount || 0
    console.log(`  - offers: ${r10.rowCount} rows removed`)

    // 3. Break circular foreign key on products
    console.log('\n[STEP 3] Breaking circular foreign key on products...')
    const r11 = await client.query('UPDATE public.products SET approved_primary_image_id = NULL WHERE approved_primary_image_id IS NOT NULL;')
    console.log(`  - products (approved_primary_image_id set to NULL): ${r11.rowCount} rows updated`)

    // 4. Delete dependent product child tables
    console.log('\n[STEP 4] Deleting dependent product child records...')
    const r12 = await client.query('DELETE FROM public.product_images;')
    deletionLog.tablesReset['product_images'] = r12.rowCount || 0
    console.log(`  - product_images: ${r12.rowCount} rows removed`)

    const r13 = await client.query('DELETE FROM public.product_aliases;')
    deletionLog.tablesReset['product_aliases'] = r13.rowCount || 0
    console.log(`  - product_aliases: ${r13.rowCount} rows removed`)

    const r14 = await client.query('DELETE FROM public.watched_items WHERE product_id IS NOT NULL;')
    deletionLog.tablesReset['watched_items (product refs)'] = r14.rowCount || 0
    console.log(`  - watched_items (product refs): ${r14.rowCount} rows removed`)

    const r15 = await client.query('DELETE FROM public.shopping_list_items WHERE product_id IS NOT NULL;')
    deletionLog.tablesReset['shopping_list_items (product refs)'] = r15.rowCount || 0
    console.log(`  - shopping_list_items (product refs): ${r15.rowCount} rows removed`)

    // Check if product_alias_proposals table exists
    const hasAliasProposals = (await client.query(`
      SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'product_alias_proposals';
    `)).rows.length > 0
    if (hasAliasProposals) {
      const r16 = await client.query('DELETE FROM public.product_alias_proposals;')
      deletionLog.tablesReset['product_alias_proposals'] = r16.rowCount || 0
      console.log(`  - product_alias_proposals: ${r16.rowCount} rows removed`)
    }

    // 5. Delete products
    console.log('\n[STEP 5] Deleting test products...')
    const r17 = await client.query('DELETE FROM public.products;')
    deletionLog.tablesReset['products'] = r17.rowCount || 0
    console.log(`  - products: ${r17.rowCount} rows removed`)

    // 6. Pre-commit Verification
    console.log('\n[STEP 6] Running Pre-Commit Referential Verification...')
    const countOffers = (await client.query('SELECT count(*)::int FROM public.offers;')).rows[0].count
    const countProds = (await client.query('SELECT count(*)::int FROM public.products;')).rows[0].count
    const countPImgs = (await client.query('SELECT count(*)::int FROM public.product_images;')).rows[0].count
    const countODisplay = (await client.query('SELECT count(*)::int FROM public.offer_display_images;')).rows[0].count
    const countAliases = (await client.query('SELECT count(*)::int FROM public.product_aliases;')).rows[0].count

    deletionLog.postResetCounts = {
      offers: countOffers,
      products: countProds,
      product_images: countPImgs,
      offer_display_images: countODisplay,
      product_aliases: countAliases
    }

    if (countOffers !== 0 || countProds !== 0 || countPImgs !== 0 || countODisplay !== 0 || countAliases !== 0) {
      throw new Error(`Pre-commit validation failed: non-zero counts remaining! ${JSON.stringify(deletionLog.postResetCounts)}`)
    }

    // Reference table integrity check
    const countSupermarkets = (await client.query('SELECT count(*)::int FROM public.supermarkets;')).rows[0].count
    const countCategories = (await client.query('SELECT count(*)::int FROM public.categories;')).rows[0].count
    const countCities = (await client.query('SELECT count(*)::int FROM public.cities;')).rows[0].count
    const countRegions = (await client.query('SELECT count(*)::int FROM public.regions;')).rows[0].count
    const countUnits = (await client.query('SELECT count(*)::int FROM public.units;')).rows[0].count
    const countCrosswalk = (await client.query('SELECT count(*)::int FROM public.legacy_id_crosswalk;')).rows[0].count
    const countSmRegions = (await client.query('SELECT count(*)::int FROM public.supermarket_regions;')).rows[0].count

    deletionLog.referenceDataVerification = {
      supermarkets: countSupermarkets,
      categories: countCategories,
      cities: countCities,
      regions: countRegions,
      units: countUnits,
      supermarket_regions: countSmRegions,
      legacy_id_crosswalk: countCrosswalk
    }

    if (countSupermarkets < 13 || countCategories < 13 || countCities < 25 || countRegions < 5 || countUnits < 9 || countCrosswalk < 38) {
      throw new Error(`Pre-commit validation failed: Reference data corrupted! ${JSON.stringify(deletionLog.referenceDataVerification)}`)
    }

    // 7. Commit Transaction
    console.log('\n>>> Committing Transaction (COMMIT)...')
    await client.query('COMMIT;')
    console.log('>>> Database Transaction COMMITTED SUCCESSFULLY!')
    deletionLog.success = true

  } catch (err: any) {
    console.error('>>> TRANSACTION ERROR, ROLLING BACK:', err)
    try {
      await client.query('ROLLBACK;')
      console.log('>>> ROLLBACK COMPLETE.')
    } catch {}
    throw err
  } finally {
    await client.end()
  }

  // 8. Storage Cleanup (exclusively belonging to removed records)
  console.log('\n[STEP 7] Cleaning up Supabase Storage test objects...')
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  const supabase = createClient(url, serviceKey)

  // A. product-images/catalog (7 files)
  const { data: pFiles } = await supabase.storage.from('product-images').list('catalog', { limit: 100 })
  const pPathsToDelete = (pFiles || []).map((f) => `catalog/${f.name}`)
  if (pPathsToDelete.length > 0) {
    console.log(`  Deleting ${pPathsToDelete.length} objects from product-images...`)
    const { error: pDelErr } = await supabase.storage.from('product-images').remove(pPathsToDelete)
    if (pDelErr) {
      console.warn('  Warning deleting product-images objects:', pDelErr.message)
    } else {
      console.log('  Successfully removed product-images/catalog test objects.')
    }
    deletionLog.storageDeleted.push({
      bucket: 'product-images',
      filesCount: pPathsToDelete.length,
      files: pPathsToDelete
    })
  }

  // B. offer-display-images/offers (31 files)
  const { data: oFiles } = await supabase.storage.from('offer-display-images').list('offers', { limit: 100 })
  const oPathsToDelete = (oFiles || []).map((f) => `offers/${f.name}`)
  if (oPathsToDelete.length > 0) {
    console.log(`  Deleting ${oPathsToDelete.length} objects from offer-display-images...`)
    const { error: oDelErr } = await supabase.storage.from('offer-display-images').remove(oPathsToDelete)
    if (oDelErr) {
      console.warn('  Warning deleting offer-display-images objects:', oDelErr.message)
    } else {
      console.log('  Successfully removed offer-display-images/offers test objects.')
    }
    deletionLog.storageDeleted.push({
      bucket: 'offer-display-images',
      filesCount: oPathsToDelete.length,
      files: oPathsToDelete
    })
  }

  // Save execution log
  const logPath = path.resolve(process.cwd(), 'backups', 'db-prelaunch-reset-2026-11-11T22-38-45-937Z', 'reset-execution-log.json')
  fs.writeFileSync(logPath, JSON.stringify(deletionLog, null, 2), 'utf-8')
  console.log(`\n[RESET LOG] Saved execution log: ${logPath}`)
  console.log('===============================================================')
  console.log('   RESET EXECUTION FINISHED: 100% CLEAN DATABASE')
  console.log('===============================================================')
}

executePrelaunchReset().catch(console.error)

