import { useState, useEffect, useCallback } from 'react'
import type { SafeConfigStatus } from '../../../shared/types/config'

export function useConfigStatus() {
  const [configStatus, setConfigStatus] = useState<SafeConfigStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const status = await window.wifranExtractor.config.getStatus()
      setConfigStatus(status)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  return { configStatus, loading, error, refresh: fetchConfig }
}
