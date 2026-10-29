export type OfferSyncInputRow = {
  importRowId?: string | null
  rowNumber?: number | null
  rowId: string
  pageNumber: number
  status: 'prepared' | 'needs_review' | 'duplicate' | 'error' | 'skipped'
  preparedPayload: any
  normalizedData: any
  localImagePath?: string | null
  localThumbnailPath?: string | null
  duplicateOfferId?: string | null
  issues?: Array<{
    severity: 'info' | 'warning' | 'error'
    code: string
    fieldName?: string | null
    message: string
  }>
}

export type OfferSyncOptions = {
  requireImageForDraft: boolean
  defaultOfferStatus: 'draft' | 'needs_review' | 'published'
  importDefaultStatus: 'published' | 'needs_review'
  allowNeedsReviewFallback: boolean
  publishWarningsAllowed: boolean
  requirePrePublishApproval?: boolean
  extractionPackagePath?: string
  dryRun?: boolean
}

export type OfferSyncInput = {
  importBatchId?: string | null
  sourceId?: string | null
  leafletId?: string | null
  supermarketId: string
  supermarketSlug?: string | null
  locationScope: 'national' | 'region' | 'city'
  locationSlug: string
  cityId: string | null
  regionId: string | null
  offerStartDate: string
  offerEndDate: string
  storageBucket: string
  rows: OfferSyncInputRow[]
  options: OfferSyncOptions
}

export type OfferSyncIssue = {
  severity: 'info' | 'warning' | 'error'
  code: string
  fieldName?: string | null
  message: string
}

export type OfferSyncRowResult = {
  rowId: string
  importRowId?: string | null
  rowNumber?: number | null
  status: 'imported' | 'needs_review_imported' | 'published' | 'skipped' | 'duplicate' | 'error'
  createdOfferId: string | null
  duplicateOfferId: string | null
  imageUrl: string | null
  storagePath: string | null
  thumbnailUrl?: string | null
  thumbnailStoragePath?: string | null
  externalImageId: string | null
  updatedPayload: any
  issues: OfferSyncIssue[]
}

export type OfferSyncProgressStage =
  | 'started'
  | 'row_skipped'
  | 'image_uploading'
  | 'image_uploaded'
  | 'offer_inserting'
  | 'offer_inserted'
  | 'row_failed'
  | 'batch_updating'
  | 'completed'
  | 'partially_completed'
  | 'failed'

export type OfferSyncProgressEvent = {
  stage: OfferSyncProgressStage
  message: string
  rowId?: string
  current?: number
  total?: number
  details?: Record<string, unknown>
}

export type OfferSyncResult = {
  ok: boolean
  status: 'imported' | 'partially_imported' | 'failed'
  totalRows: number
  importedRows: number
  publishedRows: number
  needsReviewImportedRows: number
  skippedRows: number
  duplicateRows: number
  errorRows: number
  imageUploadedRows: number
  imageFailedRows: number
  results: OfferSyncRowResult[]
  startedAt: string
  completedAt: string
  durationMs: number
  error?: {
    code: string
    message: string
  }
}
