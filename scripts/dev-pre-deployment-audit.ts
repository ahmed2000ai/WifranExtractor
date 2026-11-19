import { createGuardedPgClient, resolveDatabaseConfig } from '../src/main/db/databaseEnvironmentResolver'
import fs from 'fs'
import path from 'path'

async function preDeploymentDevAudit() {
  const config = resolveDatabaseConfig('DEVELOPMENT_TEST')
  console.log('=== DEV PRE-DEPLOYMENT AUDIT ===')
  console.log(`Context: ${config.context}`)
  console.log(`Target Project Ref: ${config.projectRef}`)
  console.log(`Target Host: ${config.dbHost}`)

  if (config.projectRef !== 'gykrbpykjhpyrdrinkuk') {
    throw new Error(`CRITICAL: Project ref is ${config.projectRef}, expected gykrbpykjhpyrdrinkuk!`)
  }

  const client = createGuardedPgClient('DEVELOPMENT_TEST')
  await client.connect()

  try {
    // 1. Confirm current schema migration tables
    const migTables = await client.query(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_name LIKE '%migration%' OR table_name LIKE '%schema%'
      ORDER BY table_name;
    `)
    console.log('\nMigration Tracking Tables:', migTables.rows)

    // Check public._applied_migrations if exists
    const hasAppliedMig = migTables.rows.some(r => r.table_name === '_applied_migrations')
    if (hasAppliedMig) {
      const migHistory = await client.query(`SELECT * FROM public._applied_migrations ORDER BY applied_at;`)
      console.log('public._applied_migrations:', migHistory.rows)
    }

    // 2. Check if Migration 011 has already been applied by inspecting v_consumer_offers definition
    const viewDefRes = await client.query(`
      SELECT pg_get_viewdef('public.v_consumer_offers'::regclass, true) AS def;
    `)
    const viewDef = viewDefRes.rows[0]?.def || ''
    const hasCandidateVisibility = viewDef.includes('candidate_pending_review') || viewDef.includes('candidate')
    const has012Precedence = viewDef.includes('COALESCE(odi.public_url, pi.public_url)')
    console.log('\nv_consumer_offers Current State:')
    console.log(`- Exists: true`)
    console.log(`- Contains candidate visibility (011 marker): ${hasCandidateVisibility}`)
    console.log(`- Contains 012 image precedence (012 marker): ${has012Precedence}`)

    // Check check constraint on offer_display_images
    const conRes = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.offer_display_images'::regclass
        AND conname = 'offer_display_images_source_kind_check';
    `)
    console.log('\noffer_display_images source_kind constraint:', conRes.rows[0]?.def || 'NONE')
    const has012Constraint = (conRes.rows[0]?.def || '').includes('promotional_leaflet_crop')
    console.log(`- Contains promotional_leaflet_crop (012 marker): ${has012Constraint}`)

    // 3. Check products column defaults
    const prodColDefaults = await client.query(`
      SELECT column_name, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'products'
        AND column_name IN ('verification_status', 'verification_basis')
      ORDER BY column_name;
    `)
    console.log('\npublic.products verification defaults:', prodColDefaults.rows)

    const offerContractCol = await client.query(`
      SELECT column_name, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'offers'
        AND column_name = 'contract_version';
    `)
    console.log('public.offers contract_version default:', offerContractCol.rows)

    // 4. Baseline table counts
    const tables = [
      'supermarkets', 'products', 'offers', 'product_images', 'offer_display_images',
      'categories', 'brands', 'cities', 'regions'
    ]
    console.log('\nBaseline Table Counts:')
    const counts: Record<string, number> = {}
    for (const t of tables) {
      const res = await client.query(`SELECT count(*)::int AS cnt FROM public.${t};`)
      counts[t] = res.rows[0].cnt
      console.log(`- public.${t}: ${counts[t]}`)
    }

    // Save baseline state report
    const baselineReport = {
      projectRef: config.projectRef,
      dbHost: config.dbHost,
      timestamp: new Date().toISOString(),
      counts,
      viewMarkers: {
        hasCandidateVisibility,
        has012Precedence,
        has012Constraint
      },
      productDefaults: prodColDefaults.rows,
      offerContractDefault: offerContractCol.rows
    }

    const outDir = path.resolve(process.cwd(), 'backups/dev_stage_a')
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, 'dev_baseline_state.json'), JSON.stringify(baselineReport, null, 2))
    console.log(`\nBaseline state recorded to ${path.join(outDir, 'dev_baseline_state.json')}`)

  } finally {
    await client.end()
  }
}

preDeploymentDevAudit().catch((err) => {
  console.error('Audit failed:', err)
  process.exit(1)
})
