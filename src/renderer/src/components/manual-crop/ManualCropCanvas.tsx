import { useRef, useState, useEffect } from 'react'
import { ManualCropPageLayout, ManualCropBox } from '../../../../shared/types/manualCrop'

interface ManualCropCanvasProps {
  layout: ManualCropPageLayout;
  selectedBoxIds: Set<string>;
  zoom: number;
  onSelectBox: (id: string, multi: boolean) => void;
  onSelectRect: (rect: { x: number, y: number, width: number, height: number }, mode?: 'replace' | 'add' | 'toggle') => void;
  onMoveBoxes: (dx: number, dy: number) => void;
  onResizeBoxes: (edges: { top?: number, right?: number, bottom?: number, left?: number }) => void;
  onMoveRowLine: (index: number, y: number) => void;
  onMoveColumnLine: (index: number, x: number) => void;
  onAddBox: (x: number, y: number, width: number, height: number) => void;
  isAddingBox?: boolean;
  onGenerateGrid: (boxId: string) => void;
  onGenerateRow: (boxId: string) => void;
  onGenerateColumn: (boxId: string) => void;
  onDeleteBox?: (boxId: string) => void;
  onDeleteSelected?: () => void;
  onMerge?: () => void;
  onSplitH?: () => void;
  onSplitV?: () => void;
  onExclude?: () => void;
  onInclude?: () => void;
}

