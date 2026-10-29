export type PersistImportTrackingInput = {
  metadata: {
    supermarketId: string
    locationScope: 'national' | 'region' | 'city'
    cityId: string | null
    regionId: string | null
    supermarketLabel?: string | null
    locationLabel?: string | null
    offerStartDate: string
    offerEndDate: string
    originalFileName: string
    workspacePath: string
    sourcePdfPath?: string | null
    fileUrl?: string | null
    leafletId?: string | null
  }
  ocr: {
    totalExtractedItems: number
    totalNormalizedRows: number
    validRowCount: number
    warningRowCount: number
    errorRowCount: number
    skippedRowCount: number
    skippedPromotionalRowCount: number
    normalizedRows: any[] // We pass exactly what we received from the pipeline
  }
  crops?: {
    results: any[] // We pass exactly what we received from the cropping service
    croppedRows: number
    skippedRows: number
    warningRows: number
    errorRows: number
  } | null
  dryRun?: boolean
}

export type PersistImportTrackingResult = {
  ok: boolean
  sourceId?: string
  importBatchId?: string
  insertedImportRowCount?: number
  insertedValidationErrorCount?: number
  batchStatus?: 'uploaded' | 'parsed' | 'validated' | 'imported' | 'partially_imported' | 'failed' | 'cancelled'
  error?: {
    code: string
    message: string
  }
}

export type ImportTrackingProgressStage =
  | 'started'
  | 'source_created'
  | 'batch_created'
  | 'rows_inserted'
  | 'errors_inserted'
  | 'completed'
  | 'failed'

export type ImportTrackingProgressEvent = {
  stage: ImportTrackingProgressStage
  message: string
  details?: Record<string, unknown>
}
