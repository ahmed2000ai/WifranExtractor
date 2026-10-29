import { useState, useCallback } from 'react'
import type { 
  EntityMatchingInput, 
  EntityMatchingResult,
  EntityMatchingProgressEvent
} from '../../../shared/types/entityMatching'

export function useEntityMatching() {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<EntityMatchingResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progressEvents, setProgressEvents] = useState<EntityMatchingProgressEvent[]>([])

  const matchRows = useCallback(async (input: EntityMatchingInput) => {
    setRunning(true)
    setResult(null)
    setError(null)
    setProgressEvents([])

    const logEvent = (stage: EntityMatchingProgressEvent['stage'], message: string) => {
      setProgressEvents(prev => [...prev, { stage, message }])
    }

    try {
      logEvent('started', 'Starting entity matching process.')
      logEvent('matching_rows', `Matching ${input.rows.length} rows against Wifran database...`)
      
      const res = await window.wifranExtractor.entityMatching.matchRows(input)
      
      if (res.ok) {
        logEvent('completed', `Entity matching completed. Matched: ${res.matchedRows}, Warnings: ${res.warningRows}, Errors: ${res.errorRows}, Skipped: ${res.skippedRows}.`)
        if (res.brandsCreated > 0) logEvent('completed', `Created ${res.brandsCreated} new brands.`)
        if (res.categoriesCreated > 0) logEvent('completed', `Created ${res.categoriesCreated} new categories.`)
        if (res.productsCreated > 0) logEvent('completed', `Created ${res.productsCreated} new products.`)
        if (res.aliasesCreated > 0) logEvent('completed', `Created ${res.aliasesCreated} new product aliases.`)
        
        setResult(res)
      } else {
        logEvent('failed', `Entity matching failed: ${res.error?.message}`)
        setResult(res)
        setError(res.error?.message || 'Failed to match entities.')
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
    matchRows,
    reset
  }
}
