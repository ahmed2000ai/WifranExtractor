import { useState, useRef, useEffect } from 'react'
import type { UiLogEntry } from '../hooks/usePipelineLogs'

// Extend pipelineSummary to know about log entry types just via import trick or redefining
// We have it defined in usePipelineLogs, let's just copy the type over to avoid circular

export type LogPanelProps = {
  logs: UiLogEntry[]
  onClear: () => void
}

export function LogPanel({ logs, onClear }: LogPanelProps) {
  const [filterSource, setFilterSource] = useState<string>('all')
  const [filterLevel, setFilterLevel] = useState<string>('all')
  const logContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logs])

  const filteredLogs = logs.filter(l => {
    if (filterSource !== 'all' && l.source !== filterSource) return false
    if (filterLevel !== 'all' && l.level !== filterLevel) return false
    return true
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <select value={filterSource} onChange={e => setFilterSource(e.target.value)} className="input" style={{ padding: '4px 8px' }}>
            <option value="all">All Sources</option>
            <option value="pdf">PDF</option>
            <option value="ocr">OCR</option>
            <option value="page_first">Page-First OCR</option>
            <option value="image">Image</option>
            <option value="import_tracking">Import Tracking</option>
            <option value="entity_matching">Entity Matching</option>
            <option value="offer_preparation">Offer Preparation</option>
            <option value="offer_sync">Offer Sync</option>
          </select>
          <select value={filterLevel} onChange={e => setFilterLevel(e.target.value)} className="input" style={{ padding: '4px 8px' }}>
            <option value="all">All Levels</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
          </select>
        </div>
        <button onClick={onClear} className="btn" style={{ padding: '4px 12px', fontSize: '0.8rem' }}>Clear Logs</button>
      </div>

      <div ref={logContainerRef} style={{ flex: 1, backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '4px', overflowY: 'auto', padding: '16px', fontFamily: 'monospace', fontSize: '0.8rem' }}>
        {filteredLogs.length === 0 ? (
          <div style={{ color: '#64748b', textAlign: 'center', marginTop: '20px' }}>No logs available.</div>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyleType: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filteredLogs.map((log, idx) => {
              const colorMap = {
                debug: '#94a3b8',
                info: '#e2e8f0',
                warning: '#fbbf24',
                error: '#f87171'
              }
              const sourceColorMap = {
                pdf: '#a855f7',
                ocr: '#3b82f6',
                image: '#10b981',
                import_tracking: '#f59e0b',
                entity_matching: '#ef4444',
                offer_preparation: '#ec4899',
                offer_sync: '#0ea5e9',
                app: '#64748b'
              }
              return (
                <li key={idx} style={{ paddingBottom: '8px', borderBottom: '1px solid #1e293b' }}>
                  <span style={{ color: '#64748b', marginRight: '8px' }}>{new Date(log.timestamp).toLocaleTimeString()}</span>
                  <span style={{ color: (sourceColorMap as any)[log.source] || '#cbd5e1', fontWeight: 'bold', marginRight: '8px' }}>[{log.source.toUpperCase()}]</span>
                  {log.level !== 'info' && <span style={{ color: colorMap[log.level], marginRight: '8px', textTransform: 'uppercase' }}>{log.level}</span>}
                  <span style={{ color: colorMap[log.level] || '#e2e8f0' }}>{log.message}</span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
