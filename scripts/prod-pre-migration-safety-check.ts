/**
 * Production Pre-Migration Safety Check (Read-Only)
 *
 * Verifies all preconditions on Production (swratbmclahjyekouned)
 * prior to applying Migrations 012 and 013.
 */

import { createGuardedPgClient, PRODUCTION_PROJECT_REF } from '../src/main/db/databaseEnvironmentResolver'

async function runProdPreMigrationSafetyCheck() {
  console.log('=================================================================')
  console.log('   PRODUCTION PRE-MIGRATION SAFETY CHECK (READ-ONLY)            ')
  console.log('=================================================================\n')

  const client = createGuardedPgClient('PRODUCTION_UI')
  await client.connect()

  await client.query('BEGIN READ ONLY;')
  await client.query("SET LOCAL statement_timeout = '15s';")

  try {
    // 1. Target database validation
    const dbRes = await client.query('SELECT current_database(), current_user;')
    console.log(`[TARGET] Database: ${dbRes.rows[0].current_database}, User: ${dbRes.rows[0].current_user}`)

    // 2. Migration status
    const migRes = await client.query('SELECT id FROM public._applied_migrations ORDER BY applied_at;')
    const appliedIds = new Set(migRes.rows.map(r => r.id))
    console.log(`[MIGRATIONS] Total applied: ${appliedIds.size}`)
    
    if (!appliedIds.has('011_wifran_mvp_candidate_consumer_visibility.sql')) {
      throw new Error('FAIL: Migration 011 is NOT recorded in _applied_migrations!')
    }
    console.log('  ✓ Migration 011 is recorded.')

    if (appliedIds.has('012_wifran_offer_display_image_precedence.sql')) {
      throw new Error('FAIL: Migration 012 is ALREADY applied on Production!')
    }
    console.log('  ✓ Migration 012 is NOT yet applied.')

    if (appliedIds.has('013_wifran_product_verification_defaults.sql')) {
      throw new Error('FAIL: Migration 013 is ALREADY applied on Production!')
    }
    console.log('  ✓ Migration 013 is NOT yet applied.')

    // 3. Baseline counts
    const countsRes = await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.offers) as offers_count,
        (SELECT count(*)::int FROM public.products) as products_count,
        (SELECT count(*)::int FROM public.product_images) as pi_count,
        (SELECT count(*)::int FROM public.offer_display_images) as odi_count,
        (SELECT count(*)::int FROM public.supermarkets) as supermarkets_count;
    `)
    const c = countsRes.rows[0]
    console.log(`[BASELINE COUNTS] offers=${c.offers_count}, products=${c.products_count}, product_images=${c.pi_count}, offer_display_images=${c.odi_count}, supermarkets=${c.supermarkets_count}`)
    
    if (c.offers_count !== 30 || c.products_count !== 25) {
      throw new Error(`FAIL: Unexpected baseline counts (expected 30 offers, 25 products, got ${c.offers_count}, ${c.products_count})`)
    }
    console.log('  ✓ Baseline row counts match expected Production state.')

    // 4. Check constraint status on offer_display_images
    const conRes = await client.query(`
      SELECT pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conrelid = 'public.offer_display_images'::regclass
        AND conname = 'offer_display_images_source_kind_check';
    `)
    const def = conRes.rows[0]?.def || ''
    console.log(`[CURRENT CONSTRAINT] ${def}`)
    if (def.includes('promotional_leaflet_crop')) {
      console.log('  ℹ Constraint already expanded.')
    } else {
      console.log('  ✓ Constraint currently at legacy 3-value check, ready for Migration 012 expansion.')
    }

    // 5. Check product defaults
    const defRes = await client.query(`
      SELECT column_name, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'products'
        AND column_name IN ('verification_status', 'verification_basis');
    `)
    console.log('[CURRENT PRODUCT DEFAULTS]', defRes.rows)

    console.log('\n=================================================================')
    console.log('   PRODUCTION PRE-MIGRATION SAFETY CHECK PASSED (100% READY)     ')
    console.log('=================================================================')
  } finally {
    await client.query('ROLLBACK;')
    await client.end()
  }
}

runProdPreMigrationSafetyCheck().catch(err => {
  console.error('Safety check failed:', err)
  process.exit(1)
})
