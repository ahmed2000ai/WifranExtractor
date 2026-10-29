import { convertArabicNumeralsToWestern } from '../src/shared/utils/arabicNumerals'
import { calculateDiscountAmount, calculateDiscountPercentage, calculateUnitPrice } from '../src/shared/utils/offerCalculations'
import { normalizeBoundingBox } from '../src/shared/utils/boundingBoxNormalization'
import { buildPipelineSummary } from '../src/shared/utils/pipelineSummaryBuilder'
import { normalizePackUnit as normalizeUnit } from '../src/shared/utils/unitNormalization'
import { validateLocationScope } from '../src/shared/utils/locationScopeValidation'
import { buildOfferImageStoragePath } from '../src/main/storage/storagePathBuilder'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { calculateDefaultGridSizeFromTemplateBox } from '../src/shared/utils/manualCropTemplateGrid'

function assertEqual(actual: any, expected: any, message: string) {
  if (actual !== expected) {
    throw new Error(`❌ ${message} | Expected: ${expected}, Got: ${actual}`)
  }
}

function assertDeepEqual(actual: any, expected: any, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`❌ ${message} | Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(actual)}`)
  }
}

function testArabicNumerals() {
  console.log('Testing Arabic Numerals...')
  assertEqual(convertArabicNumeralsToWestern('١٢٣٤٥'), '12345', 'Basic Arabic numerals')
  assertEqual(convertArabicNumeralsToWestern('Price: ٥٠.٩٩'), 'Price: 50.99', 'Mixed text and Arabic numerals')
  assertEqual(convertArabicNumeralsToWestern('12345'), '12345', 'Standard English numerals unchanged')
  console.log('✅ Arabic Numerals passed.\n')
}

function testOfferCalculations() {
  console.log('Testing Offer Calculations...')
  // Valid discount
  let amt = calculateDiscountAmount(10, 20)
  let pct = calculateDiscountPercentage(10, 20)
  assertEqual(amt, 10, 'Discount amount calculation')
  assertEqual(pct, 50, 'Discount percentage calculation')

  // Missing original price
  amt = calculateDiscountAmount(10, null)
  pct = calculateDiscountPercentage(10, null)
  assertEqual(amt, null, 'No original price -> no amount')
  assertEqual(pct, null, 'No original price -> no percentage')

  // Original price < offer price (invalid)
  amt = calculateDiscountAmount(20, 10)
  pct = calculateDiscountPercentage(20, 10)
  assertEqual(amt, null, 'Negative discount prevented')
  assertEqual(pct, null, 'Negative discount prevented')

  // Unit price calculations
  let unitPrice = calculateUnitPrice({ offerPrice: 10, packSizeValue: 2, packQuantity: 1 })
  assertEqual(unitPrice, 5, 'Unit price valid calculation')

  // Missing pack quantity
  unitPrice = calculateUnitPrice({ offerPrice: 10, packSizeValue: null, packQuantity: null })
  assertEqual(unitPrice, null, 'Unit price skipped without quantity')

  console.log('✅ Offer Calculations passed.\n')
}

