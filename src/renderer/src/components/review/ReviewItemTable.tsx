import type { ReviewItem } from '../../../../shared/types/itemOcr'

interface ReviewItemTableProps {
  items: ReviewItem[];
  onSelectItem: (item: ReviewItem) => void;
  selectedItemNumber: string | null;
  onEditField?: (itemNumber: string, field: string, value: any) => void;
}

export function ReviewItemTable({ items, onSelectItem, selectedItemNumber, onEditField }: ReviewItemTableProps) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ backgroundColor: '#f1f5f9', borderBottom: '2px solid #e2e8f0' }}>
            <th style={thStyle}>Page</th>
            <th style={thStyle}>Item</th>
            <th style={thStyle}>Image</th>
            <th style={thStyle}>Name (AR)</th>
            <th style={thStyle}>Name (EN)</th>
            <th style={thStyle}>Offer Price</th>
            <th style={thStyle}>Orig. Price</th>
            <th style={thStyle}>Size</th>
            <th style={thStyle}>Pack Qty</th>
            <th style={thStyle}>Other Returned Keys</th>
            <th style={thStyle}>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const knownKeys = ['product_name_ar', 'product_name_en', 'name_ar', 'name_en', 'offer_price', 'original_price', 'size', 'pack_quantity']
            const otherFields = Object.entries(item.ocr || {}).filter(([k]) => !knownKeys.includes(k))

            return (
              <tr
                key={`${item.pageNumber}-${item.itemNumber}`}
                onClick={() => onSelectItem(item)}
                style={{
                  cursor: 'pointer',
                  backgroundColor: selectedItemNumber === item.itemNumber ? '#eff6ff' : (item.ocrStatus === 'failed' ? '#fef2f2' : 'white'),
                  borderBottom: '1px solid #e2e8f0'
                }}
              >
                <td style={tdStyle}>{item.pageNumber}</td>
                <td style={tdStyle}>{item.itemNumber}</td>
                <td style={tdStyle}>
                  {item.localImagePath ? (
                    <img
                      src={`local-file://get?path=${encodeURIComponent(item.localImagePath)}`}
                      alt={`Item ${item.itemNumber}`}
                      style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: '4px', border: '1px solid #e2e8f0' }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                  ) : <span style={{ color: '#94a3b8' }}>—</span>}
                </td>
                <td style={{ ...tdStyle, direction: 'rtl', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {onEditField ? (
                    <input
                      type="text"
                      value={(item.ocr?.product_name_ar as string) || (item.ocr?.name_ar as string) || ''}
                      onChange={(e) => onEditField(item.itemNumber, 'product_name_ar', e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      style={inlineInputStyle}
                      dir="rtl"
                    />
                  ) : ((item.ocr?.product_name_ar as string) || (item.ocr?.name_ar as string) || '—')}
                </td>
                <td style={{ ...tdStyle, maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {onEditField ? (
                    <input
                      type="text"
                      value={(item.ocr?.product_name_en as string) || (item.ocr?.name_en as string) || ''}
                      onChange={(e) => onEditField(item.itemNumber, 'product_name_en', e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      style={inlineInputStyle}
                    />
                  ) : ((item.ocr?.product_name_en as string) || (item.ocr?.name_en as string) || '—')}
                </td>
                <td style={tdStyle}>
                  {onEditField ? (
                    <input
                      type="number"
                      value={(item.ocr?.offer_price as number) ?? ''}
                      onChange={(e) => onEditField(item.itemNumber, 'offer_price', e.target.value ? Number(e.target.value) : null)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ ...inlineInputStyle, width: '70px' }}
                      step="0.01"
                    />
                  ) : (item.ocr?.offer_price != null ? Number(item.ocr.offer_price).toFixed(2) : '—')}
                </td>
                <td style={tdStyle}>
                  {onEditField ? (
                    <input
                      type="number"
                      value={(item.ocr?.original_price as number) ?? ''}
                      onChange={(e) => onEditField(item.itemNumber, 'original_price', e.target.value ? Number(e.target.value) : null)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ ...inlineInputStyle, width: '70px' }}
                      step="0.01"
                    />
                  ) : (item.ocr?.original_price != null ? Number(item.ocr.original_price).toFixed(2) : '—')}
                </td>
                <td style={tdStyle}>{typeof item.ocr?.size === 'object' ? (item.ocr?.size as any)?.text : (item.ocr?.size as string) || '—'}</td>
                <td style={tdStyle}>{String(item.ocr?.pack_quantity ?? '—')}</td>
                <td style={{ ...tdStyle, maxWidth: '200px', whiteSpace: 'normal', fontSize: '0.75rem' }}>
                  {otherFields.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {otherFields.map(([k, v]) => (
                        <span key={k} style={{ background: '#f1f5f9', padding: '2px 4px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                          <strong style={{ color: '#64748b' }}>{k}:</strong> {String(v)}
                        </span>
                      ))}
                    </div>
                  ) : <span style={{ color: '#94a3b8' }}>—</span>}
                </td>
                <td style={tdStyle}>
                  <StatusDot status={item.ocrStatus} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function StatusDot({ status }: { status: string }) {
  const color = status === 'completed' ? '#10b981' : status === 'failed' ? '#ef4444' : status === 'running' ? '#3b82f6' : '#94a3b8'
  const label = status === 'completed' ? '✓ OK' : status === 'failed' ? '✗ Fail' : status === 'running' ? '⏳' : '…'
  return (
    <span style={{ color, fontWeight: 600, fontSize: '0.8rem' }}>{label}</span>
  )
}

const thStyle: React.CSSProperties = {
  padding: '8px 6px',
  textAlign: 'left',
  fontWeight: 600,
  color: '#475569',
  whiteSpace: 'nowrap',
  fontSize: '0.8rem'
}

const tdStyle: React.CSSProperties = {
  padding: '6px',
  verticalAlign: 'middle',
  whiteSpace: 'nowrap'
}

const inlineInputStyle: React.CSSProperties = {
  padding: '2px 4px',
  fontSize: '0.85rem',
  border: '1px solid #cbd5e1',
  borderRadius: '3px',
  width: '100%',
  boxSizing: 'border-box'
}
