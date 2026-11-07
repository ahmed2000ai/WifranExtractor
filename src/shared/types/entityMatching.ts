export type EntityMatchingInputRow = {
  importRowId?: string | null
  rowNumber?: number | null
  rowId: string
  pageNumber: number
  status: 'valid' | 'warning' | 'error' | 'skipped'
  skipReason?: string | null
  rawData?: any
  normalizedData: any
}

export type EntityMatchingOptions = {
  autoCreateBrands: boolean
  autoCreateProducts: boolean
  autoCreateCategories: boolean
}

export type EntityMatchIssue = {
  severity: 'info' | 'warning' | 'error'
  code: string
  fieldName?: string | null
  message: string
}

export type MatchedEntityIds = {
  brandId: string | null
  categoryId: string | null
  productId: string | number | null
}

export type EntityMatchingRowResult = {
  rowId: string
  importRowId?: string | null
  rowNumber?: number | null
  status: 'matched' | 'warning' | 'error' | 'skipped'
  matched: MatchedEntityIds
  created: {
    brandCreated: boolean
    productCreated: boolean
    aliasCreated: boolean
    categoryCreated: boolean
  }
  updatedNormalizedData: any
  issues: EntityMatchIssue[]
}

export type EntityMatchingInput = {
  importBatchId?: string | null
  rows: EntityMatchingInputRow[]
  options: EntityMatchingOptions
}

export type EntityMatchingResult = {
  ok: boolean
  totalRows: number
  matchedRows: number
  warningRows: number
  errorRows: number
  skippedRows: number
  brandsCreated: number
  productsCreated: number
  aliasesCreated: number
  categoriesCreated: number
  results: EntityMatchingRowResult[]
  error?: {
    code: string
    message: string
  }
}

export type EntityMatchingProgressStage =
  | 'started'
  | 'matching_rows'
  | 'completed'
  | 'failed'

export type EntityMatchingProgressEvent = {
  stage: EntityMatchingProgressStage
  message: string
  details?: Record<string, unknown>
}