function testBoundingBoxes() {
  console.log('Testing Bounding Box Normalization...')
  
  // Normal bounding box (already pixels, e.g. from 1000x1000 page but values > 1)
  const b1 = normalizeBoundingBox({ x: 100, y: 100, width: 200, height: 200 }, 1000, 1000)
  assertDeepEqual(b1, { x: 100, y: 100, width: 200, height: 200 }, 'Standard valid box (pixels)')

  // 0-to-1 normalized percentages
  const b2 = normalizeBoundingBox({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, 1000, 1000)
  assertDeepEqual(b2, { x: 100, y: 100, width: 200, height: 200 }, 'Percentage box normalized to pixels')

  // snake_case bounding box
  const b3 = normalizeBoundingBox({ top_left_x: 0.1, top_left_y: 0.1, bottom_right_x: 0.3, bottom_right_y: 0.3 }, 1000, 1000)
  assertDeepEqual(b3, { x: 100, y: 100, width: 200, height: 200 }, 'top_left / bottom_right format')

  // camelCase format
  const b4 = normalizeBoundingBox({ topLeftX: 0.1, topLeftY: 0.1, bottomRightX: 0.3, bottomRightY: 0.3 }, 1000, 1000)
  assertDeepEqual(b4, { x: 100, y: 100, width: 200, height: 200 }, 'topLeft / bottomRight format')

  console.log('✅ Bounding Box Normalization passed.\n')
}

function testUnitNormalization() {
  console.log('Testing Unit Normalization...')
  assertEqual(normalizeUnit('Kilo'), 'kg', 'Kilo -> kg')
  assertEqual(normalizeUnit('KG'), 'kg', 'KG -> kg')
  assertEqual(normalizeUnit('gram'), 'g', 'gram -> g')
  assertEqual(normalizeUnit('G'), 'g', 'G -> g')
  assertEqual(normalizeUnit('Liter'), 'l', 'Liter -> l')
  assertEqual(normalizeUnit('ML'), 'ml', 'ML -> ml')
  assertEqual(normalizeUnit('pcs'), 'piece', 'pcs -> piece')
  assertEqual(normalizeUnit('unknown'), 'other', 'unknown -> other')
  console.log('✅ Unit Normalization passed.\n')
}

function testPipelineSummary() {
  console.log('Testing Pipeline Summary Builder...')
  const summary = buildPipelineSummary({
    formState: {},
    pdfPreprocessResult: null,
    ocrPipelineResult: {
      status: 'completed',
      ok: true,
      errors: [],
      normalizedRows: [
        { source: { row_id: '1' }, status: 'valid', issues: [], original: {} },
        { source: { row_id: '2' }, status: 'skipped', skip_reason: 'NON_PRODUCT_PROMOTIONAL_AREA', issues: [], original: {} },
        { source: { row_id: '3' }, status: 'error', issues: [], original: {} }
      ]
    },
    imageCroppingResult: null,
    importTrackingResult: null,
    entityMatchingResult: null,
    offerPreparationResult: null,
    offerSyncResult: {
      status: 'completed',
      ok: true,
      errors: [],
      importedRows: 1,
      needsReviewImportedRows: 0,
      skippedRows: 1,
      duplicateRows: 0,
      errorRows: 1,
      imageUploadedRows: 0
    }
  })

  assertEqual(summary.counts.totalRows, 3, 'Total rows counts')
  assertEqual(summary.counts.skippedPromotionalRows, 1, 'Promotional rows counts')
  assertEqual(summary.counts.errorRows, 1, 'Error rows counts')
  assertEqual(summary.counts.validRows, 1, 'Valid rows counts')
  console.log('✅ Pipeline Summary Builder passed.\n')
}

// Helper to test Prompt Builder
import { buildWifranLeafletExtractionPrompt } from '../src/main/ocr/ocrPromptBuilder'
import { stripLargeOcrPayloadFields } from '../src/main/ocr/ocrDebugStorage'

async function testOcrCostMinimization() {
  console.log('Testing OCR Cost Minimization...')
  const prompt = buildWifranLeafletExtractionPrompt({ originalPageNumbers: [1, 2] })
  assertEqual(prompt.includes('Return only valid JSON matching the schema'), true, 'Prompt missing JSON restriction')
  assertEqual(prompt.includes('No markdown'), true, 'Prompt missing markdown restriction')
  
  const mockPayload = {
    image_base64: 'data:image/png;base64,...',
    base64: '...',
    document_annotation: 'A'.repeat(50001),
    long_markdown: 'A'.repeat(50001),
    valid: 'data'
  }
  
  const stripped = stripLargeOcrPayloadFields(mockPayload)
  assertEqual(stripped.image_base64, '[REDACTED_LARGE_PAYLOAD]', 'Failed to redact image_base64')
  assertEqual(stripped.base64, '[REDACTED_LARGE_PAYLOAD]', 'Failed to redact base64')
  assertEqual(stripped.long_markdown, '[REDACTED_LARGE_PAYLOAD]', 'Failed to redact large strings')
  assertEqual(stripped.document_annotation, mockPayload.document_annotation, 'Must not redact document_annotation')
  assertEqual(stripped.valid, 'data', 'Must keep small valid fields')
  
  console.log('✅ OCR Cost Minimization passed.\n')
}

// Helper to test Config Defaults
import { loadEnvConfig } from '../src/main/config/env'
import { getSafeConfigStatus } from '../src/main/config/configStatus'

function testConfigDefaults() {
  console.log('Testing Safe Config Defaults...')
  const config = loadEnvConfig()
  assertEqual(config.ocr.chunkSize, 1, 'Default chunk size should be 1')
  assertEqual(config.ocr.maxConcurrentRequests, 1, 'Default concurrency should be 1')
  assertEqual(config.ocr.maxRetries, 6, 'Default retries should be 6')
  assertEqual(config.ocr.requestTimeoutMs, 240000, 'Default timeout should be 240000')
  assertEqual(config.pdf.renderDpi, 250, 'Default DPI should be 250')
  assertEqual(config.debug.saveIntermediateFiles, false, 'Default saveIntermediateFiles should be false')
  
  const status = getSafeConfigStatus()
  // Since our tests don't have all envs set by default, validation might fail, but let's check warnings
  const hasChunkWarning = status.validation.warnings.some(w => w.includes('OCR_CHUNK_SIZE'))
  // It shouldn't have warning if default is 1
  assertEqual(hasChunkWarning, false, 'Should not have chunk warning on default')
  
  console.log('✅ Safe Config Defaults passed.\n')
}

function runSecuritySmokeCheck() {
  console.log('Running Security Smoke Check on Renderer Code...')
  const rendererDir = join(__dirname, '../src/renderer/src')
  
  function checkFiles(dir: string) {
    const files = readdirSync(dir, { withFileTypes: true })
    for (const file of files) {
      const fullPath = join(dir, file.name)
      if (file.isDirectory()) {
        checkFiles(fullPath)
      } else if (file.name.endsWith('.ts') || file.name.endsWith('.tsx')) {
        const content = readFileSync(fullPath, 'utf-8')
        if (content.includes('process.env.SUPABASE_SERVICE_ROLE_KEY')) {
          throw new Error(`❌ Security violation: process.env.SUPABASE_SERVICE_ROLE_KEY found in renderer code: ${fullPath}`)
        }
        if (content.includes('process.env.MISTRAL_API_KEY')) {
          throw new Error(`❌ Security violation: process.env.MISTRAL_API_KEY found in renderer code: ${fullPath}`)
        }
        if (content.includes("from '../../main/")) {
          throw new Error(`❌ Security violation: Main process code imported in renderer: ${fullPath}`)
        }
      }
    }
  }

  checkFiles(rendererDir)
  console.log('✅ Security Smoke Check passed.\n')
}

import { mergeOcrRetryResult } from '../src/shared/utils/ocrPipelineMerge'

function testOcrRetryMerge() {
  console.log('Testing OCR Retry Merge Logic...')
  
  const originalResult: any = {
    status: 'partially_completed',
    totalChunks: 2,
    completedChunks: 1,
    failedChunks: 1,
    totalExtractedItems: 2,
    totalNormalizedRows: 2,
    validRowCount: 2,
    warningRowCount: 0,
    errorRowCount: 0,
    skippedRowCount: 0,
    skippedPromotionalRowCount: 0,
    chunks: [
      { chunkId: 'c1', status: 'completed', extractedItemCount: 2, normalizedRowCount: 2 },
      { chunkId: 'c2', status: 'failed', extractedItemCount: 0, normalizedRowCount: 0, error: { message: 'Timeout' } }
    ],
    normalizedRows: [
      { source: { chunk_id: 'c1', row_id: 'r1' }, status: 'valid' },
      { source: { chunk_id: 'c1', row_id: 'r2' }, status: 'valid' }
    ]
  }

  const retryChunks: any = [
    { chunkId: 'c2', status: 'completed', extractedItemCount: 1, normalizedRowCount: 1 }
  ]

  const retryNormalizedRows: any = [
    { source: { chunk_id: 'c2', row_id: 'r3' }, status: 'valid' }
  ]

  const merged = mergeOcrRetryResult({
    original: originalResult,
    retryChunks,
    retryNormalizedRows
  })

  assertEqual(merged.status, 'completed', 'Status should be upgraded to completed')
  assertEqual(merged.failedChunks, 0, 'Failed chunks should be 0')
  assertEqual(merged.completedChunks, 2, 'Completed chunks should be 2')
  assertEqual(merged.totalExtractedItems, 3, 'Total extracted items should be 3')
  assertEqual(merged.totalNormalizedRows, 3, 'Total normalized rows should be 3')
  assertEqual(merged.normalizedRows.length, 3, 'Should have 3 rows in array')
  assertEqual(merged.normalizedRows.some(r => r.source.row_id === 'r3'), true, 'Should include r3')

  // Test deduplication over same chunk retry
  const originalResult2: any = {
    ...originalResult,
    status: 'failed',
    completedChunks: 0,
    failedChunks: 2,
    chunks: [
      { chunkId: 'c1', status: 'failed', extractedItemCount: 0, normalizedRowCount: 0 },
      { chunkId: 'c2', status: 'failed', extractedItemCount: 0, normalizedRowCount: 0 }
    ],
    normalizedRows: [
      { source: { chunk_id: 'c1', row_id: 'r1_old' }, status: 'error' } // stale row
    ]
  }
  
  const retryChunks2: any = [
    { chunkId: 'c1', status: 'completed', extractedItemCount: 1, normalizedRowCount: 1 }
  ]
  const retryNormalizedRows2: any = [
    { source: { chunk_id: 'c1', row_id: 'r1_new' }, status: 'valid' }
  ]

  const merged2 = mergeOcrRetryResult({
    original: originalResult2,
    retryChunks: retryChunks2,
    retryNormalizedRows: retryNormalizedRows2
  })

  assertEqual(merged2.status, 'partially_completed', 'Status partially_completed')
  assertEqual(merged2.failedChunks, 1, 'Failed chunks should be 1')
  assertEqual(merged2.normalizedRows.length, 1, 'Should only have 1 row')
  assertEqual(merged2.normalizedRows[0].source.row_id, 'r1_new', 'Stale row should be removed')
  
  console.log('✅ OCR Retry Merge Logic passed.\n')
}

function testLocationScopeValidation() {
  console.log('Testing Location Scope Validation...')
  const national = validateLocationScope({ locationScope: 'national', cityId: null, regionId: null })
  assertEqual(national.ok, true, 'National scope valid')
  
  const nationalInvalid = validateLocationScope({ locationScope: 'national', cityId: 'c1', regionId: null })
  assertEqual(nationalInvalid.ok, false, 'National scope with city invalid')
  
  const region = validateLocationScope({ locationScope: 'region', regionId: 'r1', cityId: null })
  assertEqual(region.ok, true, 'Region scope valid')
  
  const regionInvalid = validateLocationScope({ locationScope: 'region', regionId: 'r1', cityId: 'c1' })
  assertEqual(regionInvalid.ok, false, 'Region scope with city invalid')
  
  const city = validateLocationScope({ locationScope: 'city', cityId: 'c1', regionId: null })
  assertEqual(city.ok, true, 'City scope valid')
  console.log('✅ Location Scope Validation passed.\n')
}

function testStoragePathBuilder() {
  console.log('Testing Storage Path Builder...')
  const p1 = buildOfferImageStoragePath({
    supermarketSlug: 'carrefour',
    coverageScope: 'national',
    locationSlug: 'egypt',
    leafletId: 'carrefour-egypt-2024',
    itemNumber: '001',
    extension: 'webp'
  })
  assertEqual(p1, 'carrefour/national/egypt/carrefour-egypt-2024/001.webp', 'Valid national webp path')
  
  const p2 = buildOfferImageStoragePath({
    coverageScope: 'city',
    locationSlug: 'cairo',
    leafletId: 'leaflet-1',
    itemNumber: '005',
    extension: 'jpg'
  })
  assertEqual(p2, 'unknown-supermarket/city/cairo/leaflet-1/005.jpg', 'Missing supermarket slug')
  console.log('✅ Storage Path Builder passed.\n')
}

function testTemplateGridCalculation() {
  console.log('Testing Template Grid Calculation...')
  
  // Top-left selected box produces defaults that grow downward/rightward.
  let res = calculateDefaultGridSizeFromTemplateBox({
    pageWidth: 1000, pageHeight: 1000, boxX: 0, boxY: 0, boxWidth: 200, boxHeight: 200
  })
  assertEqual(res.columns, 5, 'Top-left columns')
  assertEqual(res.rows, 5, 'Top-left rows')
  
  // Bottom-left selected box produces grid defaults that grow upward/rightward.
  res = calculateDefaultGridSizeFromTemplateBox({
    pageWidth: 1000, pageHeight: 1000, boxX: 0, boxY: 800, boxWidth: 200, boxHeight: 200
  })
  assertEqual(res.columns, 5, 'Bottom-left columns')
  assertEqual(res.rows, 5, 'Bottom-left rows')
  assertEqual(res.boxesBelow, 0, 'No boxes below bottom-left')
  assertEqual(res.boxesAbove, 4, '4 boxes above bottom-left')

  // Leftover margins smaller than one box are deducted and do not increase count.
  res = calculateDefaultGridSizeFromTemplateBox({
    pageWidth: 1200, pageHeight: 1200, boxX: 80, boxY: 100, boxWidth: 250, boxHeight: 300
  })
  assertEqual(res.columns, 4, 'Leftover margins deducted for columns')
  assertEqual(res.boxesLeft, 0, 'No boxes fit in left 80px')
  assertEqual(res.boxesRight, 3, '3 boxes fit in right 870px')
  assertEqual(res.leftoverMargins.right, 120, '120px leftover on right')
  assertEqual(res.rows, 3, 'Leftover margins deducted for rows')

  console.log('✅ Template Grid Calculation passed.\n')
}

import { execSync } from 'child_process'
import * as fs from 'fs'

function testDatasetVerifier() {
  console.log('Testing Dataset Verifier...')
  const baseDir = join(process.cwd(), 'training-data', 'offer-block-detector')
  const backupDir = join(process.cwd(), 'training-data', 'offer-block-detector_backup_test')

  // Backup real data
  if (fs.existsSync(baseDir)) {
    fs.renameSync(baseDir, backupDir)
  }

  try {
    // 1. missing dataset root is initialized safely
    let out = execSync('npx tsx scripts/mlDatasetVerify.ts', { encoding: 'utf8' })
    assertEqual(out.includes('Dataset integrity: VALID'), true, 'Missing dataset becomes valid')
    assertEqual(fs.existsSync(baseDir), true, 'Base dir should be created')
    assertEqual(fs.existsSync(join(baseDir, 'annotations')), true, 'Annotations dir created')

    // 2. empty dataset verifies successfully & empty index uses the correct schema
    out = execSync('npx tsx scripts/mlDatasetVerify.ts', { encoding: 'utf8' })
    assertEqual(out.includes('Dataset integrity: VALID'), true, 'Empty dataset verifies successfully')
    assertEqual(out.includes('Training readiness: NOT READY'), true, 'Readiness is false for 0 annotations')
    
    const indexStr = fs.readFileSync(join(baseDir, 'dataset-index.json'), 'utf8')
    const index = JSON.parse(indexStr)
    assertEqual(index.schema_version, 1, 'Index uses correct schema')

    // 3. bootstrap is idempotent & existing dataset is not overwritten
    fs.writeFileSync(join(baseDir, 'annotations', 'dummy.json'), '{"dummy":true}', 'utf8')
    try {
      execSync('npx tsx scripts/mlDatasetVerify.ts', { encoding: 'utf8', stdio: 'pipe' })
    } catch(e) {} // will fail because dummy is not a valid annotation, but the file should still exist
    assertEqual(fs.existsSync(join(baseDir, 'annotations', 'dummy.json')), true, 'Existing data not overwritten')
    fs.unlinkSync(join(baseDir, 'annotations', 'dummy.json'))

    // 4. missing referenced image fails
    const annMissingImg = {
      annotation_id: 'ann-1',
      source: { leaflet_file_name: 'test', supermarket_code: 'sm' },
      image: { page_number: 1, training_image_path: 'doesnotexist.webp', width: 100, height: 100 },
      confirmed: { boxes: [] },
      quality: { eligible_for_training: true }
    }
    fs.writeFileSync(join(baseDir, 'annotations', 'ann-1.json'), JSON.stringify(annMissingImg))
    let failed = false
    try { execSync('npx tsx scripts/mlDatasetVerify.ts', { stdio: 'pipe' }) } catch(e: any) { failed = true; assertEqual(e.stdout.toString().includes('Missing image file'), true, 'Should detect missing image') }
    assertEqual(failed, true, 'Missing image fails')

    // 5. invalid box fails
    fs.writeFileSync(join(baseDir, 'images', 'dummy.webp'), 'img')
    const annInvalidBox = { ...annMissingImg, image: { ...annMissingImg.image, training_image_path: join(baseDir, 'images', 'dummy.webp') }, confirmed: { boxes: [{ x: -1, y: 0, width: 10, height: 10 }] } }
    fs.writeFileSync(join(baseDir, 'annotations', 'ann-1.json'), JSON.stringify(annInvalidBox))
    failed = false
    try { execSync('npx tsx scripts/mlDatasetVerify.ts', { stdio: 'pipe' }) } catch(e: any) { failed = true; assertEqual(e.stdout.toString().includes('Invalid box bounds'), true, 'Should detect invalid box') }
    assertEqual(failed, true, 'Invalid box fails')

    // 6. duplicate identity fails
    const annValid = { ...annInvalidBox, confirmed: { boxes: [{ x: 1, y: 1, width: 10, height: 10 }] } }
    fs.writeFileSync(join(baseDir, 'annotations', 'ann-1.json'), JSON.stringify(annValid))
    fs.writeFileSync(join(baseDir, 'annotations', 'ann-2.json'), JSON.stringify({ ...annValid, annotation_id: 'ann-2' })) // same page identity!
    failed = false
    try { execSync('npx tsx scripts/mlDatasetVerify.ts', { stdio: 'pipe' }) } catch(e: any) { failed = true; assertEqual(e.stdout.toString().includes('Duplicate page identity'), true, 'Should detect duplicate identity') }
    assertEqual(failed, true, 'Duplicate identity fails')

    // 7. below-threshold dataset passes integrity verification
    fs.unlinkSync(join(baseDir, 'annotations', 'ann-2.json')) // keep only 1 valid
    const out2 = execSync('npx tsx scripts/mlDatasetVerify.ts', { encoding: 'utf8' })
    assertEqual(out2.includes('Dataset integrity: VALID'), true, 'Below-threshold valid dataset passes')
    assertEqual(out2.includes('Eligible annotations: 1'), true, 'Counts 1 annotation')

  } finally {
    // Restore real data
    fs.rmSync(baseDir, { recursive: true, force: true })
    if (fs.existsSync(backupDir)) {
      fs.renameSync(backupDir, baseDir)
    }
  }

  console.log('✅ Dataset Verifier Tests passed.\n')
}

function testAutoAcceptanceVerifier() {
  console.log('Testing Auto-Acceptance Verifier...')
  // The verifier itself is a standalone test script that asserts all the safety gates
  const out = execSync('npx tsx scripts/mlAutoAcceptanceVerify.ts', { encoding: 'utf8' })
  assertEqual(out.includes('PASS: Fully validated isolated model reaches page-level gates'), true, 'Verifier should pass all safety scenarios')
  assertEqual(out.includes('Result: PASS'), true, 'Verifier should exit with Result: PASS')
  console.log('✅ Auto-Acceptance Verifier Tests passed.\n')
}

async function runAll() {
  console.log('==================================')
  console.log('Starting Local Smoke Tests')
  console.log('==================================\n')

  try {
    testArabicNumerals()
    testOfferCalculations()
    testBoundingBoxes()
    testUnitNormalization()
    testPipelineSummary()
    await testOcrCostMinimization()
    testConfigDefaults()
    testOcrRetryMerge()
    testLocationScopeValidation()
    testStoragePathBuilder()
    runSecuritySmokeCheck()
    testTemplateGridCalculation()
    testDatasetVerifier()
    testAutoAcceptanceVerifier()
    
    console.log('🎉 All Smoke Tests Passed Successfully.')
    process.exit(0)
  } catch (e: any) {
    console.error(e.message)
    process.exit(1)
  }
}

runAll()
