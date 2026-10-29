import { useState } from 'react'
import type { CropAndItemOcrWorkflowResult } from '../../../../shared/types/reviewWorkflow'
import type { ReviewItem, ItemOcrJson } from '../../../../shared/types/itemOcr'
import { ReviewItemTable } from './ReviewItemTable'
import { ReviewItemDetailsPanel } from './ReviewItemDetailsPanel'

interface PreDbReviewSummaryProps {
  workflowResult: CropAndItemOcrWorkflowResult;
  onProceedToUpdateDb: (items: ReviewItem[]) => void;
  dbSyncEnabled: boolean;
  dbSyncRunning: boolean;
}

export function PreDbReviewSummary({ workflowResult, onProceedToUpdateDb, dbSyncEnabled, dbSyncRunning }: PreDbReviewSummaryProps) {
  const [selectedItem, setSelectedItem] = useState<ReviewItem | null>(null)
  const [editableItems, setEditableItems] = useState<ReviewItem[]>(workflowResult.reviewItems)
  const [showEditing, setShowEditing] = useState(false)

  const eligibleForSync = editableItems.filter(i => i.ocrStatus === 'completed' && i.ocr?.offer_price != null)
  const skippedFromSync = editableItems.filter(i => i.ocrStatus !== 'completed' || i.ocr?.offer_price == null)

  // Per-page count checks
  const pageChecks: Array<{ page: number; crops: number; ocrOk: number; ocrFail: number }> = []
  const pageMap = new Map<number, { crops: number; ocrOk: number; ocrFail: number }>()
  for (const item of editableItems) {
    if (!pageMap.has(item.pageNumber)) pageMap.set(item.pageNumber, { crops: 0, ocrOk: 0, ocrFail: 0 })
    const p = pageMap.get(item.pageNumber)!
    p.crops++
    if (item.ocrStatus === 'completed') p.ocrOk++
    if (item.ocrStatus === 'failed') p.ocrFail++
  }
  pageMap.forEach((v, k) => pageChecks.push({ page: k, ...v }))
  pageChecks.sort((a, b) => a.page - b.page)

  const handleEditField = (itemNumber: string, field: string, value: any) => {
    setEditableItems(prev => prev.map(item => {
      if (item.itemNumber !== itemNumber || !item.ocr) return item
      const updatedOcr = { ...item.ocr, [field]: value } as ItemOcrJson
      return { ...item, ocr: updatedOcr }
    }))
  }

  return (
    <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
      {/* Summary Header */}
      <div style={{ padding: '20px 24px', backgroundColor: '#f0fdf4', borderBottom: '1px solid #bbf7d0' }}>
        <h2 style={{ margin: '0 0 16px 0', color: '#166534', fontSize: '1.2rem' }}>Pre-DB Review Summary</h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px' }}>
          <CountCard label="Total Pages" value={workflowResult.totalPages} />
          <CountCard label="Crop Images" value={workflowResult.totalCrops} />
          <CountCard label="OCR Completed" value={workflowResult.totalOcrCompleted} variant="success" />
          <CountCard label="OCR Failed" value={workflowResult.totalOcrFailed} variant={workflowResult.totalOcrFailed > 0 ? 'error' : 'default'} />
          <CountCard label="Eligible for DB" value={eligibleForSync.length} variant="success" />
          <CountCard label="Skipped from DB" value={skippedFromSync.length} variant={skippedFromSync.length > 0 ? 'warning' : 'default'} />
        </div>
      </div>

      {/* Per-Page Breakdown */}
      {pageChecks.some(p => p.ocrFail > 0) && (
        <div style={{ padding: '12px 24px', backgroundColor: '#fef2f2', borderBottom: '1px solid #fca5a5', fontSize: '0.9rem', color: '#991b1b' }}>
          <strong>⚠️ Count mismatches detected:</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: '20px' }}>
            {pageChecks.filter(p => p.ocrFail > 0).map(p => (
              <li key={p.page}>Page {p.page}: {p.crops} crops, {p.ocrOk} OCR completed, {p.ocrFail} OCR failed. Review before updating DB.</li>
            ))}
          </ul>
        </div>
      )}

      {/* Local File Paths */}
      <div style={{ padding: '12px 24px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '0.85rem', color: '#475569' }}>
        <div><strong>Review Summary:</strong> <code style={{ fontSize: '0.8rem' }}>{workflowResult.reviewSummaryPath}</code></div>
        <div><strong>Review Items:</strong> <code style={{ fontSize: '0.8rem' }}>{workflowResult.reviewItemsPath}</code></div>
        <div><strong>Crop Folder:</strong> <code style={{ fontSize: '0.8rem' }}>{workflowResult.cropFolderPath}</code></div>
        {workflowResult.returnedKeysRegistryPath && (
          <div><strong>Returned Keys:</strong> <code style={{ fontSize: '0.8rem' }}>{workflowResult.returnedKeysRegistryPath}</code></div>
        )}
        {workflowResult.keysWithoutValuesPath && (
          <div><strong>Keys Without Values:</strong> <code style={{ fontSize: '0.8rem' }}>{workflowResult.keysWithoutValuesPath}</code></div>
        )}
      </div>

      {/* Controls */}
      <div style={{ padding: '12px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: '12px', alignItems: 'center' }}>
        <label style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          <input type="checkbox" checked={showEditing} onChange={(e) => setShowEditing(e.target.checked)} />
          Enable inline editing
        </label>
        <div style={{ marginLeft: 'auto' }}>
          <button
            className="btn btn-primary"
            onClick={() => onProceedToUpdateDb(eligibleForSync)}
            disabled={!dbSyncEnabled || dbSyncRunning || eligibleForSync.length === 0}
            style={{ padding: '10px 24px', fontWeight: 600 }}
          >
            {dbSyncRunning ? 'Updating DB...' : `Proceed to Update DB (${eligibleForSync.length} items)`}
          </button>
        </div>
      </div>

      {/* Item Table */}
      <div style={{ maxHeight: 'calc(100vh - 500px)', overflowY: 'auto' }}>
        <ReviewItemTable
          items={editableItems}
          onSelectItem={setSelectedItem}
          selectedItemNumber={selectedItem?.itemNumber || null}
          onEditField={showEditing ? handleEditField : undefined}
        />
      </div>

      {/* Detail Panel */}
      {selectedItem && (
        <ReviewItemDetailsPanel item={selectedItem} onClose={() => setSelectedItem(null)} />
      )}
    </div>
  )
}

function CountCard({ label, value, variant = 'default' }: { label: string; value: number; variant?: 'default' | 'success' | 'warning' | 'error' }) {
  const colors = {
    default: { bg: '#f8fafc', text: '#334155', border: '#e2e8f0' },
    success: { bg: '#f0fdf4', text: '#166534', border: '#bbf7d0' },
    warning: { bg: '#fefce8', text: '#854d0e', border: '#fde68a' },
    error: { bg: '#fef2f2', text: '#991b1b', border: '#fca5a5' }
  }
  const c = colors[variant]
  return (
    <div style={{ padding: '12px', backgroundColor: c.bg, border: `1px solid ${c.border}`, borderRadius: '8px', textAlign: 'center' }}>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: c.text }}>{value}</div>
      <div style={{ fontSize: '0.8rem', color: c.text, opacity: 0.8 }}>{label}</div>
    </div>
  )
}
