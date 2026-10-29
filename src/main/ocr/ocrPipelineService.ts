import { MistralOcrProvider } from './mistralOcrProvider'
import { getOcrConcurrencyLimit } from './ocrConcurrency'
import { runWithOcrRetry } from './ocrRetry'
import { loadEnvConfig } from '../config/env'
import type { 
  OcrPipelineInput, 
  OcrPipelineResult, 
  OcrPipelineProgressEvent,
  OcrChunkRunSummary
} from '../../shared/types/ocrJob'
import type { NormalizedOcrRow } from '../../shared/types/ocr'
import { OcrRateLimitQueue } from './ocrRateLimitQueue'

export async function runOcrPipeline(
  input: OcrPipelineInput,
  onProgress?: (event: OcrPipelineProgressEvent) => void
): Promise<OcrPipelineResult> {
  const startedAt = new Date().toISOString()
  const startTimeMs = Date.now()
  const config = loadEnvConfig()
  
  if (!config.mistral.apiKey) {
    throw new Error('MISSING_MISTRAL_API_KEY: Mistral API key is not configured.')
  }

  if (!input.workspacePath || !input.chunks || input.chunks.length === 0) {
    throw new Error('OCR_PIPELINE_ERROR: Invalid input, missing workspacePath or chunks.')
  }

  const limit = getOcrConcurrencyLimit()
  const provider = new MistralOcrProvider()

  let completedChunksCount = 0
  let failedChunksCount = 0

  const chunkSummaries: OcrChunkRunSummary[] = []
  const allNormalizedRows: NormalizedOcrRow[] = []

  const queue = new OcrRateLimitQueue({
    requestsPerSecondLimit: config.ocr.requestsPerSecondLimit || 1,
    minRequestIntervalMs: config.ocr.minRequestIntervalMs || 5000,
    tokensPerMinuteLimit: config.ocr.tokensPerMinuteLimit || 50000,
    tpmSafetyRatio: config.ocr.tpmSafetyRatio || 0.75,
    estimatedTokensPerPage: config.ocr.estimatedTokensPerPage || 3000,
    estimatedTokensPerDensePage: config.ocr.estimatedTokensPerDensePage || 5000
  });

  onProgress?.({
    stage: 'started',
    message: 'Starting OCR pipeline.',
    current: 0,
    total: input.chunks.length,
    chunksProcessed: 0,
    totalChunks: input.chunks.length,
    pagesProcessed: 0,
    totalPages: input.chunks.reduce((sum, c) => sum + c.originalPageNumbers.length, 0)
  })

  let totalPagesProcessed = 0;
  let totalWaitTimeMs = 0;
  let totalWaits = 0;
  let rateLimitRetries = 0;
  let estimatedTokenUsage = 0;
  let actualTokenUsage = 0;

  // We map the chunks through p-limit

  const chunkPromises = input.chunks.map(chunk => limit(async () => {
    const chunkStartTimeMs = Date.now()
    
    onProgress?.({
      stage: 'chunk_started',
      chunkId: chunk.chunkId,
      message: `Running OCR for ${chunk.chunkId}.`,
      current: completedChunksCount + failedChunksCount + 1,
      total: input.chunks.length,
      chunksProcessed: completedChunksCount + failedChunksCount,
      totalChunks: input.chunks.length,
      pagesProcessed: totalPagesProcessed,
      totalPages: input.chunks.reduce((sum, c) => sum + c.originalPageNumbers.length, 0)
    })

    const runSummary: OcrChunkRunSummary = {
      chunkId: chunk.chunkId,
      chunkIndex: chunk.chunkIndex,
      originalPageNumbers: chunk.originalPageNumbers,
      status: 'running',
      attempts: 0,
      extractedItemCount: 0,
      normalizedRowCount: 0,
      skippedPromotionalRowCount: 0,
      warningRowCount: 0,
      errorRowCount: 0
    }

    try {
      const { result, attempts } = await runWithOcrRetry({
        operation: () => provider.extractOffersFromChunk({
          chunkId: chunk.chunkId,
          chunkPdfPath: chunk.chunkPdfPath,
          originalPageNumbers: chunk.originalPageNumbers,
          renderedPages: input.renderedPages,
          workspacePath: input.workspacePath
        }),
        maxRetries: config.ocr.maxRetries || 3,
        baseDelayMs: config.ocr.retryBaseDelayMs || 1000,
        queue,
        chunkId: chunk.chunkId,
        pageCount: chunk.originalPageNumbers.length,
        dense: false,
        onWait: (info) => {
          totalWaits++;
          totalWaitTimeMs += info.waitMs;
          if (info.reason === 'retry_after') rateLimitRetries++;
          onProgress?.({
            stage: 'waiting_for_rate_limit',
            chunkId: chunk.chunkId,
            message: info.message,
            waitMs: info.waitMs,
            waitReason: info.reason,
            current: completedChunksCount + failedChunksCount,
            total: input.chunks.length,
            chunksProcessed: completedChunksCount + failedChunksCount,
            totalChunks: input.chunks.length,
            pagesProcessed: totalPagesProcessed,
            totalPages: input.chunks.reduce((sum, c) => sum + c.originalPageNumbers.length, 0)
          })
        },
        onRetry: (retryEvent) => {
          onProgress?.({
            stage: 'chunk_retrying',
            chunkId: chunk.chunkId,
            message: `Retrying OCR for ${chunk.chunkId} after temporary error.`,
            details: { attempt: retryEvent.attempt, delayMs: retryEvent.delayMs },
            chunksProcessed: completedChunksCount + failedChunksCount,
            totalChunks: input.chunks.length,
            pagesProcessed: totalPagesProcessed,
            totalPages: input.chunks.reduce((sum, c) => sum + c.originalPageNumbers.length, 0)
          })
        }
      })

      runSummary.attempts = attempts
      runSummary.status = 'completed'
      runSummary.durationMs = Date.now() - chunkStartTimeMs
      runSummary.extractedItemCount = result.items.length
      runSummary.normalizedRowCount = result.normalizedRows.length
      runSummary.debugFilePath = result.debugFilePath
      
      if (result.usageInfo) {
        runSummary.usageInfo = result.usageInfo
      }
      
      const estimatedTokens = 3000 * chunk.originalPageNumbers.length;
      estimatedTokenUsage += estimatedTokens;
      if (result._rawTokens) actualTokenUsage += result._rawTokens;

      result.normalizedRows.forEach(row => {
        row.source.chunk_id = chunk.chunkId
        
        // Mistral returns 1-indexed page_number relative to the chunk.
        // Map it back to the original page number.
        const chunkPageIdx = Math.max(0, row.source.page_number - 1)
        if (chunkPageIdx < chunk.originalPageNumbers.length) {
          row.source.page_number = chunk.originalPageNumbers[chunkPageIdx]
        }
        
        if (row.status === 'skipped') {
          runSummary.skippedPromotionalRowCount++
        }
        if (row.status === 'warning') runSummary.warningRowCount++
        if (row.status === 'error') runSummary.errorRowCount++
        
        allNormalizedRows.push(row)
      })

      completedChunksCount++
      totalPagesProcessed += chunk.originalPageNumbers.length;
      
      onProgress?.({
        stage: 'chunk_completed',
        chunkId: chunk.chunkId,
        message: `OCR completed for ${chunk.chunkId}.${runSummary.skippedPromotionalRowCount > 0 ? ` Skipped ${runSummary.skippedPromotionalRowCount} promotional/banner rows.` : ''}`,
        current: completedChunksCount + failedChunksCount,
        total: input.chunks.length,
        chunksProcessed: completedChunksCount + failedChunksCount,
        totalChunks: input.chunks.length,
        pagesProcessed: totalPagesProcessed,
        totalPages: input.chunks.reduce((sum, c) => sum + c.originalPageNumbers.length, 0),
        estimatedRemainingMs: (input.chunks.length - (completedChunksCount + failedChunksCount)) * ((Date.now() - startTimeMs) / (completedChunksCount + failedChunksCount))
      })

    } catch (e: any) {
      runSummary.status = 'failed'
      runSummary.durationMs = Date.now() - chunkStartTimeMs
      runSummary.error = {
        code: e.message.split(':')[0] || 'OCR_CHUNK_FAILED',
        message: e.message
      }
      failedChunksCount++

      onProgress?.({
        stage: 'chunk_failed',
        chunkId: chunk.chunkId,
        message: `OCR failed for ${chunk.chunkId}: ${e.message}`,
        current: completedChunksCount + failedChunksCount,
        total: input.chunks.length,
        chunksProcessed: completedChunksCount + failedChunksCount,
        totalChunks: input.chunks.length,
        pagesProcessed: totalPagesProcessed,
        totalPages: input.chunks.reduce((sum, c) => sum + c.originalPageNumbers.length, 0),
        estimatedRemainingMs: (input.chunks.length - (completedChunksCount + failedChunksCount)) * ((Date.now() - startTimeMs) / (completedChunksCount + failedChunksCount))
      })
    }

    chunkSummaries.push(runSummary)
  }))

  await Promise.all(chunkPromises)

  // Sort summaries correctly
  chunkSummaries.sort((a, b) => a.chunkIndex - b.chunkIndex)

  let pipelineStatus: 'completed' | 'partially_completed' | 'failed' = 'completed'
  if (failedChunksCount === input.chunks.length) {
    pipelineStatus = 'failed'
  } else if (failedChunksCount > 0) {
    pipelineStatus = 'partially_completed'
  }

  // Aggregate totals
  let totalExtractedItems = 0
  let totalNormalizedRows = 0
  let validRowCount = 0
  let warningRowCount = 0
  let errorRowCount = 0
  let skippedRowCount = 0
  let skippedPromotionalRowCount = 0

  chunkSummaries.forEach(s => {
    totalExtractedItems += s.extractedItemCount
    totalNormalizedRows += s.normalizedRowCount
  })

  allNormalizedRows.forEach(row => {
    if (row.status === 'valid') validRowCount++
    if (row.status === 'warning') warningRowCount++
    if (row.status === 'error') errorRowCount++
    if (row.status === 'skipped') {
      skippedRowCount++
      skippedPromotionalRowCount++
    }
  })

  const durationMs = Date.now() - startTimeMs

  onProgress?.({
    stage: pipelineStatus === 'failed' ? 'failed' : pipelineStatus === 'partially_completed' ? 'partially_completed' : 'completed',
    message: pipelineStatus === 'failed' 
      ? `OCR pipeline failed. All chunks failed. Total wait time: ${Math.round(totalWaitTimeMs/1000)}s` 
      : pipelineStatus === 'partially_completed' 
        ? `OCR pipeline partially completed. Total wait time: ${Math.round(totalWaitTimeMs/1000)}s` 
        : `OCR pipeline completed. Total wait time: ${Math.round(totalWaitTimeMs/1000)}s`,
    current: completedChunksCount,
    total: input.chunks.length,
    chunksProcessed: completedChunksCount + failedChunksCount,
    totalChunks: input.chunks.length,
    pagesProcessed: totalPagesProcessed,
    totalPages: input.chunks.reduce((sum, c) => sum + c.originalPageNumbers.length, 0),
    estimatedRemainingMs: 0
  })

  return {
    ok: pipelineStatus !== 'failed',
    status: pipelineStatus,
    provider: 'mistral',
    model: config.mistral.ocrModel || 'mistral-ocr-latest',
    totalChunks: input.chunks.length,
    completedChunks: completedChunksCount,
    failedChunks: failedChunksCount,
    totalExtractedItems,
    totalNormalizedRows,
    validRowCount,
    warningRowCount,
    errorRowCount,
    skippedRowCount,
    skippedPromotionalRowCount,
    chunks: chunkSummaries,
    normalizedRows: allNormalizedRows,
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs,
    error: pipelineStatus === 'failed' ? { code: 'OCR_ALL_CHUNKS_FAILED', message: 'All chunks failed OCR processing.' } : undefined,
    totalWaits,
    totalWaitTimeMs,
    rateLimitRetries,
    estimatedTokenUsage,
    actualTokenUsage
  }
}

