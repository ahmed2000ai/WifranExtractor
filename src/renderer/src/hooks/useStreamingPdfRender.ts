import { useState, useCallback, useEffect, useRef } from 'react'
import type { 
  StreamingPdfRenderInput, 
  StreamingPdfRenderState, 
  StreamingPdfRenderProgressEvent,
  RenderedPageInfo
} from '../../../shared/types/pdfPreprocess'

export function useStreamingPdfRender() {
  const [running, setRunning] = useState(false)
  const [state, setState] = useState<StreamingPdfRenderState | null>(null)
  const [pages, setPages] = useState<RenderedPageInfo[]>([])
  const [latestEvent, setLatestEvent] = useState<StreamingPdfRenderProgressEvent | null>(null)
  const [error, setError] = useState<string | null>(null)

  const unsubRef = useRef<(() => void) | null>(null)
  const currentJobIdRef = useRef<string | null>(null)

  useEffect(() => {
    const unsub = window.wifranExtractor.pdf.onRenderStreamingProgress((event) => {
      if (currentJobIdRef.current && event.jobId !== currentJobIdRef.current) {
        return // Ignore events from previous background jobs
      }

      setLatestEvent(event)
      
      setState(prev => {
        if (!prev) {
          return {
            status: event.stage === 'completed' || event.stage === 'failed' || event.stage === 'partially_completed' ? event.stage as any : 'running',
            totalPages: event.totalPages || 0,
            renderedPages: event.renderedPages || 0,
            failedPages: event.failedPages || 0,
            pages: event.page ? [event.page] : [],
            firstPageReady: !!event.page && event.page.pageNumber === 1 && event.page.status === 'rendered',
            workspacePath: event.workspacePath,
            chunks: event.chunks
          }
        }
        
        const newPages = [...prev.pages]
        if (event.page) {
          const idx = newPages.findIndex(p => p.pageNumber === event.page!.pageNumber)
          if (idx >= 0) newPages[idx] = event.page
          else newPages.push(event.page)
        }

        const isTerminal = event.stage === 'completed' || event.stage === 'failed' || event.stage === 'partially_completed'

        return {
          ...prev,
          status: isTerminal ? event.stage as any : prev.status,
          totalPages: event.totalPages ?? prev.totalPages,
          renderedPages: event.renderedPages ?? prev.renderedPages,
          failedPages: event.failedPages ?? prev.failedPages,
          pages: newPages,
          firstPageReady: prev.firstPageReady || (!!event.page && event.page.pageNumber === 1 && event.page.status === 'rendered'),
          workspacePath: event.workspacePath ?? prev.workspacePath,
          chunks: event.chunks ?? prev.chunks
        }
      })
    })

    unsubRef.current = unsub

    return () => {
      unsub()
    }
  }, [])

  // Sync pages array for easier access
  useEffect(() => {
    if (state?.pages) {
      setPages([...state.pages].sort((a, b) => a.pageNumber - b.pageNumber))
    }
  }, [state?.pages])

  const startRender = useCallback(async (input: StreamingPdfRenderInput) => {
    const jobId = Math.random().toString(36).substring(7)
    currentJobIdRef.current = jobId
    input.jobId = jobId

    setRunning(true)
    setError(null)
    setState(null)
    setPages([])
    setLatestEvent(null)

    try {
      const result = await window.wifranExtractor.pdf.renderStreaming(input)
      setState(result)
      if (result.status === 'failed') {
        setError(result.error || 'Render failed')
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setRunning(false)
    }
  }, [])

  const getPageStatus = useCallback((pageNumber: number): RenderedPageInfo | null => {
    return pages.find(p => p.pageNumber === pageNumber) || null
  }, [pages])

  const getRenderedPage = useCallback((pageNumber: number): RenderedPageInfo | null => {
    const p = getPageStatus(pageNumber)
    return p?.status === 'rendered' ? p : null
  }, [getPageStatus])

  const reset = useCallback(() => {
    currentJobIdRef.current = null
    setRunning(false)
    setState(null)
    setPages([])
    setLatestEvent(null)
    setError(null)
  }, [])

  return {
    running,
    state,
    pages,
    renderedPages: state?.renderedPages || 0,
    failedPages: state?.failedPages || 0,
    totalPages: state?.totalPages || 0,
    firstPageReady: state?.firstPageReady || false,
    latestEvent,
    error,
    startRender,
    getPageStatus,
    getRenderedPage,
    reset
  }
}
