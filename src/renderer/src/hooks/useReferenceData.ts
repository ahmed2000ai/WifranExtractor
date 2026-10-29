import { useState, useEffect, useCallback } from 'react'
import type { ReferenceDataBundle } from '../../../shared/types/referenceData'

export function useReferenceData() {
  const [data, setData] = useState<ReferenceDataBundle | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.wifranExtractor.reference.loadAll()
      if (result.ok && result.data) {
        setData(result.data)
      } else {
        setError(result.error || 'Failed to load reference data.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return { data, loading, error, reload }
}
