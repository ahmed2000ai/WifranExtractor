/**
 * Post-Deployment Verification on LIVE PRODUCTION (swratbmclahjyekouned)
 *
 * Strictly Read-Only verification validating all Stage A requirements:
 * 1. Migration History (011, 012, 013 recorded in _applied_migrations)
 * 2. Record preservation (30 offers, 25 products, 18 product images preserved)
 * 3. Existing product verification states unchanged
 * 4. Consumer view v_consumer_offers exactly 98 columns
 * 5. Precedence: odi takes precedence over pi
 * 6. Candidate visibility & version fallback to wifran.extractor.offer/2.0
 * 7. offer_display_images_source_kind_check supports promotional_leaflet_crop
 * 8. Product defaults set to candidate & auto_extraction_provisional
 * 9. Defensive positive constraints (inner_pack_count, each_size_value)
 * 10. anon and authenticated SELECT grants
 * 11. All 30 production offers map cleanly through Consumer App mapper
 * 12. Extractor dynamic schema readiness check passes with 0 blocking reasons
 */

import {
  createGuardedPgClient,
  getGuardedSupabaseClient,
  PRODUCTION_PROJECT_REF
} from '../src/main/db/databaseEnvironmentResolver'
import { assessSchemaCompatibility } from '../src/main/db/schemaCompatibilityService'
// @ts-expect-error importing from consumer-app for contract mapping
import { mapConsumerOfferRow } from '../../Wifran/consumer-app/src/lib/consumer-offers/mapper'

