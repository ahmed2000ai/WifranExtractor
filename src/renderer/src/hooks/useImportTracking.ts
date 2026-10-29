import { useState, useCallback } from 'react'
import type { PersistImportTrackingInput, PersistImportTrackingResult, ImportTrackingProgressEvent, ImportTrackingProgressStage } from '../../../shared/types/importTracking'

export function useImportTracking() {
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<PersistImportTrackingResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progressEvents, setProgressEvents] = useState<ImportTrackingProgressEvent[]>([])

  const persist = useCallback(async (input: PersistImportTrackingInput) => {
    setSaving(true)
    setResult(null)
    setError(null)
    setProgressEvents([])

    const logEvent = (stage: ImportTrackingProgressStage, message: string) => {
      setProgressEvents(prev => [...prev, { stage, message }])
    }

    try {
      logEvent('started', 'Starting import tracking persistence.')
      logEvent('source_created', 'Creating offer source.')
      logEvent('batch_created', 'Creating import batch.')
      logEvent('rows_inserted', 'Inserting import rows.')
      logEvent('errors_inserted', 'Inserting validation errors.')
      
      const res = await window.wifranExtractor.importTracking.persist(input)
      if (res.ok) {
        logEvent('completed', `Import tracking saved successfully. Inserted ${res.insertedImportRowCount} rows and ${res.insertedValidationErrorCount} validation errors.`)
        setResult(res)
      } else {
        logEvent('failed', `Import tracking failed: ${res.error?.message}`)
        setResult(res)
        setError(res.error?.message || 'Failed to save import tracking data.')
      }
    } catch (e: any) {
      logEvent('failed', `Failed to communicate with main process: ${e.message}`)
      setError(e.message || 'Failed to communicate with main process.')
    } finally {
      setSaving(false)
    }
  }, [])

  const reset = useCallback(() => {
    setSaving(false)
    setResult(null)
    setError(null)
    setProgressEvents([])
  }, [])

  return {
    saving,
    result,
    error,
    progressEvents,
    persist,
    reset
  }
}
