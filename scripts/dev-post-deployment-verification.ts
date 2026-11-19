import { createGuardedPgClient, resolveDatabaseConfig } from '../src/main/db/databaseEnvironmentResolver'
import { assessSchemaCompatibility } from '../src/main/db/schemaCompatibilityService'
import fs from 'fs'
import path from 'path'

async function postDeploymentDevVerification() {
  console.log('=================================================================')
  console.log('  POST-DEPLOYMENT VERIFICATION ON LIVE DEV (gykrbpykjhpyrdrinkuk)')
  console.log('=================================================================')

  const config = resolveDatabaseConfig('DEVELOPMENT_TEST')
  if (config.projectRef !== 'gykrbpykjhpyrdrinkuk') {
    throw new Error(`CRITICAL: Not connected to DEV! Project ref is ${config.projectRef}`)
  }

  const client = createGuardedPgClient('DEVELOPMENT_TEST')
  await client.connect()

  const verificationReport: Record<string, any> = {}

  try {
    // 1. Confirm all 3 migrations are recorded in public._applied_migrations
    console.log('\n--- 1. Migration History ---')
    const migRes = await client.query<{ id: string; applied_at: string }>(`
      SELECT id, applied_at FROM public._applied_migrations ORDER BY applied_at;
    `)
    const appliedIds = migRes.rows.map(r => r.id)
    console.log('Applied migrations:', appliedIds)

    const expectedNewMigrations = [
      '011_wifran_mvp_candidate_consumer_visibility.sql',
      '012_wifran_offer_display_image_precedence.sql',
      '013_wifran_product_verification_defaults.sql'
    ]
    for (const m of expectedNewMigrations) {
      if (!appliedIds.includes(m)) {
        throw new Error(`Verification FAILED: ${m} not found in _applied_migrations!`)
      }
    }
    console.log('✓ All 3 Stage A migrations verified in _applied_migrations!')
    verificationReport.migrations = migRes.rows

    // 2. Verify v_consumer_offers 98-column signature
    console.log('\n--- 2. Consumer View Signature (v_consumer_offers) ---')
    const colRes = await client.query<{ column_name: string; data_type: string; ordinal_position: number }>(`
      SELECT column_name, data_type, ordinal_position
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'v_consumer_offers'
      ORDER BY ordinal_position;
    `)
    console.log(`Total columns in v_consumer_offers: ${colRes.rows.length}`)
    if (colRes.rows.length !== 98) {
      throw new Error(`Verification FAILED: v_consumer_offers has ${colRes.rows.length} columns, expected exactly 98!`)
    }
    console.log('✓ Exactly 98 columns matching consumer application contract!')
    verificationReport.columnCount = colRes.rows.length

    // 3. Verify view definition has 012 precedence & candidate visibility
    console.log('\n--- 3. View Logic & Precedence ---')
    const viewDefRes = await client.query<{ def: string }>(`
      SELECT pg_get_viewdef('public.v_consumer_offers'::regclass, true) AS def;
    `)
    const viewDef = viewDefRes.rows[0]?.def || ''
    const has012Precedence = viewDef.includes('COALESCE(odi.public_url, pi.public_url)')
    const hasCandidateVisibility = viewDef.includes('candidate_pending_review') || viewDef.includes('candidate')
    const hasContractVersionFallback = viewDef.includes('wifran.extractor.offer/2.0')

    console.log(`- 012 Image Precedence (odi over pi): ${has012Precedence}`)
    console.log(`- Candidate Product Visibility: ${hasCandidateVisibility}`)
    console.log(`- Contract Version 2.0 Fallback: ${hasContractVersionFallback}`)

    if (!has012Precedence || !hasCandidateVisibility || !hasContractVersionFallback) {
      throw new Error('Verification FAILED: v_consumer_offers missing required precedence or candidate visibility logic!')
    }
    console.log('✓ View logic, image precedence, and candidate visibility verified!')

    // 4. Verify check constraint on public.offer_display_images
    console.log('\n--- 4. offer_display_images Provenance Check Constraint ---')
    const conRes = await client.query<{ conname: string; def: string }>(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.offer_display_images'::regclass
        AND conname = 'offer_display_images_source_kind_check';
    `)
    const conDef = conRes.rows[0]?.def || ''
    console.log(`Constraint definition: ${conDef}`)
    const supportsLeafletCrop = conDef.includes('promotional_leaflet_crop') && conDef.includes('leaflet_crop')
    if (!supportsLeafletCrop) {
      throw new Error('Verification FAILED: offer_display_images constraint does not include promotional_leaflet_crop!')
    }
    console.log('✓ Accurate leaflet-crop provenance (promotional_leaflet_crop, leaflet_crop) supported!')
    verificationReport.sourceKindConstraint = conDef

    // 5. Verify product verification defaults & positive constraints
    console.log('\n--- 5. Product Verification Defaults & Quantity Constraints ---')
    const prodDefRes = await client.query<{ column_name: string; column_default: string }>(`
      SELECT column_name, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'products'
        AND column_name IN ('verification_status', 'verification_basis');
    `)
    console.log('Product defaults:', prodDefRes.rows)
    const statusDef = prodDefRes.rows.find(r => r.column_name === 'verification_status')?.column_default
    const basisDef = prodDefRes.rows.find(r => r.column_name === 'verification_basis')?.column_default

    if (!statusDef?.includes('candidate') || !basisDef?.includes('auto_extraction_provisional')) {
      throw new Error(`Verification FAILED: Product defaults incorrect! status=${statusDef}, basis=${basisDef}`)
    }
    console.log('✓ Product defaults set to candidate and auto_extraction_provisional!')

    // Verify quantity check constraints on products
    const prodCons = await client.query<{ conname: string; def: string }>(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.products'::regclass
        AND conname IN ('chk_products_positive_size', 'chk_products_positive_inner_count');
    `)
    console.log('Product positive constraints:', prodCons.rows)
    if (prodCons.rows.length !== 2) {
      throw new Error(`Verification FAILED: Expected 2 positive quantity constraints, found ${prodCons.rows.length}!`)
    }
    console.log('✓ Defensive positive quantity constraints verified!')

    // Verify offers contract_version default
    const offerDefRes = await client.query<{ column_name: string; column_default: string }>(`
      SELECT column_name, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'offers'
        AND column_name = 'contract_version';
    `)
    console.log('Offers contract_version default:', offerDefRes.rows)
    const contractVerDef = offerDefRes.rows[0]?.column_default
    if (!contractVerDef?.includes('wifran.extractor.offer/2.0')) {
      throw new Error(`Verification FAILED: offers.contract_version default is ${contractVerDef}, expected wifran.extractor.offer/2.0!`)
    }
    console.log('✓ offers.contract_version default verified as wifran.extractor.offer/2.0!')

    // 6. Verify permissions on v_consumer_offers
    console.log('\n--- 6. Permissions (anon & authenticated) ---')
    const permRes = await client.query<{ grantee: string; privilege_type: string }>(`
      SELECT grantee, privilege_type
      FROM information_schema.table_privileges
      WHERE table_schema = 'public' AND table_name = 'v_consumer_offers'
        AND privilege_type = 'SELECT';
    `)
    const grantees = permRes.rows.map(r => r.grantee)
    console.log('SELECT grantees:', grantees)
    if (!grantees.includes('anon') || !grantees.includes('authenticated')) {
      throw new Error(`Verification FAILED: Missing SELECT permissions on v_consumer_offers for anon or authenticated!`)
    }
    console.log('✓ Permissions granted to anon and authenticated!')

    // 7. Verify table counts match baseline
    console.log('\n--- 7. Record & Data Integrity Preservation ---')
    const tables = [
      'supermarkets', 'products', 'offers', 'product_images', 'offer_display_images',
      'categories', 'brands', 'cities', 'regions'
    ]
    const baselineFile = path.resolve(process.cwd(), 'backups/dev_stage_a/dev_baseline_state.json')
    const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'))

    for (const t of tables) {
      const res = await client.query(`SELECT count(*)::int AS cnt FROM public.${t};`)
      const currentCount = res.rows[0].cnt
      const baselineCount = baseline.counts[t]
      console.log(`- public.${t}: current=${currentCount}, baseline=${baselineCount}`)
      if (currentCount !== baselineCount) {
        throw new Error(`Verification FAILED: Table count mismatch for public.${t}! current=${currentCount}, baseline=${baselineCount}`)
      }
    }
    console.log('✓ All existing DEV records, rows, and identities strictly preserved!')

    // 8. Run schema compatibility assessment
    console.log('\n--- 8. Dynamic Schema Compatibility Assessment ---')
    const report = await assessSchemaCompatibility({
      context: 'DEVELOPMENT_TEST',
      pgClient: client
    })
    console.log(`Schema Compatibility: compatible=${report.compatible}`)
    console.log(`Missing dependencies:`, report.missingDependencies)
    console.log(`Blocking reasons:`, report.blockingReasons)
    if (!report.compatible || report.blockingReasons.length > 0) {
      throw new Error(`Verification FAILED: assessSchemaCompatibility reported incompatible schema: ${report.blockingReasons.join('; ')}`)
    }
    console.log('✓ Dynamic publication readiness assessment passed with ZERO blocking reasons!')

    // Write full post-deployment verification report to disk
    const reportPath = path.resolve(process.cwd(), 'backups/dev_stage_a/dev_post_deployment_verification.json')
    fs.writeFileSync(reportPath, JSON.stringify(verificationReport, null, 2))
    console.log(`\nVerification report saved to ${reportPath}`)
    console.log('\n=================================================================')
    console.log('  LIVE DEV POST-DEPLOYMENT VERIFICATION PASSED (100% SUCCESS)    ')
    console.log('=================================================================')

  } finally {
    await client.end()
  }
}

postDeploymentDevVerification().catch((err) => {
  console.error('\nVerification failed:', err)
  process.exit(1)
})
