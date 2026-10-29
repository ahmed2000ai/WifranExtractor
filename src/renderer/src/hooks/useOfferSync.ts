import { useState, useCallback, useEffect } from 'react'
import type { 
  OfferSyncInput, 
  OfferSyncResult,
  OfferSyncProgressEvent
} from '../../../shared/types/offerSync'

export function useOfferSync() {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<OfferSyncResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progressEvents, setProgressEvents] = useState<OfferSyncProgressEvent[]>([])
  const [latestProgress, setLatestProgress] = useState<OfferSyncProgressEvent | null>(null)

  useEffect(() => {
    if (running) {
      const unsubscribe = window.wifranExtractor.offerSync.onProgress((event) => {
        setLatestProgress(event)
        setProgressEvents(prev => [...prev, event])
      })
      return unsubscribe
    }
    return undefined
  }, [running])

  const syncPreparedOffers = useCallback(async (input: OfferSyncInput) => {
    setRunning(true)
    setResult(null)
    setError(null)
    setProgressEvents([])
    setLatestProgress(null)

    try {
      const res = await window.wifranExtractor.offerSync.syncPreparedOffers(input)
      if (res.ok) {
        setResult(res)
      } else {
        setResult(res)
        setError(res.error?.message || 'Failed to sync offers.')
      }
    } catch (e: any) {
      setError(e.message || 'Failed to communicate with main process.')
    } finally {
      setRunning(false)
    }
  }, [])

  const reset = useCallback(() => {
    setRunning(false)
    setResult(null)
    setError(null)
    setProgressEvents([])
    setLatestProgress(null)
  }, [])

  return {
    running,
    progressEvents,
    latestProgress,
    result,
    error,
    syncPreparedOffers,
    reset
  }
}
