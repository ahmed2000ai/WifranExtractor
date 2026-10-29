import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { ManualCropSession, ManualCropPageLayout } from '../../../../shared/types/manualCrop'
import { useManualCropLayout } from '../../hooks/useManualCropLayout'
import { ManualCropCanvas } from './ManualCropCanvas'
import { ManualCropToolbar } from './ManualCropToolbar'
import { ManualCropBoxList } from './ManualCropBoxList'

import { getIncludedRowCount, getIncludedColumnCount, getIncludedBoxCountInRow, getIncludedBoxCountInColumn } from '../../../../shared/utils/manualCropStructure'
import { generateGridFromTemplateBox, generateRowFromTemplateBox, generateColumnFromTemplateBox, calculateDefaultGridSizeFromTemplateBox } from '../../../../shared/utils/manualCropTemplateGrid'
import { useCropLayoutTemplates } from '../../hooks/useCropLayoutTemplates'
import { CropTemplateBrowser } from './templates/CropTemplateBrowser'
import { SaveCropTemplateDialog } from './templates/SaveCropTemplateDialog'

interface ManualCropEditorProps {
  workspacePath: string;
  pdfPath: string;
  renderedPages: Array<{ pageNumber: number, imagePath: string, width: number, height: number, status: string }>;
  streamingState?: import('../../../../shared/types/pdfPreprocess').StreamingPdfRenderState;

  supermarketCode?: string;
  supermarketDescription?: string;
  onClose: () => void;
  onComplete: () => void;
}

