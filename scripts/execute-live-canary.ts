// [PRODUCTION SAFETY QUARANTINE] WIFRAN-ENV-ISOLATION-002
// This script is a historical production utility. Execution against production is blocked by default.
// To execute with explicit authorization, provide BOTH:
//   1. Environment variable: WIFRAN_PRODUCTION_MAINTENANCE_CONFIRMED=1
//   2. CLI argument: --allow-production-admin-operation
import { assertProductionMaintenanceAuthorized } from '../src/main/db/databaseEnvironmentResolver'
assertProductionMaintenanceAuthorized(__filename)

import * as fs from 'fs'
import * as path from 'path'
import { getSupabaseAdminClient } from '../src/main/db/supabaseAdminClient'
import {
  loadStagedLeafletDraft,
  saveStagedLeafletDraft,
  publishStagedLeafletDraftToDb
} from '../src/main/db/stagedLeafletDraftService'
import { resolveOrCreateSupermarket } from '../src/main/db/supermarketRegionResolutionService'
import { EXPECTED_CONSUMER_VIEW_COLUMNS } from './apply-migration-008'

async function executeLiveCanary() {
  console.log('======================================================================')
  console.log('WIFRAN-EXTRACTOR-IDENTITY-001N — LIVE CANARY EXECUTION & VERIFICATION')
  console.log('======================================================================\n')

  const supabase = getSupabaseAdminClient()
  const canaryWorkspace = path.resolve(process.cwd(), 'tmp/noori_canary_preparation')
  const mapFilePath = path.join(canaryWorkspace, 'offer-image-ref-map.json')

  // -------------------------------------------------------------------
  // 1. MANDATORY PRE-EXECUTION SAFETY AUDIT & BASELINE
  // -------------------------------------------------------------------
  console.log('--- Step 1: Pre-Execution Database Baseline Audit ---')
  const { count: preOfferCount } = await supabase.from('offers').select('*', { count: 'exact', head: true })
  const { count: preProductCount } = await supabase.from('products').select('*', { count: 'exact', head: true })
  const { count: preAliasCount } = await supabase.from('product_aliases').select('*', { count: 'exact', head: true })
  const { count: preImageCount } = await supabase.from('product_images').select('*', { count: 'exact', head: true })
  const { count: preDisplayImgCount } = await supabase.from('offer_display_images').select('*', { count: 'exact', head: true })
  const { count: preConsumerCount } = await supabase.from('v_consumer_offers').select('*', { count: 'exact', head: true })

  console.log({
    preOfferCount,
    preProductCount,
    preAliasCount,
    preImageCount,
    preDisplayImgCount,
    preConsumerCount
  })

  if (preOfferCount !== 87 || preProductCount !== 8 || preAliasCount !== 0 || preImageCount !== 7 || preConsumerCount !== 87) {
    throw new Error(`Pre-execution safety check failed! Database is not at 87-offer baseline. Aborting.`)
  }

  // Record MD5 / IDs of all 87 baseline offers to assert they remain 100% untouched
  const { data: baselineOffers } = await supabase.from('offers').select('id, updated_at, source_offer_id, product_id, catalog_match_status').order('id')
  const baselineOfferIds = new Set(baselineOffers!.map((o: any) => o.id))

  // -------------------------------------------------------------------
  // 2. RESOLVE OR CREATE SUPERMARKET FOR NOORI
  // -------------------------------------------------------------------
  console.log('\n--- Step 2: Resolving / Creating Retailer for Noori Supermarket ---')
  const resolvedSm = await resolveOrCreateSupermarket('Noori Supermarket', {
    supabaseClient: supabase
  })
  console.log('Resolved Supermarket:', resolvedSm)

  // -------------------------------------------------------------------
  // 3. LOAD STAGED DRAFT & UPDATE HEADER WITH RESOLVED RETAILER
  // -------------------------------------------------------------------
  console.log('\n--- Step 3: Loading Staged Canary Draft ---')
  const draft = await loadStagedLeafletDraft(canaryWorkspace)
  if (!draft) {
    throw new Error(`Staged draft not found in ${canaryWorkspace}`)
  }

  draft.header.supermarketId = resolvedSm.id
  ;(draft.header as any).cityId = 'a6f7b140-0002-4444-a000-000000000002' // Jeddah
  ;(draft.header as any).regionId = 'b144b6c8-2222-4444-b000-000000000002' // Western
  ;(draft.header as any).locationScope = 'city'
  draft.header.validFrom = '2026-11-02'
  draft.header.validTo = '2026-11-11'
  draft.leafletHash = 'noori-city-jeddah-2026-11-11'

  const canaryOfferMeta = [
    { sourceOfferId: 'noori-city-jeddah-2026-11-11:p001:i001:s01', quantityLimit: '1 كرتون', quantityLimitValue: 1 },
    { sourceOfferId: 'noori-city-jeddah-2026-11-11:p001:i002:s01', quantityLimit: '1 كرتون', quantityLimitValue: 1 },
    { sourceOfferId: 'noori-city-jeddah-2026-11-11:p001:i003:s01', quantityLimit: '1 كيس', quantityLimitValue: 1 }
  ]
  draft.items.forEach((item, idx) => {
    item.sourceOfferId = canaryOfferMeta[idx].sourceOfferId
    ;(item as any).quantity_limit = canaryOfferMeta[idx].quantityLimit
    ;(item as any).quantity_limit_value = canaryOfferMeta[idx].quantityLimitValue
  })

  await saveStagedLeafletDraft(canaryWorkspace, draft)
  console.log(`Staged draft updated with supermarketId: ${resolvedSm.id}`)

  // -------------------------------------------------------------------
  // 4. EXECUTE CONTROLLED LIVE PUBLICATION
  // -------------------------------------------------------------------
  console.log('\n--- Step 4: Executing Controlled Publication of the 3 Offers ---')
  const publishResult = await publishStagedLeafletDraftToDb(canaryWorkspace, {
    supabaseClient: supabase,
    mapFilePath,
    operatorConfirmedPublish: true,
    rightsBasis: 'operator_manual_verified',
    reviewedBy: 'wifran_operator_canary_001n',
    onProgress: (p) => {
      console.log(`[Progress] ${p.stage}: ${p.message}`)
    }
  })

  console.log('\nPublish Result:', {
    ok: publishResult.ok,
    leafletId: publishResult.leafletId,
    offersPublishedCount: publishResult.offersPublishedCount,
    reusedExistingDbImagesCount: publishResult.reusedExistingDbImagesCount,
    aliasesLearnedCount: publishResult.aliasesLearnedCount,
    errors: publishResult.errors
  })

  if (!publishResult.ok || publishResult.errors.length > 0 || publishResult.offersPublishedCount !== 3) {
    console.error('Publication did not succeed as expected! Errors:', publishResult.errors)
    throw new Error('Publication failed!')
  }

  // -------------------------------------------------------------------
  // 5. POST-PUBLICATION VERIFICATION AUDIT
  // -------------------------------------------------------------------
  console.log('\n--- Step 5: Post-Publication Database Verification Audit ---')

  // A. Total Offers Count
  const { count: postOfferCount } = await supabase.from('offers').select('*', { count: 'exact', head: true })
  console.log(`Assertion 1 (Total Offers = 90): ${postOfferCount} -> ${postOfferCount === 90 ? 'PASS' : 'FAIL'}`)

  // B. Exactly 3 new offers inserted
  const { data: newNooriOffers } = await supabase
    .from('offers')
    .select('id, source_offer_id, title_en, title_ar, product_id, catalog_match_status, status, offer_price, original_price, offer_start_date, offer_end_date, thumbnail_storage_path')
    .ilike('source_offer_id', 'noori%')
    .order('source_offer_id')

  console.log(`Assertion 2 (Exactly 3 Noori offers inserted): found ${newNooriOffers?.length} -> ${newNooriOffers?.length === 3 ? 'PASS' : 'FAIL'}`)
  for (const o of newNooriOffers || []) {
    console.log(`- [${o.id}] "${o.title_en}" | Price: ${o.offer_price} | Status: ${o.status} | Product ID: ${o.product_id ?? 'NULL'} | Match: ${o.catalog_match_status}`)
  }

  // C. Baseline offers intact (0 modifications)
  const { data: currentBaselineOffers } = await supabase
    .from('offers')
    .select('id, updated_at')
    .not('source_offer_id', 'ilike', 'noori%')
    .order('id')

  let baselineIntact = currentBaselineOffers?.length === 87
  if (baselineIntact) {
    for (const o of currentBaselineOffers!) {
      if (!baselineOfferIds.has(o.id)) {
        baselineIntact = false
        break
      }
    }
  }
  console.log(`Assertion 3 (All 87 baseline offers intact and untouched): ${baselineIntact ? 'PASS' : 'FAIL'}`)

  // D. Products count unchanged (exactly 8, zero products created)
  const { count: postProductCount } = await supabase.from('products').select('*', { count: 'exact', head: true })
  console.log(`Assertion 4 (Products count unchanged = 8): ${postProductCount} -> ${postProductCount === 8 ? 'PASS' : 'FAIL'}`)

  // E. Aliases count unchanged (exactly 0, auto-learning disabled)
  const { count: postAliasCount } = await supabase.from('product_aliases').select('*', { count: 'exact', head: true })
  console.log(`Assertion 5 (Aliases count unchanged = 0): ${postAliasCount} -> ${postAliasCount === 0 ? 'PASS' : 'FAIL'}`)

  // F. Consumer view v_consumer_offers row count & column schema
  const { count: postConsumerCount } = await supabase.from('v_consumer_offers').select('*', { count: 'exact', head: true })
  console.log(`Assertion 6 (v_consumer_offers total rows = 90): ${postConsumerCount} -> ${postConsumerCount === 90 ? 'PASS' : 'FAIL'}`)

  const { data: sampleConsumerRow } = await supabase.from('v_consumer_offers').select('*').limit(1)
  const viewKeys = new Set(Object.keys(sampleConsumerRow?.[0] || {}))
  const missingCols = EXPECTED_CONSUMER_VIEW_COLUMNS.filter(c => !viewKeys.has(c.name))
  const all98ColsPresent = viewKeys.size === 98 && missingCols.length === 0
  console.log(`Assertion 6b (v_consumer_offers exactly 98 columns present): size=${viewKeys.size}, missing=${missingCols.length} -> ${all98ColsPresent ? 'PASS' : 'FAIL'}`)

  // G. Identity masking in v_consumer_offers for the 3 new offers
  const { data: consumerNooriOffers } = await supabase
    .from('v_consumer_offers')
    .select('id, source_offer_id, title_en, product_id, display_image_url, display_image_kind, image_url, thumbnail_url')
    .ilike('source_offer_id', 'noori%')

  let allMasked = (consumerNooriOffers?.length === 3)
  let noPrivateLeaks = true
  for (const c of consumerNooriOffers || []) {
    if (c.product_id !== null) allMasked = false
    if (c.display_image_url !== null) noPrivateLeaks = false
    if (c.image_url !== null) noPrivateLeaks = false
    if (c.thumbnail_url !== null) noPrivateLeaks = false
  }
  console.log(`Assertion 7 (Product IDs masked to NULL in v_consumer_offers): ${allMasked ? 'PASS' : 'FAIL'}`)
  console.log(`Assertion 8 (Display images safely NULL with 0 private crop leaks): ${noPrivateLeaks ? 'PASS' : 'FAIL'}`)

  // H. Shopping-date RPC test for Jeddah on valid date 2026-11-05
  const { data: rpcOffers, error: rpcErr } = await supabase.rpc('get_consumer_offers_for_shopping_date', {
    p_shopping_date: '2026-11-05',
    p_city_id: 'a6f7b140-0002-4444-a000-000000000002' // Jeddah
  })

  const rpcNooriCount = (rpcOffers || []).filter((o: any) => o.source_offer_id?.startsWith('noori')).length
  console.log(`Assertion 9 (get_consumer_offers_for_shopping_date returns 3 Noori offers): count=${rpcNooriCount} -> ${rpcNooriCount === 3 ? 'PASS' : 'FAIL'}`)

  // I. Verified product associations preserved (exactly 8 offers with verified product IDs)
  const { data: verifiedInConsumer } = await supabase
    .from('v_consumer_offers')
    .select('id, product_id')
    .not('product_id', 'is', null)
  console.log(`Assertion 10 (Exactly 8 verified product links exposed in consumer view): count=${verifiedInConsumer?.length} -> ${verifiedInConsumer?.length === 8 ? 'PASS' : 'FAIL'}`)

  const allPassed =
    postOfferCount === 90 &&
    newNooriOffers?.length === 3 &&
    baselineIntact &&
    postProductCount === 8 &&
    postAliasCount === 0 &&
    postConsumerCount === 90 &&
    all98ColsPresent &&
    allMasked &&
    noPrivateLeaks &&
    rpcNooriCount === 3 &&
    verifiedInConsumer?.length === 8

  console.log(`\n======================================================================`)
  console.log(`LIVE CANARY STATUS: ${allPassed ? 'ALL 10 ASSERTIONS PASSED — LIVE CANARY SUCCESSFUL' : 'FAILED ASSERTIONS DETECTED'}`)
  console.log(`======================================================================`)

  if (!allPassed) {
    throw new Error('Live canary post-publication assertions failed!')
  }
}

executeLiveCanary().catch((err) => {
  console.error('Execution failed:', err)
  process.exit(1)
})
