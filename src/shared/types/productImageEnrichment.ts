import type {
  ResolvedEntity,
  StagedLeafletHeader,
  OriginalOcrSnapshot,
  AiCorrectedSnapshot,
  PostCorrectionDbMatch,
  StagedOfferItem,
  StagedLeafletDraft,
  ImportStep2CsvResult,
  PublishStagedLeafletOptions,
  PublishStagedLeafletResult
} from './stagedDraft'

export type {
  ResolvedEntity,
  StagedLeafletHeader,
  OriginalOcrSnapshot,
  AiCorrectedSnapshot,
  PostCorrectionDbMatch,
  StagedOfferItem,
  StagedLeafletDraft,
  ImportStep2CsvResult,
  PublishStagedLeafletOptions,
  PublishStagedLeafletResult
}

export interface ValidatedCsvRow {
  rowNumber: number
  imageRef?: string
  productId?: number | string
  offerId?: string
  targetKind?: 'product' | 'offer'
  imageUrl: string | null
  productName?: string
  visualSubjectKey?: string
  status: 'valid' | 'blank_skipped' | 'duplicate_product' | 'unknown_product' | 'invalid_url' | 'already_has_image'
  issueMessage?: string
}

export interface HybridImageRefRow {
  imageRef: string
  itemName: string
  kind: 'product' | 'offer'
  productId?: number | string
  offerId?: string
  visualSubjectKey?: string
  memberOfferIds?: string[]
}

export interface ExportHybridImageRefsResult {
  csvContent: string
  count: number
  pCount: number
  oCount: number
  groupedOffersCount: number
  rows: HybridImageRefRow[]
  products: Array<{ id: number | string; item_name: string }>
  offers: Array<{ id: string; item_name: string; visual_subject_key: string; short_ref?: string }>
}

export interface CsvValidationSummary {
  ok: boolean
  totalRows: number
  validRowsCount: number
  blankSkippedCount: number
  alreadyHasImageCount: number
  errorCount: number
  rows: ValidatedCsvRow[]
  errors: string[]
}

export interface UploadProductImagesInput {
  csvContent: string
  operatorConfirmedReview: boolean
  reviewedBy?: string
  rightsBasis?: string
  mapFilePath?: string
  onProgress?: (event: { current: number; total: number; message: string; stage: string }) => void
}

export interface UploadProductImagesResult {
  totalRows: number
  uploadedCount: number
  reusedCount: number
  skippedCount: number
  failedCount: number
  success?: number
  skipped?: number
  errors?: number
  results: Array<{
    productId?: number | string
    offerId?: string
    imageRef?: string
    targetKind?: 'product' | 'offer'
    status: 'uploaded' | 'reused' | 'skipped' | 'failed'
    publicUrl?: string
    storagePath?: string
    error?: string
  }>
}

export interface PreMatchLocalOffersResult {
  items: StagedOfferItem[]
  matchedWithExistingDbImageCount: number
  matchedProductWithoutImageCount: number
  unmatchedOfferCount: number
  unmatchedWithExistingDbImageCount: number
  exportableCount: number
}

export interface ExportStagedLeafletRow {
  imageRef: string
  itemName?: string
  titleEn: string
  titleAr: string
  brand: string
  sizeOrWeight: string
  imageUrl: string
  isMetadata?: boolean
}

export interface ExportStagedLeafletResult {
  csvContent: string
  exportableCount: number
  skippedAlreadyImagedCount: number
  pCount: number
  oCount: number
  metadataRowsCount: number
  rows: ExportStagedLeafletRow[]
  draft: StagedLeafletDraft
}


