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
  validateProductImageCsvImport,
  uploadApprovedProductImagesToDb
} from '../src/main/db/productImageEnrichmentService'

async function runStep3FullImport() {
  console.log('====================================================================')
  console.log('1. READING CSV & VALIDATING IMPORT PREVIEW')
  console.log('====================================================================')

  const csvPath = path.resolve(process.cwd(), 'imports/Wifran_Step3_Full42_Candidates_TEST_ONLY.csv')
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found at ${csvPath}`)
  }

  const csvContent = fs.readFileSync(csvPath, 'utf8')
  console.log(`Loaded CSV from ${csvPath} (${csvContent.length} bytes)`)

  const validation = await validateProductImageCsvImport(csvContent)
  console.log('\n--- Validation Preview Summary ---')
  console.log(`Total Rows:             ${validation.totalRows}`)
  console.log(`Valid Rows:             ${validation.validRowsCount}`)
  console.log(`Blank Skipped Rows:     ${validation.blankSkippedCount}`)
  console.log(`Already Has Image:      ${validation.alreadyHasImageCount}`)
  console.log(`Error Count:            ${validation.errorCount}`)
  console.log(`Validation OK:          ${validation.ok}`)
  if (validation.errors.length > 0) {
    console.log(`Errors:`, validation.errors)
  }

  console.log('\n====================================================================')
  console.log('2. EXECUTING BATCH UPLOAD (uploadApprovedProductImagesToDb)')
  console.log('====================================================================')

  const startTime = Date.now()
  const uploadResult = await uploadApprovedProductImagesToDb({
    csvContent,
    operatorConfirmedReview: true,
    reviewedBy: 'wifran_operator_step3_test',
    rightsBasis: 'wifran_operator_verified',
    onProgress: (p) => {
      console.log(`[Progress ${p.current}/${p.total}] (${p.stage}) ${p.message}`)
    }
  })
  const durationMs = Date.now() - startTime

  console.log('\n--- Batch Upload Result ---')
  console.log(`Duration:               ${(durationMs / 1000).toFixed(2)}s`)
  console.log(`Total Rows:             ${uploadResult.totalRows}`)
  console.log(`Uploaded Count:         ${uploadResult.uploadedCount}`)
  console.log(`Reused Count:           ${uploadResult.reusedCount}`)
  console.log(`Skipped Count:          ${uploadResult.skippedCount}`)
  console.log(`Failed Count:           ${uploadResult.failedCount}`)
  console.log(`Summary Success:        ${uploadResult.success}`)
  console.log(`Summary Skipped:        ${uploadResult.skipped}`)
  console.log(`Summary Errors:         ${uploadResult.errors}`)

  console.log('\n====================================================================')
  console.log('3. CAPTURING DATABASE ASSOCIATIONS & METRICS')
  console.log('====================================================================')

  const supabase = getSupabaseAdminClient()

  // 1. Query public.product_images
  const { data: dbProductImages, error: piErr } = await supabase
    .from('product_images')
    .select('id, product_id, storage_bucket, storage_object_path, public_url, content_sha256, approval_status, source_url')
    .order('product_id', { ascending: true })

  if (piErr) {
    console.error('Error querying product_images:', piErr.message)
  } else {
    console.log(`\npublic.product_images total rows: ${dbProductImages?.length || 0}`)
    for (const pi of dbProductImages || []) {
      console.log(`  - Product ID ${pi.product_id}: img=${pi.id}, sha=${pi.content_sha256?.slice(0, 12)}..., path=${pi.storage_object_path}`)
    }
  }

  // 2. Query public.products for 1..8
  const { data: dbProducts, error: pErr } = await supabase
    .from('products')
    .select('id, item_name_complete, approved_primary_image_id, default_image_url')
    .in('id', [1, 2, 3, 4, 5, 6, 7, 8])
    .order('id', { ascending: true })

  if (pErr) {
    console.error('Error querying products:', pErr.message)
  } else {
    console.log(`\npublic.products (IDs 1-8):`)
    for (const p of dbProducts || []) {
      console.log(`  - P${p.id} (${p.item_name_complete}): approved_img=${p.approved_primary_image_id || 'NULL'}, url=${p.default_image_url || 'NULL'}`)
    }
  }

  // 3. Query public.offer_display_images
  const { data: dbOfferImages, error: odiErr } = await supabase
    .from('offer_display_images')
    .select('id, offer_id, storage_bucket, storage_object_path, public_url, content_sha256, visual_subject_key, approval_status')
    .order('created_at', { ascending: true })

  if (odiErr) {
    console.error('Error querying offer_display_images:', odiErr.message)
  } else {
    console.log(`\npublic.offer_display_images total rows: ${dbOfferImages?.length || 0}`)
    const uniqueOffers = new Set(dbOfferImages?.map((o) => o.offer_id))
    console.log(`Unique offers with display images: ${uniqueOffers.size}`)
  }

  // 4. Query public.offer_visual_group_members and check propagation
  const { data: groupMembers, error: gmErr } = await supabase
    .from('offer_visual_group_members')
    .select('representative_offer_id, member_offer_id, visual_subject_key, visual_subject_name')

  if (gmErr) {
    console.error('Error querying offer_visual_group_members:', gmErr.message)
  } else {
    console.log(`\npublic.offer_visual_group_members (${groupMembers?.length || 0} members):`)
    const offerImgMap = new Set(dbOfferImages?.map((o) => o.offer_id) || [])
    for (const gm of groupMembers || []) {
      const repHasImg = offerImgMap.has(gm.representative_offer_id)
      const memHasImg = offerImgMap.has(gm.member_offer_id)
      console.log(`  - Rep: ${gm.representative_offer_id} (hasImg: ${repHasImg}) -> Member: ${gm.member_offer_id} (hasImg: ${memHasImg}) [${gm.visual_subject_name}]`)
    }
  }

  // 5. Specific Investigation of Problematic Rows: P1, P4, and "flying fish" offer
  console.log('\n====================================================================')
  console.log('4. INVESTIGATING PROBLEMATIC ROWS (P1, P4, FLYING FISH)')
  console.log('====================================================================')

  // Find P1 in upload results
  const p1Res = uploadResult.results.find((r) => r.imageRef === 'P1' || r.productId === 1 || r.productId === '1')
  console.log('\n[P1 Result]:', JSON.stringify(p1Res, null, 2))

  // Find P4 in upload results
  const p4Res = uploadResult.results.find((r) => r.imageRef === 'P4' || r.productId === 4 || r.productId === '4')
  console.log('\n[P4 Result]:', JSON.stringify(p4Res, null, 2))

  // Find flying fish offer
  const { data: fishOffers } = await supabase
    .from('offers')
    .select('id, source_offer_id, title_en, title_ar')
    .or('title_en.ilike.%fish%,title_ar.ilike.%سمك%')

  console.log('\nFish offers in database:')
  for (const fo of fishOffers || []) {
    const foRes = uploadResult.results.find((r) => r.offerId === fo.id || r.imageRef === `O${fo.id}`)
    console.log(`  - Offer ${fo.id} (${fo.title_en} | ${fo.title_ar}):`)
    console.log(`    Status in batch: ${foRes ? JSON.stringify(foRes) : 'Not in batch'}`)
  }

  // List all failed rows
  const failedRows = uploadResult.results.filter((r) => r.status === 'failed')
  console.log(`\nTotal Failed Rows: ${failedRows.length}`)
  for (const fr of failedRows) {
    console.log(`  - ${fr.imageRef || fr.productId || fr.offerId} (${fr.targetKind}): ${fr.error}`)
  }

  console.log('\n====================================================================')
  console.log('5. BATCH IMPORT COMPLETE')
  console.log('====================================================================')
}

runStep3FullImport().catch((err) => {
  console.error('Fatal error during Step 3 full import:', err)
  process.exit(1)
})

