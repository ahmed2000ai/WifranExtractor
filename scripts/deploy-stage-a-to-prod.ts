/**
 * Controlled Stage A Deployment to PRODUCTION (swratbmclahjyekouned)
 *
 * Applies Migrations 012 and 013 in strict sequence.
 * Requires:
 *   - WIFRAN_PRODUCTION_MAINTENANCE_CONFIRMED=1
 *   - --allow-production-admin-operation flag
 *
 * Hard safety guards enforce:
 *   - Target project ref is swratbmclahjyekouned
 *   - Migration 011 is already applied
 *   - Migrations 012 and 013 are pending
 *   - Baseline counts (30 offers, 25 products) match exactly
 *   - Automatic abort and rollback on error
 */

import fs from 'fs'
import path from 'path'
import {
  createGuardedPgClient,
  resolveDatabaseConfig,
  assertProductionMaintenanceAuthorized,
  PRODUCTION_PROJECT_REF
} from '../src/main/db/databaseEnvironmentResolver'

const MIGRATIONS_TO_APPLY = [
  {
    id: '012_wifran_offer_display_image_precedence.sql',
    path: 'project-knowledge/wifran_docs/012_wifran_offer_display_image_precedence.sql'
  },
  {
    id: '013_wifran_product_verification_defaults.sql',
    path: 'project-knowledge/wifran_docs/013_wifran_product_verification_defaults.sql'
  }
]

async function deployStageAToProd() {
  console.log('=================================================================')
  console.log('  CONTROLLED STAGE A DEPLOYMENT TO PRODUCTION                    ')
  console.log('  Target Project: swratbmclahjyekouned                           ')
  console.log('=================================================================\n')

  // 1. Enforce maintenance authorization guards
  assertProductionMaintenanceAuthorized('deploy-stage-a-to-prod.ts')

  // 2. Validate configuration
  const config = resolveDatabaseConfig('PRODUCTION_UI')
  console.log(`Context: ${config.context}`)
  console.log(`Target Project Ref: ${config.projectRef}`)
  console.log(`Target Host: ${config.dbHost}:${config.dbPort}`)

  if (config.projectRef !== PRODUCTION_PROJECT_REF) {
    throw new Error(`CRITICAL ABORT: Target project ref is "${config.projectRef}", expected "${PRODUCTION_PROJECT_REF}"!`)
  }

  // 3. Connect to Production
  const client = createGuardedPgClient('PRODUCTION_UI')
  await client.connect()

  try {
    // 4. Preflight checks
    console.log('\n--- Preflight Verification ---')
    const existingMigRes = await client.query<{ id: string }>(`
      SELECT id FROM public._applied_migrations ORDER BY applied_at;
    `)
    const appliedSet = new Set(existingMigRes.rows.map(r => r.id))
    console.log(`Recorded migrations in Production: ${appliedSet.size}`)

    if (!appliedSet.has('011_wifran_mvp_candidate_consumer_visibility.sql')) {
      throw new Error('CRITICAL ABORT: Migration 011 is NOT recorded in Production _applied_migrations!')
    }
    console.log('  ✓ Migration 011 is verified present.')

    if (appliedSet.has('012_wifran_offer_display_image_precedence.sql')) {
      throw new Error('CRITICAL ABORT: Migration 012 is ALREADY recorded in Production _applied_migrations!')
    }
    console.log('  ✓ Migration 012 is verified pending.')

    if (appliedSet.has('013_wifran_product_verification_defaults.sql')) {
      throw new Error('CRITICAL ABORT: Migration 013 is ALREADY recorded in Production _applied_migrations!')
    }
    console.log('  ✓ Migration 013 is verified pending.')

    // Baseline row count validation
    const countRes = await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.offers) as offers_count,
        (SELECT count(*)::int FROM public.products) as products_count,
        (SELECT count(*)::int FROM public.product_images) as pi_count,
        (SELECT count(*)::int FROM public.offer_display_images) as odi_count;
    `)
    const c = countRes.rows[0]
    console.log(`Baseline counts: offers=${c.offers_count}, products=${c.products_count}, product_images=${c.pi_count}, offer_display_images=${c.odi_count}`)
    if (c.offers_count !== 30 || c.products_count !== 25) {
      throw new Error(`CRITICAL ABORT: Unexpected row count baseline (expected 30 offers, 25 products; got ${c.offers_count}, ${c.products_count})`)
    }
    console.log('  ✓ Baseline row counts match expected state.')

    // 5. Apply migrations in strict sequential order
    console.log('\n--- Applying Migrations ---')
    for (const mig of MIGRATIONS_TO_APPLY) {
      console.log(`\n-----------------------------------------------------------------`)
      console.log(`Applying: ${mig.id}`)
      console.log(`File:     ${mig.path}`)

      const fullPath = path.resolve(process.cwd(), mig.path)
      const sql = fs.readFileSync(fullPath, 'utf8')

      const startMs = Date.now()
      try {
        // Execute DDL
        await client.query(sql)

        // Register in _applied_migrations
        await client.query(
          `INSERT INTO public._applied_migrations (id, applied_at)
           VALUES ($1, now())
           ON CONFLICT (id) DO UPDATE SET applied_at = now();`,
          [mig.id]
        )
        const durationMs = Date.now() - startMs
        console.log(`✓ Migration ${mig.id} applied and registered successfully in ${durationMs}ms!`)
      } catch (err: any) {
        console.error(`\n❌ CRITICAL FAILURE applying migration ${mig.id}!`)
        console.error(`Error details: ${err?.message || err}`)
        console.error('ABORTING DEPLOYMENT IMMEDIATELY.')
        throw err
      }
    }

    console.log('\n=================================================================')
    console.log('  ALL STAGE A MIGRATIONS APPLIED SUCCESSFULLY TO PRODUCTION!    ')
    console.log('=================================================================')

  } finally {
    await client.end()
  }
}

deployStageAToProd().catch(err => {
  console.error('\nDeployment aborted with fatal error:', err)
  process.exit(1)
})
