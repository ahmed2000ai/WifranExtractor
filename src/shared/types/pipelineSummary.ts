export type PipelineStageStatus =
  | 'not_started'
  | 'running'
  | 'completed'
  | 'partially_completed'
  | 'failed'
  | 'skipped'

export type PipelineStageSummary = {
  key:
    | 'metadata'
    | 'pdf_preprocess'
    | 'ocr'
    | 'promotional_filtering'
    | 'image_cropping'
    | 'import_tracking'
    | 'entity_matching'
    | 'offer_preparation'
    | 'offer_sync'
  label: string
  status: PipelineStageStatus
  startedAt?: string | null
  completedAt?: string | null
  durationMs?: number | null
  message?: string | null
  counts?: Record<string, number>
}

export type PipelineRowIssue = {
  severity: 'info' | 'warning' | 'error'
  code: string
  fieldName?: string | null
  message: string
}

export type PipelineResultRow = {
  rowId: string
  rowNumber?: number | null
  pageNumber?: number | null

  productNameAr?: string | null
  productNameEn?: string | null
  offerPrice?: number | null

  rowStatus:
    | 'valid'
    | 'warning'
    | 'error'
    | 'skipped'
    | 'matched'
    | 'prepared'
    | 'needs_review'
    | 'duplicate'
    | 'imported'
    | 'published'
    | 'needs_review_imported'

  skipReason?: string | null

  productId?: string | number | null
  brandId?: string | null
  categoryId?: string | null

  duplicateOfferId?: string | null
  createdOfferId?: string | null

  localImagePath?: string | null
  imageUrl?: string | null
  storagePath?: string | null

  dataQualityScore?: number | null
  preparedOfferStatus?: 'draft' | 'needs_review' | 'published' | null

  issues: PipelineRowIssue[]
}

export type PipelineSummary = {
  stages: PipelineStageSummary[]
  rows: PipelineResultRow[]
  counts: {
    totalRows: number
    validRows: number
    warningRows: number
    errorRows: number
    skippedRows: number
    skippedPromotionalRows: number
    duplicateRows: number
    preparedRows: number
    importedRows: number
    publishedRows: number
    needsReviewImportedRows: number
    imageUploadedRows: number
    imageFailedRows: number
    failedChunks: number
  }
  finalStatus:
    | 'not_started'
    | 'ready'
    | 'running'
    | 'completed'
    | 'partially_completed'
    | 'failed'
    | 'skipped'
}
