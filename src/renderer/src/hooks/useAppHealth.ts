import { useState, useEffect } from 'react'
import type { AppHealthStatus } from '../../../shared/types/app'

export function useAppHealth() {
  const [health, setHealth] = useState<AppHealthStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    async function fetchHealth() {
      try {
        setLoading(true)
        setError(null)
        const status = await window.wifranExtractor.app.getHealth()
        if (mounted) setHealth(status)
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    fetchHealth()

    return () => {
      mounted = false
    }
  }, [])

  return { health, loading, error }
}
