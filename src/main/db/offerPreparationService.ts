import { getSupabaseAdminClient } from './supabaseAdminClient'
import {
  OfferPreparationInput,
  OfferPreparationResult,
  OfferPreparationRowResult
} from '../../shared/types/offerPayload'
import { buildPreparedOfferPayload } from './offerPayloadBuilder'
import { findDuplicateOffer } from './duplicateOfferService'

export async function prepareOffersForSync(
  input: OfferPreparationInput
): Promise<OfferPreparationResult> {
  const result: OfferPreparationResult = {
    ok: true,
    totalRows: input.rows.length,
    preparedRows: 0,
    needsReviewRows: 0,
    duplicateRows: 0,
    errorRows: 0,
    skippedRows: 0,
    results: []
  }

  const supabase = getSupabaseAdminClient()

  // Generate source_item_number
  const sortedRows = [...input.rows].sort((a, b) => {
    const pageA = a.pageNumber || 0
    const pageB = b.pageNumber || 0
    if (pageA !== pageB) return pageA - pageB
    
    const bboxA = a.normalizedData?.original?.bounding_box || [0,0,0,0]
    const bboxB = b.normalizedData?.original?.bounding_box || [0,0,0,0]
    
    if (bboxA[1] !== bboxB[1]) return bboxA[1] - bboxB[1]
    if (bboxA[0] !== bboxB[0]) return bboxA[0] - bboxB[0]
    
    return a.rowId.localeCompare(b.rowId)
  })

  // Assign numbers to normalized data
  let validItemCounter = 1
  for (const row of sortedRows) {
    if (row.status !== 'skipped' && row.skipReason !== 'NON_PRODUCT_PROMOTIONAL_AREA') {
      row.normalizedData = row.normalizedData || {}
      row.normalizedData.source_item_number = String(validItemCounter++).padStart(3, '0')
    }
  }

  for (const row of input.rows) {
    if (row.status === 'skipped' || row.skipReason === 'NON_PRODUCT_PROMOTIONAL_AREA') {
      result.skippedRows++
      result.results.push({
        rowId: row.rowId,
        importRowId: row.importRowId,
        rowNumber: row.rowNumber,
        status: 'skipped',
        payload: null,
        duplicate: null,
        updatedNormalizedData: row.normalizedData,
        issues: [{ severity: 'info', code: 'PREPARATION_SKIPPED', message: 'Row skipped due to previous stage.' }]
      })
      continue
    }

    if (row.status === 'error') {
      result.errorRows++
      result.results.push({
        rowId: row.rowId,
        importRowId: row.importRowId,
        rowNumber: row.rowNumber,
        status: 'error',
        payload: null,
        duplicate: null,
        updatedNormalizedData: row.normalizedData,
        issues: [{ severity: 'error', code: 'PREVIOUS_STAGE_ERROR', message: 'Row has blocking errors from previous stages.' }]
      })
      continue
    }

    // Build Payload
    const { payload, issues } = buildPreparedOfferPayload({
      normalizedData: row.normalizedData,
      supermarketId: input.supermarketId,
      locationScope: input.locationScope,
      cityId: input.cityId,
      regionId: input.regionId,
      sourceId: input.sourceId || null,
      leafletId: input.leafletId || null,
      offerStartDate: input.offerStartDate,
      offerEndDate: input.offerEndDate,
      defaultOfferStatus: input.options.defaultOfferStatus,
      importDefaultStatus: input.options.importDefaultStatus,
      allowNeedsReviewFallback: input.options.allowNeedsReviewFallback,
      publishWarningsAllowed: input.options.publishWarningsAllowed,
      dataQualityNeedsReviewThreshold: input.options.dataQualityNeedsReviewThreshold,
      requireImageForDraft: input.options.requireImageForDraft
    })

    if (!payload) {
      result.errorRows++
      const res: OfferPreparationRowResult = {
        rowId: row.rowId,
        importRowId: row.importRowId,
        rowNumber: row.rowNumber,
        status: 'error',
        payload: null,
        duplicate: null,
        updatedNormalizedData: row.normalizedData,
        issues
      }
      result.results.push(res)
      await updateDbRow(supabase, res, input.importBatchId)
      continue
    }

    // Duplicate Check
    let duplicate: import('../../shared/types/offerPayload').DuplicateOfferMatch | null = null
    try {
      duplicate = await findDuplicateOffer({
        supermarketId: payload.supermarket_id,
        cityId: payload.city_id,
        regionId: payload.region_id,
        productId: payload.product_id,
        titleAr: payload.title_ar,
        titleEn: payload.title_en,
        offerStartDate: payload.offer_start_date,
        offerEndDate: payload.offer_end_date,
        offerPrice: payload.offer_price,
        packSizeValue: payload.pack_size_value,
        packSizeUnit: payload.pack_size_unit,
        packQuantity: payload.pack_quantity
      })
    } catch (err: any) {
      issues.push({ severity: 'error', code: 'DUPLICATE_CHECK_FAILED', message: err.message })
    }

    let finalStatus: OfferPreparationRowResult['status'] = payload.status === 'draft' ? 'prepared' : 'needs_review'
    
    if (duplicate) {
      if (input.options.skipDuplicateOffers) {
        finalStatus = 'duplicate'
        issues.push({ severity: 'info', code: 'DUPLICATE_OFFER_DETECTED', message: `Duplicate offer found: ${duplicate.duplicateOfferId}. Row skipped.` })
      } else {
        issues.push({ severity: 'warning', code: 'DUPLICATE_OFFER_DETECTED', message: `Duplicate offer found: ${duplicate.duplicateOfferId}. Proceeding as configured.` })
        finalStatus = 'needs_review'
        payload.status = 'needs_review'
      }
    }

    if (issues.some(i => i.severity === 'error')) {
      finalStatus = 'error'
    }

    // Update Normalized Data
    const updatedNormalizedData = { ...row.normalizedData }
    updatedNormalizedData.prepared_offer = {
      payload: finalStatus !== 'duplicate' && finalStatus !== 'error' ? payload : null,
      status: payload.status,
      data_quality_score: payload.data_quality_score
    }
    
    if (duplicate) {
      updatedNormalizedData.matched = {
        ...updatedNormalizedData.matched,
        duplicate_offer_id: duplicate.duplicateOfferId
      }
    }

    // Tally
    if (finalStatus === 'duplicate') result.duplicateRows++
    else if (finalStatus === 'error') result.errorRows++
    else if (finalStatus === 'needs_review') result.needsReviewRows++
    else if (finalStatus === 'prepared') result.preparedRows++

    const res: OfferPreparationRowResult = {
      rowId: row.rowId,
      importRowId: row.importRowId,
      rowNumber: row.rowNumber,
      status: finalStatus,
      payload: finalStatus !== 'error' ? payload : null, // keep payload even if duplicate for reference, though DB insert shouldn't happen
      duplicate,
      updatedNormalizedData,
      issues
    }
    
    result.results.push(res)
    
    // DB side effects
    await updateDbRow(supabase, res, input.importBatchId)
  }

  return result
}

