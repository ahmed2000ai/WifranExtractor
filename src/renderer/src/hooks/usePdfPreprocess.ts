import { useState, useCallback, useEffect } from 'react'
import type { 
  PdfPreprocessInput, 
  PdfPreprocessResult, 
  PdfPreprocessProgressEvent 
} from '../../../shared/types/pdfPreprocess'

export function usePdfPreprocess() {
  const [running, setRunning] = useState(false)
  const [progressEvents, setProgressEvents] = useState<PdfPreprocessProgressEvent[]>([])
  const [latestProgress, setLatestProgress] = useState<PdfPreprocessProgressEvent | null>(null)
  const [result, setResult] = useState<PdfPreprocessResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Subscribe to progress events from the main process
    const unsubscribe = window.wifranExtractor.pdf.onPreprocessProgress((event) => {
      setProgressEvents(prev => [...prev, event])
      setLatestProgress(event)
    })
    return () => unsubscribe()
  }, [])

  const startPreprocess = useCallback(async (input: PdfPreprocessInput) => {
    setRunning(true)
    setProgressEvents([])
    setLatestProgress(null)
    setResult(null)
    setError(null)

    try {
      const preprocessResult = await window.wifranExtractor.pdf.preprocess(input)
      setResult(preprocessResult)
      if (!preprocessResult.ok) {
        setError(preprocessResult.error?.message || 'Unknown error during preprocessing.')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to communicate with main process.')
    } finally {
      setRunning(false)
    }
  }, [])

  const reset = useCallback(() => {
    setRunning(false)
    setProgressEvents([])
    setLatestProgress(null)
    setResult(null)
    setError(null)
  }, [])

  return {
    running,
    progressEvents,
    latestProgress,
    result,
    error,
    startPreprocess,
    reset
  }
}
