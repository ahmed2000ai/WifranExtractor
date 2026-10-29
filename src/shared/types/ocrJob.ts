import type { NormalizedOcrRow } from './ocr'

export type OcrSingleChunkTestInput = {
  workspacePath: string
  chunkId: string
  chunkPdfPath: string
  originalPageNumbers: number[]
  renderedPages: Array<{
    pageNumber: number
    imagePath: string
    width: number
    height: number
    dpi: number
  }>
}

export type OcrSingleChunkTestResult = {
  ok: boolean
  provider?: 'mistral'
  model?: string
  chunkId?: string
  originalPageNumbers?: number[]
  extractedItemCount?: number
  normalizedRowCount?: number
  skippedPromotionalRowCount?: number
  warningRowCount?: number
  errorRowCount?: number
  normalizedRows?: NormalizedOcrRow[]
  debugFilePath?: string | null
  usageInfo?: unknown
  error?: {
    code: string
    message: string
  }
}

export type OcrPipelineInput = {
  workspacePath: string
  chunks: Array<{
    chunkId: string
    chunkIndex: number
    chunkPdfPath: string
    originalPageNumbers: number[]
    firstOriginalPageNumber: number
    lastOriginalPageNumber: number
  }>
  renderedPages: Array<{
    pageNumber: number
    imagePath: string
    width: number
    height: number
    dpi: number
  }>
}

export type OcrPipelineProgressStage =
  | 'started'
  | 'chunk_queued'
  | 'waiting_for_rate_limit'
  | 'chunk_started'
  | 'chunk_retrying'
  | 'chunk_completed'
  | 'chunk_failed'
  | 'normalizing'
  | 'completed'
  | 'partially_completed'
  | 'failed'

export type OcrPipelineProgressEvent = {
  stage: OcrPipelineProgressStage
  message: string
  chunkId?: string
  current?: number
  total?: number

  pagesProcessed?: number
  totalPages?: number
  chunksProcessed?: number
  totalChunks?: number

  waitMs?: number
  waitReason?: 'request_interval' | 'token_budget' | 'retry_after' | 'none'

  estimatedRemainingMs?: number | null

  details?: Record<string, unknown>
}

export type OcrChunkRunStatus =
  | 'pending'
  | 'running'
  | 'retrying'
  | 'completed'
  | 'failed'

export type OcrChunkRunSummary = {
  chunkId: string
  chunkIndex: number
  originalPageNumbers: number[]
  status: OcrChunkRunStatus
  attempts: number
  durationMs?: number
  extractedItemCount: number
  normalizedRowCount: number
  skippedPromotionalRowCount: number
  warningRowCount: number
  errorRowCount: number
  debugFilePath?: string | null
  usageInfo?: unknown
  error?: {
    code: string
    message: string
  }
}

export type OcrPipelineResult = {
  ok: boolean
  status: 'completed' | 'partially_completed' | 'failed'
  provider: 'mistral'
  model: string
  totalChunks: number
  completedChunks: number
  failedChunks: number
  totalExtractedItems: number
  totalNormalizedRows: number
  validRowCount: number
  warningRowCount: number
  errorRowCount: number
  skippedRowCount: number
  skippedPromotionalRowCount: number
  chunks: OcrChunkRunSummary[]
  normalizedRows: NormalizedOcrRow[]
  startedAt: string
  completedAt: string
  durationMs: number
  error?: {
    code: string
    message: string
  }
  debugFilePath?: string | null
  usageInfo?: unknown
  totalWaits?: number
  totalWaitTimeMs?: number
  rateLimitRetries?: number
  estimatedTokenUsage?: number
  actualTokenUsage?: number
}

export type RetryFailedOcrChunksInput = {
  workspacePath: string
  originalPipelineResult: OcrPipelineResult
  renderedPages: Array<{
    pageNumber: number
    imagePath: string
    width: number
    height: number
    dpi: number
  }>
}

export type RetryFailedOcrChunksResult = {
  ok: boolean
  retriedChunkCount: number
  successfulRetryCount: number
  failedRetryCount: number
  mergedPipelineResult: OcrPipelineResult | null
  retriedChunks: OcrChunkRunSummary[]
  error?: {
    code: string
    message: string
  }
}
