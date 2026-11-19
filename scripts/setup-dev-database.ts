/**
 * Development Database Setup & Migration Script
 *
 * Applies version-controlled migrations (001 - 009) and reference data
 * EXCLUSIVELY to the DEVELOPMENT Supabase project (gykrbpykjhpyrdrinkuk).
 *
 * Hard safety guards ensure this script CANNOT run against production (swratbmclahjyekouned).
 */

import fs from 'fs'
import path from 'path'
import {
  createGuardedPgClient,
  getGuardedSupabaseClient,
  resolveDatabaseConfig,
  DEVELOPMENT_PROJECT_REF,
  PRODUCTION_PROJECT_REF
} from '../src/main/db/databaseEnvironmentResolver'
import { resolveOrCreateSupermarket } from '../src/main/db/supermarketRegionResolutionService'

export async function setupDevDatabase() {
  console.log('=================================================================')
  console.log('   WIFRAN-ENV-ISOLATION-001: SETUP DEVELOPMENT DATABASE')
  console.log('=================================================================')

  // 1. Guard check
  const config = resolveDatabaseConfig('DEVELOPMENT_TEST')
  console.log(`[TARGET] Context: ${config.context}`)
  console.log(`[TARGET] Project Ref: ${config.projectRef}`)
  console.log(`[TARGET] Host: ${config.dbHost}:${config.dbPort}`)

  if (config.projectRef !== DEVELOPMENT_PROJECT_REF) {
    throw new Error(`SAFETY ERROR: Expected dev ref ${DEVELOPMENT_PROJECT_REF}, got ${config.projectRef}`)
  }

  if (config.projectRef === PRODUCTION_PROJECT_REF) {
    throw new Error('CRITICAL SAFETY VIOLATION: Attempted to run dev setup against PRODUCTION!')
  }

  const client = createGuardedPgClient('DEVELOPMENT_TEST')
  await client.connect()
  console.log('Connected to DEVELOPMENT PostgreSQL database.\n')

  // Create migration tracking table
  await client.query(`
    CREATE TABLE IF NOT EXISTS public._applied_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `)

  const migrationsToApply = [
    { name: '001_initial_schema.sql', path: 'project-knowledge/wifran_docs/001_initial_schema.sql' },
    { name: '001_seed_core_catalog.sql', path: 'project-knowledge/wifran_docs/001_seed_core_catalog.sql' },
    { name: '003_offer_location_scope.sql', path: 'project-knowledge/wifran_docs/003_offer_location_scope.sql' },
    { name: '004_offer_image_ingestion_metadata.sql', path: 'project-knowledge/wifran_docs/004_offer_image_ingestion_metadata.sql' },
    { name: '005_wifran_v2_offer_contract.sql', path: 'project-knowledge/wifran_docs/005_wifran_v2_offer_contract.sql' },
    { name: '006_wifran_07a_security_and_contract_reconciliation.sql', path: 'project-knowledge/wifran_docs/006_wifran_07a_security_and_contract_reconciliation.sql' },
    { name: '007_wifran_07g_07h_catalog_resolution_and_product_images.sql', path: 'project-knowledge/wifran_docs/007_wifran_07g_07h_catalog_resolution_and_product_images.sql' },
    { name: '008_wifran_07j_consumer_view_disputed_identity_masking.sql', path: 'project-knowledge/wifran_docs/008_wifran_07j_consumer_view_disputed_identity_masking.sql' },
    { name: '009_wifran_07j_product_alias_staging_and_audit.sql', path: 'project-knowledge/wifran_docs/009_wifran_07j_product_alias_staging_and_audit.sql' },
    { name: '010_wifran_08_publication_journal_and_uniqueness.sql', path: 'project-knowledge/wifran_docs/010_wifran_08_publication_journal_and_uniqueness.sql' },
    { name: '011_wifran_mvp_candidate_consumer_visibility.sql', path: 'project-knowledge/wifran_docs/011_wifran_mvp_candidate_consumer_visibility.sql' }
  ]

  const appliedRes = await client.query('SELECT id FROM public._applied_migrations;')
  const appliedSet = new Set(appliedRes.rows.map((r) => r.id))

  // If public tables already exist from an earlier execution, backfill _applied_migrations
  const existingTables = await client.query(`
    SELECT count(*)::int as count FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name IN ('products', 'offers', 'product_alias_proposals');
  `)
  if (existingTables.rows[0].count === 3 && appliedSet.size === 0) {
    console.log('Detected pre-existing schema components. Registering baseline migrations in _applied_migrations...')
    for (const m of migrationsToApply) {
      await client.query('INSERT INTO public._applied_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING;', [m.name])
      appliedSet.add(m.name)
    }
  }

  console.log('--- Applying Migrations ---')
  for (const m of migrationsToApply) {
    if (appliedSet.has(m.name)) {
      console.log(`Migration ${m.name} already applied (skipping).`)
      continue
    }

    const fullPath = path.resolve(process.cwd(), m.path)
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Migration file not found: ${fullPath}`)
    }
    const sql = fs.readFileSync(fullPath, 'utf8')
    console.log(`Executing migration: ${m.name} (${sql.length} bytes)...`)
    const startTime = Date.now()
    await client.query(sql)
    await client.query('INSERT INTO public._applied_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING;', [m.name])
    console.log(`  -> SUCCESS in ${Date.now() - startTime}ms`)
  }

  // 2. Storage buckets setup
  console.log('\n--- Setting Up Storage Buckets ---')
  const supabase = getGuardedSupabaseClient('DEVELOPMENT_TEST')
  const requiredBuckets = [
    { id: 'offer-images', public: false },
    { id: 'product-images', public: true },
    { id: 'offer-display-images', public: true },
    { id: 'tmp', public: false }
  ]

  const { data: existingBuckets, error: listBucketsErr } = await supabase.storage.listBuckets()
  if (listBucketsErr) {
    console.warn('Could not list storage buckets via Supabase JS:', listBucketsErr.message)
  }
  const existingBucketIds = new Set((existingBuckets || []).map((b) => b.id))

  for (const b of requiredBuckets) {
    if (!existingBucketIds.has(b.id)) {
      console.log(`Creating storage bucket: "${b.id}" (public=${b.public})...`)
      const { error: createErr } = await supabase.storage.createBucket(b.id, {
        public: b.public,
        fileSizeLimit: 10485760
      })
      if (createErr && !createErr.message.includes('already exists')) {
        console.warn(`  Warning creating bucket ${b.id}:`, createErr.message)
        await client.query(`
          INSERT INTO storage.buckets (id, name, public, file_size_limit)
          VALUES ($1, $1, $2, 10485760)
          ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;
        `, [b.id, b.public])
      } else {
        console.log(`  -> Bucket "${b.id}" ready.`)
      }
    } else {
      console.log(`  -> Bucket "${b.id}" already exists.`)
    }
  }

  // Ensure Noori Supermarket is present to match full 13 retailers in production
  console.log('\n--- Ensuring Noori Supermarket Reference Record ---')
  const nooriSm = await resolveOrCreateSupermarket('Noori Supermarket', {
    supabaseClient: supabase
  })
  console.log(`  -> Noori Supermarket resolved: id=${nooriSm.id}, code=${nooriSm.code || 'N/A'}, name="${nooriSm.name_en || (nooriSm as any).nameEn}"`)

  // 3. Post-Setup Verification
  console.log('\n--- Development Schema Verification ---')

  const tablesRes = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `)
  const baseTables = tablesRes.rows.map((r) => r.table_name)
  console.log(`Total public base tables in DEV: ${baseTables.length}`)

  const viewsRes = await client.query(`
    SELECT table_name 
    FROM information_schema.views 
    WHERE table_schema = 'public'
    ORDER BY table_name;
  `)
  const views = viewsRes.rows.map((r) => r.table_name)
  console.log(`Total public views in DEV: ${views.length} (${views.join(', ')})`)

  // Check row counts for master data and catalog tables
  const rowCounts: Record<string, number> = {}
  for (const t of baseTables) {
    const countRes = await client.query(`SELECT count(*)::int as count FROM public."${t}";`)
    rowCounts[t] = countRes.rows[0].count
  }

  console.log('\nReference Data Counts in DEV:')
  console.log(`  - categories:           ${rowCounts['categories'] ?? 'MISSING'} (expected: 13)`)
  console.log(`  - cities:               ${rowCounts['cities'] ?? 'MISSING'} (expected: 25)`)
  console.log(`  - regions:              ${rowCounts['regions'] ?? 'MISSING'} (expected: 5)`)
  console.log(`  - supermarkets:         ${rowCounts['supermarkets'] ?? 'MISSING'} (expected: 13)`)
  console.log(`  - supermarket_regions:  ${rowCounts['supermarket_regions'] ?? 'MISSING'} (expected: 12)`)
  console.log(`  - units:                ${rowCounts['units'] ?? 'MISSING'} (expected: 9)`)
  console.log(`  - legacy_id_crosswalk:  ${rowCounts['legacy_id_crosswalk'] ?? 'MISSING'} (expected: 38)`)

  console.log('\nCatalog / Offer Initial Data Counts in DEV:')
  console.log(`  - products:             ${rowCounts['products'] ?? 'MISSING'} (expected: 0)`)
  console.log(`  - offers:               ${rowCounts['offers'] ?? 'MISSING'} (expected: 0)`)
  console.log(`  - product_images:       ${rowCounts['product_images'] ?? 'MISSING'} (expected: 0)`)
  console.log(`  - offer_display_images: ${rowCounts['offer_display_images'] ?? 'MISSING'} (expected: 0)`)
  console.log(`  - product_aliases:      ${rowCounts['product_aliases'] ?? 'MISSING'} (expected: 0)`)

  // Check RLS policies count
  const rlsRes = await client.query(`
    SELECT count(*)::int as count 
    FROM pg_policies 
    WHERE schemaname = 'public';
  `)
  const rlsCount = rlsRes.rows[0].count
  console.log(`\nTotal RLS policies in DEV public schema: ${rlsCount}`)

  // Storage buckets check
  const { data: finalBuckets } = await supabase.storage.listBuckets()
  console.log(`Storage buckets in DEV: ${(finalBuckets || []).map((b) => `${b.id} (public=${b.public})`).join(', ')}`)

  await client.end()
  console.log('\n=================================================================')
  console.log('   DEVELOPMENT DATABASE INITIALIZATION COMPLETE')
  console.log('=================================================================')
}

if (require.main === module) {
  setupDevDatabase().catch((err) => {
    console.error('\n[FATAL ERROR during dev database setup]:', err)
    process.exit(1)
  })
}
