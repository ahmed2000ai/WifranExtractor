export type CropBoundingBox = {
  x: number
  y: number
  width: number
  height: number
}

export type CropRenderedPage = {
  pageNumber: number
  imagePath: string
  width: number
  height: number
  dpi: number
}

export type CropInputRow = {
  rowId: string
  pageNumber: number
  status: 'valid' | 'warning' | 'error' | 'skipped'
  skipReason?: string | null
  productNameAr?: string | null
  productNameEn?: string | null
  offerPrice?: number | null
  boundingBox: CropBoundingBox | null
}

export type CropRowResultStatus = 'cropped' | 'skipped' | 'warning' | 'error'

export type CropRowIssue = {
  severity: 'info' | 'warning' | 'error'
  code: string
  message: string
}

export type CropRowResult = {
  rowId: string
  pageNumber: number
  status: CropRowResultStatus
  localImagePath: string | null
  originalBoundingBox: CropBoundingBox | null
  normalizedBoundingBox: CropBoundingBox | null
  paddedBoundingBox: CropBoundingBox | null
  issues: CropRowIssue[]
}

export type ImageCroppingInput = {
  workspacePath: string
  renderedPages: CropRenderedPage[]
  rows: CropInputRow[]
  paddingPercent: number
  outputFormat: 'jpg' | 'png' | 'webp'
  outputQuality: number
}

export type ImageCroppingProgressStage =
  | 'started'
  | 'row_skipped'
  | 'row_cropping'
  | 'row_cropped'
  | 'row_failed'
  | 'completed'
  | 'failed'

export type ImageCroppingProgressEvent = {
  stage: ImageCroppingProgressStage
  message: string
  rowId?: string
  current?: number
  total?: number
  details?: Record<string, unknown>
}

export type ImageCroppingResult = {
  ok: boolean
  workspacePath: string
  totalRows: number
  croppedRows: number
  skippedRows: number
  warningRows: number
  errorRows: number
  results: CropRowResult[]
  startedAt: string
  completedAt: string
  durationMs: number
  error?: {
    code: string
    message: string
  }
}
