import type { PersistImportTrackingInput } from '../../shared/types/importTracking'

export function mapOfferSourcePayload(input: PersistImportTrackingInput) {
  const { metadata } = input

  let title = `${metadata.supermarketLabel || metadata.supermarketId} leaflet`
  if (metadata.locationLabel) {
    title += ` - ${metadata.locationLabel}`
  }
  title += ` - ${metadata.offerStartDate} to ${metadata.offerEndDate}`

  return {
    source_type: 'leaflet_pdf',
    supermarket_id: metadata.supermarketId,
    city_id: metadata.cityId || null,
    region_id: metadata.regionId || null,
    title,
    source_url: null,
    file_url: metadata.fileUrl || null,
    valid_from: metadata.offerStartDate,
    valid_to: metadata.offerEndDate,
    notes: `Imported from local workspace: ${metadata.workspacePath}`
  }
}

export function mapImportBatchPayload(input: PersistImportTrackingInput, sourceId: string) {
  const { metadata, ocr } = input

  let status = 'validated'
  if (ocr.totalNormalizedRows === 0 || ocr.errorRowCount === ocr.totalNormalizedRows) {
    status = 'failed'
  }

  return {
    source_id: sourceId,
    supermarket_id: metadata.supermarketId,
    city_id: metadata.cityId || null,
    region_id: metadata.regionId || null,
    file_name: metadata.originalFileName,
    file_url: metadata.fileUrl || null,
    file_type: 'pdf',
    status,
    total_rows: ocr.totalNormalizedRows,
    valid_rows: ocr.validRowCount,
    warning_rows: ocr.warningRowCount,
    error_rows: ocr.errorRowCount,
    imported_rows: 0,
    skipped_rows: ocr.skippedRowCount,
    offer_start_date: metadata.offerStartDate,
    offer_end_date: metadata.offerEndDate
  }
}

export function buildImportRowsPayloads(input: PersistImportTrackingInput, batchId: string) {
  const { ocr, crops } = input

  const rows: any[] = []

  // Pre-calculate crop lookups if available
  const cropMap = new Map<string, any>()
  if (crops && crops.results) {
    for (const cr of crops.results) {
      cropMap.set(cr.rowId, cr)
    }
  }

  // Generate a random UUID locally for each row so we can link validation_errors immediately before DB insert.
  // Wait, the DB will assign import_row_id. But if we use bulk insert, we don't know the IDs unless we do it sequentially or use RETURNING.
  // Supabase `insert().select()` returns the inserted rows, so we can link errors after inserting rows.
  // So we just return the raw payloads here, and the service will handle the two-step insert.

  ocr.normalizedRows.forEach((row: any, index: number) => {
    const rowIdStr = String(row.source?.row_id || index)
    
    // Merge crop data into normalized data
    const cropData = cropMap.get(rowIdStr)
    const normalizedData = {
      ...row,
      crop_result: cropData || null
    }

    const rowPayload = {
      import_batch_id: batchId,
      row_number: index + 1,
      raw_data: row.original || {},
      normalized_data: normalizedData,
      status: row.status,
      created_offer_id: null,
      
      // Temporary property to match errors later (we will strip it before DB insert)
      _temp_row_id: rowIdStr,
      
      // We will attach errors here so the service can insert them later
      _temp_errors: [] as any[]
    }

    // Map OCR errors
    if (row.errors && Array.isArray(row.errors)) {
      row.errors.forEach((err: any) => {
        rowPayload._temp_errors.push({
          import_batch_id: batchId,
          offer_id: null,
          severity: 'error',
          field_name: err.field || null,
          error_code: err.code || 'UNKNOWN_ERROR',
          message: err.message || 'Validation error'
        })
      })
    }

    // Map OCR warnings
    if (row.warnings && Array.isArray(row.warnings)) {
      row.warnings.forEach((warn: any) => {
        rowPayload._temp_errors.push({
          import_batch_id: batchId,
          offer_id: null,
          severity: 'warning',
          field_name: warn.field || null,
          error_code: warn.code || 'UNKNOWN_WARNING',
          message: warn.message || 'Validation warning'
        })
      })
    }

    // Map Skips
    if (row.status === 'skipped' && row.skip_reason) {
      rowPayload._temp_errors.push({
        import_batch_id: batchId,
        offer_id: null,
        severity: 'info',
        field_name: null,
        error_code: row.skip_reason,
        message: 'Row was skipped.'
      })
    }

    // Map Crop issues
    if (cropData && cropData.issues && Array.isArray(cropData.issues)) {
      cropData.issues.forEach((issue: any) => {
        rowPayload._temp_errors.push({
          import_batch_id: batchId,
          offer_id: null,
          severity: issue.severity || 'warning',
          field_name: 'image',
          error_code: issue.code || 'CROP_ISSUE',
          message: issue.message || 'Image cropping issue'
        })
      })
    }

    rows.push(rowPayload)
  })

  return rows
}