export async function retryFailedOcrChunks(
  input: import('../../shared/types/ocrJob').RetryFailedOcrChunksInput,
  onProgress?: (event: import('../../shared/types/ocrJob').OcrPipelineProgressEvent) => void
): Promise<import('../../shared/types/ocrJob').RetryFailedOcrChunksResult> {
  const { workspacePath, originalPipelineResult, renderedPages } = input
  
  if (!workspacePath || !originalPipelineResult || !renderedPages) {
    throw new Error('RETRY_FAILED_CHUNKS_ERROR: Invalid input provided.')
  }

  // 1. Identify failed chunks
  const failedChunks = originalPipelineResult.chunks.filter(c => c.status === 'failed')
  
  if (failedChunks.length === 0) {
    return {
      ok: true,
      retriedChunkCount: 0,
      successfulRetryCount: 0,
      failedRetryCount: 0,
      mergedPipelineResult: originalPipelineResult,
      retriedChunks: []
    }
  }

  const limit = getOcrConcurrencyLimit()
  const provider = new MistralOcrProvider()
  const config = loadEnvConfig()

  const queue = new OcrRateLimitQueue({
    requestsPerSecondLimit: config.ocr.requestsPerSecondLimit || 1,
    minRequestIntervalMs: config.ocr.minRequestIntervalMs || 5000,
    tokensPerMinuteLimit: config.ocr.tokensPerMinuteLimit || 50000,
    tpmSafetyRatio: config.ocr.tpmSafetyRatio || 0.75,
    estimatedTokensPerPage: config.ocr.estimatedTokensPerPage || 3000,
    estimatedTokensPerDensePage: config.ocr.estimatedTokensPerDensePage || 5000
  });

  onProgress?.({
    stage: 'started',
    message: 'Retrying failed OCR chunks.',
    current: 0,
    total: failedChunks.length,
    chunksProcessed: 0,
    totalChunks: failedChunks.length,
    pagesProcessed: 0,
    totalPages: failedChunks.reduce((sum, c) => sum + c.originalPageNumbers.length, 0)
  })

  let completedRetries = 0
  let failedRetries = 0
  let totalPagesProcessed = 0;

  const retrySummaries: import('../../shared/types/ocrJob').OcrChunkRunSummary[] = []
  const retryNormalizedRows: import('../../shared/types/ocr').NormalizedOcrRow[] = []

  const chunkPromises = failedChunks.map(chunk => limit(async () => {
    const chunkStartTimeMs = Date.now()
    
    onProgress?.({
      stage: 'chunk_started',
      chunkId: chunk.chunkId,
      message: `Retrying OCR for failed ${chunk.chunkId}.`,
      current: completedRetries + failedRetries + 1,
      total: failedChunks.length,
      chunksProcessed: completedRetries + failedRetries,
      totalChunks: failedChunks.length,
      pagesProcessed: totalPagesProcessed,
      totalPages: failedChunks.reduce((sum, c) => sum + c.originalPageNumbers.length, 0)
    })

    const runSummary: import('../../shared/types/ocrJob').OcrChunkRunSummary = {
      chunkId: chunk.chunkId,
      chunkIndex: chunk.chunkIndex,
      originalPageNumbers: chunk.originalPageNumbers,
      status: 'running',
      attempts: 0,
      extractedItemCount: 0,
      normalizedRowCount: 0,
      skippedPromotionalRowCount: 0,
      warningRowCount: 0,
      errorRowCount: 0
    }

    try {
      const { result, attempts } = await runWithOcrRetry({
        operation: () => provider.extractOffersFromChunk({
          chunkId: chunk.chunkId,
          chunkPdfPath: require('path').join(workspacePath, 'pdf', `${chunk.chunkId}.pdf`),
          originalPageNumbers: chunk.originalPageNumbers,
          renderedPages: renderedPages,
          workspacePath: workspacePath
        }),
        maxRetries: config.ocr.maxRetries || 5,
        baseDelayMs: config.ocr.retryBaseDelayMs || 2000,
        queue,
        chunkId: chunk.chunkId,
        pageCount: chunk.originalPageNumbers.length,
        dense: false,
        onWait: (info) => {
          onProgress?.({
            stage: 'waiting_for_rate_limit',
            chunkId: chunk.chunkId,
            message: info.message,
            waitMs: info.waitMs,
            waitReason: info.reason,
            current: completedRetries + failedRetries,
            total: failedChunks.length,
            chunksProcessed: completedRetries + failedRetries,
            totalChunks: failedChunks.length,
            pagesProcessed: totalPagesProcessed,
            totalPages: failedChunks.reduce((sum, c) => sum + c.originalPageNumbers.length, 0)
          })
        },
        onRetry: (retryEvent) => {
          onProgress?.({
            stage: 'chunk_retrying',
            chunkId: chunk.chunkId,
            message: `Retrying OCR for ${chunk.chunkId} after temporary error.`,
            details: { attempt: retryEvent.attempt, delayMs: retryEvent.delayMs },
            chunksProcessed: completedRetries + failedRetries,
            totalChunks: failedChunks.length,
            pagesProcessed: totalPagesProcessed,
            totalPages: failedChunks.reduce((sum, c) => sum + c.originalPageNumbers.length, 0)
          })
        }
      })

      runSummary.attempts = attempts
      runSummary.status = 'completed'
      runSummary.durationMs = Date.now() - chunkStartTimeMs
      runSummary.extractedItemCount = result.items.length
      runSummary.normalizedRowCount = result.normalizedRows.length
      runSummary.debugFilePath = result.debugFilePath
      
      if (result.usageInfo) {
        runSummary.usageInfo = result.usageInfo
      }

      result.normalizedRows.forEach(row => {
        row.source.chunk_id = chunk.chunkId
        
        if (row.status === 'skipped') {
          runSummary.skippedPromotionalRowCount++
        }
        if (row.status === 'warning') runSummary.warningRowCount++
        if (row.status === 'error') runSummary.errorRowCount++
        
        retryNormalizedRows.push(row)
      })

      completedRetries++
      totalPagesProcessed += chunk.originalPageNumbers.length;
      
      onProgress?.({
        stage: 'chunk_completed',
        chunkId: chunk.chunkId,
        message: `Retry succeeded for ${chunk.chunkId}.`,
        current: completedRetries + failedRetries,
        total: failedChunks.length,
        chunksProcessed: completedRetries + failedRetries,
        totalChunks: failedChunks.length,
        pagesProcessed: totalPagesProcessed,
        totalPages: failedChunks.reduce((sum, c) => sum + c.originalPageNumbers.length, 0),
        estimatedRemainingMs: (failedChunks.length - (completedRetries + failedRetries)) * ((input.originalPipelineResult.startedAt ? Date.now() - new Date(input.originalPipelineResult.startedAt).getTime() : 5000) / (completedRetries + failedRetries || 1))
      })

    } catch (e: any) {
      runSummary.status = 'failed'
      runSummary.durationMs = Date.now() - chunkStartTimeMs
      runSummary.error = {
        code: e.message.split(':')[0] || 'OCR_CHUNK_RETRY_FAILED',
        message: e.message
      }
      failedRetries++

      onProgress?.({
        stage: 'chunk_failed',
        chunkId: chunk.chunkId,
        message: `Retry failed for ${chunk.chunkId}: ${e.message}`,
        current: completedRetries + failedRetries,
        total: failedChunks.length,
        chunksProcessed: completedRetries + failedRetries,
        totalChunks: failedChunks.length,
        pagesProcessed: totalPagesProcessed,
        totalPages: failedChunks.reduce((sum, c) => sum + c.originalPageNumbers.length, 0)
      })
    }

    retrySummaries.push(runSummary)
  }))

  await Promise.all(chunkPromises)
  
  const { mergeOcrRetryResult } = require('../../shared/utils/ocrPipelineMerge')
  const mergedPipelineResult = mergeOcrRetryResult({
    original: originalPipelineResult,
    retryChunks: retrySummaries,
    retryNormalizedRows
  })

  onProgress?.({
    stage: mergedPipelineResult.status === 'completed' ? 'completed' : 'partially_completed',
    message: `OCR retry completed: ${completedRetries} succeeded, ${failedRetries} still failed.`,
    current: failedChunks.length,
    total: failedChunks.length
  })

  return {
    ok: true,
    retriedChunkCount: failedChunks.length,
    successfulRetryCount: completedRetries,
    failedRetryCount: failedRetries,
    mergedPipelineResult,
    retriedChunks: retrySummaries
  }
}
