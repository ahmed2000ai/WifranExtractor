import { useState, useCallback } from 'react'
import type { OcrSingleChunkTestInput, OcrSingleChunkTestResult } from '../../../shared/types/ocrJob'

export function useOcrTest() {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<OcrSingleChunkTestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const runSingleChunkTest = useCallback(async (input: OcrSingleChunkTestInput) => {
    setRunning(true)
    setResult(null)
    setError(null)

    try {
      const response = await window.wifranExtractor.ocr.testSingleChunk(input)
      setResult(response)
      if (!response.ok) {
        setError(response.error?.message || 'Unknown OCR error')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to communicate with OCR process')
    } finally {
      setRunning(false)
    }
  }, [])

  const reset = useCallback(() => {
    setRunning(false)
    setResult(null)
    setError(null)
  }, [])

  return {
    running,
    result,
    error,
    runSingleChunkTest,
    reset
  }
}