export function ManualCropCanvas({
  layout,
  selectedBoxIds,
  zoom,
  onSelectBox,
  onSelectRect,
  onMoveBoxes,
  onResizeBoxes,
  onMoveRowLine,
  onMoveColumnLine,
  onAddBox,
  isAddingBox,
  onGenerateGrid,
  onGenerateRow,
  onGenerateColumn,
  onDeleteBox,
  onDeleteSelected,
  onMerge,
  onSplitH,
  onSplitV,
  onExclude,
  onInclude,
  onCloneBoxes
}: ManualCropCanvasProps & { onCloneBoxes?: (dx: number, dy: number) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, boxId: string } | null>(null)
  
  const [dragState, setDragState] = useState<{
    type: 'move_box' | 'resize_box' | 'move_row' | 'move_col' | 'draw_rect' | 'add_box' | null;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    targetId?: string;
    targetIndex?: number;
    resizeEdges?: { top?: boolean, right?: boolean, bottom?: boolean, left?: boolean };
    modifierMode?: 'replace' | 'add' | 'toggle';
    isCtrlKey?: boolean;
  }>({ type: null, startX: 0, startY: 0, currentX: 0, currentY: 0 })

  const getEventCoords = (e: React.MouseEvent | MouseEvent) => {
    if (!containerRef.current) return { x: 0, y: 0 }
    const rect = containerRef.current.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) / zoom,
      y: (e.clientY - rect.top) / zoom
    }
  }

  const handleMouseDown = (e: React.MouseEvent, type: any, data: any = {}) => {
    if (e.button !== 0) return // Only left click
    e.stopPropagation()
    const coords = getEventCoords(e)
    setDragState({
      type,
      startX: coords.x,
      startY: coords.y,
      currentX: coords.x,
      currentY: coords.y,
      isCtrlKey: e.ctrlKey || e.metaKey,
      ...data
    })
    
    // Auto-select if clicking a box not currently selected (for moving)
    if (type === 'move_box' && data.targetId && !selectedBoxIds.has(data.targetId)) {
      onSelectBox(data.targetId, e.shiftKey)
    }
  }

  const handleContextMenu = (e: React.MouseEvent, boxId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, boxId })
  }

  const handleBackgroundMouseDown = (e: React.MouseEvent) => {
    if (contextMenu) setContextMenu(null)
    if (e.button !== 0) return
    const coords = getEventCoords(e)
    if (isAddingBox) {
      setDragState({ type: 'add_box', startX: coords.x, startY: coords.y, currentX: coords.x, currentY: coords.y })
    } else {
      let mode: 'replace' | 'add' | 'toggle' = 'replace'
      if (e.shiftKey) mode = 'add'
      else if (e.ctrlKey || e.metaKey) mode = 'toggle'

      setDragState({ type: 'draw_rect', startX: coords.x, startY: coords.y, currentX: coords.x, currentY: coords.y, modifierMode: mode })
      if (mode === 'replace') {
        // Clear selection initially when replacing
        onSelectRect({ x: 0, y: 0, width: 0, height: 0 }, 'replace')
      }
    }
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragState.type) return
      const coords = getEventCoords(e)
      setDragState(prev => ({ ...prev, currentX: coords.x, currentY: coords.y }))
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (!dragState.type) return
      const coords = getEventCoords(e)
      const dx = coords.x - dragState.startX
      const dy = coords.y - dragState.startY

      if (dragState.type === 'move_box' && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
        if (dragState.isCtrlKey && onCloneBoxes) {
          onCloneBoxes(dx, dy)
        } else {
          onMoveBoxes(dx, dy)
        }
      } else if (dragState.type === 'move_box' && Math.abs(dx) <= 2 && Math.abs(dy) <= 2 && dragState.targetId) {
        // Just a click
        if (!e.shiftKey && selectedBoxIds.has(dragState.targetId) && selectedBoxIds.size > 1) {
          // If we clicked an already selected box without shift, isolate selection
          onSelectBox(dragState.targetId, false)
        }
      } else if (dragState.type === 'resize_box' && dragState.resizeEdges) {
        const edges: any = {}
        if (dragState.resizeEdges.top) edges.top = dy
        if (dragState.resizeEdges.bottom) edges.bottom = dy
        if (dragState.resizeEdges.left) edges.left = dx
        if (dragState.resizeEdges.right) edges.right = dx
        onResizeBoxes(edges)
      } else if (dragState.type === 'move_row' && dragState.targetIndex !== undefined) {
        onMoveRowLine(dragState.targetIndex, coords.y)
      } else if (dragState.type === 'move_col' && dragState.targetIndex !== undefined) {
        onMoveColumnLine(dragState.targetIndex, coords.x)
      } else if (dragState.type === 'draw_rect') {
        const minX = Math.min(dragState.startX, coords.x)
        const minY = Math.min(dragState.startY, coords.y)
        const width = Math.abs(coords.x - dragState.startX)
        const height = Math.abs(coords.y - dragState.startY)
        if (width > 4 && height > 4) {
          onSelectRect({ x: minX, y: minY, width, height }, dragState.modifierMode || 'replace')
        }
      } else if (dragState.type === 'add_box') {
        const minX = Math.min(dragState.startX, coords.x)
        const minY = Math.min(dragState.startY, coords.y)
        const width = Math.abs(coords.x - dragState.startX)
        const height = Math.abs(coords.y - dragState.startY)
        if (width > 20 && height > 20) {
          onAddBox(minX, minY, width, height)
        }
      }

      setDragState({ type: null, startX: 0, startY: 0, currentX: 0, currentY: 0 })
    }

    if (dragState.type) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragState, onMoveBoxes, onResizeBoxes, onMoveRowLine, onMoveColumnLine, onSelectRect, onAddBox, selectedBoxIds, onSelectBox, onCloneBoxes])

  const renderBox = (box: ManualCropBox) => {
    const isSelected = selectedBoxIds.has(box.id)
    const isMoving = dragState.type === 'move_box' && isSelected
    const isResizing = dragState.type === 'resize_box' && isSelected

    let x = box.x
    let y = box.y
    let w = box.width
    let h = box.height

    if (isMoving) {
      x += (dragState.currentX - dragState.startX)
      y += (dragState.currentY - dragState.startY)
    } else if (isResizing && dragState.resizeEdges) {
      const dx = dragState.currentX - dragState.startX
      const dy = dragState.currentY - dragState.startY
      if (dragState.resizeEdges.left) { x += dx; w -= dx }
      if (dragState.resizeEdges.right) { w += dx }
      if (dragState.resizeEdges.top) { y += dy; h -= dy }
      if (dragState.resizeEdges.bottom) { h += dy }
    }

    const renderProvenanceBadge = (prov?: string) => {
      if (!prov) return null;
      let text = '';
      let color = '#94a3b8'; // default gray
      if (prov === 'price_anchor_split') { text = 'Split'; color = '#8b5cf6'; } // purple
      else if (prov === 'leaflet_session_adapted') { text = 'Adapted'; color = '#0ea5e9'; } // light blue
      else if (prov === 'ctrl_drag_clone') { text = 'Cloned'; color = '#14b8a6'; } // teal
      else return null;
      
      return (
        <div style={{ position: 'absolute', bottom: -20, left: 0, color: 'white', fontSize: '10px', fontWeight: 'bold', backgroundColor: color, padding: '0 4px', borderRadius: '2px', whiteSpace: 'nowrap' }}>
          {text}
        </div>
      )
    }

    return (
      <div
        key={box.id}
        onMouseDown={(e) => handleMouseDown(e, 'move_box', { targetId: box.id })}
        onContextMenu={(e) => handleContextMenu(e, box.id)}
        style={{
          position: 'absolute',
          left: `${x * zoom}px`,
          top: `${y * zoom}px`,
          width: `${w * zoom}px`,
          height: `${h * zoom}px`,
          border: `2px solid ${isSelected ? '#3b82f6' : (box.included ? '#10b981' : '#94a3b8')}`,
          backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.2)' : (box.included ? 'rgba(16, 185, 129, 0.05)' : 'rgba(148, 163, 184, 0.3)'),
          cursor: isAddingBox ? 'crosshair' : 'move',
          boxSizing: 'border-box',
          zIndex: isSelected ? 10 : 5
        }}
      >
        {box.included && box.itemNumber && (
          <div style={{ position: 'absolute', top: 0, left: 0, backgroundColor: '#10b981', color: 'white', fontSize: '10px', padding: '2px 4px', fontWeight: 'bold' }}>
            {box.itemNumber}
          </div>
        )}
        
        {renderProvenanceBadge(box.provenance)}

        {isSelected && !isAddingBox && (
          <>
            {/* Resize Handles */}
            <div style={{ position: 'absolute', top: -4, left: -4, width: 8, height: 8, backgroundColor: 'white', border: '1px solid #3b82f6', cursor: 'nwse-resize' }} onMouseDown={(e) => handleMouseDown(e, 'resize_box', { targetId: box.id, resizeEdges: { top: true, left: true } })} />
            <div style={{ position: 'absolute', top: -4, right: -4, width: 8, height: 8, backgroundColor: 'white', border: '1px solid #3b82f6', cursor: 'nesw-resize' }} onMouseDown={(e) => handleMouseDown(e, 'resize_box', { targetId: box.id, resizeEdges: { top: true, right: true } })} />
            <div style={{ position: 'absolute', bottom: -4, left: -4, width: 8, height: 8, backgroundColor: 'white', border: '1px solid #3b82f6', cursor: 'nesw-resize' }} onMouseDown={(e) => handleMouseDown(e, 'resize_box', { targetId: box.id, resizeEdges: { bottom: true, left: true } })} />
            <div style={{ position: 'absolute', bottom: -4, right: -4, width: 8, height: 8, backgroundColor: 'white', border: '1px solid #3b82f6', cursor: 'nwse-resize' }} onMouseDown={(e) => handleMouseDown(e, 'resize_box', { targetId: box.id, resizeEdges: { bottom: true, right: true } })} />
            
            <div style={{ position: 'absolute', top: -4, left: '50%', transform: 'translateX(-50%)', width: 12, height: 8, backgroundColor: 'white', border: '1px solid #3b82f6', cursor: 'ns-resize' }} onMouseDown={(e) => handleMouseDown(e, 'resize_box', { targetId: box.id, resizeEdges: { top: true } })} />
            <div style={{ position: 'absolute', bottom: -4, left: '50%', transform: 'translateX(-50%)', width: 12, height: 8, backgroundColor: 'white', border: '1px solid #3b82f6', cursor: 'ns-resize' }} onMouseDown={(e) => handleMouseDown(e, 'resize_box', { targetId: box.id, resizeEdges: { bottom: true } })} />
            <div style={{ position: 'absolute', left: -4, top: '50%', transform: 'translateY(-50%)', width: 8, height: 12, backgroundColor: 'white', border: '1px solid #3b82f6', cursor: 'ew-resize' }} onMouseDown={(e) => handleMouseDown(e, 'resize_box', { targetId: box.id, resizeEdges: { left: true } })} />
            <div style={{ position: 'absolute', right: -4, top: '50%', transform: 'translateY(-50%)', width: 8, height: 12, backgroundColor: 'white', border: '1px solid #3b82f6', cursor: 'ew-resize' }} onMouseDown={(e) => handleMouseDown(e, 'resize_box', { targetId: box.id, resizeEdges: { right: true } })} />
          </>
        )}
      </div>
    )
  }


  const renderSuggestedBox = (box: any) => {
    return (
      <div
        key={box.id}
        style={{
          position: 'absolute',
          left: `${box.x * zoom}px`,
          top: `${box.y * zoom}px`,
          width: `${box.width * zoom}px`,
          height: `${box.height * zoom}px`,
          border: '2px dashed #f59e0b',
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          pointerEvents: 'none',
          boxSizing: 'border-box',
          zIndex: 4
        }}
      >
        <div style={{ position: 'absolute', top: -20, left: 0, color: '#f59e0b', fontSize: '10px', fontWeight: 'bold', backgroundColor: 'white', padding: '0 4px', border: '1px solid #f59e0b', borderRadius: '2px' }}>
          Suggested ({Math.round((box.confidence || 0) * 100)}%)
          {box.provenance === 'price_anchor_split' && <span style={{ marginLeft: '4px', color: '#8b5cf6' }}>| Split</span>}
          {box.provenance === 'leaflet_session_adapted' && <span style={{ marginLeft: '4px', color: '#0ea5e9' }}>| Adapted</span>}
        </div>
      </div>
    )
  }

  const renderSelectionRect = () => {
    if (dragState.type !== 'draw_rect' && dragState.type !== 'add_box') return null
    const x = Math.min(dragState.startX, dragState.currentX)
    const y = Math.min(dragState.startY, dragState.currentY)
    const w = Math.abs(dragState.currentX - dragState.startX)
    const h = Math.abs(dragState.currentY - dragState.startY)
    
    return (
      <div style={{
        position: 'absolute',
        left: `${x * zoom}px`,
        top: `${y * zoom}px`,
        width: `${w * zoom}px`,
        height: `${h * zoom}px`,
        border: dragState.type === 'add_box' ? '2px dashed #10b981' : '1px solid rgba(59, 130, 246, 0.8)',
        backgroundColor: dragState.type === 'add_box' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(59, 130, 246, 0.1)',
        zIndex: 20,
        pointerEvents: 'none'
      }} />
    )
  }

  const renderClonePreview = () => {
    if (dragState.type !== 'move_box' || !dragState.isCtrlKey) return null
    const dx = dragState.currentX - dragState.startX
    const dy = dragState.currentY - dragState.startY

    return Array.from(selectedBoxIds).map(id => {
      const box = layout.boxes.find(b => b.id === id)
      if (!box) return null
      return (
        <div
          key={`clone-${id}`}
          style={{
            position: 'absolute',
            left: `${(box.x + dx) * zoom}px`,
            top: `${(box.y + dy) * zoom}px`,
            width: `${box.width * zoom}px`,
            height: `${box.height * zoom}px`,
            border: `2px dashed #10b981`,
            backgroundColor: 'rgba(16, 185, 129, 0.3)',
            zIndex: 15,
            pointerEvents: 'none'
          }}
        />
      )
    })
  }

  return (
    <div 
      ref={containerRef}
      onMouseDown={handleBackgroundMouseDown}
      style={{
        position: 'relative',
        width: `${layout.pageWidth * zoom}px`,
        height: `${layout.pageHeight * zoom}px`,
        backgroundImage: `url("local-file://get?path=${encodeURIComponent(layout.pageImagePath)}")`,
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat',
        userSelect: 'none',
        cursor: isAddingBox ? 'crosshair' : 'default',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
      }}
    >
      {/* Grid lines removed per user request: renderGridLines() */}
      {layout.suggestedBoxes && layout.suggestedBoxes.map(renderSuggestedBox)}
      {layout.boxes.map(renderBox)}
      {renderClonePreview()}
      {dragState.type === 'draw_rect' && renderSelectionRect()}
      {dragState.type === 'add_box' && renderSelectionRect()}

      {/* Context Menu Overlay */}
      {contextMenu && (() => {
        const isMultiSelect = selectedBoxIds.size > 1 && selectedBoxIds.has(contextMenu.boxId);
        return (
          <div 
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999 }}
            onClick={() => setContextMenu(null)}
            onMouseDown={() => setContextMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setContextMenu(null) }}
          >
            <div
              style={{
                position: 'absolute',
                top: contextMenu.y,
                left: contextMenu.x,
                backgroundColor: 'white',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                borderRadius: '4px',
                border: '1px solid #e2e8f0',
                padding: '4px 0',
                minWidth: '200px',
                display: 'flex',
                flexDirection: 'column'
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button 
                className="context-menu-item"
                disabled={isMultiSelect}
                style={{ textAlign: 'left', padding: '8px 16px', background: 'none', border: 'none', cursor: isMultiSelect ? 'not-allowed' : 'pointer', fontSize: '0.9rem', color: isMultiSelect ? '#cbd5e1' : '#1e293b' }}
                onClick={() => { if (!isMultiSelect) { onGenerateGrid(contextMenu.boxId); setContextMenu(null) } }}
                onMouseOver={(e) => { if (!isMultiSelect) e.currentTarget.style.backgroundColor = '#f1f5f9' }}
                onMouseOut={(e) => { if (!isMultiSelect) e.currentTarget.style.backgroundColor = 'transparent' }}
              >
                Generate Grid From This Box...
              </button>
              <button 
                className="context-menu-item"
                disabled={isMultiSelect}
                style={{ textAlign: 'left', padding: '8px 16px', background: 'none', border: 'none', cursor: isMultiSelect ? 'not-allowed' : 'pointer', fontSize: '0.9rem', color: isMultiSelect ? '#cbd5e1' : '#1e293b' }}
                onClick={() => { if (!isMultiSelect) { onGenerateRow(contextMenu.boxId); setContextMenu(null) } }}
                onMouseOver={(e) => { if (!isMultiSelect) e.currentTarget.style.backgroundColor = '#f1f5f9' }}
                onMouseOut={(e) => { if (!isMultiSelect) e.currentTarget.style.backgroundColor = 'transparent' }}
              >
                Generate Row From This Box...
              </button>
              <button 
                className="context-menu-item"
                disabled={isMultiSelect}
                style={{ textAlign: 'left', padding: '8px 16px', background: 'none', border: 'none', cursor: isMultiSelect ? 'not-allowed' : 'pointer', fontSize: '0.9rem', color: isMultiSelect ? '#cbd5e1' : '#1e293b' }}
                onClick={() => { if (!isMultiSelect) { onGenerateColumn(contextMenu.boxId); setContextMenu(null) } }}
                onMouseOver={(e) => { if (!isMultiSelect) e.currentTarget.style.backgroundColor = '#f1f5f9' }}
                onMouseOut={(e) => { if (!isMultiSelect) e.currentTarget.style.backgroundColor = 'transparent' }}
              >
                Generate Column From This Box...
              </button>
              {(onDeleteBox || onDeleteSelected) && (
                <>
                  <div style={{ height: '1px', backgroundColor: '#e2e8f0', margin: '4px 0' }} />
                  <button 
                    className="context-menu-item"
                    style={{ textAlign: 'left', padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.9rem', color: '#ef4444' }}
                    onClick={() => { 
                      if (isMultiSelect && onDeleteSelected) {
                        onDeleteSelected();
                      } else if (onDeleteBox) {
                        onDeleteBox(contextMenu.boxId);
                      }
                      setContextMenu(null) 
                    }}
                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#fef2f2'}
                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    {isMultiSelect ? `Delete ${selectedBoxIds.size} Selected Boxes` : 'Delete Box'}
                  </button>
                </>
              )}
              {isMultiSelect && onMerge && (
                <button 
                  className="context-menu-item"
                  style={{ textAlign: 'left', padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.9rem' }}
                  onClick={() => { onMerge(); setContextMenu(null) }}
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  Merge Selected
                </button>
              )}
              {onSplitH && (
                <button 
                  className="context-menu-item"
                  style={{ textAlign: 'left', padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.9rem' }}
                  onClick={() => { onSplitH(); setContextMenu(null) }}
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  Split Horizontally
                </button>
              )}
              {onSplitV && (
                <button 
                  className="context-menu-item"
                  style={{ textAlign: 'left', padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.9rem' }}
                  onClick={() => { onSplitV(); setContextMenu(null) }}
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  Split to Stacked Column
                </button>
              )}
              {onExclude && onInclude && (
                <>
                  <div style={{ height: '1px', backgroundColor: '#e2e8f0', margin: '4px 0' }} />
                  <button 
                    className="context-menu-item"
                    style={{ textAlign: 'left', padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.9rem', color: '#ef4444' }}
                    onClick={() => { onExclude(); setContextMenu(null) }}
                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#fef2f2'}
                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    Exclude from Processing
                  </button>
                  <button 
                    className="context-menu-item"
                    style={{ textAlign: 'left', padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.9rem', color: '#10b981' }}
                    onClick={() => { onInclude(); setContextMenu(null) }}
                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#ecfdf5'}
                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    Include in Processing
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  )
}
