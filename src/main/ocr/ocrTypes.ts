import type { NormalizedOcrRow } from '../../shared/types/ocr'

export type OcrProviderName = 'mistral'

export type OcrChunkInput = {
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
  workspacePath?: string
}

export type OcrExtractedDocument = {
  provider: OcrProviderName
  model: string
  chunkId: string
  originalPageNumbers: number[]
  rawResponse: unknown
  rawDocumentAnnotation: unknown
  items: unknown[]
  normalizedRows: NormalizedOcrRow[]
  usageInfo?: unknown
  _rawTokens?: number
  debugFilePath?: string | null
}

export interface OcrProvider {
  extractOffersFromChunk(input: OcrChunkInput): Promise<OcrExtractedDocument>
}
