import type { OcrPipelineResult, OcrChunkRunSummary } from '../types/ocrJob'
import type { NormalizedOcrRow } from '../types/ocr'

export function mergeOcrRetryResult(input: {
  original: OcrPipelineResult
  retryChunks: OcrChunkRunSummary[]
  retryNormalizedRows: NormalizedOcrRow[]
}): OcrPipelineResult {
  const { original, retryChunks, retryNormalizedRows } = input

  // Clone original to avoid mutation
  const merged: OcrPipelineResult = JSON.parse(JSON.stringify(original))

  const retryChunkMap = new Map<string, OcrChunkRunSummary>()
  for (const chunk of retryChunks) {
    retryChunkMap.set(chunk.chunkId, chunk)
  }

  // 1. Replace failed chunk summaries with successful retry summaries (or updated failed ones)
  const updatedChunks: OcrChunkRunSummary[] = []
  let failedChunksCount = 0
  let completedChunksCount = 0

  for (const origChunk of merged.chunks) {
    if (retryChunkMap.has(origChunk.chunkId)) {
      const retryChunk = retryChunkMap.get(origChunk.chunkId)!
      updatedChunks.push(retryChunk)
      if (retryChunk.status === 'failed') failedChunksCount++
      else completedChunksCount++
    } else {
      updatedChunks.push(origChunk)
      if (origChunk.status === 'failed') failedChunksCount++
      else completedChunksCount++
    }
  }

  merged.chunks = updatedChunks
  merged.failedChunks = failedChunksCount
  merged.completedChunks = completedChunksCount

  // 2. Remove old rows from retried chunks before adding retry rows
  const retriedChunkIds = new Set(retryChunks.map(c => c.chunkId))
  const keptRows = merged.normalizedRows.filter(row => {
    // If it lacks a chunk_id, keep it just in case, but normally we shouldn't have rows from retried chunks missing chunk_id
    if (!row.source.chunk_id) return true
    return !retriedChunkIds.has(row.source.chunk_id)
  })

  // 3. Add the newly retried rows
  // We should also ensure no duplicate row_ids exist within the same chunk in retryNormalizedRows just in case
  const addedRowsMap = new Map<string, NormalizedOcrRow>()
  for (const newRow of retryNormalizedRows) {
    const key = `${newRow.source.chunk_id}-${newRow.source.row_id}`
    addedRowsMap.set(key, newRow)
  }

  const finalRows = [...keptRows, ...Array.from(addedRowsMap.values())]
  merged.normalizedRows = finalRows

  // 4. Recalculate totals
  let totalExtractedItems = 0
  let totalNormalizedRows = 0
  let validRowCount = 0
  let warningRowCount = 0
  let errorRowCount = 0
  let skippedRowCount = 0
  let skippedPromotionalRowCount = 0

  for (const chunk of merged.chunks) {
    totalExtractedItems += chunk.extractedItemCount
    totalNormalizedRows += chunk.normalizedRowCount
  }

  for (const row of finalRows) {
    if (row.status === 'valid') validRowCount++
    if (row.status === 'warning') warningRowCount++
    if (row.status === 'error') errorRowCount++
    if (row.status === 'skipped') {
      skippedRowCount++
      skippedPromotionalRowCount++
    }
  }

  merged.totalExtractedItems = totalExtractedItems
  merged.totalNormalizedRows = totalNormalizedRows
  merged.validRowCount = validRowCount
  merged.warningRowCount = warningRowCount
  merged.errorRowCount = errorRowCount
  merged.skippedRowCount = skippedRowCount
  merged.skippedPromotionalRowCount = skippedPromotionalRowCount

  // 5. Status update
  if (failedChunksCount === merged.totalChunks) {
    merged.status = 'failed'
  } else if (failedChunksCount > 0) {
    merged.status = 'partially_completed'
  } else {
    merged.status = 'completed'
  }

  merged.ok = merged.status !== 'failed'
  merged.completedAt = new Date().toISOString()
  const startedAtMs = new Date(merged.startedAt).getTime()
  merged.durationMs = Date.now() - startedAtMs
  
  if (merged.status === 'failed') {
    merged.error = { code: 'OCR_ALL_CHUNKS_FAILED', message: 'All chunks failed OCR processing.' }
  } else {
    delete merged.error
  }

  return merged
}
