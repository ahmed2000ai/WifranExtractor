import { PageHeader } from '../components/PageHeader'
import { usePipelineLogs } from '../hooks/usePipelineLogs'
import { LogPanel } from '../components/LogPanel'

export function LogsPage(): JSX.Element {
  const { logs, clearLogs } = usePipelineLogs()

  return (
    <div className="page-container" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PageHeader 
        title="Extraction Logs" 
        description="Monitor system events, background OCR processing, and entity matching output." 
      />

      <div className="card" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>
        <div style={{ padding: '16px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <LogPanel logs={logs} onClear={clearLogs} />
        </div>
      </div>
    </div>
  )
}
