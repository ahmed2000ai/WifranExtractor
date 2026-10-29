import { PipelineSummary, PipelineResultRow, PipelineStageSummary, PipelineRowIssue } from '../types/pipelineSummary'

export function buildPipelineSummary(input: {
  formState?: any
  pdfPreprocessResult?: any
  ocrPipelineResult?: any
  imageCroppingResult?: any
  importTrackingResult?: any
  entityMatchingResult?: any
  offerPreparationResult?: any
  offerSyncResult?: any
}): PipelineSummary {
  const summary: PipelineSummary = {
    stages: [],
    rows: [],
    counts: {
      totalRows: 0,
      validRows: 0,
      warningRows: 0,
      errorRows: 0,
      skippedRows: 0,
      skippedPromotionalRows: 0,
      duplicateRows: 0,
      preparedRows: 0,
      importedRows: 0,
      publishedRows: 0,
      needsReviewImportedRows: 0,
      imageUploadedRows: 0,
      imageFailedRows: 0,
      failedChunks: 0
    },
    finalStatus: 'not_started'
  }

  // 1. Build Stages Timeline
  const sForm: PipelineStageSummary = { key: 'metadata', label: 'Form Metadata', status: input.formState?.supermarketId ? 'completed' : 'not_started' }
  const sPdf: PipelineStageSummary = { key: 'pdf_preprocess', label: 'PDF Preprocess', status: input.pdfPreprocessResult ? 'completed' : 'not_started' }
  const sOcr: PipelineStageSummary = { key: 'ocr', label: 'OCR Extraction', status: input.ocrPipelineResult?.status === 'success' ? 'completed' : input.ocrPipelineResult?.status === 'partial' ? 'partially_completed' : input.ocrPipelineResult?.status === 'failed' ? 'failed' : 'not_started' }
  const sPromo: PipelineStageSummary = { key: 'promotional_filtering', label: 'Promo Filter', status: input.ocrPipelineResult ? 'completed' : 'not_started' }
  const sCrop: PipelineStageSummary = { key: 'image_cropping', label: 'Image Crop', status: input.imageCroppingResult?.status === 'success' ? 'completed' : input.imageCroppingResult?.status === 'partial' ? 'partially_completed' : input.imageCroppingResult?.status === 'failed' ? 'failed' : 'not_started' }
  const sDb: PipelineStageSummary = { key: 'import_tracking', label: 'DB Import Track', status: input.importTrackingResult?.success ? 'completed' : input.importTrackingResult?.success === false ? 'failed' : 'not_started' }
  const sMatch: PipelineStageSummary = { key: 'entity_matching', label: 'Entity Match', status: input.entityMatchingResult?.status === 'success' ? 'completed' : input.entityMatchingResult?.status === 'failed' ? 'failed' : 'not_started' }
  const sPrep: PipelineStageSummary = { key: 'offer_preparation', label: 'Offer Prep', status: input.offerPreparationResult?.status === 'prepared' ? 'completed' : input.offerPreparationResult?.status === 'failed' ? 'failed' : input.offerPreparationResult?.status === 'partially_prepared' ? 'partially_completed' : 'not_started' }
  const sSync: PipelineStageSummary = { key: 'offer_sync', label: 'Final Sync', status: input.offerSyncResult?.status === 'imported' ? 'completed' : input.offerSyncResult?.status === 'partially_imported' ? 'partially_completed' : input.offerSyncResult?.status === 'failed' ? 'failed' : 'not_started' }

  summary.stages = [sForm, sPdf, sOcr, sPromo, sCrop, sDb, sMatch, sPrep, sSync]

  // Overall pipeline status
  if (sSync.status !== 'not_started') {
    summary.finalStatus = sSync.status
  } else if (sPrep.status !== 'not_started') {
    summary.finalStatus = sPrep.status
  } else if (sOcr.status !== 'not_started') {
    summary.finalStatus = sOcr.status
  } else if (sPdf.status === 'completed') {
    summary.finalStatus = 'ready'
  }

  // 2. Build Row Summaries
  const rowMap = new Map<string, PipelineResultRow>()

  // A. Load from OCR Result
  if (input.ocrPipelineResult && input.ocrPipelineResult.normalizedRows) {
    summary.counts.failedChunks = input.ocrPipelineResult.failedChunks || 0

    for (const r of input.ocrPipelineResult.normalizedRows) {
      const rowId = r.source.row_id
      let rowStatus: any = r.status
      if (rowStatus === 'skipped' && r.skip_reason === 'NON_PRODUCT_PROMOTIONAL_AREA') {
        summary.counts.skippedPromotionalRows++
      }

      const issues: PipelineRowIssue[] = []
      if (r.errors) {
        issues.push(...r.errors.map((e: any) => ({ severity: 'error' as const, code: 'OCR_ERROR', fieldName: e.field, message: e.message })))
      }
      if (r.warnings) {
        issues.push(...r.warnings.map((w: any) => ({ severity: 'warning' as const, code: 'OCR_WARNING', fieldName: w.field, message: w.message })))
      }

      rowMap.set(rowId, {
        rowId,
        rowNumber: r.source.row_number,
        pageNumber: r.source.page_number,
        productNameAr: r.offer?.title_ar || r.original?.product_name_ar,
        productNameEn: r.offer?.title_en || r.original?.product_name_en,
        offerPrice: r.offer?.offer_price || r.original?.offer_price,
        rowStatus: rowStatus,
        skipReason: r.skip_reason,
        issues
      })
    }
  }

  // B. Overlay Cropping
  if (input.imageCroppingResult && input.imageCroppingResult.results) {
    for (const crop of input.imageCroppingResult.results) {
      const existing = rowMap.get(crop.rowId)
      if (existing) {
        if (crop.localImagePath) existing.localImagePath = crop.localImagePath
        if (crop.status === 'error') {
          existing.rowStatus = 'error'
          existing.issues.push({ severity: 'error', code: 'CROP_FAILED', message: crop.error || 'Unknown crop error' })
        }
      }
    }
  }

  // C. Overlay Entity Matching
  if (input.entityMatchingResult && input.entityMatchingResult.results) {
    for (const match of input.entityMatchingResult.results) {
      const existing = rowMap.get(match.rowId)
      if (existing) {
        if (match.matched?.brandId) existing.brandId = match.matched.brandId
        if (match.matched?.categoryId) existing.categoryId = match.matched.categoryId
        if (match.matched?.productId) existing.productId = match.matched.productId
        
        if (match.issues && match.issues.length > 0) {
          existing.issues.push(...match.issues)
        }

        if (existing.rowStatus !== 'skipped' && existing.rowStatus !== 'error') {
          if (match.status === 'matched') {
             existing.rowStatus = 'matched'
          } else if (match.status === 'error') {
             existing.rowStatus = 'error'
          } else if (match.status === 'warning') {
             existing.rowStatus = 'warning'
          }
        }
      }
    }
  }

  // D. Overlay Offer Preparation
  if (input.offerPreparationResult && input.offerPreparationResult.results) {
    for (const prep of input.offerPreparationResult.results) {
      const existing = rowMap.get(prep.rowId)
      if (existing) {
        existing.dataQualityScore = prep.payload?.data_quality_score
        existing.preparedOfferStatus = prep.payload?.status

        if (prep.duplicate) {
          existing.duplicateOfferId = prep.duplicate.duplicateOfferId
          existing.rowStatus = 'duplicate'
        } else if (existing.rowStatus !== 'skipped' && existing.rowStatus !== 'error') {
          existing.rowStatus = prep.status as any
        }

        if (prep.issues && prep.issues.length > 0) {
          existing.issues.push(...prep.issues)
        }
      }
    }
  }

  // E. Overlay Offer Sync
  if (input.offerSyncResult && input.offerSyncResult.results) {
    for (const sync of input.offerSyncResult.results) {
      const existing = rowMap.get(sync.rowId)
      if (existing) {
        if (sync.imageUrl) {
          existing.imageUrl = sync.imageUrl
          existing.storagePath = sync.storagePath
          summary.counts.imageUploadedRows++
        }
        if (sync.createdOfferId) existing.createdOfferId = sync.createdOfferId

        if (sync.issues && sync.issues.length > 0) {
           existing.issues.push(...sync.issues)
           if (sync.issues.some((i: any) => i.code === 'IMAGE_UPLOAD_FAILED')) {
             summary.counts.imageFailedRows++
           }
        }

        // Final overwrite of status from DB POV
        if (sync.status === 'imported') existing.rowStatus = 'imported'
        else if (sync.status === 'published') existing.rowStatus = 'published'
        else if (sync.status === 'needs_review_imported') existing.rowStatus = 'needs_review_imported'
        else if (sync.status === 'error') existing.rowStatus = 'error'
      }
    }
  }

  summary.rows = Array.from(rowMap.values())
  summary.counts.totalRows = summary.rows.length

  for (const r of summary.rows) {
    if (r.rowStatus === 'error') summary.counts.errorRows++
    else if (r.rowStatus === 'warning') summary.counts.warningRows++
    else if (r.rowStatus === 'duplicate') summary.counts.duplicateRows++
    else if (r.rowStatus === 'skipped') summary.counts.skippedRows++
    else if (r.rowStatus === 'published') summary.counts.publishedRows++
    else if (r.rowStatus === 'imported') summary.counts.importedRows++
    else if (r.rowStatus === 'needs_review_imported') summary.counts.needsReviewImportedRows++
    else if (r.rowStatus === 'prepared') summary.counts.preparedRows++
    else if (r.rowStatus === 'valid' || r.rowStatus === 'matched') summary.counts.validRows++
    
    // Check if error array exists regardless of status logic cascade
    if (r.issues.some(i => i.severity === 'error') && r.rowStatus !== 'error') {
       summary.counts.errorRows++
       // Don't double count if we tweak logic later
    }
  }

  return summary
}
