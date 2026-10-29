import { useState } from 'react'

interface ManualCropToolbarProps {
  zoom: number;
  setZoom: (v: number) => void;
  zoomMode: 'fit_page' | 'fit_width' | 'manual';
  setZoomMode: (mode: 'fit_page' | 'fit_width' | 'manual') => void;
  selectedCount: number;
  historyIndex: number;
  historyLength: number;
  onUndo: () => void;
  onRedo: () => void;
  onRenumber: () => void;
  isAddingBox: boolean;
  setIsAddingBox: (v: boolean) => void;
  onSave: () => void;
  onCrop: () => void;
  saving: boolean;
  cropping: boolean;
  layout?: import('../../../../shared/types/manualCrop').ManualCropPageLayout;
  onTogglePageComplete?: () => void;
  onDeletePage?: () => void;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  showTemplateBrowser: boolean;
  setShowTemplateBrowser: (v: boolean) => void;
  topBarLeft?: React.ReactNode;
  topBarRight?: React.ReactNode;
  onSaveTemplate?: () => void;
  onAcceptSuggestions?: () => void;
  onRejectSuggestions?: () => void;
  onRegenerateSuggestions?: () => void;
}

export function ManualCropToolbar({
  zoom, setZoom, zoomMode, setZoomMode, selectedCount, historyIndex, historyLength,
  onUndo, onRedo, onRenumber,
  isAddingBox, setIsAddingBox, onSave, onCrop, saving, cropping, layout, onTogglePageComplete, onDeletePage,
  onSelectAll, onClearSelection, showTemplateBrowser, setShowTemplateBrowser,
  topBarLeft, topBarRight, onSaveTemplate,
  onAcceptSuggestions, onRejectSuggestions, onRegenerateSuggestions
}: ManualCropToolbarProps) {
  const [showPageActions, setShowPageActions] = useState(false)
  
  return (
    <div style={{ padding: '4px 16px', backgroundColor: '#ffffff', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: '16px', alignItems: 'center', minHeight: '48px', flexWrap: 'wrap' }}>
      {/* Title / Navigation from parent */}
      <h2 style={{ margin: 0, fontSize: '1.1rem', color: '#0f172a', fontWeight: 600, marginRight: '8px' }}>Manual Crop Editor</h2>
      {topBarLeft && (
        <div style={{ display: 'flex', alignItems: 'center', borderRight: '1px solid #cbd5e1', paddingRight: '16px', marginRight: '4px' }}>
          {topBarLeft}
        </div>
      )}

      {/* Zoom Group */}
      <div style={{ display: 'flex', gap: '4px', borderRight: '1px solid #cbd5e1', paddingRight: '12px', alignItems: 'center' }}>
        <button className={`btn btn-sm ${zoomMode === 'fit_page' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setZoomMode('fit_page')} title="Fit Page" aria-label="Fit Page" style={{ padding: '4px 8px' }}>⛶</button>
        <button className={`btn btn-sm ${zoomMode === 'fit_width' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setZoomMode('fit_width')} title="Fit Width" aria-label="Fit Width" style={{ padding: '4px 8px' }}>↔</button>
        <button className="btn btn-sm btn-secondary" onClick={() => setZoom(Math.max(0.05, zoom - 0.1))} title="Zoom Out" aria-label="Zoom Out" style={{ padding: '4px 8px' }}>−</button>
        <span style={{ fontSize: '0.85rem', width: '36px', textAlign: 'center', fontFamily: 'monospace' }}>{Math.round(zoom * 100)}%</span>
        <button className="btn btn-sm btn-secondary" onClick={() => setZoom(Math.min(3, zoom + 0.1))} title="Zoom In" aria-label="Zoom In" style={{ padding: '4px 8px' }}>+</button>
      </div>

      {/* History Group */}
      <div style={{ display: 'flex', gap: '4px', borderRight: '1px solid #cbd5e1', paddingRight: '12px' }}>
        <button className="btn btn-sm btn-secondary" disabled={historyIndex === 0} onClick={onUndo} title="Undo (Ctrl+Z)" aria-label="Undo" style={{ padding: '4px 8px' }}>↶</button>
        <button className="btn btn-sm btn-secondary" disabled={historyIndex === historyLength - 1} onClick={onRedo} title="Redo (Ctrl+Y)" aria-label="Redo" style={{ padding: '4px 8px' }}>↷</button>
      </div>

      {/* Selection / Box Group */}
      <div style={{ display: 'flex', gap: '4px', borderRight: '1px solid #cbd5e1', paddingRight: '12px' }}>
        <button 
          className={`btn btn-sm ${isAddingBox ? 'btn-primary' : 'btn-secondary'}`} 
          onClick={() => setIsAddingBox(!isAddingBox)}
          title="Add Box (A)" aria-label="Add Box"
          style={{ padding: '4px 8px' }}
        >
          ＋□
        </button>
        <button className="btn btn-sm btn-secondary" onClick={onSelectAll} title="Select All Boxes (Ctrl+A)" aria-label="Select All" style={{ padding: '4px 8px' }}>⧉</button>
        <button className="btn btn-sm btn-secondary" disabled={selectedCount === 0} onClick={onClearSelection} title="Clear Selection (Esc)" aria-label="Clear Selection" style={{ padding: '4px 8px' }}>✕</button>
      </div>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        {layout && (
          <span style={{ fontSize: '0.8rem', color: '#64748b', display: 'flex', gap: '6px' }}>
            <span>Selected: {selectedCount}</span>
            <span>|</span>
            <span>
              Crops: 
              {layout.cropStatus === 'ready' && <span style={{ color: '#10b981', marginLeft: '4px', fontWeight: 'bold' }}>Ready ({layout.cropInfo?.generatedCropCount}/{layout.cropInfo?.expectedCropCount})</span>}
              {layout.cropStatus === 'stale' && <span style={{ color: '#f59e0b', marginLeft: '4px', fontWeight: 'bold' }}>Stale</span>}
              {layout.cropStatus === 'running' && <span style={{ color: '#3b82f6', marginLeft: '4px', fontWeight: 'bold' }}>Running...</span>}
              {layout.cropStatus === 'queued' && <span style={{ color: '#64748b', marginLeft: '4px', fontWeight: 'bold' }}>Queued...</span>}
              {layout.cropStatus === 'failed' && <span style={{ color: '#ef4444', marginLeft: '4px', fontWeight: 'bold' }}>Failed</span>}
              {layout.cropStatus === 'warning' && <span style={{ color: '#f59e0b', marginLeft: '4px', fontWeight: 'bold' }}>Warning</span>}
              {(!layout.cropStatus || layout.cropStatus === 'not_started') && <span style={{ marginLeft: '4px', fontWeight: 'bold' }}>Not Started</span>}
            </span>
            {layout.queue_status && (
              <>
                <span>|</span>
                <span>
                  Queue: 
                  {layout.queue_status === 'accepted' && <span style={{ color: '#10b981', marginLeft: '4px', fontWeight: 'bold' }}>Accepted</span>}
                  {layout.queue_status === 'review_required' && <span style={{ color: '#f59e0b', marginLeft: '4px', fontWeight: 'bold' }}>Review Required</span>}
                  {layout.queue_status === 'corrected' && <span style={{ color: '#3b82f6', marginLeft: '4px', fontWeight: 'bold' }}>Corrected</span>}
                </span>
              </>
            )}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto', alignItems: 'center' }}>
        {onSaveTemplate && (
          <button 
            className="btn btn-sm btn-secondary" 
            title="Save current layout as a new template" 
            onClick={onSaveTemplate}
            style={{ padding: '4px 8px' }}
          >
            💾
          </button>
        )}
        
        {layout?.suggestedBoxes && layout.suggestedBoxes.length > 0 && (
          <>
            <button className="btn btn-sm btn-primary" onClick={onAcceptSuggestions} title="Accept Auto-Suggestions">
              ✓ Accept Auto-Grid
            </button>
            <button className="btn btn-sm btn-secondary" onClick={onRejectSuggestions} title="Reject Auto-Suggestions">
              ✕ Reject Auto-Grid
            </button>
          </>
        )}

        {onRegenerateSuggestions && (!layout?.suggestedBoxes || layout.suggestedBoxes.length === 0) && (
           <button className="btn btn-sm btn-secondary" onClick={onRegenerateSuggestions} title="Re-run Auto-Suggest">
             Auto-Suggest Grid
           </button>
        )}
        
        <button  
          className={`btn btn-sm ${showTemplateBrowser ? 'btn-primary' : 'btn-secondary'}`} 
          onClick={() => setShowTemplateBrowser(!showTemplateBrowser)}
          title="Toggle Side Panel"
        >
          {showTemplateBrowser ? 'Hide Panel' : 'Show Panel'}
        </button>

        {layout && onTogglePageComplete && (
          <button 
            className={`btn btn-sm ${layout.pageComplete ? 'btn-primary' : 'btn-secondary'}`} 
            onClick={onTogglePageComplete}
            title={layout.pageComplete ? 'Page is Marked Complete' : 'Mark Page Complete'}
            style={{ padding: '4px 12px' }}
          >
            {layout.pageComplete ? '✓ Complete' : '✓ Mark Complete'}
          </button>
        )}

        {/* Page Actions Menu */}
        <div style={{ position: 'relative' }}>
          <button 
            className="btn btn-sm btn-secondary" 
            onClick={() => setShowPageActions(!showPageActions)}
            title="Page Actions"
            style={{ padding: '4px 8px' }}
          >
            ⋯
          </button>
          
          {showPageActions && (
            <>
              <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100 }} onClick={() => setShowPageActions(false)} />
              <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '4px', backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '4px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', zIndex: 101, minWidth: '180px', display: 'flex', flexDirection: 'column', padding: '4px 0' }}>
                <button 
                  className="context-menu-item"
                  style={{ textAlign: 'left', padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.9rem' }}
                  onClick={() => { onSave(); setShowPageActions(false) }}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save Layout'}
                </button>
                <button 
                  className="context-menu-item"
                  style={{ textAlign: 'left', padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.9rem' }}
                  onClick={() => { onRenumber(); setShowPageActions(false) }}
                >
                  Renumber Boxes
                </button>
                <button 
                  className="context-menu-item"
                  style={{ textAlign: 'left', padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.9rem' }}
                  onClick={() => { onCrop(); setShowPageActions(false) }}
                  disabled={cropping}
                >
                  {cropping ? 'Generating Crops...' : 'Generate Crops'}
                </button>
                
                {onDeletePage && (
                  <>
                    <div style={{ height: '1px', backgroundColor: '#e2e8f0', margin: '4px 0' }} />
                    <button 
                      className="context-menu-item"
                      style={{ textAlign: 'left', padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.9rem', color: '#ef4444' }}
                      onClick={() => {
                        if (window.confirm('Are you sure you want to completely delete this page? It will be skipped in processing.')) {
                          onDeletePage()
                        }
                        setShowPageActions(false)
                      }}
                    >
                      Delete Page
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* Right side controls (Close) */}
        {topBarRight && (
          <div style={{ marginLeft: '12px', display: 'flex', alignItems: 'center' }}>
            {topBarRight}
          </div>
        )}
      </div>
    </div>
  )
}