export function ManualCropEditor({
  workspacePath, pdfPath, renderedPages, streamingState, supermarketCode, supermarketDescription, onClose, onComplete
}: ManualCropEditorProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [cropping, setCropping] = useState(false)
  
  const pageEditorRef = useRef<{ 
    getCurrentLayout: () => ManualCropPageLayout,
    hasUnsavedChanges: () => boolean,
    saveChanges: () => void
  }>(null)

  const [session, setSession] = useState<ManualCropSession | null>(null)

  const [currentPageIndex, setCurrentPageIndex] = useState(0)
  const [zoom, setZoom] = useState(0.4)
  const [zoomMode, setZoomMode] = useState<'fit_page' | 'fit_width' | 'manual'>('fit_page')
  const [isAddingBox, setIsAddingBox] = useState(false)
  const [showTemplateBrowser, setShowTemplateBrowser] = useState(true)
  const [activeTab, setActiveTab] = useState<'templates' | 'items'>('templates')

  // Initialize or load session
  useEffect(() => {
    async function init() {
      const res = await window.wifranExtractor.manualCrop.loadSession(workspacePath)
      if (res.ok && res.session) {
        setSession(res.session)
      } else {
        const newSession: ManualCropSession = {
          pdfPath,
          pageLayouts: renderedPages.map(() => {
            // Layouts initialize empty now
            return null as any
          })
        }
        setSession(newSession)
      }

      try {
        const qRes = await window.wifranExtractor.manualCrop.getReviewQueue(workspacePath)
        if (qRes.ok && qRes.queue && qRes.queue.entries.length > 0) {
          const firstReview = qRes.queue.entries.find((e: any) => e.status !== 'resolved')
          if (firstReview) {
            setCurrentPageIndex(Math.max(0, firstReview.page_number - 1))
          }
        }
      } catch (e) { }

      setLoading(false)
    }
    init()
    
    // Listen to background crop progress
    const unsubscribe = window.wifranExtractor.manualCrop.onPageCropProgress((data: any) => {
      setSession(prev => {
        if (!prev) return prev
        const newLayouts = [...prev.pageLayouts]
        const idx = newLayouts.findIndex(l => l && l.pageNumber === data.pageNumber)
        if (idx >= 0 && newLayouts[idx]) {
          // If the layout became stale while processing, don't overwrite it with 'ready'
          if (data.status === 'ready' && newLayouts[idx]!.cropStatus === 'stale') {
             // Keep it stale so it gets re-run later
          } else {
             newLayouts[idx] = { 
               ...newLayouts[idx]!, 
               cropStatus: data.status,
               cropInfo: data.cropInfo 
             }
          }
        }
        
        const updatedSession = { ...prev, pageLayouts: newLayouts }
        window.wifranExtractor.manualCrop.saveSession(workspacePath, updatedSession)
        
        return updatedSession
      })
    })
    return () => unsubscribe()
  }, [workspacePath, pdfPath, renderedPages])

  const currentPage = renderedPages[currentPageIndex] || streamingState?.pages[currentPageIndex]
  const totalExpectedPages = streamingState ? streamingState.totalPages : renderedPages.length

  const isCurrentPageReady = currentPage && currentPage.status === 'rendered'
  const isCurrentPageFailed = currentPage && currentPage.status === 'failed'
  
  const [skipAccepted, setSkipAccepted] = useState(true)

  const getPrevPageIndex = () => {
    for (let i = currentPageIndex - 1; i >= 0; i--) {
      if (session?.deletedPages?.includes(i + 1)) continue;
      if (skipAccepted) {
        const layout = session?.pageLayouts?.find(l => l?.pageNumber === i + 1);
        if (layout?.queue_status === 'accepted') continue;
      }
      return i;
    }
    return -1
  }

  const getNextPageIndex = () => {
    for (let i = currentPageIndex + 1; i < totalExpectedPages; i++) {
      if (session?.deletedPages?.includes(i + 1)) continue;
      if (skipAccepted) {
        const layout = session?.pageLayouts?.find(l => l?.pageNumber === i + 1);
        if (layout?.queue_status === 'accepted') continue;
      }
      return i;
    }
    return -1
  }

  const prevPageIndex = getPrevPageIndex()
  const nextPageIndex = getNextPageIndex()

  useEffect(() => {
    // Fast-forward if current page is deleted or accepted (if skip enabled)
    const isDeleted = session?.deletedPages?.includes(currentPageIndex + 1);
    const layout = session?.pageLayouts?.find(l => l?.pageNumber === currentPageIndex + 1);
    const isAccepted = skipAccepted && layout?.queue_status === 'accepted';
    
    if (isDeleted || isAccepted) {
      if (nextPageIndex !== -1) setCurrentPageIndex(nextPageIndex)
      else if (prevPageIndex !== -1) setCurrentPageIndex(prevPageIndex)
    }
  }, [session?.deletedPages, session?.pageLayouts, skipAccepted, currentPageIndex, nextPageIndex, prevPageIndex])

  const handleDeletePage = () => {
    if (!session) return
    const pageNum = currentPageIndex + 1
    const newDeleted = [...(session.deletedPages || []), pageNum]
    const newSession = { ...session, deletedPages: newDeleted }
    setSession(newSession)
    
    setSaving(true)
    window.wifranExtractor.manualCrop.saveSession(workspacePath, newSession).finally(() => setSaving(false))
  }
  const topBarLeft = (
    <>
      <button className="btn btn-secondary btn-sm" disabled={prevPageIndex === -1} onClick={() => {
        if (!session) return
        const layout = pageEditorRef.current?.getCurrentLayout()
        if (layout) {
          
          const newLayouts = [...(session.pageLayouts || [])]
          const idx = newLayouts.findIndex(l => l?.pageNumber === layout.pageNumber)
          if (idx >= 0) newLayouts[idx] = layout
          else newLayouts.push(layout)
          
          const newSession: ManualCropSession = { 
            ...session, 
            pageLayouts: newLayouts.filter((l): l is ManualCropPageLayout => Boolean(l)) 
          }
          setSession(newSession)
          window.wifranExtractor.manualCrop.saveSession(workspacePath, newSession)
          
          // NEW: Trigger background crop if it has included boxes
          if (layout.boxes.some(b => b.included)) {
            window.wifranExtractor.manualCrop.enqueuePageCrop(workspacePath, layout)
          } else {
            layout.cropStatus = 'not_started' // or warning, as requested
          }
        }
        setCurrentPageIndex(prevPageIndex)
      }}>
        &larr; Prev
      </button>
      <span style={{ fontSize: '0.85rem', color: '#475569', minWidth: '80px', textAlign: 'center', margin: '0 4px' }}>
        Page {currentPageIndex + 1} of {totalExpectedPages}
        {session?.deletedPages?.includes(currentPageIndex + 1) && ' (Del)'}
      </span>
      <button className="btn btn-secondary btn-sm" disabled={nextPageIndex === -1} onClick={() => {
        if (!session) return
        const layout = pageEditorRef.current?.getCurrentLayout()
        if (layout) {
          
          const newLayouts = [...(session.pageLayouts || [])]
          const idx = newLayouts.findIndex(l => l?.pageNumber === layout.pageNumber)
          if (idx >= 0) newLayouts[idx] = layout
          else newLayouts.push(layout)
          
          const newSession: ManualCropSession = { 
            ...session, 
            pageLayouts: newLayouts.filter((l): l is ManualCropPageLayout => Boolean(l)) 
          }
          setSession(newSession)
          window.wifranExtractor.manualCrop.saveSession(workspacePath, newSession)
          
          // NEW: Trigger background crop if it has included boxes
          if (layout.boxes.some(b => b.included)) {
            window.wifranExtractor.manualCrop.enqueuePageCrop(workspacePath, layout)
          } else {
            layout.cropStatus = 'not_started'
          }
        }
        setCurrentPageIndex(nextPageIndex)
      }}>
        Next &rarr;
      </button>
      <label style={{ display: 'flex', alignItems: 'center', fontSize: '0.85rem', marginLeft: '8px', cursor: 'pointer', color: '#475569' }}>
        <input 
          type="checkbox" 
          checked={skipAccepted} 
          onChange={e => setSkipAccepted(e.target.checked)} 
          style={{ marginRight: '4px' }} 
        />
        Skip Accepted Pages
      </label>
    </>
  )

  const handleClose = () => {
    if (pageEditorRef.current?.hasUnsavedChanges()) {
      const confirmSave = window.confirm("You have unsaved changes on this page. Do you want to save them before closing?")
      if (confirmSave) {
        pageEditorRef.current.saveChanges()
      }
    }
    onClose()
  }

  const topBarRight = (
    <>
      {streamingState && streamingState.status === 'running' && (
        <span style={{ fontSize: '0.85rem', color: '#0ea5e9', marginRight: '8px' }}>
          Rendering: {streamingState.renderedPages}/{streamingState.totalPages}
        </span>
      )}
      <button className="btn btn-secondary btn-sm" onClick={handleClose}>Close</button>
    </>
  )

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#f1f5f9', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>

      {loading || !session ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>Loading editor...</div>
      ) : isCurrentPageFailed ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
          <h3>Page {currentPageIndex + 1} Failed to Render</h3>
          <p>{(currentPage as any)?.error?.message || 'Unknown error'}</p>
        </div>
      ) : !isCurrentPageReady ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
          <h3>Page {currentPageIndex + 1} is rendering...</h3>
          <p>Please wait. ({streamingState?.renderedPages || 0} / {streamingState?.totalPages || 0} ready)</p>
        </div>
      ) : (
        <PageEditor 
          ref={pageEditorRef}
          key={currentPage.pageNumber}
          workspacePath={workspacePath}
          page={currentPage}

          supermarketCode={supermarketCode}
          supermarketDescription={supermarketDescription}
          existingLayout={session.pageLayouts ? session.pageLayouts.find(l => l?.pageNumber === currentPage.pageNumber) : null}
          onSavePage={(layout: ManualCropPageLayout) => {
            if (!session) return
            const newLayouts = [...(session.pageLayouts || [])]
            const idx = newLayouts.findIndex(l => l?.pageNumber === layout.pageNumber)
            if (idx >= 0) newLayouts[idx] = layout
            else newLayouts.push(layout)
            
            const newSession: ManualCropSession = { 
              ...session, 
              pageLayouts: newLayouts.filter((l): l is ManualCropPageLayout => Boolean(l)) 
            }
            setSession(newSession)
            
            setSaving(true)
            window.wifranExtractor.manualCrop.saveSession(workspacePath, newSession).finally(() => setSaving(false))
            
            // NEW: Trigger background crop on save if it has included boxes
            if (layout.boxes.some(b => b.included)) {
              window.wifranExtractor.manualCrop.enqueuePageCrop(workspacePath, layout)
            } else {
              layout.cropStatus = 'not_started'
            }
          }}
          onCropAll={async () => {
            // First save current
            setCropping(true)
            await window.wifranExtractor.manualCrop.cropAllPages({
              layouts: session.pageLayouts.filter(l => Boolean(l) && !session.deletedPages?.includes(l.pageNumber)),
              workspacePath
            })
            setCropping(false)
            onComplete()
          }}
          zoom={zoom}
          setZoom={setZoom}
          zoomMode={zoomMode}
          setZoomMode={setZoomMode}
          isAddingBox={isAddingBox}
          setIsAddingBox={setIsAddingBox}
          saving={saving}
          cropping={cropping}
          onDeletePage={handleDeletePage}
          showTemplateBrowser={showTemplateBrowser}
          setShowTemplateBrowser={setShowTemplateBrowser}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          topBarLeft={topBarLeft}
          topBarRight={topBarRight}
        />
      )}
    </div>
  )
}

