export type OfferPayloadInputRow = {
  importRowId?: string | null
  rowNumber?: number | null
  rowId: string
  pageNumber: number
  status: 'valid' | 'warning' | 'error' | 'skipped' | 'matched'
  skipReason?: string | null
  normalizedData: any
}

export type PreparedOfferPayload = {
  product_id: string | number | null
  supermarket_id: string
  location_scope: string
  city_id: string | null
  region_id: string | null
  category_id: string | null
  brand_id: string | null

  title_ar: string | null
  title_en: string | null

  offer_price: number
  original_price: number | null
  discount_amount: number | null
  discount_percentage: number | null

  pack_size_value: number | null
  pack_size_unit: string | null
  pack_quantity: number | null
  unit_price: number | null
  unit_price_unit: string | null

  offer_start_date: string
  offer_end_date: string
  status: 'draft' | 'needs_review' | 'published'

  image_url: string | null
  image_path: string | null
  image_bucket: string | null
  image_source_type: string | null
  source_id: string | null
  source_page_number: number
  source_item_number: string | null
  source_reference: string | null
  external_image_id: string | null
  offer_source_id: string | null

  deal_score: number | null
  deal_label: string | null
  data_quality_score: number

  is_loyalty_required: boolean
  loyalty_notes_ar: string | null
  loyalty_notes_en: string | null

  quantity_limit: string | null
  notes_ar: string | null
  notes_en: string | null
}

export type OfferPreparationIssue = {
  severity: 'info' | 'warning' | 'error'
  code: string
  fieldName?: string | null
  message: string
}

export type DuplicateOfferMatch = {
  duplicateOfferId: string
  matchReason: string
}

export type OfferPreparationRowResult = {
  rowId: string
  importRowId?: string | null
  rowNumber?: number | null
  status: 'prepared' | 'needs_review' | 'duplicate' | 'error' | 'skipped'
  payload: PreparedOfferPayload | null
  duplicate: DuplicateOfferMatch | null
  updatedNormalizedData: any
  issues: OfferPreparationIssue[]
}

export type OfferPreparationInput = {
  importBatchId?: string | null
  sourceId?: string | null
  leafletId?: string | null
  supermarketId: string
  locationScope: 'national' | 'region' | 'city'
  cityId: string | null
  regionId: string | null
  offerStartDate: string
  offerEndDate: string
  rows: OfferPayloadInputRow[]
  options: {
    skipDuplicateOffers: boolean
    defaultOfferStatus: 'draft' | 'needs_review' | 'published'
    importDefaultStatus: 'published' | 'needs_review'
    allowNeedsReviewFallback: boolean
    publishWarningsAllowed: boolean
    dataQualityNeedsReviewThreshold: number
    requireImageForDraft: boolean
  }
}

export type OfferPreparationResult = {
  ok: boolean
  totalRows: number
  preparedRows: number
  needsReviewRows: number
  duplicateRows: number
  errorRows: number
  skippedRows: number
  results: OfferPreparationRowResult[]
  error?: {
    code: string
    message: string
  }
}

export type OfferPreparationProgressStage =
  | 'started'
  | 'building_payloads'
  | 'checking_duplicates'
  | 'saving_to_db'
  | 'completed'
  | 'failed'

export type OfferPreparationProgressEvent = {
  stage: OfferPreparationProgressStage
  message: string
  details?: Record<string, unknown>
}
