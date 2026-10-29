import { useState, useEffect, useCallback } from 'react'
import type { 
  ImageCroppingInput, 
  ImageCroppingResult, 
  ImageCroppingProgressEvent 
} from '../../../shared/types/imageCropping'

export function useImageCropping() {
  const [running, setRunning] = useState(false)
  const [progressEvents, setProgressEvents] = useState<ImageCroppingProgressEvent[]>([])
  const [latestProgress, setLatestProgress] = useState<ImageCroppingProgressEvent | null>(null)
  const [result, setResult] = useState<ImageCroppingResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribe = window.wifranExtractor.image.onCropProgress((event) => {
      setProgressEvents(prev => [...prev, event])
      setLatestProgress(event)
    })
    return () => {
      unsubscribe()
    }
  }, [])

  const cropRows = useCallback(async (input: ImageCroppingInput) => {
    setRunning(true)
    setResult(null)
    setError(null)
    setProgressEvents([])
    setLatestProgress(null)

    try {
      const res = await window.wifranExtractor.image.cropOcrRows(input)
      if (res.ok) {
        setResult(res)
      } else {
        setResult(res)
        setError(res.error?.message || 'Unknown cropping error occurred.')
      }
    } catch (e: any) {
      setError(e.message || 'Failed to communicate with main process.')
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
    cropRows,
    reset
  }
}
