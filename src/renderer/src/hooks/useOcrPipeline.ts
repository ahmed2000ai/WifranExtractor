import { useState, useCallback, useEffect } from 'react'
import type { OcrPipelineInput, OcrPipelineResult, OcrPipelineProgressEvent } from '../../../shared/types/ocrJob'

export function useOcrPipeline() {
  const [running, setRunning] = useState(false)
  const [progressEvents, setProgressEvents] = useState<OcrPipelineProgressEvent[]>([])
  const [latestProgress, setLatestProgress] = useState<OcrPipelineProgressEvent | null>(null)
  const [result, setResult] = useState<OcrPipelineResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [retryingFailedChunks, setRetryingFailedChunks] = useState(false)
  const [retryResult, setRetryResult] = useState<any>(null)

  useEffect(() => {
    if (!window.wifranExtractor?.ocr?.onPipelineProgress) return

    const unsubscribe = window.wifranExtractor.ocr.onPipelineProgress((event) => {
      setLatestProgress(event)
      setProgressEvents((prev) => [...prev, event])
    })

    return () => unsubscribe()
  }, [])

  useEffect(() => {
    if (!window.wifranExtractor?.ocr?.onRetryProgress) return

    const unsubscribe = window.wifranExtractor.ocr.onRetryProgress((event) => {
      setLatestProgress(event)
      setProgressEvents((prev) => [...prev, event])
    })

    return () => unsubscribe()
  }, [])

  const runPipeline = useCallback(async (input: OcrPipelineInput) => {
    setRunning(true)
    setResult(null)
    setError(null)
    setProgressEvents([])
    setLatestProgress(null)
    setRetryResult(null)

    try {
      const response = await window.wifranExtractor.ocr.runPipeline(input)
      setResult(response)
      if (!response.ok) {
        setError(response.error?.message || 'Pipeline failed.')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to execute OCR Pipeline')
    } finally {
      setRunning(false)
    }
  }, [])

  const retryFailedChunks = useCallback(async (input: import('../../../shared/types/ocrJob').RetryFailedOcrChunksInput) => {
    setRetryingFailedChunks(true)
    setError(null)
    setRetryResult(null)
    // We could clear progress events, or just append
    // Let's clear for cleaner view
    setProgressEvents([])
    setLatestProgress(null)

    try {
      const response = await window.wifranExtractor.ocr.retryFailedChunks(input)
      setRetryResult(response)
      if (response.ok && response.mergedPipelineResult) {
        // Replace main result with merged one
        setResult(response.mergedPipelineResult)
      } else {
        setError(response.error?.message || 'Retry failed.')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to execute OCR Retry')
    } finally {
      setRetryingFailedChunks(false)
    }
  }, [])

  const reset = useCallback(() => {
    setRunning(false)
    setResult(null)
    setError(null)
    setProgressEvents([])
    setLatestProgress(null)
    setRetryingFailedChunks(false)
    setRetryResult(null)
  }, [])

  return {
    running,
    retryingFailedChunks,
    progressEvents,
    latestProgress,
    result,
    retryResult,
    error,
    runPipeline,
    retryFailedChunks,
    reset
  }
}
