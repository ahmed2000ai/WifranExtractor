import { PipelineResultRow } from '../../../shared/types/pipelineSummary'
import { StatusBadge } from './StatusBadge'
import { IssueList } from './IssueList'

type ResultsTableProps = {
  rows: PipelineResultRow[]
  onSelectRow: (rowId: string) => void
  selectedRowId: string | null
}

export function ResultsTable({ rows, onSelectRow, selectedRowId }: ResultsTableProps) {
  if (rows.length === 0) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8' }}>
        No rows available.
      </div>
    )
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table" style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #334155', backgroundColor: '#0f172a' }}>
            <th style={{ padding: '8px' }}>Row / Pg</th>
            <th style={{ padding: '8px' }}>Product & Price</th>
            <th style={{ padding: '8px' }}>Status</th>
            <th style={{ padding: '8px' }}>DQ Score</th>
            <th style={{ padding: '8px' }}>DB Identity</th>
            <th style={{ padding: '8px' }}>Image</th>
            <th style={{ padding: '8px' }}>Issues</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr 
              key={row.rowId} 
              style={{ 
                borderBottom: '1px solid #334155', 
                opacity: ['skipped', 'duplicate'].includes(row.rowStatus) ? 0.6 : 1,
                backgroundColor: selectedRowId === row.rowId ? '#1e293b' : 'transparent',
                cursor: 'pointer'
              }}
              onClick={() => onSelectRow(row.rowId)}
            >
              <td style={{ padding: '8px' }}>
                <div style={{ fontWeight: 'bold' }}>{row.rowNumber || row.rowId}</div>
                <div style={{ color: '#94a3b8' }}>Pg {row.pageNumber || '-'}</div>
              </td>
              <td style={{ padding: '8px' }}>
                <div style={{ maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={row.productNameAr || ''}>
                  {row.productNameAr || '-'}
                </div>
                <div style={{ color: '#94a3b8', maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={row.productNameEn || ''}>
                  {row.productNameEn || '-'}
                </div>
                <div style={{ color: '#38bdf8', marginTop: '4px' }}>
                  {row.offerPrice ? `${row.offerPrice} SAR` : '-'}
                </div>
              </td>
              <td style={{ padding: '8px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                  <StatusBadge status={row.rowStatus} />
                  {row.preparedOfferStatus && (
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{row.preparedOfferStatus}</span>
                  )}
                  {row.rowStatus === 'skipped' && row.skipReason && (
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{row.skipReason}</span>
                  )}
                </div>
              </td>
              <td style={{ padding: '8px' }}>
                {row.dataQualityScore != null ? (
                  <span style={{ color: row.dataQualityScore >= 80 ? '#34d399' : '#fbbf24', fontWeight: 'bold' }}>
                    {row.dataQualityScore}
                  </span>
                ) : (
                  <span style={{ color: '#64748b' }}>-</span>
                )}
              </td>
              <td style={{ padding: '8px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.75rem' }}>
                  {row.productId && <div><span style={{ color: '#94a3b8' }}>P: </span>{row.productId.substring(0, 8)}...</div>}
                  {row.createdOfferId && <div><span style={{ color: '#10b981' }}>Offer: </span>{row.createdOfferId.substring(0, 8)}...</div>}
                  {row.duplicateOfferId && <div><span style={{ color: '#f43f5e' }}>Dupe: </span>{row.duplicateOfferId.substring(0, 8)}...</div>}
                </div>
              </td>
              <td style={{ padding: '8px' }}>
                {row.imageUrl ? (
                  <a href={row.imageUrl} target="_blank" rel="noreferrer" style={{ color: '#38bdf8', textDecoration: 'underline' }} onClick={e => e.stopPropagation()}>View</a>
                ) : row.localImagePath ? (
                  <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Local Crop</span>
                ) : (
                  <span style={{ color: '#64748b' }}>-</span>
                )}
              </td>
              <td style={{ padding: '8px', maxWidth: '250px' }}>
                <IssueList issues={row.issues} compact />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
