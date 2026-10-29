import { join } from 'path'
import { readFileSync, readdirSync } from 'fs'
import { normalizeOcrExtractionResponse } from '../src/shared/utils/ocrNormalization'

const FIXTURES_DIR = join(__dirname, '../src/shared/fixtures')

function run() {
  console.log('Running OCR Fixture Validation...\n')
  
  let files: string[] = []
  try {
    files = readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json') && f.includes('-response'))
  } catch (e) {
    console.error(`Failed to read fixtures directory: ${FIXTURES_DIR}`)
    process.exit(1)
  }

  let passed = 0
  let failed = 0

  for (const file of files) {
    const filePath = join(FIXTURES_DIR, file)
    const fileData = readFileSync(filePath, 'utf-8')
    let jsonData: unknown
    try {
      jsonData = JSON.parse(fileData)
    } catch (e) {
      console.error(`❌ [${file}]: Invalid JSON format.`)
      failed++
      continue
    }

    const result = normalizeOcrExtractionResponse(jsonData)

    if (!result.ok) {
      console.log(`❌ [${file}]: Normalization failed completely.`)
      console.log(`   Errors: ${result.errors.map(e => e.message).join(', ')}`)
      failed++
      continue
    }

    // Expectation logic based on filename
    const isPromotional = file.includes('promotional') && !file.includes('edge-cases')
    const isEdgeCases = file.includes('edge-cases')
    const isEmpty = file.includes('empty')
    const isMissingPrice = file.includes('missing-price')
    const isMissingProduct = file.includes('missing-product')
    const isMissingBbox = file.includes('missing-bounding-box')
    const isInvalidOriginalPrice = file.includes('invalid-original-price')

    let filePassed = true
    let notes: string[] = []

    if (isEmpty) {
      if (result.items.length !== 0) {
        filePassed = false; notes.push('Expected 0 items')
      }
    } else if (isEdgeCases && file.includes('promotional-filter')) {
      // Assertions on the old promotional edge cases
      const row1Plus1 = result.rows.find(r => r.source.row_id === 'real-product-1plus1')
      const rowLurpak = result.rows.find(r => r.source.row_id === 'real-product-lurpak')
      const rowDate = result.rows.find(r => r.source.row_id === 'date-only-badge')
      const rowSponsor = result.rows.find(r => r.source.row_id === 'sponsor-only')
      const rowAmbiguous = result.rows.find(r => r.source.row_id === 'ambiguous-promo')

      if (row1Plus1?.status === 'skipped') {
        filePassed = false; notes.push('Real product 1+1 should not be skipped')
      }
      if (rowLurpak?.status === 'skipped') {
        filePassed = false; notes.push('Real product Lurpak should not be skipped')
      }
      if (rowDate?.status !== 'skipped' || rowDate.skip_reason !== 'PROMO_DATE_BADGE_ONLY') {
        filePassed = false; notes.push('Date badge should be skipped with PROMO_DATE_BADGE_ONLY')
      }
      if (rowSponsor?.status !== 'skipped' || rowSponsor.skip_reason !== 'PROMO_LOGO_OR_SPONSOR_ONLY') {
        filePassed = false; notes.push('Sponsor logo should be skipped with PROMO_LOGO_OR_SPONSOR_ONLY')
      }
      if (rowAmbiguous?.status === 'skipped' || !rowAmbiguous?.warnings.some(w => w.code === 'POSSIBLE_NON_PRODUCT_PROMOTIONAL_AREA')) {
        filePassed = false; notes.push('Ambiguous promo should have a warning, not be skipped')
      }

    } else if (file.includes('product-block-edge-cases')) {
      const err1 = result.rows.find(r => r.source.row_id === 'err1')
      const err2 = result.rows.find(r => r.source.row_id === 'err2')
      const err3 = result.rows.find(r => r.source.row_id === 'err3')
      const err4 = result.rows.find(r => r.source.row_id === 'err4')
      const err5 = result.rows.find(r => r.source.row_id === 'err5')
      const err6 = result.rows.find(r => r.source.row_id === 'err6')
      
      if (err1?.status !== 'skipped' || err1.skip_reason !== 'ISOLATED_PRICE_WITHOUT_PRODUCT') {
        filePassed = false; notes.push('Price-only row should be skipped as ISOLATED_PRICE_WITHOUT_PRODUCT')
      }
      if (err2?.status !== 'skipped' || err2.skip_reason !== 'ISOLATED_PRICE_WITHOUT_PRODUCT') {
        filePassed = false; notes.push('Old-price-only row should be skipped as ISOLATED_PRICE_WITHOUT_PRODUCT')
      }
      if (err3?.status !== 'skipped' || err3.skip_reason !== 'PROMO_NO_PRODUCT_NAME_OR_PRICE') {
        // Depending on heuristics it might hit PROMO_NO_PRODUCT_NAME_OR_PRICE first since no price or name.
        if (err3?.skip_reason !== 'PROMO_NO_PRODUCT_NAME_OR_PRICE' && err3?.skip_reason !== 'PROMO_GENERIC_DISCOUNT_ONLY') {
            filePassed = false; notes.push(`Discount-only row should be skipped, got ${err3?.skip_reason}`)
        }
      }
      if (err4?.status !== 'skipped' || err4.skip_reason !== 'SKU_ONLY_ROW') {
        filePassed = false; notes.push('SKU-only row should be skipped as SKU_ONLY_ROW')
      }
      if (err5?.status !== 'skipped' || err5.skip_reason !== 'BRANCH_NOTE_ONLY_ROW') {
        filePassed = false; notes.push('Branch-note-only row should be skipped as BRANCH_NOTE_ONLY_ROW')
      }
      if (err6?.status !== 'skipped' || err6.skip_reason !== 'BRANCH_NOTE_ONLY_ROW') {
        filePassed = false; notes.push('Unit-note-only row should be skipped as BRANCH_NOTE_ONLY_ROW')
      }

    } else if (file.includes('product-block-association')) {
      for (const row of result.rows) {
         if (row.status === 'skipped' || row.status === 'error') {
            filePassed = false; notes.push(`Valid row ${row.source.row_id} was improperly skipped/errored: ${row.status}`)
         }
      }
      const row = result.rows[0]
      if (!row) {
        filePassed = false; notes.push('Expected at least 1 row')
      } else {
        if (isPromotional && row.status !== 'skipped') {
          filePassed = false; notes.push(`Expected status 'skipped', got '${row.status}'`)
        }
        if (isMissingPrice && row.status !== 'error') {
          filePassed = false; notes.push(`Expected status 'error' for missing price, got '${row.status}'`)
        }
        if (isMissingProduct && row.status !== 'error') {
          filePassed = false; notes.push(`Expected status 'error' for missing product, got '${row.status}'`)
        }
        if (isMissingBbox && row.status !== 'warning') {
          filePassed = false; notes.push(`Expected status 'warning' for missing bounding box, got '${row.status}'`)
        }
        if (isInvalidOriginalPrice && row.status !== 'warning') {
          filePassed = false; notes.push(`Expected status 'warning' for invalid original price, got '${row.status}'`)
        }
      }
    }

    if (filePassed) {
      console.log(`✅ [${file}]: Passed.`)
      passed++
    } else {
      console.log(`❌ [${file}]: Failed expectations.`)
      notes.forEach(n => console.log(`   - ${n}`))
      failed++
    }
  }

  console.log(`\nSummary: ${passed} passed, ${failed} failed.`)
  if (failed > 0) {
    process.exit(1)
  }
}

run()
