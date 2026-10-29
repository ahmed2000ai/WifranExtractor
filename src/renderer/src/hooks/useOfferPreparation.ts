import { useState, useCallback } from 'react'
import type { 
  OfferPreparationInput, 
  OfferPreparationResult,
  OfferPreparationProgressEvent
} from '../../../shared/types/offerPayload'

export function useOfferPreparation() {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<OfferPreparationResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progressEvents, setProgressEvents] = useState<OfferPreparationProgressEvent[]>([])

  const prepareOffers = useCallback(async (input: OfferPreparationInput) => {
    setRunning(true)
    setResult(null)
    setError(null)
    setProgressEvents([])

    const logEvent = (stage: OfferPreparationProgressEvent['stage'], message: string) => {
      setProgressEvents(prev => [...prev, { stage, message }])
    }

    try {
      logEvent('started', 'Preparing final offer payloads.')
      logEvent('building_payloads', `Evaluating and calculating fields for ${input.rows.length} rows...`)
      
      const res = await window.wifranExtractor.offerPreparation.prepare(input)
      
      if (res.ok) {
        logEvent('completed', `Prepared ${res.preparedRows} offer payloads.`)
        if (res.needsReviewRows > 0) logEvent('completed', `Marked ${res.needsReviewRows} rows as needs_review.`)
        if (res.duplicateRows > 0) logEvent('completed', `Marked ${res.duplicateRows} rows as duplicates.`)
        if (res.errorRows > 0) logEvent('failed', `${res.errorRows} payloads failed generation.`)
        logEvent('completed', 'Offer preparation completed.')
        setResult(res)
      } else {
        logEvent('failed', `Offer preparation failed: ${res.error?.message}`)
        setResult(res)
        setError(res.error?.message || 'Failed to prepare offers.')
      }
    } catch (e: any) {
      logEvent('failed', `Failed to communicate with main process: ${e.message}`)
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
  }, [])

  return {
    running,
    result,
    error,
    progressEvents,
    prepareOffers,
    reset
  }
}