async function updateDbRow(supabase: any, row: OfferPreparationRowResult, importBatchId?: string | null) {
  if (!row.importRowId) return

  const rowStatusMap: Record<OfferPreparationRowResult['status'], string> = {
    prepared: 'valid',
    needs_review: 'warning',
    duplicate: 'skipped',
    error: 'error',
    skipped: 'skipped'
  }

  const { error: rowUpdateError } = await supabase
    .from('import_rows')
    .update({
      normalized_data: row.updatedNormalizedData,
      status: rowStatusMap[row.status]
    })
    .eq('id', row.importRowId)

  if (rowUpdateError) {
    console.error(`Failed to update import row ${row.importRowId}:`, rowUpdateError)
    row.issues.push({ severity: 'error', code: 'IMPORT_ROW_UPDATE_FAILED', message: rowUpdateError.message })
  }

  if (importBatchId && row.issues.length > 0) {
    const errorInserts = row.issues.map(issue => ({
      import_batch_id: importBatchId,
      import_row_id: row.importRowId,
      offer_id: null,
      severity: issue.severity,
      field_name: issue.fieldName || null,
      error_code: issue.code,
      message: issue.message
    }))

    if (errorInserts.length > 0) {
      const { error: valError } = await supabase.from('validation_errors').insert(errorInserts)
      if (valError) {
        console.error(`Failed to insert validation errors for row ${row.importRowId}:`, valError)
      }
    }
  }
}
