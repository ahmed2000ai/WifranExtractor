import { useState, useEffect, useMemo } from 'react'
import type {
  StagedLeafletDraft,
  StagedOfferItem,
  PublishStagedLeafletResult
} from '../../../../shared/types/productImageEnrichment'
import { MetadataCompletionModal } from './MetadataCompletionModal'

export interface StagedLeafletPreviewPanelProps {
  jobDir: string
  initialDraft?: StagedLeafletDraft
  onClose?: () => void
  onPublishStarted?: () => void
}

export function StagedLeafletPreviewPanel({
  jobDir,
  initialDraft,
  onClose,
  onPublishStarted
}: StagedLeafletPreviewPanelProps): JSX.Element {
  const [draft, setDraft] = useState<StagedLeafletDraft | null>(initialDraft || null)
  const [loading, setLoading] = useState<boolean>(!initialDraft)
  const [error, setError] = useState<string | null>(null)

  // Top Controls & Global Display Mode
  const [imageMode, setImageMode] = useState<'cropped' | 'downloaded'>('downloaded')
  const [activeFilter, setActiveFilter] = useState<'all' | 'operator_edited' | 'ai_corrected' | 're_matched' | 'image_issues'>('all')

  // Step 1 Export / Step 2 Import states
  const [exporting, setExporting] = useState<boolean>(false)
  const [importing, setImporting] = useState<boolean>(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  // Publish to DB state
  const [operatorConfirmedPublish, setOperatorConfirmedPublish] = useState<boolean>(false)
  const [publishing, setPublishing] = useState<boolean>(false)
  const [publishResult, setPublishResult] = useState<PublishStagedLeafletResult | null>(null)
  const [publishError, setPublishError] = useState<string | null>(null)

  // Custom Image URL Prompt State
  const [customUrlModalOfferId, setCustomUrlModalOfferId] = useState<string | null>(null)
  const [customUrlInput, setCustomUrlInput] = useState<string>('')
  const [customUrlError, setCustomUrlError] = useState<string | null>(null)

  // Metadata completion modal state
  const [isMetadataModalOpen, setIsMetadataModalOpen] = useState<boolean>(false)
  const [metadataMissingFields, setMetadataMissingFields] = useState<Array<'supermarket' | 'region' | 'validFrom' | 'validTo'>>([])
  const [metadataValidationWarnings, setMetadataValidationWarnings] = useState<string[]>([])

  // Load draft from disk if not provided
  useEffect(() => {
    if (!initialDraft) {
      loadDraftFromDisk()
    }
  }, [jobDir])

  const loadDraftFromDisk = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.wifranExtractor.productEnrichment.loadDraft(jobDir)
      if (res) {
        setDraft(res)
      } else {
        setError('No staged draft found for this workspace.')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load staged draft.')
    } finally {
      setLoading(false)
    }
  }

  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 5000)
  }

  // Header update handler
  const handleHeaderChange = async (field: 'supermarketId' | 'region' | 'validFrom' | 'validTo', value: string) => {
    if (!draft) return
    try {
      const updated = await window.wifranExtractor.productEnrichment.updateHeader(jobDir, {
        [field]: value || null
      })
      setDraft(updated)
      showToast(`Header ${field} updated.`)
    } catch (err: any) {
      setError(err.message || 'Failed to update header')
    }
  }

  // Step 1: Export CSV handler
  const handleExportStep1 = async () => {
    if (!draft) return
    setExporting(true)
    setError(null)
    try {
      const res = await window.wifranExtractor.productEnrichment.exportStep1Csv(jobDir)
      setDraft(res.draft)

      // Prompt user to save file
      const saveRes = await window.wifranExtractor.productEnrichment.saveCsvDialog({
        defaultFileName: `wifran_step1_export_${draft.leafletHash || 'draft'}.csv`,
        csvContent: res.csvContent
      })

      if (!saveRes.canceled) {
        showToast(`Step 1 CSV exported successfully (${res.exportableCount} net-new items)!`)
      }
    } catch (err: any) {
      setError(err.message || 'Failed to export Step 1 CSV')
    } finally {
      setExporting(false)
    }
  }

  // Header completeness & publish gating
  const isHeaderComplete = useMemo(() => {
    if (!draft) return false
    const h = draft.header
    return Boolean(
      h.supermarketId?.trim() &&
      h.region?.trim() &&
      h.validFrom?.trim() &&
      h.validTo?.trim() &&
      new Date(h.validTo).getTime() >= new Date(h.validFrom).getTime()
    )
  }, [draft])

  const canPublish = isHeaderComplete && operatorConfirmedPublish && !publishing && draft?.status !== 'published'

  // Publish to DB handler
  const handlePublishToDb = async () => {
    if (!canPublish || !draft) return
    setPublishing(true)
    setPublishError(null)
    try {
      onPublishStarted?.()
      const res = await window.wifranExtractor.productEnrichment.publishStagedDraft(jobDir, {
        operatorConfirmedPublish: true
      })
      if (!res.ok) {
        setPublishError(res.errors?.join(' ') || 'Publishing failed.')
      } else {
        setPublishResult(res)
        setDraft(prev => (prev ? { ...prev, status: 'published', publishedAt: new Date().toISOString() } : null))
        showToast(`Successfully published ${res.offersPublishedCount} offers to database!`)
      }
    } catch (err: any) {
      setPublishError(err.message || 'Failed to publish draft to database.')
    } finally {
      setPublishing(false)
    }
  }

  // Step 2: Import CSV handler via file dialog
  const handleSelectCsvToImport = async () => {
    setImportError(null)
    try {
      const dialogRes = await window.wifranExtractor.productEnrichment.selectCsvDialog()
      if (dialogRes.canceled || !dialogRes.content) return
      await processImportCsvContent(dialogRes.content)
    } catch (err: any) {
      setImportError(err.message || 'Failed to select CSV file')
    }
  }

  // Dropzone handler
  const handleDropCsv = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async (evt) => {
      const content = (evt.target?.result as string) || ''
      await processImportCsvContent(content)
    }
    reader.onerror = () => setImportError('Failed to read dropped file.')
    reader.readAsText(file)
  }

  const processImportCsvContent = async (csvContent: string) => {
    setImporting(true)
    setImportError(null)
    try {
      const res = await window.wifranExtractor.productEnrichment.importStep2Csv(jobDir, csvContent)
      setDraft(res.draft)
      showToast(
        `Imported Step 2 CSV: ${res.matchedOffersCount} offers matched, ${res.aiCorrectedCount} AI corrections, ${res.candidateImagesDownloadedCount} images staged.`
      )
      // Always open MetadataCompletionModal after Step 2 CSV import so the operator can confirm or correct leaflet metadata
      setMetadataMissingFields(res.missingFields || [])
      setMetadataValidationWarnings(res.validationWarnings || [])
      setIsMetadataModalOpen(true)
    } catch (err: any) {
      setImportError(err.message || 'Failed to import Step 2 CSV')
    } finally {
      setImporting(false)
    }
  }

  // Field Edit Handler
  const handleFieldChange = async (offerId: string, field: string, value: any) => {
    try {
      const updated = await window.wifranExtractor.productEnrichment.updateOfferField(jobDir, offerId, {
        [field]: value
      })
      setDraft(updated)
    } catch (err: any) {
      setError(err.message || `Failed to update field ${field}`)
    }
  }

  // Revert Single Field
  const handleRevertField = async (offerId: string, fieldName: string) => {
    try {
      const updated = await window.wifranExtractor.productEnrichment.revertOfferField(jobDir, offerId, fieldName)
      setDraft(updated)
      showToast(`Field ${fieldName} reverted to original/AI snapshot.`)
    } catch (err: any) {
      setError(err.message || 'Failed to revert field')
    }
  }

  // Revert All Fields on Card
  const handleRevertAllFields = async (offerId: string) => {
    try {
      const updated = await window.wifranExtractor.productEnrichment.revertOfferField(jobDir, offerId)
      setDraft(updated)
      showToast('All operator edits on this item were reverted.')
    } catch (err: any) {
      setError(err.message || 'Failed to revert item')
    }
  }

  // Image Replacement Handler
  const handleImageSwap = async (
    offerId: string,
    mode: 'existing_db' | 'candidate' | 'custom_local' | 'custom_url' | 'none',
    customUrl?: string,
    localPath?: string
  ) => {
    try {
      const updated = await window.wifranExtractor.productEnrichment.replaceConsumerImage(jobDir, offerId, {
        mode,
        customUrl,
        localFilePath: localPath
      })
      setDraft(updated)
      showToast(`Consumer image source updated to ${mode}.`)
    } catch (err: any) {
      setError(err.message || 'Failed to update consumer image')
    }
  }

  // Pick Custom Local File
  const handlePickLocalImage = async (offerId: string) => {
    try {
      const res = await window.wifranExtractor.productEnrichment.selectImageDialog()
      if (res.canceled || !res.filePath) return
      await handleImageSwap(offerId, 'custom_local', undefined, res.filePath)
    } catch (err: any) {
      setError(err.message || 'Failed to pick local image')
    }
  }

  // Filter & Counts Calculations
  const counts = useMemo(() => {
    if (!draft) return { total: 0, operatorEdited: 0, aiCorrected: 0, reMatched: 0, imageIssues: 0, alreadyImaged: 0, pCount: 0, oCount: 0 }
    let operatorEdited = 0
    let aiCorrected = 0
    let reMatched = 0
    let imageIssues = 0
    let alreadyImaged = 0
    let pCount = 0
    let oCount = 0

    const seenP = new Set<number>()
    const seenO = new Set<string>()

    for (const item of draft.items) {
      if (item.isOperatorModified) operatorEdited++
      if (item.isAiCorrected) aiCorrected++
      if (item.postCorrectionDbMatch) reMatched++

      const hasDisplayImg = Boolean(
        item.selectedImageSource === 'existing_db'
          ? item.existingDbImageUrl
          : item.selectedImageSource === 'candidate'
            ? item.candidateImageLocalPath
            : item.selectedImageSource === 'custom_local'
              ? item.customImageLocalPath
              : item.selectedImageSource === 'custom_url'
                ? item.customImageUrl || item.customImageLocalPath
                : false
      )

      if (item.candidateDownloadError || (!hasDisplayImg && item.selectedImageSource === 'none')) {
        imageIssues++
      }

      if (item.selectedImageSource === 'existing_db' && !item.postCorrectionDbMatch) {
        alreadyImaged++
      } else if (item.matchedProductId != null) {
        if (!seenP.has(item.matchedProductId)) {
          seenP.add(item.matchedProductId)
          pCount++
        }
      } else if (item.imageRef) {
        if (!seenO.has(item.imageRef)) {
          seenO.add(item.imageRef)
          oCount++
        }
      }
    }

    return {
      total: draft.items.length,
      operatorEdited,
      aiCorrected,
      reMatched,
      imageIssues,
      alreadyImaged,
      pCount,
      oCount
    }
  }, [draft])

  const filteredItems = useMemo(() => {
    if (!draft) return []
    return draft.items.filter((item) => {
      if (activeFilter === 'operator_edited') return item.isOperatorModified === true
      if (activeFilter === 'ai_corrected') return item.isAiCorrected === true
      if (activeFilter === 're_matched') return item.postCorrectionDbMatch != null
      if (activeFilter === 'image_issues') {
        const hasDisplayImg = Boolean(
          item.selectedImageSource === 'existing_db'
            ? item.existingDbImageUrl
            : item.selectedImageSource === 'candidate'
              ? item.candidateImageLocalPath
              : item.selectedImageSource === 'custom_local'
                ? item.customImageLocalPath
                : item.selectedImageSource === 'custom_url'
                  ? item.customImageUrl || item.customImageLocalPath
                  : false
        )
        return item.candidateDownloadError != null || !hasDisplayImg || item.selectedImageSource === 'none'
      }
      return true
    })
  }, [draft, activeFilter])

  if (loading) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
        <p>Loading staged draft...</p>
      </div>
    )
  }

  if (error && !draft) {
    return (
      <div style={{ padding: '24px', backgroundColor: '#fef2f2', border: '1px solid #f87171', borderRadius: '8px', color: '#991b1b' }}>
        <h3>Failed to Load Staging Workspace</h3>
        <p>{error}</p>
        {onClose && (
          <button className="btn btn-secondary" onClick={onClose} style={{ marginTop: '12px' }}>
            Close
          </button>
        )}
      </div>
    )
  }

  if (!draft) return <div />

  return (
    <div className="staged-preview-container" style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' }}>
      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            backgroundColor: '#0f172a',
            color: '#f8fafc',
            padding: '12px 20px',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            fontSize: '0.9rem'
          }}
        >
          <span>{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1.1rem' }}
          >
            ×
          </button>
        </div>
      )}

      {/* Top Banner / Actions Bar */}
      <div
        className="card"
        style={{
          padding: '16px 20px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px solid var(--border-color)'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#0f172a', fontWeight: 600 }}>
            Unified Staging Workspace
          </h2>
          <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
            Local-First, Single-Publish Image Enrichment & Review (No Database Writes until Final Publish)
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {/* Step 1 Export Button */}
          <button
            className="btn btn-secondary"
            onClick={handleExportStep1}
            disabled={exporting}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            {exporting ? 'Exporting...' : 'Export Step 1 CSV'}
          </button>

          {/* Step 2 Import Dropzone / Button */}
          <button
            className="btn btn-secondary"
            onClick={handleSelectCsvToImport}
            disabled={importing || publishing}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            {importing ? 'Importing...' : 'Import Step 2 CSV'}
          </button>

          {/* Operator Confirmation Checkbox */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.8rem',
              color: '#334155',
              cursor: 'pointer',
              userSelect: 'none'
            }}
          >
            <input
              type="checkbox"
              id="operator-confirm-publish-checkbox"
              data-testid="operator-confirm-publish-checkbox"
              checked={operatorConfirmedPublish}
              onChange={(e) => setOperatorConfirmedPublish(e.target.checked)}
              disabled={publishing || draft.status === 'published'}
            />
            <span>Confirm Operator Review</span>
          </label>

          {/* Publish to DB Action Button */}
          <button
            id="staged-publish-db-btn"
            data-testid="staged-publish-db-btn"
            className="btn btn-primary"
            onClick={handlePublishToDb}
            disabled={!canPublish}
            style={{
              backgroundColor: draft.status === 'published' ? '#6b7280' : canPublish ? '#059669' : '#9ca3af',
              borderColor: draft.status === 'published' ? '#6b7280' : canPublish ? '#059669' : '#9ca3af',
              color: '#ffffff',
              fontWeight: 600,
              cursor: canPublish ? 'pointer' : 'not-allowed'
            }}
            title={
              draft.status === 'published'
                ? 'Leaflet has already been published to Supabase'
                : !isHeaderComplete
                  ? 'Please complete all header fields (Supermarket, Region, Valid Dates) first'
                  : !operatorConfirmedPublish
                    ? 'Please check the confirmation box to authorize database publish'
                    : 'Publish all approved items and images atomically to Supabase'
            }
          >
            {publishing
              ? 'Publishing Leaflet & Images to DB...'
              : draft.status === 'published'
                ? 'Published ✓'
                : 'Publish to DB'}
          </button>

          {onClose && (
            <button className="btn btn-secondary" onClick={onClose}>
              Back
            </button>
          )}
        </div>
      </div>

      {/* Published Summary Banner */}
      {publishResult && (
        <div
          role="status"
          data-testid="published-summary-banner"
          style={{
            backgroundColor: '#ecfdf5',
            border: '2px solid #059669',
            borderRadius: '8px',
            padding: '16px 20px',
            color: '#065f46'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '1.25rem' }}>🎉</span>
            <strong style={{ fontSize: '1rem', color: '#047857' }}>
              Leaflet Published to Database Successfully!
            </strong>
            <span style={{ fontSize: '0.8rem', color: '#065f46' }}>
              (Leaflet ID: <code>{publishResult.leafletId}</code>)
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: '12px',
              fontSize: '0.85rem',
              marginTop: '12px'
            }}
          >
            <div style={{ padding: '8px', backgroundColor: '#ffffff', borderRadius: '6px', textAlign: 'center', border: '1px solid #a7f3d0' }}>
              <div style={{ color: '#065f46', fontSize: '0.75rem' }}>Offers Published</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#047857' }}>
                {publishResult.offersPublishedCount}
              </div>
            </div>

            <div style={{ padding: '8px', backgroundColor: '#ffffff', borderRadius: '6px', textAlign: 'center', border: '1px solid #a7f3d0' }}>
              <div style={{ color: '#065f46', fontSize: '0.75rem' }}>Product Images Uploaded</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#047857' }}>
                {publishResult.productImagesUploadedCount}
              </div>
            </div>

            <div style={{ padding: '8px', backgroundColor: '#ffffff', borderRadius: '6px', textAlign: 'center', border: '1px solid #a7f3d0' }}>
              <div style={{ color: '#065f46', fontSize: '0.75rem' }}>Offer Display Images</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#047857' }}>
                {publishResult.offerDisplayImagesUploadedCount}
              </div>
            </div>

            <div style={{ padding: '8px', backgroundColor: '#ffffff', borderRadius: '6px', textAlign: 'center', border: '1px solid #a7f3d0' }}>
              <div style={{ color: '#065f46', fontSize: '0.75rem' }}>Reused Existing Images</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#047857' }}>
                {publishResult.reusedExistingDbImagesCount}
              </div>
            </div>

            <div style={{ padding: '8px', backgroundColor: '#ffffff', borderRadius: '6px', textAlign: 'center', border: '1px solid #a7f3d0' }}>
              <div style={{ color: '#065f46', fontSize: '0.75rem' }}>Aliases Learned</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#047857' }}>
                {publishResult.aliasesLearnedCount}
              </div>
            </div>

            <div style={{ padding: '8px', backgroundColor: '#ffffff', borderRadius: '6px', textAlign: 'center', border: '1px solid #a7f3d0' }}>
              <div style={{ color: '#065f46', fontSize: '0.75rem' }}>Purged Short Refs</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#047857' }}>
                {publishResult.purgedShortRefsCount}
              </div>
            </div>
          </div>
        </div>
      )}

      {publishError && (
        <div style={{ padding: '12px 16px', backgroundColor: '#fef2f2', border: '1px solid #f87171', borderRadius: '6px', color: '#991b1b', fontSize: '0.9rem' }}>
          <strong>Publish Error:</strong> {publishError}
        </div>
      )}

      {/* Status Bar */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '12px'
        }}
      >
        <div className="card" style={{ padding: '12px 16px', textAlign: 'center', backgroundColor: '#f8fafc' }}>
          <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Total Extracted Offers</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#0f172a' }}>{counts.total}</div>
        </div>

        <div className="card" style={{ padding: '12px 16px', textAlign: 'center', backgroundColor: '#f0fdf4' }}>
          <div style={{ fontSize: '0.8rem', color: '#166534' }}>Already Imaged in DB</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#15803d' }}>{counts.alreadyImaged}</div>
          <div style={{ fontSize: '0.75rem', color: '#16a34a' }}>Skipped from CSV</div>
        </div>

        <div className="card" style={{ padding: '12px 16px', textAlign: 'center', backgroundColor: '#f0f9ff' }}>
          <div style={{ fontSize: '0.8rem', color: '#0369a1' }}>Net-New CSV Candidates</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#0284c7' }}>
            {counts.pCount + counts.oCount}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#0284c7' }}>
            P: {counts.pCount} | O: {counts.oCount}
          </div>
        </div>

        {/* Dropzone Container in Header */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDropCsv}
          onClick={handleSelectCsvToImport}
          style={{
            border: '2px dashed #94a3b8',
            borderRadius: '8px',
            padding: '12px',
            textAlign: 'center',
            cursor: 'pointer',
            backgroundColor: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center'
          }}
        >
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>Drop Returned Step 2 CSV</span>
          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>or click to browse</span>
        </div>
      </div>

      {importError && (
        <div style={{ padding: '12px 16px', backgroundColor: '#fef2f2', border: '1px solid #f87171', borderRadius: '6px', color: '#991b1b', fontSize: '0.9rem' }}>
          <strong>Import Error:</strong> {importError}
        </div>
      )}

      {/* Leaflet Header Editable Bar */}
      <div
        className="card"
        style={{
          padding: '16px 20px',
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: draft.header.headerModifiedByOperator ? '1px solid #f59e0b' : '1px solid var(--border-color)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontWeight: 600, fontSize: '0.95rem', color: '#1e293b' }}>Leaflet Header Metadata</span>
            {draft.header.headerModifiedByOperator && (
              <span
                style={{
                  backgroundColor: '#fef3c7',
                  color: '#b45309',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  fontSize: '0.75rem',
                  fontWeight: 600
                }}
              >
                Header Edited
              </span>
            )}
            <button
              data-testid="edit-metadata-btn"
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setMetadataMissingFields([])
                setMetadataValidationWarnings([])
                setIsMetadataModalOpen(true)
              }}
              style={{
                fontSize: '0.75rem',
                padding: '2px 10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#f1f5f9',
                color: '#334155',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <span>✏️</span>
              <span>Edit Metadata</span>
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '0.85rem' }}>
            {draft.header.firstPagePublicUrl && (
              <a
                href={draft.header.firstPagePublicUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: '#2563eb', textDecoration: 'underline' }}
              >
                View Page 1
              </a>
            )}
            {draft.header.lastPagePublicUrl && (
              <a
                href={draft.header.lastPagePublicUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: '#2563eb', textDecoration: 'underline' }}
              >
                View Page N
              </a>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>
              Supermarket ID
            </label>
            <input
              data-testid="header-supermarket-id"
              className="form-control"
              type="text"
              value={draft.header.supermarketId || ''}
              placeholder="e.g. alwafa, danube"
              onChange={(e) => handleHeaderChange('supermarketId', e.target.value)}
              style={{ width: '100%', fontSize: '0.85rem' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>
              Region
            </label>
            <input
              data-testid="header-region"
              className="form-control"
              type="text"
              value={draft.header.region || ''}
              placeholder="e.g. Western, Central"
              onChange={(e) => handleHeaderChange('region', e.target.value)}
              style={{ width: '100%', fontSize: '0.85rem' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>
              Valid From
            </label>
            <input
              data-testid="header-valid-from"
              className="form-control"
              type="date"
              value={draft.header.validFrom || ''}
              onChange={(e) => handleHeaderChange('validFrom', e.target.value)}
              style={{ width: '100%', fontSize: '0.85rem' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>
              Valid To
            </label>
            <input
              data-testid="header-valid-to"
              className="form-control"
              type="date"
              value={draft.header.validTo || ''}
              onChange={(e) => handleHeaderChange('validTo', e.target.value)}
              style={{ width: '100%', fontSize: '0.85rem' }}
            />
          </div>
        </div>
      </div>

      {/* Global Image Mode Toggle & Filter Bar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '16px'
        }}
      >
        {/* Global Image Mode Toggle */}
        <div id="staged-image-mode-toggle" style={{ display: 'flex', backgroundColor: '#e2e8f0', borderRadius: '8px', padding: '3px' }}>
          <button
            onClick={() => setImageMode('cropped')}
            style={{
              padding: '8px 16px',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: imageMode === 'cropped' ? 600 : 400,
              backgroundColor: imageMode === 'cropped' ? '#ffffff' : 'transparent',
              color: imageMode === 'cropped' ? '#0f172a' : '#64748b',
              boxShadow: imageMode === 'cropped' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
            }}
          >
            ✂️ Cropped Leaflet Mode
          </button>
          <button
            onClick={() => setImageMode('downloaded')}
            style={{
              padding: '8px 16px',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: imageMode === 'downloaded' ? 600 : 400,
              backgroundColor: imageMode === 'downloaded' ? '#ffffff' : 'transparent',
              color: imageMode === 'downloaded' ? '#0f172a' : '#64748b',
              boxShadow: imageMode === 'downloaded' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
            }}
          >
            🖼️ Downloaded Display Mode
          </button>
        </div>

        {/* Quick Filter Bar */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            className={`btn ${activeFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.8rem', padding: '6px 12px' }}
            onClick={() => setActiveFilter('all')}
          >
            All ({counts.total})
          </button>
          <button
            className={`btn ${activeFilter === 'operator_edited' ? 'btn-primary' : 'btn-secondary'}`}
            style={{
              fontSize: '0.8rem',
              padding: '6px 12px',
              backgroundColor: activeFilter === 'operator_edited' ? '#d97706' : undefined,
              borderColor: activeFilter === 'operator_edited' ? '#d97706' : undefined
            }}
            onClick={() => setActiveFilter('operator_edited')}
          >
            Edited by You ({counts.operatorEdited})
          </button>
          <button
            className={`btn ${activeFilter === 'ai_corrected' ? 'btn-primary' : 'btn-secondary'}`}
            style={{
              fontSize: '0.8rem',
              padding: '6px 12px',
              backgroundColor: activeFilter === 'ai_corrected' ? '#0891b2' : undefined,
              borderColor: activeFilter === 'ai_corrected' ? '#0891b2' : undefined
            }}
            onClick={() => setActiveFilter('ai_corrected')}
          >
            AI Corrected ({counts.aiCorrected})
          </button>
          <button
            className={`btn ${activeFilter === 're_matched' ? 'btn-primary' : 'btn-secondary'}`}
            style={{
              fontSize: '0.8rem',
              padding: '6px 12px',
              backgroundColor: activeFilter === 're_matched' ? '#059669' : undefined,
              borderColor: activeFilter === 're_matched' ? '#059669' : undefined
            }}
            onClick={() => setActiveFilter('re_matched')}
          >
            Catalog Re-Matched ({counts.reMatched})
          </button>
          <button
            className={`btn ${activeFilter === 'image_issues' ? 'btn-primary' : 'btn-secondary'}`}
            style={{
              fontSize: '0.8rem',
              padding: '6px 12px',
              backgroundColor: activeFilter === 'image_issues' ? '#e11d48' : undefined,
              borderColor: activeFilter === 'image_issues' ? '#e11d48' : undefined
            }}
            onClick={() => setActiveFilter('image_issues')}
          >
            Image Failed / Missing ({counts.imageIssues})
          </button>
        </div>
      </div>

      {/* Staged Offer Cards List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {filteredItems.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8', backgroundColor: '#ffffff', borderRadius: '8px' }}>
            No offers match the selected filter.
          </div>
        ) : (
          filteredItems.map((item) => (
            <OfferCard
              key={item.id}
              item={item}
              imageMode={imageMode}
              onFieldChange={(field, val) => handleFieldChange(item.id, field, val)}
              onRevertField={(field) => handleRevertField(item.id, field)}
              onRevertAll={() => handleRevertAllFields(item.id)}
              onImageSwap={(mode, customUrl, localPath) => handleImageSwap(item.id, mode, customUrl, localPath)}
              onPickLocalImage={() => handlePickLocalImage(item.id)}
              onOpenCustomUrlModal={() => {
                setCustomUrlModalOfferId(item.id)
                setCustomUrlInput(item.customImageUrl || '')
                setCustomUrlError(null)
              }}
            />
          ))
        )}
      </div>

      {/* Custom URL Popover Modal */}
      {customUrlModalOfferId && (
        <div
          role="dialog"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000
          }}
        >
          <div className="card" style={{ width: '480px', padding: '24px', backgroundColor: '#ffffff', borderRadius: '8px' }}>
            <h3 style={{ margin: '0 0 12px 0' }}>Paste Custom Image URL</h3>
            <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '16px' }}>
              Enter an HTTPS image URL. The image will be validated locally and downloaded into <code>staged-candidate-images/</code>.
            </p>
            <input
              type="text"
              className="form-control"
              placeholder="https://example.com/image.webp"
              value={customUrlInput}
              onChange={(e) => setCustomUrlInput(e.target.value)}
              style={{ width: '100%', marginBottom: '12px' }}
            />
            {customUrlError && (
              <p style={{ color: '#dc2626', fontSize: '0.8rem', marginBottom: '12px' }}>{customUrlError}</p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="btn btn-secondary" onClick={() => setCustomUrlModalOfferId(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  if (!customUrlInput.trim()) return
                  try {
                    await handleImageSwap(customUrlModalOfferId, 'custom_url', customUrlInput.trim())
                    setCustomUrlModalOfferId(null)
                  } catch (err: any) {
                    setCustomUrlError(err.message || 'Failed to download image URL')
                  }
                }}
              >
                Download & Set Image
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Metadata Completion Modal */}
      {isMetadataModalOpen && draft && (
        <MetadataCompletionModal
          jobDir={jobDir}
          currentHeader={draft.header}
          missingFields={metadataMissingFields}
          validationWarnings={metadataValidationWarnings}
          onClose={() => setIsMetadataModalOpen(false)}
          onSave={(updatedDraft) => {
            setDraft(updatedDraft)
            setMetadataMissingFields([])
            setMetadataValidationWarnings([])
            showToast('Leaflet header metadata saved successfully!')
          }}
        />
      )}
    </div>
  )
}

// -------------------------------------------------------------
// Individual Staged Offer Card Component
// -------------------------------------------------------------
interface OfferCardProps {
  item: StagedOfferItem
  imageMode: 'cropped' | 'downloaded'
  onFieldChange: (field: string, val: any) => void
  onRevertField: (field: string) => void
  onRevertAll: () => void
  onImageSwap: (mode: 'existing_db' | 'candidate' | 'custom_local' | 'custom_url' | 'none', customUrl?: string, localPath?: string) => void
  onPickLocalImage: () => void
  onOpenCustomUrlModal: () => void
}

function OfferCard({
  item,
  imageMode,
  onFieldChange,
  onRevertField,
  onRevertAll,
  onImageSwap,
  onPickLocalImage,
  onOpenCustomUrlModal
}: OfferCardProps): JSX.Element {
  // Determine card border styling (3-tier hierarchy)
  const cardBorderStyle = item.isOperatorModified
    ? '2px solid #f59e0b' // Tier 1: Amber
    : item.isAiCorrected
      ? '2px solid #06b6d4' // Tier 2: Cyan
      : '1px solid var(--border-color)'

  // Resolved Consumer Display Image
  const resolvedDisplayUrl =
    item.selectedImageSource === 'existing_db'
      ? item.existingDbImageUrl
      : item.selectedImageSource === 'candidate'
        ? item.candidateImageLocalPath
        : item.selectedImageSource === 'custom_local'
          ? item.customImageLocalPath
          : item.selectedImageSource === 'custom_url'
            ? item.customImageUrl || item.customImageLocalPath
            : null

  const isFieldEdited = (fieldName: string) => item.operatorEditedFields.includes(fieldName)
  const isFieldAiCorrected = (fieldName: string) => Boolean(item.aiCorrected && (item.aiCorrected as any)[fieldName])

  return (
    <div
      className="card offer-card"
      data-testid={`offer-card-${item.id}`}
      style={{
        padding: '16px 20px',
        borderRadius: '8px',
        backgroundColor: '#ffffff',
        border: cardBorderStyle,
        boxShadow: item.isOperatorModified ? '0 2px 8px rgba(245, 158, 11, 0.15)' : 'none'
      }}
    >
      {/* Header Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
          borderBottom: '1px solid #f1f5f9',
          paddingBottom: '8px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Reference badge */}
          <span
            style={{
              backgroundColor: '#1e293b',
              color: '#f8fafc',
              padding: '2px 8px',
              borderRadius: '4px',
              fontWeight: 700,
              fontSize: '0.85rem'
            }}
          >
            {item.imageRef || `P${item.matchedProductId}` || item.id}
          </span>

          {item.isRepresentative && (
            <span
              style={{
                backgroundColor: '#e0e7ff',
                color: '#3730a3',
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '0.75rem',
                fontWeight: 600
              }}
            >
              Visual Rep ({item.visualGroupMemberIds?.length || 1} items)
            </span>
          )}

          {item.representativeOfferId && (
            <span
              style={{
                backgroundColor: '#f1f5f9',
                color: '#475569',
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '0.75rem'
              }}
            >
              Group Member
            </span>
          )}

          {/* Tier 1 Badge: Operator Modified */}
          {item.isOperatorModified && (
            <span
              style={{
                backgroundColor: '#fef3c7',
                color: '#b45309',
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '0.75rem',
                fontWeight: 600
              }}
            >
              Edited by You
            </span>
          )}

          {/* Tier 2 Badge: AI Corrected */}
          {item.isAiCorrected && (
            <span
              style={{
                backgroundColor: '#cffafe',
                color: '#0e7490',
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '0.75rem',
                fontWeight: 600
              }}
            >
              AI Corrected
            </span>
          )}

          {/* Tier 3 Badge: Download Error or Missing Image */}
          {item.candidateDownloadError && (
            <span
              style={{
                backgroundColor: '#ffe4e6',
                color: '#e11d48',
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '0.75rem',
                fontWeight: 600
              }}
            >
              Image Failed
            </span>
          )}

          {imageMode === 'downloaded' && !resolvedDisplayUrl && item.selectedImageSource === 'none' && (
            <span
              style={{
                backgroundColor: '#f1f5f9',
                color: '#64748b',
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '0.75rem'
              }}
            >
              No Display Image
            </span>
          )}
        </div>

        {/* Revert All Button */}
        {item.isOperatorModified && (
          <button
            className="btn btn-secondary"
            style={{ fontSize: '0.75rem', padding: '3px 8px' }}
            onClick={onRevertAll}
            title="Revert all operator edits on this offer back to AI / OCR snapshot"
          >
            Revert All Edits
          </button>
        )}
      </div>

      {/* Post-Correction DB Match Banner */}
      {item.postCorrectionDbMatch && (
        <div
          style={{
            backgroundColor: '#ecfdf5',
            border: '1px solid #a7f3d0',
            borderRadius: '6px',
            padding: '10px 14px',
            marginBottom: '12px',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <div>
            <div style={{ fontWeight: 600, color: '#065f46', fontSize: '0.85rem' }}>
              🔗 Catalog Match Found: P{item.postCorrectionDbMatch.productId} ({item.postCorrectionDbMatch.productTitleEn || 'Product'})
            </div>
            <div style={{ fontSize: '0.75rem', color: '#047857' }}>
              AI-corrected text matched an existing catalog product with an approved image.
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="btn"
              style={{
                fontSize: '0.75rem',
                padding: '4px 8px',
                backgroundColor: item.selectedImageSource === 'existing_db' ? '#059669' : '#ffffff',
                color: item.selectedImageSource === 'existing_db' ? '#ffffff' : '#065f46',
                border: '1px solid #059669'
              }}
              onClick={() => onImageSwap('existing_db')}
            >
              Use Existing DB Image
            </button>
            <button
              className="btn"
              style={{
                fontSize: '0.75rem',
                padding: '4px 8px',
                backgroundColor: item.selectedImageSource === 'candidate' ? '#0284c7' : '#ffffff',
                color: item.selectedImageSource === 'candidate' ? '#ffffff' : '#0284c7',
                border: '1px solid #0284c7'
              }}
              onClick={() => onImageSwap('candidate')}
            >
              Use Step 2 Candidate Image
            </button>
          </div>
        </div>
      )}

      {/* Card Content Grid (Image on Left, Editable Fields on Right) */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px' }}>
        {/* Image Preview & Controls Column */}
        <div style={{ flex: '0 0 240px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div
            style={{
              width: '240px',
              height: '240px',
              borderRadius: '6px',
              border: '1px solid #e2e8f0',
              overflow: 'hidden',
              backgroundColor: '#f8fafc',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative'
            }}
          >
            {imageMode === 'cropped' ? (
              item.croppedEvidenceLocalPath ? (
                <img
                  src={item.croppedEvidenceLocalPath}
                  alt="Cropped Evidence"
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                />
              ) : (
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>No Crop Path</span>
              )
            ) : resolvedDisplayUrl ? (
              <img
                src={resolvedDisplayUrl}
                alt="Consumer Display"
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: '12px', color: '#94a3b8' }}>
                <span style={{ fontSize: '1.8rem', display: 'block', marginBottom: '4px' }}>🖼️</span>
                <span style={{ fontSize: '0.75rem' }}>No Consumer Image</span>
                {item.candidateDownloadError && (
                  <span style={{ display: 'block', color: '#e11d48', fontSize: '0.7rem', marginTop: '4px' }}>
                    {item.candidateDownloadError}
                  </span>
                )}
              </div>
            )}

            {/* Mode watermark badge */}
            <span
              style={{
                position: 'absolute',
                top: '6px',
                left: '6px',
                backgroundColor: 'rgba(15, 23, 42, 0.75)',
                color: '#ffffff',
                padding: '2px 6px',
                borderRadius: '4px',
                fontSize: '0.65rem'
              }}
            >
              {imageMode === 'cropped' ? 'Leaflet Crop' : `Source: ${item.selectedImageSource}`}
            </span>
          </div>

          {/* Consumer Image Source Actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                className="btn btn-secondary"
                style={{ flex: 1, fontSize: '0.7rem', padding: '4px' }}
                onClick={onPickLocalImage}
                title="Choose a local image file"
              >
                Local File...
              </button>
              <button
                className="btn btn-secondary"
                style={{ flex: 1, fontSize: '0.7rem', padding: '4px' }}
                onClick={onOpenCustomUrlModal}
                title="Paste a custom image URL"
              >
                Paste URL...
              </button>
              <button
                className="btn btn-secondary"
                style={{ fontSize: '0.7rem', padding: '4px 8px' }}
                onClick={() => onImageSwap('none')}
                title="Clear image (NULL)"
              >
                Clear
              </button>
            </div>

            {/* Quick Toggle Between Existing DB & Candidate (if both exist) */}
            {item.existingDbImageUrl && item.candidateImageLocalPath && !item.postCorrectionDbMatch && (
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  className="btn"
                  style={{
                    flex: 1,
                    fontSize: '0.65rem',
                    padding: '3px',
                    backgroundColor: item.selectedImageSource === 'existing_db' ? '#059669' : '#ffffff',
                    color: item.selectedImageSource === 'existing_db' ? '#ffffff' : '#065f46',
                    border: '1px solid #059669'
                  }}
                  onClick={() => onImageSwap('existing_db')}
                >
                  Existing DB
                </button>
                <button
                  className="btn"
                  style={{
                    flex: 1,
                    fontSize: '0.65rem',
                    padding: '3px',
                    backgroundColor: item.selectedImageSource === 'candidate' ? '#0284c7' : '#ffffff',
                    color: item.selectedImageSource === 'candidate' ? '#ffffff' : '#0284c7',
                    border: '1px solid #0284c7'
                  }}
                  onClick={() => onImageSwap('candidate')}
                >
                  Step 2 Candidate
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Editable Fields Grid Column */}
        <div style={{ flex: '1 1 500px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {/* Title AR */}
            <EditableField
              label="Title AR (العنوان)"
              dir="rtl"
              value={item.titleAr || ''}
              isEdited={isFieldEdited('titleAr')}
              isAiCorrected={isFieldAiCorrected('titleAr')}
              originalValue={item.originalOcr.titleAr}
              onChange={(val) => onFieldChange('titleAr', val)}
              onRevert={() => onRevertField('titleAr')}
            />

            {/* Title EN */}
            <EditableField
              label="Title EN"
              value={item.titleEn || ''}
              isEdited={isFieldEdited('titleEn')}
              isAiCorrected={isFieldAiCorrected('titleEn')}
              originalValue={item.originalOcr.titleEn}
              onChange={(val) => onFieldChange('titleEn', val)}
              onRevert={() => onRevertField('titleEn')}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {/* Brand */}
            <EditableField
              label="Brand"
              value={item.brand || ''}
              isEdited={isFieldEdited('brand')}
              isAiCorrected={isFieldAiCorrected('brand')}
              originalValue={item.originalOcr.brand}
              onChange={(val) => onFieldChange('brand', val)}
              onRevert={() => onRevertField('brand')}
            />

            {/* Size / Weight */}
            <EditableField
              label="Size / Weight"
              value={item.sizeOrWeight || ''}
              isEdited={isFieldEdited('sizeOrWeight')}
              isAiCorrected={isFieldAiCorrected('sizeOrWeight')}
              originalValue={item.originalOcr.sizeOrWeight}
              onChange={(val) => onFieldChange('sizeOrWeight', val)}
              onRevert={() => onRevertField('sizeOrWeight')}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px' }}>
            {/* Price Before */}
            <EditableField
              label="Price Before"
              type="number"
              step="0.01"
              value={item.priceBefore ?? ''}
              isEdited={isFieldEdited('priceBefore')}
              originalValue={item.originalOcr.priceBefore}
              onChange={(val) => onFieldChange('priceBefore', val !== '' ? parseFloat(val) : null)}
              onRevert={() => onRevertField('priceBefore')}
            />

            {/* Price After */}
            <EditableField
              label="Price After"
              type="number"
              step="0.01"
              value={item.priceAfter ?? ''}
              isEdited={isFieldEdited('priceAfter')}
              originalValue={item.originalOcr.priceAfter}
              onChange={(val) => onFieldChange('priceAfter', val !== '' ? parseFloat(val) : null)}
              onRevert={() => onRevertField('priceAfter')}
            />

            {/* Discount % (Recalculated automatically) */}
            <EditableField
              label="Discount %"
              type="number"
              value={item.discountPercent ?? ''}
              isEdited={isFieldEdited('discountPercent')}
              originalValue={item.originalOcr.discountPercent}
              onChange={(val) => onFieldChange('discountPercent', val !== '' ? parseInt(val, 10) : null)}
              onRevert={() => onRevertField('discountPercent')}
            />

            {/* Promo Notes */}
            <EditableField
              label="Promo Notes"
              value={item.promoNotes || ''}
              isEdited={isFieldEdited('promoNotes')}
              originalValue={item.originalOcr.promoNotes}
              onChange={(val) => onFieldChange('promoNotes', val)}
              onRevert={() => onRevertField('promoNotes')}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// -------------------------------------------------------------
// Editable Field Input with 1-Click Revert & AI Tooltip Subtext
// -------------------------------------------------------------
interface EditableFieldProps {
  label: string
  value: string | number
  type?: 'text' | 'number'
  step?: string
  dir?: 'ltr' | 'rtl'
  isEdited: boolean
  isAiCorrected?: boolean
  originalValue?: string | number | null
  onChange: (val: string) => void
  onRevert: () => void
}

function EditableField({
  label,
  value,
  type = 'text',
  step,
  dir = 'ltr',
  isEdited,
  isAiCorrected = false,
  originalValue,
  onChange,
  onRevert
}: EditableFieldProps): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <label style={{ fontSize: '0.75rem', color: isEdited ? '#b45309' : '#64748b', fontWeight: isEdited ? 600 : 400 }}>
          {label}
        </label>
        {isEdited && (
          <button
            onClick={onRevert}
            style={{
              border: 'none',
              background: 'none',
              color: '#d97706',
              cursor: 'pointer',
              fontSize: '0.75rem',
              fontWeight: 700,
              padding: '0 2px'
            }}
            title="Revert field to original/AI snapshot (↺)"
          >
            ↺ Revert
          </button>
        )}
      </div>

      <input
        aria-label={label}
        data-testid={`input-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
        type={type}
        step={step}
        dir={dir}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          fontSize: '0.85rem',
          padding: '6px 8px',
          borderRadius: '4px',
          border: isEdited ? '1px solid #f59e0b' : isAiCorrected ? '1px solid #06b6d4' : '1px solid #cbd5e1',
          backgroundColor: isEdited ? '#fffbeb' : '#ffffff',
          color: '#0f172a'
        }}
      />

      {/* AI Corrected indicator with Original OCR subtext */}
      {isAiCorrected && !isEdited && (
        <span
          style={{
            fontSize: '0.7rem',
            color: '#0891b2',
            marginTop: '1px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
          title={`Original OCR: ${originalValue || 'Empty'}`}
        >
          Orig OCR: {originalValue || '(empty)'}
        </span>
      )}
    </div>
  )
}