async function verifyProductionPostDeployment() {
  console.log('=================================================================')
  console.log('  POST-DEPLOYMENT VERIFICATION ON LIVE PRODUCTION                ')
  console.log('  Target Project: swratbmclahjyekouned                           ')
  console.log('=================================================================\n')

  const client = createGuardedPgClient('PRODUCTION_UI')
  await client.connect()

  // Enforce read-only transaction for safety
  await client.query('BEGIN READ ONLY;')
  await client.query("SET LOCAL statement_timeout = '30s';")

  try {
    // --- 1. Migration History ---
    console.log('--- 1. Migration History ---')
    const migRes = await client.query<{ id: string }>(`
      SELECT id FROM public._applied_migrations ORDER BY applied_at;
    `)
    const appliedList = migRes.rows.map(r => r.id)
    console.log('Applied migrations in Production:', appliedList)

    const required = [
      '011_wifran_mvp_candidate_consumer_visibility.sql',
      '012_wifran_offer_display_image_precedence.sql',
      '013_wifran_product_verification_defaults.sql'
    ]
    for (const req of required) {
      if (!appliedList.includes(req)) {
        throw new Error(`VERIFICATION FAILED: ${req} is missing from _applied_migrations!`)
      }
    }
    console.log('✓ All 3 Stage A migrations verified in _applied_migrations!')

    // --- 2. Record & Data Integrity Preservation ---
    console.log('\n--- 2. Record & Data Integrity Preservation ---')
    const countRes = await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.offers) as offers_count,
        (SELECT count(*)::int FROM public.products) as products_count,
        (SELECT count(*)::int FROM public.product_images) as pi_count,
        (SELECT count(*)::int FROM public.offer_display_images) as odi_count,
        (SELECT count(*)::int FROM public.supermarkets) as supermarkets_count;
    `)
    const c = countRes.rows[0]
    console.log(`Live row counts: offers=${c.offers_count}, products=${c.products_count}, product_images=${c.pi_count}, offer_display_images=${c.odi_count}, supermarkets=${c.supermarkets_count}`)
    if (c.offers_count !== 30 || c.products_count !== 25 || c.pi_count !== 18 || c.supermarkets_count !== 14) {
      throw new Error(`VERIFICATION FAILED: Row counts mutated! Expected 30 offers, 25 products, 18 pi, 14 supermarkets; got ${JSON.stringify(c)}`)
    }
    console.log('✓ All 30 offers, 25 products, and catalog records strictly preserved!')

    // --- 3. Existing Product Verification States Unchanged ---
    console.log('\n--- 3. Existing Product Verification States ---')
    const prodStatesRes = await client.query(`
      SELECT verification_status, count(*)::int as count
      FROM public.products
      GROUP BY verification_status
      ORDER BY verification_status;
    `)
    console.log('Product verification status distribution:', prodStatesRes.rows)
    // In Production, all 25 pre-existing products were 'candidate'
    const candidateCount = prodStatesRes.rows.find(r => r.verification_status === 'candidate')?.count || 0
    if (candidateCount !== 25) {
      throw new Error(`VERIFICATION FAILED: Existing products mutated! Expected 25 candidate products, got ${candidateCount}`)
    }
    console.log('✓ All 25 pre-existing products remain candidate (exact pre-migration baseline preserved)!')

    // --- 4. Consumer View Signature (v_consumer_offers) ---
    console.log('\n--- 4. Consumer View Signature (v_consumer_offers) ---')
    const colsRes = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'v_consumer_offers'
      ORDER BY ordinal_position;
    `)
    console.log(`Total columns in v_consumer_offers: ${colsRes.rows.length}`)
    if (colsRes.rows.length !== 98) {
      throw new Error(`VERIFICATION FAILED: Expected 98 columns in v_consumer_offers, got ${colsRes.rows.length}!`)
    }
    console.log('✓ Exactly 98 columns matching consumer application contract!')

    // --- 5. View Logic & Precedence ---
    console.log('\n--- 5. View Logic & Precedence ---')
    const viewDefRes = await client.query(`
      SELECT view_definition
      FROM information_schema.views
      WHERE table_schema = 'public' AND table_name = 'v_consumer_offers';
    `)
    const viewDef = viewDefRes.rows[0]?.view_definition || ''
    const hasImagePrecedence = viewDef.includes('COALESCE(odi.public_url, pi.public_url)')
    const hasCandidateVisibility = viewDef.includes("'candidate'")
    const hasContractVersionFallback = viewDef.includes('wifran.extractor.offer/2.0')

    console.log(`- 012 Image Precedence (odi over pi): ${hasImagePrecedence}`)
    console.log(`- Candidate Product Visibility: ${hasCandidateVisibility}`)
    console.log(`- Contract Version 2.0 Fallback: ${hasContractVersionFallback}`)

    if (!hasImagePrecedence || !hasCandidateVisibility || !hasContractVersionFallback) {
      throw new Error('VERIFICATION FAILED: View logic does not match Migration 012 specifications!')
    }
    console.log('✓ View logic, image precedence, and candidate visibility verified!')

    // --- 6. offer_display_images Provenance Check Constraint ---
    console.log('\n--- 6. offer_display_images Provenance Check Constraint ---')
    const conRes = await client.query(`
      SELECT pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conrelid = 'public.offer_display_images'::regclass
        AND conname = 'offer_display_images_source_kind_check';
    `)
    const conDef = conRes.rows[0]?.def || ''
    console.log('Constraint definition:', conDef)
    if (!conDef.includes('promotional_leaflet_crop') || !conDef.includes('leaflet_crop')) {
      throw new Error('VERIFICATION FAILED: Constraint missing promotional_leaflet_crop or leaflet_crop!')
    }
    console.log('✓ Accurate leaflet-crop provenance (promotional_leaflet_crop, leaflet_crop) supported!')

    // --- 7. Product Verification Defaults & Quantity Constraints ---
    console.log('\n--- 7. Product Verification Defaults & Quantity Constraints ---')
    const defRes = await client.query(`
      SELECT column_name, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'products'
        AND column_name IN ('verification_status', 'verification_basis')
      ORDER BY column_name;
    `)
    console.log('Product defaults:', defRes.rows)
    const statusDef = defRes.rows.find(r => r.column_name === 'verification_status')?.column_default
    const basisDef = defRes.rows.find(r => r.column_name === 'verification_basis')?.column_default
    if (!statusDef?.includes('candidate') || !basisDef?.includes('auto_extraction_provisional')) {
      throw new Error(`VERIFICATION FAILED: Product defaults incorrect! Expected 'candidate' and 'auto_extraction_provisional', got: status=${statusDef}, basis=${basisDef}`)
    }
    console.log('✓ Product defaults verified as candidate and auto_extraction_provisional!')

    const chkRes = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conrelid = 'public.products'::regclass
        AND conname IN ('chk_products_positive_inner_count', 'chk_products_positive_size')
      ORDER BY conname;
    `)
    console.log('Product positive constraints:', chkRes.rows)
    if (chkRes.rows.length !== 2) {
      throw new Error(`VERIFICATION FAILED: Expected 2 positive quantity constraints on products, found ${chkRes.rows.length}!`)
    }
    console.log('✓ Defensive positive quantity constraints verified!')

    const offerDefRes = await client.query(`
      SELECT column_name, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'offers'
        AND column_name = 'contract_version';
    `)
    console.log('Offers contract_version default:', offerDefRes.rows)
    if (!offerDefRes.rows[0]?.column_default?.includes('wifran.extractor.offer/2.0')) {
      throw new Error(`VERIFICATION FAILED: offers.contract_version default is not wifran.extractor.offer/2.0!`)
    }
    console.log('✓ offers.contract_version default verified as wifran.extractor.offer/2.0!')

    // --- 8. Permissions (anon & authenticated) ---
    console.log('\n--- 8. Permissions (anon & authenticated) ---')
    const permRes = await client.query(`
      SELECT grantee
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'v_consumer_offers'
        AND privilege_type = 'SELECT';
    `)
    const grantees = permRes.rows.map(r => r.grantee)
    console.log('SELECT grantees:', grantees)
    if (!grantees.includes('anon') || !grantees.includes('authenticated')) {
      throw new Error(`VERIFICATION FAILED: Missing grants for anon or authenticated! Grantees: ${grantees.join(', ')}`)
    }
    console.log('✓ Permissions granted to anon and authenticated!')

    // --- 9. Clean Consumer DTO Mapping of all 30 Production Offers ---
    console.log('\n--- 9. Consumer DTO Mapping (All 30 Live Offers) ---')
    const viewRowsRes = await client.query(`
      SELECT * FROM public.v_consumer_offers;
    `)
    const viewRows = viewRowsRes.rows
    console.log(`Fetched ${viewRows.length} rows directly from public.v_consumer_offers.`)
    if (viewRows.length !== 30) {
      throw new Error(`VERIFICATION FAILED: Expected 30 view rows, got ${viewRows.length}!`)
    }

    let mappedSuccess = 0
    let totalMediaWarnings = 0
    for (const r of viewRows) {
      const mapRes = mapConsumerOfferRow(r, { referenceRiyadhDate: '2026-11-19' })
      if (!mapRes.ok) {
        throw new Error(`VERIFICATION FAILED: Row ${r.id} (${r.title_en}) failed mapping: [${mapRes.code}] ${mapRes.message}`)
      }
      mappedSuccess++
      totalMediaWarnings += mapRes.dto.media_warnings.length
      if (mapRes.dto.contract_version !== 'wifran.extractor.offer/2.0') {
        throw new Error(`VERIFICATION FAILED: Row ${r.id} has invalid contract_version: ${mapRes.dto.contract_version}`)
      }
    }
    console.log(`✓ 30 / 30 offers mapped cleanly into ConsumerOfferDTO!`)
    console.log(`✓ Total mapping failures: 0, Total media warnings: ${totalMediaWarnings}`)

    // --- 10. Dynamic Schema Compatibility Assessment ---
    console.log('\n--- 10. Dynamic Schema Compatibility Assessment ---')
    const readiness = await assessSchemaCompatibility({ context: 'PRODUCTION_UI' })
    console.log('Schema Compatibility:', {
      compatible: readiness.compatible,
      missingDependencies: readiness.missingDependencies,
      blockingReasons: readiness.blockingReasons
    })
    if (!readiness.compatible || readiness.blockingReasons.length > 0) {
      throw new Error(`VERIFICATION FAILED: assessSchemaCompatibility reported blocking reasons: ${readiness.blockingReasons.join(', ')}`)
    }
    console.log('✓ Dynamic publication readiness assessment passed with ZERO blocking reasons!')

    console.log('\n=================================================================')
    console.log('  PRODUCTION POST-DEPLOYMENT VERIFICATION PASSED (100% SUCCESS)  ')
    console.log('=================================================================')

  } finally {
    await client.query('ROLLBACK;')
    await client.end()
  }
}

verifyProductionPostDeployment().catch(err => {
  console.error('\nVerification failed with fatal error:', err)
  process.exit(1)
})
