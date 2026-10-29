import { PipelineResultRow } from '../../../shared/types/pipelineSummary'
import { StatusBadge } from './StatusBadge'
import { IssueList } from './IssueList'

type RowDetailsPanelProps = {
  row: PipelineResultRow | null
  onClose: () => void
}

export function RowDetailsPanel({ row, onClose }: RowDetailsPanelProps) {
  if (!row) return null

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      right: 0,
      width: '450px',
      height: '100%',
      backgroundColor: '#0f172a',
      borderLeft: '1px solid #334155',
      boxShadow: '-4px 0 15px rgba(0,0,0,0.5)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 100,
      overflow: 'hidden'
    }}>
      <div style={{ padding: '16px', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.1rem' }}>Row Details: {row.rowId}</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1.2rem' }}>&times;</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
            <StatusBadge status={row.rowStatus} />
            {row.preparedOfferStatus && <StatusBadge status={row.preparedOfferStatus} variant="default" />}
            {row.dataQualityScore != null && (
              <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: row.dataQualityScore >= 80 ? '#34d399' : '#fbbf24' }}>
                DQ: {row.dataQualityScore}
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.9rem', color: '#cbd5e1' }}>
            <div><strong>Product (AR):</strong> {row.productNameAr || '-'}</div>
            <div><strong>Product (EN):</strong> {row.productNameEn || '-'}</div>
            <div><strong>Offer Price:</strong> {row.offerPrice ? `${row.offerPrice} SAR` : '-'}</div>
          </div>
        </div>

        {row.issues.length > 0 && (
          <div style={{ marginBottom: '20px' }}>
            <h4 style={{ margin: '0 0 8px 0', color: '#f87171', fontSize: '0.9rem' }}>Issues</h4>
            <div style={{ backgroundColor: '#450a0a', padding: '12px', borderRadius: '4px', border: '1px solid #7f1d1d' }}>
              <IssueList issues={row.issues} />
            </div>
          </div>
        )}

        <div style={{ marginBottom: '20px' }}>
          <h4 style={{ margin: '0 0 8px 0', color: '#cbd5e1', fontSize: '0.9rem' }}>Database Identity</h4>
          <div style={{ fontSize: '0.85rem', color: '#94a3b8', backgroundColor: '#1e293b', padding: '12px', borderRadius: '4px', border: '1px solid #334155' }}>
            <div><strong>Brand ID:</strong> {row.brandId || '-'}</div>
            <div><strong>Category ID:</strong> {row.categoryId || '-'}</div>
            <div><strong>Product ID:</strong> {row.productId || '-'}</div>
            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #475569' }}>
              <strong>Created Offer ID:</strong> {row.createdOfferId || '-'}
            </div>
            <div><strong>Duplicate Offer ID:</strong> {row.duplicateOfferId || '-'}</div>
          </div>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <h4 style={{ margin: '0 0 8px 0', color: '#cbd5e1', fontSize: '0.9rem' }}>Media Assets</h4>
          <div style={{ fontSize: '0.85rem', color: '#94a3b8', backgroundColor: '#1e293b', padding: '12px', borderRadius: '4px', border: '1px solid #334155', wordBreak: 'break-all' }}>
            <div><strong>Local Path:</strong> {row.localImagePath || '-'}</div>
            <div style={{ marginTop: '8px' }}><strong>Storage Path:</strong> {row.storagePath || '-'}</div>
            <div style={{ marginTop: '8px' }}>
              <strong>Public URL:</strong>{' '}
              {row.imageUrl ? (
                <a href={row.imageUrl} target="_blank" rel="noreferrer" style={{ color: '#38bdf8' }}>{row.imageUrl}</a>
              ) : '-'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
