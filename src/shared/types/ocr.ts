export type OcrBoundingBox = {
  x: number
  y: number
  width: number
  height: number
}

export type OcrExtractedItem = {
  row_id: string
  page_number: number

  product_name_ar: string | null
  product_name_en: string | null

  brand_name_ar: string | null
  brand_name_en: string | null

  category_name_ar: string | null
  category_name_en: string | null

  description_ar: string | null
  description_en: string | null

  offer_price: number | string | null
  original_price: number | string | null
  discount_text: string | null

  pack_size_value: number | string | null
  pack_size_unit: string | null
  pack_quantity: number | string | null

  notes_ar: string | null
  notes_en: string | null

  image_id?: string | null

  bounding_box: OcrBoundingBox | null

  confidence: number | null
  warnings: string[]
}

export type OcrExtractionResponse = {
  items: OcrExtractedItem[]
}

export type NormalizedOcrRowStatus = 'valid' | 'warning' | 'error' | 'skipped'

export type NormalizedOcrRowIssueSeverity = 'info' | 'warning' | 'error'

export type NormalizedOcrRowIssue = {
  severity: NormalizedOcrRowIssueSeverity
  code: string
  field_name?: string | null
  message: string
}

export type NormalizedOcrRow = {
  source: {
    page_number: number
    row_id: string
    source_reference: string | null
    chunk_id?: string
  }
  original: OcrExtractedItem
  status: NormalizedOcrRowStatus
  skip_reason?: string | null
  offer: {
    title_ar: string | null
    title_en: string | null
    offer_price: number | null
    original_price: number | null
    discount_amount: number | null
    discount_percentage: number | null
    pack_size_value: number | null
    pack_size_unit: string | null
    pack_quantity: number | null
    notes_ar: string | null
    notes_en: string | null
    data_quality_score: number
  } | null
  bounding_box: OcrBoundingBox | null
  warnings: NormalizedOcrRowIssue[]
  errors: NormalizedOcrRowIssue[]
}
