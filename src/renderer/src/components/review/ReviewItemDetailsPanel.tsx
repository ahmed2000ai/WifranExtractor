import type { ReviewItem } from '../../../../shared/types/itemOcr'

interface ReviewItemDetailsPanelProps {
  item: ReviewItem;
  onClose: () => void;
}

export function ReviewItemDetailsPanel({ item, onClose }: ReviewItemDetailsPanelProps) {
  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: '480px',
      backgroundColor: 'white', boxShadow: '-4px 0 16px rgba(0,0,0,0.15)',
      zIndex: 500, display: 'flex', flexDirection: 'column', overflow: 'hidden'
    }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', color: '#0f172a' }}>
          Item {item.itemNumber} — Page {item.pageNumber}
        </h3>
        <button className="btn btn-secondary" onClick={onClose} style={{ padding: '4px 12px' }}>✕</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        {/* Crop Image Preview */}
        {item.localImagePath && (
          <div style={{ marginBottom: '20px', textAlign: 'center' }}>
            <img
              src={`local-file://get?path=${encodeURIComponent(item.localImagePath)}`}
              alt={`Item ${item.itemNumber}`}
              style={{ maxWidth: '100%', maxHeight: '300px', objectFit: 'contain', borderRadius: '8px', border: '1px solid #e2e8f0' }}
              onError={(e) => { (e.target as HTMLImageElement).alt = 'Image load failed' }}
            />
          </div>
        )}

        {/* Local Image Path */}
        <DetailRow label="Local Image Path" value={item.localImagePath || '—'} mono />

        {/* Crop Coordinates */}
        <DetailRow label="Crop Box" value={`x:${Math.round(item.cropBox.x)} y:${Math.round(item.cropBox.y)} w:${Math.round(item.cropBox.width)} h:${Math.round(item.cropBox.height)}`} />

        {/* OCR Status */}
        <DetailRow label="OCR Status" value={item.ocrStatus} />
        {item.ocrError && (
          <DetailRow label="OCR Error" value={`[${item.ocrError.code}] ${item.ocrError.message}`} error />
        )}

        {/* Full OCR JSON */}
        {item.ocr && (
          <div style={{ marginTop: '20px' }}>
            <h4 style={{ fontSize: '0.9rem', color: '#475569', marginBottom: '8px' }}>Strict OCR JSON</h4>
            <pre style={{
              backgroundColor: '#f8fafc', border: '1px solid #e2e8f0',
              borderRadius: '6px', padding: '12px', fontSize: '0.8rem',
              overflow: 'auto', maxHeight: '400px', whiteSpace: 'pre-wrap',
              wordBreak: 'break-word', color: '#334155'
            }}>
              {JSON.stringify(item.ocr, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

function DetailRow({ label, value, mono, error }: { label: string; value: string; mono?: boolean; error?: boolean }) {
  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>{label}</div>
      <div style={{
        fontSize: '0.85rem',
        color: error ? '#dc2626' : '#334155',
        fontFamily: mono ? 'monospace' : 'inherit',
        wordBreak: 'break-all'
      }}>
        {value}
      </div>
    </div>
  )
}