const PageEditor = forwardRef(({ workspacePath, page, existingLayout, supermarketCode, supermarketDescription, onSavePage, onCropAll, zoom, setZoom, zoomMode, setZoomMode, isAddingBox, setIsAddingBox, saving, cropping, onDeletePage, showTemplateBrowser, setShowTemplateBrowser, activeTab, setActiveTab, topBarLeft, topBarRight }: any, ref) => {
  // We need to initialize the layout if it doesn't exist
  const [initialLayout] = useState(() => {
    if (existingLayout) return existingLayout
    
    // Start empty. Do not generate a fixed grid automatically.
    return {
      pageNumber: page.pageNumber,
      pageImagePath: page.imagePath,
      pageWidth: page.width,
      pageHeight: page.height,
      boxes: [],
      rowLines: [],
      columnLines: [],
      pageComplete: false,
      completedAt: null,
      updatedAt: new Date().toISOString()
    }
  })

  const {
    layout, selectedBoxIds, historyIndex, historyLength,
    undo, redo, toggleBoxSelection, selectBoxesInRect,
    moveSelectedBoxes, resizeSelectedBoxes, setIncluded, deleteSelected, deleteBox,
    addBox, mergeSelected, splitSelected, convertColumnToStacked,
    moveRowLine, moveColumnLine, renumber, applyTemplateGeneratedLayout,
    selectAllBoxes, clearSelection, setSelectedBoxIdsList,
    setSuggestions, acceptSuggestions, rejectSuggestions, cloneSelectedBoxes
  } = useManualCropLayout(initialLayout)

  // Suggestion logic
  useEffect(() => {
    // Attempt to load suggestions if this page has none, hasn't been edited, and is not complete.
    if (!layout.suggestedBoxes && !existingLayout) {
      // Need manifest context, we can assume workspace path is enough if we call main process
      // But IPC requires manifest. Let's make IPC method simpler or fetch manifest.
      window.wifranExtractor.extractionPackage.open(workspacePath).then(res => {
        if (res.ok && res.manifest) {
          window.wifranExtractor.manualCrop.loadSuggestions(workspacePath, page.pageNumber).then(sugRes => {
            if (sugRes.ok && sugRes.result) {
              setSuggestions(sugRes.result.suggestedBoxes)
            } else {
              // If not loaded, generate it
              window.wifranExtractor.manualCrop.generateSuggestions(res.manifest, page.pageNumber, page.imagePath).then(genRes => {
                if (genRes.ok && genRes.result) {
                  setSuggestions(genRes.result.suggestedBoxes)
                  if (genRes.result.suggestedBoxes.length > 0) {
                     showToast(`Found ${genRes.result.suggestedBoxes.length} suggested items`, 'info')
                  }
                }
              })
            }
          })
        }
      })
    }
  }, [page.pageNumber, page.imagePath, workspacePath, existingLayout])

  const handleRegenerateSuggestions = () => {
    window.wifranExtractor.extractionPackage.open(workspacePath).then(res => {
      if (res.ok && res.manifest) {
        showToast('Running Auto-Suggest...', 'info')
        window.wifranExtractor.manualCrop.generateSuggestions(res.manifest, page.pageNumber, page.imagePath).then(genRes => {
          if (genRes.ok && genRes.result) {
            setSuggestions(genRes.result.suggestedBoxes)
            showToast(`Found ${genRes.result.suggestedBoxes.length} suggested items`, 'success')
          } else {
            showToast('Failed to auto-suggest', 'error')
          }
        })
      }
    })
  }

  const templateState = useCropLayoutTemplates()
  const canvasContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (zoomMode !== 'fit_page' && zoomMode !== 'fit_width') return;
    if (!canvasContainerRef.current || !layout.pageWidth || !layout.pageHeight) return;
    
    const calculateZoom = () => {
      const container = canvasContainerRef.current;
      if (!container || !layout.pageWidth || !layout.pageHeight) return;
      
      const { clientWidth, clientHeight } = container;
      if (clientWidth === 0 || clientHeight === 0) return;
      
      const horizontalPadding = 40;
      const verticalPadding = 40;
      
      const availableW = clientWidth - horizontalPadding;
      const availableH = clientHeight - verticalPadding;
      
      let newZoom = zoom;
      if (zoomMode === 'fit_page') {
        newZoom = Math.min(availableW / layout.pageWidth, availableH / layout.pageHeight) * 0.96;
      } else if (zoomMode === 'fit_width') {
        newZoom = (availableW / layout.pageWidth) * 0.96;
      }
      
      newZoom = Math.max(0.05, Math.min(newZoom, 3));
      if (Math.abs(newZoom - zoom) > 0.001) {
        setZoom(newZoom);
      }
    };

    calculateZoom();
    
    const observer = new ResizeObserver(() => {
      calculateZoom();
    });
    observer.observe(canvasContainerRef.current);
    
    return () => observer.disconnect();
  }, [zoomMode, layout.pageWidth, layout.pageHeight, showTemplateBrowser, activeTab]);

  const [showSaveTemplateDialog, setShowSaveTemplateDialog] = useState(false)

  const [lastSavedHistoryIndex, setLastSavedHistoryIndex] = useState(historyIndex)

  useImperativeHandle(ref, () => ({
    getCurrentLayout: () => layout,
    hasUnsavedChanges: () => historyIndex !== lastSavedHistoryIndex,
    saveChanges: () => {
      onSavePage(layout)
      setLastSavedHistoryIndex(historyIndex)
    }
  }))

  const [toastMessage, setToastMessage] = useState<{ text: string, type: 'info' | 'error' | 'success' } | null>(null)
  
  const showToast = (text: string, type: 'info' | 'error' | 'success') => {
    setToastMessage({ text, type })
    setTimeout(() => setToastMessage(null), 2500)
  }

  const handleApplyTemplate = (template: any) => {
    try {
      const newBoxes = template.boxes.map((b: any) => ({
        ...b,
        id: `box-tmpl-${Math.random().toString(36).substring(2, 9)}`,
        pageNumber: layout.pageNumber
      }))
      
      applyTemplateGeneratedLayout({
        ...layout,
        boxes: newBoxes,
        rowLines: template.rowLines || [],
        columnLines: template.columnLines || [],
        updatedAt: new Date().toISOString()
      })

      setSelectedBoxIdsList(newBoxes.filter((b: any) => b.included).map((b: any) => b.id))
    } catch (err: any) {
      alert(err.message)
    }
  }

  const [dialogState, setDialogState] = useState<{
    type: 'grid' | 'row' | 'column' | null;
    boxId: string;
    rows: number;
    columns: number;
  }>({ type: null, boxId: '', rows: 0, columns: 0 })

  const handleOpenGridDialog = (boxId: string) => {
    let defaultRows = getIncludedRowCount(layout) || 1
    let defaultCols = getIncludedColumnCount(layout) || 1
    
    const box = layout.boxes.find(b => b.id === boxId)
    if (box) {
      try {
        const calc = calculateDefaultGridSizeFromTemplateBox({
          pageWidth: layout.pageWidth,
          pageHeight: layout.pageHeight,
          boxX: box.x,
          boxY: box.y,
          boxWidth: box.width,
          boxHeight: box.height
        })
        defaultRows = calc.rows
        defaultCols = calc.columns
      } catch (err) {
        console.warn('Failed to calculate grid defaults geometrically, falling back to live layout stats:', err)
      }
    }

    setDialogState({
      type: 'grid',
      boxId,
      rows: defaultRows,
      columns: defaultCols
    })
  }

  const handleOpenRowDialog = (boxId: string) => {
    const box = layout.boxes.find(b => b.id === boxId)
    setDialogState({
      type: 'row',
      boxId,
      rows: 1,
      columns: box?.rowId ? getIncludedBoxCountInRow(layout, box.rowId) : 1
    })
  }

  const handleOpenColumnDialog = (boxId: string) => {
    const box = layout.boxes.find(b => b.id === boxId)
    setDialogState({
      type: 'column',
      boxId,
      rows: box?.columnId ? getIncludedBoxCountInColumn(layout, box.columnId) : 1,
      columns: 1
    })
  }

  const applyGeneration = () => {
    if (!dialogState.type || !dialogState.boxId) return
    
    let newLayout = layout
    try {
      if (dialogState.type === 'grid') {
        newLayout = generateGridFromTemplateBox({
          layout, selectedBoxId: dialogState.boxId, rows: dialogState.rows, columns: dialogState.columns
        })
      } else if (dialogState.type === 'row') {
        newLayout = generateRowFromTemplateBox({
          layout, selectedBoxId: dialogState.boxId, columns: dialogState.columns
        })
      } else if (dialogState.type === 'column') {
        newLayout = generateColumnFromTemplateBox({
          layout, selectedBoxId: dialogState.boxId, rows: dialogState.rows
        })
      }
      
      applyTemplateGeneratedLayout(newLayout)
      
      // Check for overflow warning
      const hasOverflow = newLayout.boxes.some(b => 
        b.x < 0 || b.y < 0 || b.x + b.width > layout.pageWidth || b.y + b.height > layout.pageHeight
      )
      if (hasOverflow) {
        setTimeout(() => alert('Some generated boxes extend outside the page. Adjust the selected box size or undo and try again.'), 100)
      }
    } catch (err: any) {
      alert(`Generation failed: ${err.message}`)
    }
    
    setDialogState({ type: null, boxId: '', rows: 0, columns: 0 })
  }

  const togglePageComplete = () => {
    onSavePage({
      ...layout,
      pageComplete: !layout.pageComplete,
      completedAt: !layout.pageComplete ? new Date().toISOString() : null
    })
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const targetElement = e.target as HTMLElement
        if (targetElement.closest('.template-browser-container')) {
          // Let the Template Browser handle its own deletion
          return
        }
        deleteSelected()
      } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        undo()
      } else if (e.key === 'y' && (e.ctrlKey || e.metaKey)) {
        redo()
      } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        selectAllBoxes()
      } else if (e.key === '*' || e.code === 'NumpadMultiply') {
        // Handle template cycling
        const brandTemplates = templateState.templates.filter(t => t.supermarket_code === supermarketCode)
        if (!supermarketCode) {
           showToast('No active brand set for templates.', 'error')
        } else if (brandTemplates.length === 0) {
           showToast(`No templates saved for ${supermarketDescription || supermarketCode}.`, 'error')
        } else {
           // Find which template is currently matched or use the first one
           // Since we don't have a strict 'active template ID' in layout, we just cycle by order.
           // To keep state, we can use a ref for the current cycle index.
           // For simplicity, we just look up the next one if possible or increment a persistent ref.
           cycleRef.current = (cycleRef.current + 1) % brandTemplates.length
           const nextTemplate = brandTemplates[cycleRef.current]
           handleApplyTemplate(nextTemplate)
           if (cycleRef.current === 0 && brandTemplates.length > 1) {
             showToast(`Cycle wrapped. Applied Template: ${nextTemplate.name}`, 'info') // dark blue via style
           } else {
             showToast(`Applied Template: ${nextTemplate.name}`, 'success')
           }
        }
      } else if (e.key === 'Escape') {
        clearSelection()
      } else if (e.key === 'm') {
        mergeSelected()
      } else if (e.key === 'a' && !e.ctrlKey && !e.metaKey) {
        setIsAddingBox(!isAddingBox)
      } else if (e.key === 'ArrowUp') {
        moveSelectedBoxes(0, e.shiftKey ? -10 : -1)
      } else if (e.key === 'ArrowDown') {
        moveSelectedBoxes(0, e.shiftKey ? 10 : 1)
      } else if (e.key === 'ArrowLeft') {
        moveSelectedBoxes(e.shiftKey ? -10 : -1, 0)
      } else if (e.key === 'ArrowRight') {
        moveSelectedBoxes(e.shiftKey ? 10 : 1, 0)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [deleteSelected, undo, redo, mergeSelected, setIsAddingBox, isAddingBox, moveSelectedBoxes, selectAllBoxes, clearSelection, supermarketCode, supermarketDescription, templateState.templates])

  const cycleRef = useRef(-1)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <ManualCropToolbar 
        zoom={zoom}
        setZoom={(v) => { setZoomMode('manual'); setZoom(v); }}
        zoomMode={zoomMode}
        setZoomMode={setZoomMode}
        selectedCount={selectedBoxIds.size}
        historyIndex={historyIndex}
        historyLength={historyLength}
        onUndo={undo}
        onRedo={redo}
        onRenumber={renumber}
        isAddingBox={isAddingBox}
        setIsAddingBox={setIsAddingBox}
        onSave={() => {
          onSavePage(layout)
          setLastSavedHistoryIndex(historyIndex)
        }}
        onCrop={onCropAll}
        saving={saving}
        cropping={cropping}
        layout={layout}
        onTogglePageComplete={togglePageComplete}
        onDeletePage={onDeletePage}
        onSelectAll={selectAllBoxes}
        onClearSelection={clearSelection}
        showTemplateBrowser={showTemplateBrowser}
        setShowTemplateBrowser={setShowTemplateBrowser}
        topBarLeft={topBarLeft}
        topBarRight={topBarRight}
        onAcceptSuggestions={acceptSuggestions}
        onRejectSuggestions={rejectSuggestions}
        onRegenerateSuggestions={handleRegenerateSuggestions}
        onSaveTemplate={() => {
          setShowSaveTemplateDialog(true)
        }}
      />
      
      <SaveCropTemplateDialog
        isOpen={showSaveTemplateDialog}
        onClose={() => setShowSaveTemplateDialog(false)}
        currentLayout={layout}
        onSave={async (input) => {
          await templateState.saveTemplate({
            ...input,
            supermarket_code: supermarketCode,
            supermarket_description: supermarketDescription
          })
        }}
      />

      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        <div 
          ref={canvasContainerRef}
          style={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px', backgroundColor: '#e2e8f0' }}
        >
          <ManualCropCanvas 
            layout={layout}
            selectedBoxIds={selectedBoxIds}
            zoom={zoom}
            onSelectBox={toggleBoxSelection}
            onSelectRect={selectBoxesInRect}
            onMoveBoxes={moveSelectedBoxes}
            onResizeBoxes={resizeSelectedBoxes}
            onMoveRowLine={moveRowLine}
            onMoveColumnLine={moveColumnLine}
            onAddBox={addBox}
            isAddingBox={isAddingBox}
            onGenerateGrid={handleOpenGridDialog}
            onGenerateRow={handleOpenRowDialog}
            onGenerateColumn={handleOpenColumnDialog}
            onDeleteBox={deleteBox}
            onDeleteSelected={deleteSelected}
            onMerge={mergeSelected}
            onSplitH={() => splitSelected('horizontal')}
            onSplitV={() => convertColumnToStacked(3)}
            onExclude={() => setIncluded(Array.from(selectedBoxIds), false)}
            onInclude={() => setIncluded(Array.from(selectedBoxIds), true)}
            onCloneBoxes={cloneSelectedBoxes}
          />
        </div>

        {toastMessage && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            backgroundColor: toastMessage.type === 'error' ? 'rgba(220, 38, 38, 0.9)' : 
                             toastMessage.type === 'info' ? 'rgba(30, 58, 138, 0.9)' : 
                             'rgba(37, 99, 235, 0.9)',
            color: 'white',
            padding: '12px 24px',
            borderRadius: '8px',
            fontSize: '1.2rem',
            fontWeight: 'bold',
            zIndex: 9999,
            pointerEvents: 'none',
            boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
            transition: 'opacity 0.3s',
            textAlign: 'center'
          }}>
            {toastMessage.text}
          </div>
        )}

        {showTemplateBrowser && (
          <div className="template-browser-container" style={{ width: '300px', borderLeft: '1px solid #cbd5e1', backgroundColor: '#f8fafc', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', borderBottom: '1px solid #cbd5e1' }}>
              <button 
                style={{ flex: 1, padding: '10px', background: activeTab === 'templates' ? 'white' : 'transparent', border: 'none', borderBottom: activeTab === 'templates' ? '2px solid #3b82f6' : '2px solid transparent', fontWeight: activeTab === 'templates' ? 'bold' : 'normal', cursor: 'pointer' }}
                onClick={() => setActiveTab('templates')}
              >
                Templates
              </button>
              <button 
                style={{ flex: 1, padding: '10px', background: activeTab === 'items' ? 'white' : 'transparent', border: 'none', borderBottom: activeTab === 'items' ? '2px solid #3b82f6' : '2px solid transparent', fontWeight: activeTab === 'items' ? 'bold' : 'normal', cursor: 'pointer' }}
                onClick={() => setActiveTab('items')}
              >
                Items ({layout.boxes.length})
              </button>
            </div>
            
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {activeTab === 'templates' ? (
                <div style={{ padding: '0px', display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <CropTemplateBrowser 
                    templates={templateState.templates}
                    isLoading={templateState.isLoading}
                    error={templateState.error}
                    activeSupermarketCode={supermarketCode}
                    activeSupermarketDescription={supermarketDescription}
                    onApply={handleApplyTemplate}
                    onRename={(id, name, notes) => templateState.updateTemplate(id, { name, notes })}
                    onDuplicate={templateState.duplicateTemplate}
                    onDelete={templateState.deleteTemplate}
                  />
                </div>
              ) : (
                <ManualCropBoxList 
                  layout={layout}
                  selectedBoxIds={selectedBoxIds}
                  onSelectBox={toggleBoxSelection}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Dialog removed based on user request */}      {dialogState.type && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ backgroundColor: 'white', padding: '24px', borderRadius: '8px', width: '400px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
            <h3 style={{ marginTop: 0 }}>
              {dialogState.type === 'grid' && 'Generate same-size grid from selected box'}
              {dialogState.type === 'row' && 'Generate same-size row from selected box'}
              {dialogState.type === 'column' && 'Generate same-size column from selected box'}
            </h3>
            
            <p style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: '20px' }}>
              {dialogState.type === 'grid' && 'This will replace all boxes on this page except the selected box.'}
              {dialogState.type === 'row' && 'This will replace the current row boxes, keeping the selected box.'}
              {dialogState.type === 'column' && 'This will replace the current column boxes, keeping the selected box.'}
            </p>

            <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
              {(dialogState.type === 'grid' || dialogState.type === 'column') && (
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '4px' }}>Rows</label>
                  <input 
                    type="number" min="1" max="20" 
                    value={dialogState.rows} 
                    onChange={e => setDialogState(prev => ({ ...prev, rows: parseInt(e.target.value) || 1 }))}
                    style={{ width: '100%', padding: '8px', border: '1px solid #cbd5e1', borderRadius: '4px' }}
                  />
                </div>
              )}
              {(dialogState.type === 'grid' || dialogState.type === 'row') && (
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '4px' }}>Columns</label>
                  <input 
                    type="number" min="1" max="20" 
                    value={dialogState.columns} 
                    onChange={e => setDialogState(prev => ({ ...prev, columns: parseInt(e.target.value) || 1 }))}
                    style={{ width: '100%', padding: '8px', border: '1px solid #cbd5e1', borderRadius: '4px' }}
                  />
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="btn btn-secondary" onClick={() => setDialogState({ type: null, boxId: '', rows: 0, columns: 0 })}>Cancel</button>
              <button className="btn btn-primary" onClick={applyGeneration}>Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
})
