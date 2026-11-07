export interface ResolvedEntity {
  id: string
  slug: string
  name_en: string
  name_ar: string
  isNew: boolean
}

export interface StagedLeafletHeader {
  supermarketId?: string | null
  region?: string | null
  validFrom?: string | null
  validTo?: string | null
  firstPagePublicUrl?: string | null
  lastPagePublicUrl?: string | null
  firstPageTmpPath?: string | null
  lastPageTmpPath?: string | null
  metadataPageNumber?: number | null
  headerModifiedByOperator: boolean
}

export interface OriginalOcrSnapshot {
  titleEn?: string | null
  titleAr?: string | null
  brand?: string | null
  sizeOrWeight?: string | null
  priceBefore?: number | null
  priceAfter?: number | null
  discountPercent?: number | null
  promoNotes?: string | null
}

export interface AiCorrectedSnapshot {
  titleEn?: string
  titleAr?: string
  brand?: string
  sizeOrWeight?: string
}

export interface PostCorrectionDbMatch {
  productId: number
  existingImageUrl: string
  productTitleEn?: string | null
  productTitleAr?: string | null
}

export interface StagedOfferItem {
  id: string
  sourceOfferId?: string
  pageNumber?: number
  originalOcr: OriginalOcrSnapshot
  aiCorrected?: AiCorrectedSnapshot
  isAiCorrected: boolean
  operatorEditedFields: string[]
  isOperatorModified: boolean
  operatorApprovedIdentity?: boolean
  operatorApprovedProductId?: number | null
  operatorApprovedBy?: string | null
  operatorApprovedAt?: string | null

  // Active / working fields
  titleEn?: string | null
  titleAr?: string | null
  brand?: string | null
  sizeOrWeight?: string | null
  priceBefore?: number | null
  priceAfter?: number | null
  discountPercent?: number | null
  promoNotes?: string | null

  // Consumer Display Image Staging
  croppedEvidenceLocalPath: string
  existingDbImageUrl?: string | null
  matchedProductId?: number | null
  matchedVisualSubjectKey?: string | null
  candidateImageUrl?: string | null
  candidateImageLocalPath?: string | null
  candidateImageSha256?: string | null
  candidateDownloadError?: string | null
  customImageUrl?: string | null
  customImageLocalPath?: string | null
  selectedImageSource: 'existing_db' | 'candidate' | 'custom_local' | 'custom_url' | 'none'
  postCorrectionDbMatch?: PostCorrectionDbMatch | null

  // Visual grouping & export metadata
  imageRef?: string
  isRepresentative?: boolean
  representativeOfferId?: string
  visualGroupMemberIds?: string[]
  status?: 'pending' | 'ready' | 'skipped'
}

export interface StagedLeafletDraft {
  schemaVersion: 'wifran.staged.draft/1.0'
  jobDir: string
  leafletHash?: string
  sourcePdfPath?: string
  createdAt: string
  updatedAt: string
  status?: 'draft' | 'published'
  publishedAt?: string
  header: StagedLeafletHeader
  items: StagedOfferItem[]
}

export interface PublishStagedLeafletOptions {
  operatorConfirmedPublish: boolean
  reviewedBy?: string
  rightsBasis?: string
  supabaseClient?: any
  mapFilePath?: string
  onProgress?: (event: { current: number; total: number; message: string; stage: string }) => void
  authorizedCanaryAutoLink?: boolean
  allowExistingOfferUpdates?: boolean
}

export interface PublishStagedLeafletResult {
  ok: boolean
  leafletId?: string
  offersPublishedCount: number
  offersSkippedAlreadyPublishedCount: number
  productImagesUploadedCount: number
  offerDisplayImagesUploadedCount: number
  reusedExistingDbImagesCount: number
  aliasesLearnedCount: number
  purgedShortRefsCount: number
  errors: string[]
}

export interface ImportStep2CsvResult {
  totalRows: number
  matchedOffersCount: number
  aiCorrectedCount: number
  postCorrectionDbMatchCount: number
  candidateImagesDownloadedCount: number
  candidateImagesReusedCount: number
  candidateImagesFailedCount: number
  metadataUpdated: {
    supermarketId?: string | null
    region?: string | null
    validFrom?: string | null
    validTo?: string | null
  }
  missingMetadata?: boolean
  missingFields?: Array<'supermarket' | 'region' | 'validFrom' | 'validTo'>
  validationWarnings?: string[]
  requiresOperatorMetadataConfirmation?: boolean
  errors: string[]
  draft: StagedLeafletDraft
}
