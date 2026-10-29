import { useState, useEffect } from 'react'
import { PageHeader } from '../components/PageHeader'
import { usePipelineSummary } from '../hooks/usePipelineSummary'
import { usePipelineContext } from '../context/PipelineContext'
import { SummaryCard } from '../components/SummaryCard'
import { ResultsTable } from '../components/ResultsTable'
import { RowDetailsPanel } from '../components/RowDetailsPanel'

export function ResultsPage(): JSX.Element {
  const summary = usePipelineSummary()
  const ctx = usePipelineContext()
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')

  const [manualSession, setManualSession] = useState<any>(null)
  const workspacePath = ctx.pdfPreprocess.result?.workspacePath

  useEffect(() => {
    if (workspacePath) {
      window.wifranExtractor.manualCrop.loadSession(workspacePath).then(res => {
        if (res.ok && res.session) {
          setManualSession(res.session)
        }
      })
    }
  }, [workspacePath])

  const mismatches: Array<{ page: number, manual: number, ocr: number }> = []
  if (manualSession && summary.rows.length > 0) {
    const ocrCountsByPage: Record<number, number> = {}
    summary.rows.forEach(r => {
      const p = r.pageNumber
      if (p === null || p === undefined) return
      if (!ocrCountsByPage[p]) ocrCountsByPage[p] = 0
      if (r.rowStatus !== 'skipped') ocrCountsByPage[p]++
    })

    manualSession.pageLayouts.forEach((layout: any) => {
      if (!layout) return
      const manualCount = layout.boxes.filter((b: any) => b.included).length
      const ocrCount = ocrCountsByPage[layout.pageNumber] || 0
      if (manualCount !== ocrCount) {
        mismatches.push({ page: layout.pageNumber, manual: manualCount, ocr: ocrCount })
      }
    })
  }

  const selectedRow = selectedRowId ? summary.rows.find(r => r.rowId === selectedRowId) || null : null

  const filteredRows = summary.rows.filter(r => {
    if (filter === 'all') return true
    if (filter === 'errors') return r.rowStatus === 'error'
    if (filter === 'warnings') return r.rowStatus === 'warning' || r.issues.some(i => i.severity === 'warning')
    if (filter === 'needs_review') return r.rowStatus === 'needs_review' || r.rowStatus === 'needs_review_imported' || r.preparedOfferStatus === 'needs_review'
    if (filter === 'skipped') return r.rowStatus === 'skipped'
    if (filter === 'duplicate') return r.rowStatus === 'duplicate'
    if (filter === 'published') return r.rowStatus === 'published'
    if (filter === 'imported') return r.rowStatus === 'imported' || r.rowStatus === 'needs_review_imported' || r.rowStatus === 'published'
    if (filter === 'promotional') return r.rowStatus === 'skipped' && r.skipReason === 'NON_PRODUCT_PROMOTIONAL_AREA'
    return true
  })

  return (
    <div className="page-container" style={{ position: 'relative', overflow: 'hidden' }}>
      <PageHeader 
        title="Extraction Results" 
        description="Review structured rows, validation statuses, entity matches, and final offer syncs." 
      />

      <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <SummaryCard title="Total Rows" value={summary.counts.totalRows} />
        <SummaryCard title="Valid / Matched" value={summary.counts.validRows} variant="success" />
        <SummaryCard title="Published / Live" value={summary.counts.publishedRows || 0} variant="success" />
        <SummaryCard title="Drafts / Synced" value={summary.counts.importedRows} variant="info" />
        <SummaryCard title="Needs Review" value={summary.counts.needsReviewImportedRows} variant="warning" subtitle="Requires manual publish" />
        <SummaryCard title="Skipped" value={summary.counts.skippedRows} subtitle={`${summary.counts.skippedPromotionalRows} Promotional`} />
        <SummaryCard title="Duplicates" value={summary.counts.duplicateRows} variant="error" subtitle="Skipped upload" />
        <SummaryCard title="Errors" value={summary.counts.errorRows} variant="error" subtitle="Failed rows" />
      </div>

      {mismatches.length > 0 && (
        <div style={{ padding: '12px', backgroundColor: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '4px', marginBottom: '24px', fontSize: '0.9rem', color: '#991b1b' }}>
          <strong>⚠️ Manual crop / OCR item count mismatch</strong>
          <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
            {mismatches.map((m: any) => (
              <li key={m.page}>Page {m.page}: {m.manual} manual crop boxes vs {m.ocr} OCR items. Review item numbering before sync.</li>
            ))}
          </ul>
        </div>
      )}

      {ctx.ocrPipeline.retryResult && (
        <div style={{ padding: '12px', backgroundColor: '#e0e7ff', borderRadius: '4px', marginBottom: '24px', fontSize: '0.9rem', color: '#3730a3', display: 'flex', gap: '20px' }}>
          <div><strong>OCR Retry Run:</strong></div>
          <div>Retried Chunks: {ctx.ocrPipeline.retryResult.retriedChunkCount}</div>
          <div>Successful: {ctx.ocrPipeline.retryResult.successfulRetryCount}</div>
          <div>Still Failed: {ctx.ocrPipeline.retryResult.failedRetryCount}</div>
        </div>
      )}

      {ctx.ocrPipeline.result && (
        <div style={{ padding: '12px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '4px', marginBottom: '24px', fontSize: '0.9rem', color: '#166534', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          <div><strong>OCR Stats:</strong></div>
          <div>Tokens: ~{ctx.ocrPipeline.result.estimatedTokenUsage} est. / {ctx.ocrPipeline.result.actualTokenUsage || '?'} actual</div>
          <div>Rate Limit Waits: {ctx.ocrPipeline.result.totalWaits || 0}</div>
          <div>Total Wait Time: {Math.round((ctx.ocrPipeline.result.totalWaitTimeMs || 0)/1000)}s</div>
          <div>429 Retries: {ctx.ocrPipeline.result.rateLimitRetries || 0}</div>
          <div>Duration: {Math.round(ctx.ocrPipeline.result.durationMs / 1000)}s</div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 250px)' }}>
        <div style={{ padding: '16px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc' }}>
          <h3 style={{ margin: 0, color: '#334155' }}>Pipeline Rows</h3>
          <select value={filter} onChange={e => setFilter(e.target.value)} className="input" style={{ padding: '6px 12px', minWidth: '200px' }}>
            <option value="all">All Rows</option>
            <option value="published">Published</option>
            <option value="imported">Drafts</option>
            <option value="needs_review">Needs Review</option>
            <option value="warnings">Warnings</option>
            <option value="errors">Errors</option>
            <option value="skipped">Skipped</option>
            <option value="promotional">Promotional</option>
            <option value="duplicate">Duplicates</option>
          </select>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <ResultsTable rows={filteredRows} onSelectRow={setSelectedRowId} selectedRowId={selectedRowId} />
        </div>
      </div>

      {selectedRow && (
        <RowDetailsPanel row={selectedRow} onClose={() => setSelectedRowId(null)} />
      )}
    </div>
  )
}
