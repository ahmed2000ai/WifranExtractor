import { ipcMain } from 'electron'
import { MistralOcrProvider } from '../ocr/mistralOcrProvider'
import { runOcrPipeline, retryFailedOcrChunks } from '../ocr/ocrPipelineService'
import type { 
  OcrSingleChunkTestInput, 
  OcrSingleChunkTestResult,
  OcrPipelineInput,
  OcrPipelineResult
} from '../../shared/types/ocrJob'
import { getSafeConfigStatus } from '../config/configStatus'

export function registerOcrIpcHandlers(): void {
  ipcMain.handle('ocr:testSingleChunk', async (_event, input: OcrSingleChunkTestInput): Promise<OcrSingleChunkTestResult> => {
    try {
      const config = getSafeConfigStatus()
      if (!config.mistral.apiKey.configured) {
        return { ok: false, error: { code: 'MISSING_MISTRAL_API_KEY', message: 'Mistral API key is not configured.' } }
      }

      if (!input.chunkPdfPath || input.originalPageNumbers.length === 0) {
        return { ok: false, error: { code: 'INVALID_INPUT', message: 'Missing chunk PDF path or page numbers.' } }
      }

      const provider = new MistralOcrProvider()
      
      const extractionResult = await provider.extractOffersFromChunk({
        chunkId: input.chunkId,
        chunkPdfPath: input.chunkPdfPath,
        originalPageNumbers: input.originalPageNumbers,
        renderedPages: input.renderedPages,
        workspacePath: input.workspacePath
      })

      const extractedItemCount = extractionResult.items.length
      const normalizedRowCount = extractionResult.normalizedRows.length
      
      let skippedPromotionalRowCount = 0
      let warningRowCount = 0
      let errorRowCount = 0

      extractionResult.normalizedRows.forEach(row => {
        if (row.status === 'skipped') skippedPromotionalRowCount++
        if (row.status === 'warning') warningRowCount++
        if (row.status === 'error') errorRowCount++
      })

      return {
        ok: true,
        provider: extractionResult.provider,
        model: extractionResult.model,
        chunkId: extractionResult.chunkId,
        originalPageNumbers: extractionResult.originalPageNumbers,
        extractedItemCount,
        normalizedRowCount,
        skippedPromotionalRowCount,
        warningRowCount,
        errorRowCount,
        normalizedRows: extractionResult.normalizedRows,
        debugFilePath: extractionResult.debugFilePath,
        usageInfo: extractionResult.usageInfo
      }

    } catch (e: any) {
      console.error('[OCR IPC Error]', e)
      return {
        ok: false,
        error: {
          code: e.message.split(':')[0] || 'OCR_ERROR',
          message: e.message
        }
      }
    }
  })

  ipcMain.handle('ocr:runPipeline', async (event, input: OcrPipelineInput): Promise<OcrPipelineResult> => {
    try {
      const result = await runOcrPipeline(input, (progressEvent) => {
        event.sender.send('ocr:pipeline-progress', progressEvent)
      })
      return result
    } catch (e: any) {
      console.error('[OCR Pipeline IPC Error]', e)
      return {
        ok: false,
        status: 'failed',
        provider: 'mistral',
        model: 'mistral-ocr-latest',
        totalChunks: input.chunks?.length || 0,
        completedChunks: 0,
        failedChunks: input.chunks?.length || 0,
        totalExtractedItems: 0,
        totalNormalizedRows: 0,
        validRowCount: 0,
        warningRowCount: 0,
        errorRowCount: 0,
        skippedRowCount: 0,
        skippedPromotionalRowCount: 0,
        chunks: [],
        normalizedRows: [],
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
        error: {
          code: 'OCR_PIPELINE_ERROR',
          message: e.message
        }
      }
    }
  })

  ipcMain.handle('ocr:retryFailedChunks', async (event, input: import('../../shared/types/ocrJob').RetryFailedOcrChunksInput) => {
    try {
      const result = await retryFailedOcrChunks(input, (progressEvent) => {
        event.sender.send('ocr:retry-progress', progressEvent)
      })
      return result
    } catch (e: any) {
      console.error('[OCR Retry IPC Error]', e)
      return {
        ok: false,
        retriedChunkCount: 0,
        successfulRetryCount: 0,
        failedRetryCount: 0,
        mergedPipelineResult: null,
        retriedChunks: [],
        error: {
          code: 'OCR_RETRY_ERROR',
          message: e.message
        }
      }
    }
  })
}
