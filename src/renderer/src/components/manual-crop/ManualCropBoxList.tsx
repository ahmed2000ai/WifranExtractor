import { ManualCropPageLayout } from '../../../../shared/types/manualCrop'

interface ManualCropBoxListProps {
  layout: ManualCropPageLayout;
  selectedBoxIds: Set<string>;
  onSelectBox: (id: string, multi: boolean) => void;
}

export function ManualCropBoxList({ layout, selectedBoxIds, onSelectBox }: ManualCropBoxListProps) {
  const includedBoxes = layout.boxes.filter(b => b.included).sort((a, b) => (a.itemNumber || '').localeCompare(b.itemNumber || ''))
  const excludedBoxes = layout.boxes.filter(b => !b.included)

  return (
    <div style={{ width: '250px', borderLeft: '1px solid #e2e8f0', backgroundColor: '#fff', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '16px', borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', color: '#334155' }}>Items ({includedBoxes.length})</h3>
      </div>
      
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {includedBoxes.length === 0 && (
          <p style={{ fontSize: '0.9rem', color: '#64748b', textAlign: 'center', marginTop: '20px' }}>No items included.</p>
        )}
        
        {includedBoxes.map(box => (
          <div 
            key={box.id}
            onClick={(e) => onSelectBox(box.id, e.shiftKey || e.ctrlKey || e.metaKey)}
            style={{ 
              padding: '8px', 
              marginBottom: '4px', 
              borderRadius: '4px', 
              backgroundColor: selectedBoxIds.has(box.id) ? '#eff6ff' : '#fff',
              border: `1px solid ${selectedBoxIds.has(box.id) ? '#3b82f6' : '#e2e8f0'}`,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <div style={{ width: '24px', height: '24px', backgroundColor: '#10b981', color: '#fff', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 'bold' }}>
              {box.itemNumber || '-'}
            </div>
            <div style={{ fontSize: '0.85rem', color: '#475569' }}>
              {Math.round(box.width)}x{Math.round(box.height)} px
            </div>
          </div>
        ))}

        {excludedBoxes.length > 0 && (
          <div style={{ marginTop: '20px' }}>
            <h4 style={{ fontSize: '0.9rem', color: '#94a3b8', margin: '0 0 8px 4px' }}>Excluded ({excludedBoxes.length})</h4>
            {excludedBoxes.map(box => (
              <div 
                key={box.id}
                onClick={(e) => onSelectBox(box.id, e.shiftKey || e.ctrlKey || e.metaKey)}
                style={{ 
                  padding: '4px 8px', 
                  marginBottom: '4px', 
                  borderRadius: '4px', 
                  backgroundColor: selectedBoxIds.has(box.id) ? '#fef2f2' : '#f8fafc',
                  border: `1px solid ${selectedBoxIds.has(box.id) ? '#ef4444' : '#e2e8f0'}`,
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  color: '#94a3b8'
                }}
              >
                Box {box.id.substring(0, 8)}...
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
