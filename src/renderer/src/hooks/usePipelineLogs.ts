import { useState, useCallback, useEffect, useRef } from 'react'
import { usePipelineContext } from '../context/PipelineContext'

export type UiLogEntry = {
  timestamp: string
  level: 'debug' | 'info' | 'warning' | 'error'
  source: 'pdf' | 'ocr' | 'image' | 'import_tracking' | 'entity_matching' | 'offer_preparation' | 'offer_sync' | 'page_first' | 'app'
  message: string
  details?: Record<string, unknown>
}

// Keep it in memory outside component so it persists across unmounts/remounts if needed
let inMemoryLogs: UiLogEntry[] = []

export function clearPipelineLogs() {
  inMemoryLogs = []
}

export function usePipelineLogs() {
  const [logs, setLogs] = useState<UiLogEntry[]>(inMemoryLogs)
  const ctx = usePipelineContext()
  
  // Track counts so we only append new events
  const countsRef = useRef({
    pdf: 0,
    ocr: 0,
    crop: 0,
    db: 0,
    match: 0,
    prep: 0,
    sync: 0
  })

  // Listen directly to main-process pageFirst log events
  useEffect(() => {
    if (window.wifranExtractor?.pageFirst?.onLog) {
      const unsub = window.wifranExtractor.pageFirst.onLog((logEv: any) => {
        inMemoryLogs.push({
          timestamp: logEv.timestamp || new Date().toISOString(),
          level: logEv.level || 'info',
          source: 'page_first',
          message: logEv.message || `[${logEv.code}]`
        })
        setLogs([...inMemoryLogs])
      })
      return () => {
        unsub()
      }
    }
    return undefined
  }, [])

  // Listen directly to main-process offerSync progress events so any publish is logged
  useEffect(() => {
    if (window.wifranExtractor?.offerSync?.onProgress) {
      const unsub = window.wifranExtractor.offerSync.onProgress((event: any) => {
        inMemoryLogs.push({
          timestamp: new Date().toISOString(),
          level: event.error || event.stage === 'row_failed' ? 'error' : (event.stage === 'warning' || event.stage === 'row_skipped' ? 'warning' : 'info'),
          source: 'offer_sync',
          message: event.message || `[${event.stage || 'progress'}] ${JSON.stringify(event)}`
        })
        setLogs([...inMemoryLogs])
      })
      return () => {
        unsub()
      }
    }
    return undefined
  }, [])

  useEffect(() => {
    let added = false
    
    // Helper to map hook progress events to UiLogEntry
    const appendEvents = (source: UiLogEntry['source'], events: any[], countKey: keyof typeof countsRef.current) => {
      const currentCount = countsRef.current[countKey]
      if (events.length > currentCount) {
        for (let i = currentCount; i < events.length; i++) {
          const ev = events[i]
          inMemoryLogs.push({
            timestamp: new Date().toISOString(),
            level: ev.error ? 'error' : ev.stage === 'warning' ? 'warning' : 'info',
            source,
            message: `[${ev.stage || 'info'}] ${ev.message || JSON.stringify(ev)}`
          })
          added = true
        }
        countsRef.current[countKey] = events.length
      }
    }

    appendEvents('pdf', ctx.pdfPreprocess.progressEvents || [], 'pdf')
    appendEvents('ocr', ctx.ocrPipeline.progressEvents || [], 'ocr')
    appendEvents('image', ctx.imageCropping.progressEvents || [], 'crop')
    appendEvents('import_tracking', ctx.importTracking.progressEvents || [], 'db')
    appendEvents('entity_matching', ctx.entityMatching.progressEvents || [], 'match')
    appendEvents('offer_preparation', ctx.offerPreparation.progressEvents || [], 'prep')
    appendEvents('offer_sync', ctx.offerSync.progressEvents || [], 'sync')

    if (added) {
      setLogs([...inMemoryLogs])
    }
  }, [
    ctx.pdfPreprocess.progressEvents,
    ctx.ocrPipeline.progressEvents,
    ctx.imageCropping.progressEvents,
    ctx.importTracking.progressEvents,
    ctx.entityMatching.progressEvents,
    ctx.offerPreparation.progressEvents,
    ctx.offerSync.progressEvents
  ])

  const clearLogs = useCallback(() => {
    clearPipelineLogs()
    setLogs([])
  }, [])

  return { logs, clearLogs }
}
