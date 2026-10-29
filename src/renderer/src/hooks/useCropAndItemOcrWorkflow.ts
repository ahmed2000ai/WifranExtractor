import { useState, useEffect, useCallback, useRef } from 'react'
import type { CropAndItemOcrProgressEvent, CropAndItemOcrWorkflowResult, LayoutValidationResult } from '../../../shared/types/reviewWorkflow'
import type { ManualCropPageLayout } from '../../../shared/types/manualCrop'

export function useCropAndItemOcrWorkflow() {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<CropAndItemOcrWorkflowResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [latestProgress, setLatestProgress] = useState<CropAndItemOcrProgressEvent | null>(null)
  const [validationResult, setValidationResult] = useState<LayoutValidationResult | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)

  // Subscribe to progress events
  useEffect(() => {
    const unsub = window.wifranExtractor.reviewWorkflow.onProgress((event) => {
      setLatestProgress(event)
    })
    unsubRef.current = unsub
    return () => {
      unsub()
    }
  }, [])

  const validateLayouts = useCallback(async (layouts: ManualCropPageLayout[]) => {
    try {
      const res = await window.wifranExtractor.reviewWorkflow.validateLayouts(layouts)
      setValidationResult(res)
      return res
    } catch (err: any) {
      const failRes: LayoutValidationResult = { ok: false, issues: [{ pageNumber: 0, message: err.message }] }
      setValidationResult(failRes)
      return failRes
    }
  }, [])

  const runCropAndItemOcr = useCallback(async (input: {
    workspacePath: string;
    layouts: ManualCropPageLayout[];
    imageFormat?: 'webp' | 'jpg' | 'jpeg' | 'png';
    imageQuality?: number;
  }) => {
    setRunning(true)
    setError(null)
    setResult(null)
    setLatestProgress(null)

    try {
      const res = await window.wifranExtractor.reviewWorkflow.runCropAndItemOcr({
        workspacePath: input.workspacePath,
        layouts: input.layouts,
        imageFormat: input.imageFormat || 'webp',
        imageQuality: input.imageQuality || 90
      })
      setResult(res)
      if (!res.ok) {
        setError(res.error || 'Workflow failed')
      }
      return res
    } catch (err: any) {
      setError(err.message)
      return null
    } finally {
      setRunning(false)
    }
  }, [])

  const reset = useCallback(() => {
    setRunning(false)
    setResult(null)
    setError(null)
    setLatestProgress(null)
    setValidationResult(null)
  }, [])

  return {
    running,
    result,
    error,
    latestProgress,
    validationResult,
    validateLayouts,
    runCropAndItemOcr,
    reset
  }
}
