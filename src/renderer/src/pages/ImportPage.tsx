import { useMemo, useState, useEffect } from 'react'
import { PageHeader } from '../components/PageHeader'
import { useReferenceData } from '../hooks/useReferenceData'
import { StatusBadge } from '../components/StatusBadge'
import { FormField } from '../components/FormField'
import { ValidationSummary } from '../components/ValidationSummary'
import { usePipelineContext } from '../context/PipelineContext'
import { usePipelineSummary } from '../hooks/usePipelineSummary'
import { ProgressTimeline } from '../components/ProgressTimeline'
import { OcrProgressBar } from '../components/OcrProgressBar'
import { buildLeafletId } from '../../../shared/utils/leafletId'

import { ManualCropEditor } from '../components/manual-crop/ManualCropEditor'
import { PreDbReviewSummary } from '../components/review/PreDbReviewSummary'
import { PrePublishPreview } from '../components/prepublish/PrePublishPreview'
import { PreviousExtractionsView } from '../components/extraction/PreviousExtractionsView'
import { ExtractionManifest, ExtractionPackageValidationResult } from '../../../shared/types/extractionManifest'

export function ImportPage(): JSX.Element {
  const [showManualCropEditor, setShowManualCropEditor] = useState(false)
  const [loadedManifest, setLoadedManifest] = useState<ExtractionManifest | null>(null)
  const [packageValidation, setPackageValidation] = useState<ExtractionPackageValidationResult | null>(null)
  const [showPreviousExtractions, setShowPreviousExtractions] = useState(false)
  const [previewWorkspacePath, setPreviewWorkspacePath] = useState<string | null>(null)
  const [previewOrigin, setPreviewOrigin] = useState<'import' | 'previous_extractions'>('import')
  const [showPrePublishPreview, setShowPrePublishPreview] = useState(false)
  const [selectedPageNumber, setSelectedPageNumber] = useState<number>(1)
  const [quickTestPageNumber, setQuickTestPageNumber] = useState<number>(1)
  const [quickTestMaxOffers, setQuickTestMaxOffers] = useState<number>(2)

  const { data, loading, error } = useReferenceData()
  
  const ctx = usePipelineContext()
  const summary = usePipelineSummary()
  
  const { 
    formState, 
    validation, 
    setSupermarketId, 
    setLocation, 
    setOfferStartDate, 
    setOfferEndDate, 
    selectPdf, 
    setPdfFile,
    canStart,
    configStatus
  } = ctx.importForm

  const {
    running: streamingRunning,
    state: streamingState,
    pages: streamingPages,
    firstPageReady,
    latestEvent: streamingLatestEvent,
    error: streamingError,
    startRender: startStreamingRender
  } = ctx.streamingPdfRender

  const {
    running: ocrRunning,
    result: ocrResult,
    error: ocrError,
    runSingleChunkTest
  } = ctx.ocrTest

  const {
    running: pipelineRunning,
    latestProgress: pipelineProgress,
    result: pipelineResult,
    error: pipelineError,
    runPipeline
  } = ctx.ocrPipeline

  const {
    running: cropRunning,
    latestProgress: cropProgress,
    result: cropResult,
    error: cropError,
    cropRows
  } = ctx.imageCropping

  const {
    saving: dbSaving,
    result: dbResult,
    error: dbError,
    persist: dbPersist
  } = ctx.importTracking

  const {
    running: matchRunning,
    result: matchResult,
    error: matchError,
    matchRows
  } = ctx.entityMatching

  const {
    running: prepRunning,
    result: prepResult,
    error: prepError,
    prepareOffers
  } = ctx.offerPreparation

  const {
    running: syncRunning,
    result: syncResult,
    error: syncError,
    latestProgress: syncProgress
  } = ctx.offerSync

  const locationOptions = useMemo(() => {
    if (!data || !formState.supermarketId) return []

    const options: any[] = [
      {
        id: 'hc-national-national',
        locationScope: 'national',
        locationSlug: 'national',
        coverageLabel: 'National Coverage',
        cityId: null,
        regionId: null,
        value: 'national-national',
        label: 'National Coverage'
      }
    ]

    data.regions.forEach(r => {
      options.push({
        id: `hc-region-${r.slug}`,
        locationScope: 'region',
        locationSlug: r.slug,
        coverageLabel: `Region: ${r.name_en || r.name_ar}`,
        cityId: null,
        regionId: r.id,
        value: `region-${r.slug}`,
        label: `Region: ${r.name_en || r.name_ar}`
      })
    })

    data.cities.forEach(c => {
      const mapping = data.supermarketRegions.find(sr => sr.city_id === c.id)
      options.push({
        id: `hc-city-${c.slug}`,
        locationScope: 'city',
        locationSlug: c.slug,
        coverageLabel: `City: ${c.name_en || c.name_ar}`,
        cityId: c.id,
        regionId: mapping?.region_id || null,
        value: `city-${c.slug}`,
        label: `City: ${c.name_en || c.name_ar}`
      })
    })

    return options
  }, [data, formState.supermarketId])

  const selectedLocationValue = formState.location 
    ? `${formState.location.locationScope}-${formState.location.locationSlug}`
    : ''

  // Auto-select National Coverage by default when a supermarket is chosen
  useEffect(() => {
    if (formState.supermarketId && !formState.location && locationOptions.length > 0) {
      const nationalOpt = locationOptions.find(o => o.locationScope === 'national')
      if (nationalOpt) {
        const smSlug = data?.supermarkets.find(s => s.id === formState.supermarketId)?.slug || 'unknown'
        const lId = buildLeafletId({
          supermarketSlug: smSlug,
          coverageScope: 'national',
          locationSlug: nationalOpt.locationSlug,
          validTo: formState.offerEndDate
        })
        setLocation({
          locationScope: 'national',
          locationSlug: nationalOpt.locationSlug,
          coverageLabel: nationalOpt.coverageLabel,
          cityId: nationalOpt.cityId,
          regionId: nationalOpt.regionId,
          label: nationalOpt.label,
          leafletId: lId
        })
      }
    }
  }, [formState.supermarketId, formState.location, locationOptions, data, formState.offerEndDate, setLocation])

  const [autoRun, setAutoRun] = useState(false)
  const [extractionMode, setExtractionMode] = useState<import('../../../shared/types/pageFirstExtractionMode').ExtractionMode>('page_first_annotated_ocr')
  const [showAdvancedLegacy, setShowAdvancedLegacy] = useState(false)
  
  // Reset pipeline states when the selected PDF changes so the user can start a new extraction
  useEffect(() => {
    // Determine if file actually changed to a new file (not just on initial load unless we want to reset anyway)
    // A simple reset on pdfFile change is fine since they just picked it.
    if (formState.pdfFile) {
      ctx.streamingPdfRender.reset()
      ctx.ocrPipeline.reset()
      ctx.imageCropping.reset()
      ctx.importTracking.reset()
      ctx.entityMatching.reset()
      ctx.offerPreparation.reset()
      ctx.offerSync.reset()
      ctx.cropAndItemOcr.reset()
      ctx.pageFirstPipeline.reset()
      setAutoRun(false)
    }
  }, [formState.pdfFile?.path]) // only reset when path changes

  useEffect(() => {
    if (firstPageReady && extractionMode === 'legacy_crop_first') {
      setShowManualCropEditor(true)
    }
  }, [firstPageReady, extractionMode])

  useEffect(() => {
    if (!autoRun) return

    // 1. Preprocess -> OCR Pipeline
    if ((streamingState?.status === 'completed' || streamingState?.status === 'partially_completed') && !ocrRunning && !ocrResult && !ocrError && !pipelineRunning && !pipelineResult && !pipelineError && configStatus?.mistral.apiKey.configured) {
      if (streamingState.chunks && streamingState.chunks.length > 0) {
        runPipeline({
          workspacePath: streamingState.workspacePath!,
          chunks: streamingState.chunks!,
          renderedPages: streamingPages
        })
      }
    }
    
    // 2. OCR Pipeline -> Crop Images
    else if (pipelineResult && !cropRunning && !cropResult && !cropError) {
      const rows = pipelineResult.normalizedRows.map((r: any) => ({
        rowId: r.source.row_id,
        pageNumber: r.source.page_number,
        status: r.status,
        skipReason: r.skip_reason,
        productNameAr: r.offer?.title_ar || r.original?.product_name_ar,
        productNameEn: r.offer?.title_en || r.original?.product_name_en,
        offerPrice: r.offer?.offer_price || r.original?.offer_price,
        boundingBox: r.bounding_box || r.original?.bounding_box
      }))
      
      cropRows({
        workspacePath: streamingState!.workspacePath!,
        renderedPages: streamingPages,
        rows,
        paddingPercent: 8,
        outputFormat: 'jpg',
        outputQuality: 85
      })
    }

    // 3. Crop Images -> DB Save is now manual via Pre-Publish Preview
    else if (cropResult && !dbSaving && !dbResult && !dbError) {
      setAutoRun(false)
      // We don't automatically persist to DB anymore. 
      // The user must open the Pre-Publish Preview and approve.
    }

    // 4. DB Save -> Match Entities (This runs after user approves and DB sync is triggered manually)
    else if (dbResult && !matchRunning && !matchResult && !matchError) {
      const inputRows = pipelineResult!.normalizedRows.map((r: any, index: number) => ({
        importRowId: dbResult.insertedImportRowCount ? `mock-row-${index}` : undefined,
        rowNumber: index + 1,
        rowId: r.source.row_id,
        pageNumber: r.source.page_number,
        status: r.status,
        skipReason: r.skip_reason,
        normalizedData: r
      }))

      matchRows({
        importBatchId: dbResult.importBatchId || null,
        rows: inputRows,
        options: {
          autoCreateBrands: !!configStatus?.importBehavior.autoCreateBrands,
          autoCreateProducts: !!configStatus?.importBehavior.autoCreateProducts,
          autoCreateCategories: !!configStatus?.importBehavior.autoCreateCategories
        }
      })
    }

    // 5. Match Entities -> Prepare Offers
    else if (matchResult && !prepRunning && !prepResult && !prepError) {
      const prepRows = matchResult.results.map(mr => ({
        importRowId: mr.importRowId,
        rowNumber: mr.rowNumber,
        rowId: mr.rowId,
        pageNumber: mr.updatedNormalizedData?.source?.page_number || 1,
        status: mr.status as any,
        skipReason: mr.status === 'skipped' ? 'Skipped in previous steps' : null,
        normalizedData: mr.updatedNormalizedData
      }))

      prepareOffers({
        importBatchId: dbResult?.importBatchId || null,
        sourceId: dbResult?.sourceId || null,
        leafletId: formState.location?.leafletId || null,
        supermarketId: formState.supermarketId!,
        locationScope: formState.location?.locationScope || 'national',
        cityId: formState.location?.cityId || null,
        regionId: formState.location?.regionId || null,
        offerStartDate: formState.offerStartDate,
        offerEndDate: formState.offerEndDate,
        rows: prepRows,
        options: {
          skipDuplicateOffers: !!configStatus?.importBehavior.skipDuplicateOffers,
          defaultOfferStatus: configStatus?.importBehavior.defaultOfferStatus || 'published',
          importDefaultStatus: configStatus?.importBehavior.importDefaultStatus || 'published',
          allowNeedsReviewFallback: configStatus?.importBehavior.allowNeedsReviewFallback !== false,
          publishWarningsAllowed: configStatus?.importBehavior.publishWarningsAllowed !== false,
          dataQualityNeedsReviewThreshold: configStatus?.importBehavior.dataQualityNeedsReviewThreshold || 80,
          requireImageForDraft: !!configStatus?.importBehavior.requireImageForDraft
        }
      })
    }

    // 6. Extraction complete -> Database publishing is strictly manual only.
    // Automatic DB sync invocation is removed; publishing requires explicit operator approval in Pre-Publish Preview.
    else if (prepResult && autoRun) {
      setAutoRun(false)
    }

    // Stop auto-run if an error occurs anywhere
    if (streamingError || ocrError || pipelineError || cropError || dbError || matchError || prepError || syncError) {
      setAutoRun(false)
    }
  }, [autoRun, streamingState, ocrResult, pipelineResult, cropResult, dbResult, matchResult, prepResult, syncResult, streamingError, ocrError, pipelineError, cropError, dbError, matchError, prepError, syncError, pipelineRunning, ocrRunning, configStatus])

  const getTrustedContext = () => ({
    supermarketId: formState.supermarketId,
    supermarketSlug: data?.supermarkets?.find((s: any) => s.id === formState.supermarketId)?.slug || null,
    locationScope: formState.location?.locationScope || 'national',
    cityId: formState.location?.cityId || null,
    regionId: formState.location?.regionId || null,
    offerStartDate: formState.offerStartDate || null,
    offerEndDate: formState.offerEndDate || null,
    leafletId: (formState.location as any)?.leafletId || null
  })

  const handleStartPageFirstExtraction = async (pages?: number[]) => {
    if (!streamingState?.workspacePath || !formState.pdfFile) return
    const pdfBaseName = formState.pdfFile.name.replace(/\.[^.]+$/, '')
    await ctx.pageFirstPipeline.processLeaflet({
      packageDir: streamingState.workspacePath,
      pdfBaseName,
      pages,
      trustedContext: getTrustedContext(),
      rolloutMode: 'pilot'
    })
  }

  const handleTestCurrentPage = async (pageToTest = selectedPageNumber) => {
    if (!streamingState?.workspacePath || !formState.pdfFile) return
    const pdfBaseName = formState.pdfFile.name.replace(/\.[^.]+$/, '')
    await ctx.pageFirstPipeline.processPage({
      packageDir: streamingState.workspacePath,
      pdfBaseName,
      pageNumber: pageToTest,
      trustedContext: getTrustedContext()
    })
  }

  const handleResumeProcessing = async () => {
    if (!streamingState?.workspacePath || !formState.pdfFile) return
    const pdfBaseName = formState.pdfFile.name.replace(/\.[^.]+$/, '')
    await ctx.pageFirstPipeline.resume({
      packageDir: streamingState.workspacePath,
      pdfBaseName,
      trustedContext: getTrustedContext()
    })
  }

  const handleRebuildCrops = async () => {
    if (!streamingState?.workspacePath || !formState.pdfFile) return
    const pdfBaseName = formState.pdfFile.name.replace(/\.[^.]+$/, '')
    await ctx.pageFirstPipeline.rebuildCropsFromOcr({
      packageDir: streamingState.workspacePath,
      pdfBaseName,
      trustedContext: getTrustedContext()
    })
  }

  const handleQuickTest = async () => {
    if (!streamingState?.workspacePath || !formState.pdfFile) return
    const pdfBaseName = formState.pdfFile.name.replace(/\.[^.]+$/, '')
    await (ctx.pageFirstPipeline as any).quickTestPage({
      packageDir: streamingState.workspacePath,
      pdfBaseName,
      pageNumber: quickTestPageNumber,
      trustedContext: getTrustedContext(),
      maxOffers: quickTestMaxOffers
    })
  }

  if (showPreviousExtractions) {
    return (
      <div className="page-container content-container">
        <PreviousExtractionsView
          onBack={() => setShowPreviousExtractions(false)}
          supermarkets={data?.supermarkets || []}
          onSelectForPreview={async (folderPath) => {
            const result = await window.wifranExtractor.extractionPackage.open(folderPath)
            if (result.ok && result.manifest) {
              setLoadedManifest(result.manifest)
              setPackageValidation(result.validation || null)
              if (result.manifest.supermarket?.id) setSupermarketId(result.manifest.supermarket.id)
              if (result.manifest.offer_dates?.valid_from) setOfferStartDate(result.manifest.offer_dates.valid_from)
              if (result.manifest.offer_dates?.valid_to) setOfferEndDate(result.manifest.offer_dates.valid_to)
              const pdfName = result.manifest.pdf_file_name || 'document.pdf'
              setPdfFile({ path: `${folderPath}\\${pdfName}`, name: pdfName, sizeBytes: 0, extension: 'pdf' })
            }
            setPreviewWorkspacePath(folderPath)
            setPreviewOrigin('previous_extractions')
            setShowPrePublishPreview(true)
          }}
          onSelectForLoad={async (folderPath) => {
            const result = await window.wifranExtractor.extractionPackage.open(folderPath)
            if (result.ok && result.manifest) {
              setLoadedManifest(result.manifest)
              setPackageValidation(result.validation || null)
              if (result.manifest.supermarket?.id) setSupermarketId(result.manifest.supermarket.id)
              if (result.manifest.offer_dates?.valid_from) setOfferStartDate(result.manifest.offer_dates.valid_from)
              if (result.manifest.offer_dates?.valid_to) setOfferEndDate(result.manifest.offer_dates.valid_to)
              const pdfName = result.manifest.pdf_file_name || 'document.pdf'
              setPdfFile({ path: `${folderPath}\\${pdfName}`, name: pdfName, sizeBytes: 0, extension: 'pdf' })
              ctx.streamingPdfRender.state = {
                status: 'completed',
                workspacePath: folderPath,
                totalPages: result.manifest.counts?.pages_rendered || result.manifest.page_count || 0,
                renderedPages: result.manifest.counts?.pages_rendered || 0,
                failedPages: 0,
                pages: [],
                firstPageReady: true
              }
            }
            setShowPreviousExtractions(false)
          }}
        />

        {showPrePublishPreview && (previewWorkspacePath || loadedManifest?.extraction_folder_path || streamingState?.workspacePath) && (
          <PrePublishPreview 
            workspacePath={(previewWorkspacePath || loadedManifest?.extraction_folder_path || streamingState?.workspacePath)!}
            isDryRun={(previewWorkspacePath || loadedManifest?.extraction_folder_path || streamingState?.workspacePath || '').toLowerCase().includes('_qa') || (previewWorkspacePath || loadedManifest?.extraction_folder_path || streamingState?.workspacePath || '').toLowerCase().includes('qa_')}
            qaMode={(previewWorkspacePath || loadedManifest?.extraction_folder_path || streamingState?.workspacePath || '').toLowerCase().includes('_qa') || (previewWorkspacePath || loadedManifest?.extraction_folder_path || streamingState?.workspacePath || '').toLowerCase().includes('qa_')}
            backButtonText="Back to Extractions"
            onClose={() => {
              setShowPrePublishPreview(false)
            }}
            onPublishStarted={() => {
              setShowPrePublishPreview(false)
            }}
          />
        )}
      </div>
    )
  }

  return (
    <div className="page-container">
      <PageHeader 
        title="Import Leaflet" 
        description="Select a PDF leaflet and define its metadata to begin extraction." 
      />

      {error && (
        <div style={{ padding: '10px', backgroundColor: '#fee', border: '1px solid #fcc', borderRadius: '4px', marginBottom: '20px' }}>
          <h3 style={{ color: 'red', margin: '0 0 8px 0' }}>Database Connection Error</h3>
          <p style={{ margin: 0, color: '#721c24' }}>{error}</p>
        </div>
      )}

      {loading && <p>Loading reference data...</p>}

      <ValidationSummary errors={validation.errors} />
      
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px' }}>
        <div style={{ flex: '1 1 500px', minWidth: 0 }}>
          <div className="card">
        <div className="form-section">
          <h3>1. PDF Leaflet</h3>
          <FormField 
            label="Selected File" 
            fieldKey="pdfFile" 
            errors={validation.errors}
            helperText="Only PDF leaflets are supported."
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button 
                className="btn btn-secondary" 
                onClick={() => selectPdf(data?.supermarkets, data?.cities, data?.regions)}
                disabled={loading || !data}
              >
                {loading ? 'Loading...' : 'Select PDF File...'}
              </button>
              {formState.pdfFile && (
                <span style={{ fontSize: '0.9rem', color: '#475569' }}>
                  <strong>{formState.pdfFile.name}</strong> ({Math.round(formState.pdfFile.sizeBytes / 1024)} KB)
                </span>
              )}
            </div>
          </FormField>
        </div>

        <div className="form-section">
          <h3>2. Supermarket</h3>
          <FormField 
            label="Supermarket" 
            fieldKey="supermarketId" 
            errors={validation.errors}
          >
            <select 
              className="form-control"
              value={formState.supermarketId || ''}
              onChange={(e) => setSupermarketId(e.target.value || null)}
              disabled={loading || !!error || !data || data.supermarkets.length === 0}
            >
              <option value="">
                {!data || loading ? 'Loading supermarkets...' : 'Select a supermarket...'}
              </option>
              {data?.supermarkets.map(sm => (
                <option key={sm.id} value={sm.id}>{sm.name_en || sm.name_ar || sm.slug}</option>
              ))}
            </select>
            {data && data.supermarkets.length === 0 && !loading && (
              <p className="help-text" style={{ color: 'red' }}>No active supermarkets found in database.</p>
            )}
          </FormField>
        </div>

        <div className="form-section">
          <h3>3. Location</h3>
          <FormField 
            label="City / Region" 
            fieldKey="location" 
            errors={validation.errors}
          >
            <select 
              className="form-control"
              value={selectedLocationValue}
              onChange={(e) => {
                const val = e.target.value
                if (!val) {
                  setLocation(null)
                } else {
                  const opt = locationOptions.find(o => o.value === val)
                  if (opt) {
                    // Generate leafletId right here since we have all data
                    const smSlug = data?.supermarkets.find(s => s.id === formState.supermarketId)?.slug || 'unknown'
                    const lId = buildLeafletId({
                      supermarketSlug: smSlug,
                      coverageScope: opt.locationScope as any,
                      locationSlug: opt.locationSlug,
                      validTo: formState.offerEndDate
                    })
                    
                    setLocation({ 
                      locationScope: opt.locationScope as any,
                      locationSlug: opt.locationSlug,
                      coverageLabel: opt.coverageLabel,
                      cityId: opt.cityId, 
                      regionId: opt.regionId, 
                      label: opt.label,
                      leafletId: lId
                    })
                  }
                }
              }}
              disabled={!formState.supermarketId || locationOptions.length === 0}
            >
              <option value="">
                {!formState.supermarketId 
                  ? 'Select a supermarket first' 
                  : locationOptions.length === 0 
                    ? 'No locations available for this supermarket' 
                    : 'Select city/region...'}
              </option>
              {locationOptions.map(opt => (
                <option key={opt.id} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {formState.supermarketId && locationOptions.length === 0 && (
              <p className="help-text" style={{ color: 'orange' }}>Warning: The selected supermarket has no mapped locations in the database.</p>
            )}
          </FormField>
        </div>

        <div className="form-section">
          <h3>4. Offer Dates</h3>
          <div className="form-row">
            <FormField label="Start Date" fieldKey="offerStartDate" errors={validation.errors}>
              <input 
                type="date" 
                className="form-control" 
                value={formState.offerStartDate}
                onChange={(e) => setOfferStartDate(e.target.value)}
              />
            </FormField>
            <FormField label="End Date" fieldKey="offerEndDate" errors={validation.errors}>
              <input 
                type="date" 
                className="form-control" 
                value={formState.offerEndDate}
                onChange={(e) => setOfferEndDate(e.target.value)}
              />
            </FormField>
          </div>
          <p className="help-text">These dates will be applied to all offers extracted from this leaflet.</p>
        </div>



        <div className="form-section actions-section" style={{ borderTop: '1px solid #e2e8f0', paddingTop: '20px' }}>
          <h3>6. Processing Readiness</h3>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '20px', fontSize: '0.9rem' }}>
            <div className="status-row">
              <strong style={{display: 'block', marginBottom: '4px'}}>PDF:</strong> 
              {formState.pdfFile ? <StatusBadge variant="success">Selected</StatusBadge> : <StatusBadge variant="warning">Missing</StatusBadge>}
            </div>
            <div className="status-row">
              <strong style={{display: 'block', marginBottom: '4px'}}>Supermarket:</strong> 
              {formState.supermarketId ? <StatusBadge variant="success">Selected</StatusBadge> : <StatusBadge variant="warning">Missing</StatusBadge>}
            </div>
            <div className="status-row">
              <strong style={{display: 'block', marginBottom: '4px'}}>Location:</strong> 
              {formState.location ? <StatusBadge variant="success">Selected</StatusBadge> : <StatusBadge variant="warning">Missing</StatusBadge>}
            </div>
            <div className="status-row">
              <strong style={{display: 'block', marginBottom: '4px'}}>Dates:</strong> 
              {!validation.errors.find(e => e.field === 'offerStartDate' || e.field === 'offerEndDate') 
                ? <StatusBadge variant="success">Valid</StatusBadge> 
                : <StatusBadge variant="error">Invalid</StatusBadge>}
            </div>
            
            <div className="status-row">
              <strong style={{display: 'block', marginBottom: '4px'}}>Supabase Config:</strong> 
              {configStatus?.supabase.url.configured && configStatus?.supabase.serviceRoleKey.configured && configStatus?.supabase.storageBucket.configured
                ? <StatusBadge variant="success">Ready</StatusBadge>
                : <StatusBadge variant="error">Not Ready</StatusBadge>}
            </div>
            <div className="status-row">
              <strong style={{display: 'block', marginBottom: '4px'}}>Mistral Config:</strong> 
              {configStatus?.mistral.apiKey.configured && configStatus?.mistral.ocrModel.configured && configStatus?.mistral.ocrEndpoint.configured
                ? <StatusBadge variant="success">Ready</StatusBadge>
                : <StatusBadge variant="error">Not Ready</StatusBadge>}
            </div>
          </div>
        </div>

        {streamingRunning && streamingLatestEvent && (
          <div className="form-section" style={{ borderTop: '1px solid #e2e8f0', paddingTop: '20px', color: '#0284c7' }}>
            <p><strong>Preprocessing Status:</strong> {streamingLatestEvent.message}</p>
            {streamingState && streamingState.totalPages > 0 && (
              <p style={{ fontSize: '0.9rem', marginTop: '8px' }}>
                Rendering PDF pages: {streamingState.renderedPages} / {streamingState.totalPages} ready. 
                {streamingState.renderedPages > 0 && " You can start editing while the remaining pages continue rendering."}
              </p>
            )}
          </div>
        )}

        {streamingError && (
          <div className="form-section" style={{ borderTop: '1px solid #e2e8f0', paddingTop: '20px', color: '#c53030' }}>
            <p><strong>Preprocessing Failed:</strong> {streamingError}</p>
          </div>
        )}

        {streamingState && (streamingState.status === 'completed' || streamingState.status === 'partially_completed') && (
          <div className="form-section" style={{ borderTop: '1px solid #e2e8f0', paddingTop: '20px', backgroundColor: '#f0fdf4', padding: '16px', borderRadius: '8px' }}>
            <h3 style={{ color: '#166534', margin: '0 0 12px 0' }}>Preprocessing {streamingState.status === 'completed' ? 'Complete' : 'Partially Complete'}</h3>
            <ul style={{ margin: 0, paddingLeft: '20px', color: '#15803d', fontSize: '0.9rem' }}>
              <li><strong>Workspace Path:</strong> {streamingState.workspacePath}</li>
              <li><strong>Page Count:</strong> {streamingState.totalPages}</li>
              <li><strong>Pages Rendered:</strong> {streamingState.renderedPages}</li>
              <li><strong>Pages Failed:</strong> {streamingState.failedPages}</li>
            </ul>

            {/* Chunk 68: Primary Extraction Pipeline */}
            {extractionMode === 'page_first_annotated_ocr' ? (
              <div style={{ marginTop: '20px', borderTop: '2px solid #2563eb', paddingTop: '16px', backgroundColor: '#eff6ff', padding: '16px', borderRadius: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h3 style={{ color: '#1e40af', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>🚀 Page-First Mistral OCR 4.1 Extraction</span>
                    <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '4px', backgroundColor: '#dbeafe', color: '#1e40af', fontWeight: 'bold' }}>Default Pipeline</span>
                  </h3>
                  <span style={{ fontSize: '0.85rem', color: '#475569', fontWeight: 600 }}>
                    Estimated annotated OCR cost: ~${((streamingState.totalPages || 0) * 0.005).toFixed(2)}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '16px', fontSize: '0.85rem', backgroundColor: '#ffffff', padding: '12px', borderRadius: '6px', border: '1px solid #bfdbfe' }}>
                  <div>
                    <span style={{ color: '#64748b', display: 'block' }}>Primary Detection</span>
                    <strong>Mistral OCR 4.1 Whole-Page</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block' }}>Local Offer Detector</span>
                    <strong style={{ color: '#475569' }}>Bypassed for this extraction</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block' }}>Page Count</span>
                    <strong>{streamingState.totalPages || 0} pages</strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block' }}>Estimated Time</span>
                    <strong>~{Math.ceil((streamingState.totalPages || 1) * 0.4)} min</strong>
                  </div>
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '16px' }}>
                  <button
                    className="btn btn-primary"
                    disabled={ctx.pageFirstPipeline.running || !configStatus?.mistral.apiKey.configured}
                    onClick={() => handleStartPageFirstExtraction()}
                  >
                    {ctx.pageFirstPipeline.running ? 'Extracting Whole Leaflet...' : 'Start Automatic Extraction'}
                  </button>

                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <button
                      className="btn btn-secondary"
                      id="test-current-page-btn"
                      disabled={ctx.pageFirstPipeline.running || !configStatus?.mistral.apiKey.configured}
                      onClick={() => handleTestCurrentPage(selectedPageNumber)}
                    >
                      Test Current Page (p.{selectedPageNumber})
                    </button>
                    {(streamingState?.totalPages || 1) > 1 && (
                      <select
                        id="test-page-selector"
                        value={selectedPageNumber}
                        onChange={(e) => setSelectedPageNumber(parseInt(e.target.value, 10) || 1)}
                        disabled={ctx.pageFirstPipeline.running}
                        style={{ padding: '6px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                        title="Select page to test"
                      >
                        {Array.from({ length: streamingState?.totalPages || 1 }, (_, i) => i + 1).map((p) => (
                          <option key={p} value={p}>Page {p}</option>
                        ))}
                      </select>
                    )}
                  </div>

                  <button
                    className="btn btn-secondary"
                    disabled={ctx.pageFirstPipeline.running}
                    onClick={() => handleResumeProcessing()}
                  >
                    Resume Incomplete Pages
                  </button>

                  <button
                    className="btn btn-secondary"
                    disabled={ctx.pageFirstPipeline.running}
                    onClick={() => handleRebuildCrops()}
                  >
                    Rebuild Crops From Existing OCR
                  </button>

                  {ctx.pageFirstPipeline.result && (
                    <button
                      className="btn btn-success"
                      onClick={() => {
                        setShowPrePublishPreview(true)
                      }}
                    >
                      Open Pre-Publish Preview
                    </button>
                  )}

                  {ctx.pageFirstPipeline.result && ctx.pageFirstPipeline.result.unresolvedPages > 0 && (
                    <button
                      className="btn btn-warning"
                      style={{ backgroundColor: '#f59e0b', color: '#ffffff' }}
                      onClick={() => setShowManualCropEditor(true)}
                    >
                      Open Exception Review ({ctx.pageFirstPipeline.result.unresolvedPages} Unresolved)
                    </button>
                  )}
                </div>

                {/* ⚡ Quick Test Panel */}
                <div style={{ marginTop: '16px', padding: '16px', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', borderRadius: '10px', border: '1px solid #334155' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                    <span style={{ fontSize: '1.2rem' }}>⚡</span>
                    <strong style={{ color: '#e2e8f0', fontSize: '0.95rem' }}>Quick Extraction Test</strong>
                    <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '12px', backgroundColor: '#7c3aed22', color: '#a78bfa', border: '1px solid #7c3aed44', fontWeight: 600 }}>Rate-Limit Safe</span>
                    <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: '#64748b' }}>Tests OCR accuracy without running the full leaflet</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <label style={{ color: '#94a3b8', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>Page:</label>
                      <input
                        type="number"
                        id="quick-test-page-input"
                        min={1}
                        max={streamingState?.totalPages || 99}
                        value={quickTestPageNumber}
                        onChange={(e) => setQuickTestPageNumber(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        disabled={(ctx.pageFirstPipeline as any).quickTestRunning}
                        style={{ width: '64px', padding: '5px 8px', borderRadius: '6px', border: '1px solid #475569', background: '#0f172a', color: '#e2e8f0', fontSize: '0.85rem', textAlign: 'center' }}
                      />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <label style={{ color: '#94a3b8', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>Max offers:</label>
                      <input
                        type="number"
                        id="quick-test-max-offers-input"
                        min={1}
                        max={20}
                        value={quickTestMaxOffers}
                        onChange={(e) => setQuickTestMaxOffers(Math.max(1, parseInt(e.target.value, 10) || 2))}
                        disabled={(ctx.pageFirstPipeline as any).quickTestRunning}
                        style={{ width: '54px', padding: '5px 8px', borderRadius: '6px', border: '1px solid #475569', background: '#0f172a', color: '#e2e8f0', fontSize: '0.85rem', textAlign: 'center' }}
                      />
                    </div>
                    <button
                      id="quick-test-btn"
                      disabled={(ctx.pageFirstPipeline as any).quickTestRunning || !configStatus?.mistral.apiKey.configured || !streamingState?.workspacePath}
                      onClick={handleQuickTest}
                      style={{
                        padding: '7px 18px',
                        borderRadius: '8px',
                        border: 'none',
                        background: (ctx.pageFirstPipeline as any).quickTestRunning ? '#374151' : 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                        color: '#fff',
                        fontWeight: 700,
                        fontSize: '0.88rem',
                        cursor: (ctx.pageFirstPipeline as any).quickTestRunning ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        boxShadow: (ctx.pageFirstPipeline as any).quickTestRunning ? 'none' : '0 2px 12px #7c3aed55'
                      }}
                    >
                      {(ctx.pageFirstPipeline as any).quickTestRunning ? (
                        <><span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⏳</span> Running...</>
                      ) : (
                        <>⚡ Run Quick Test (p.{quickTestPageNumber}, {quickTestMaxOffers} items)</>
                      )}
                    </button>
                    {(ctx.pageFirstPipeline as any).quickTestResult && (
                      <button
                        onClick={() => (ctx.pageFirstPipeline as any).resetQuickTest?.()}
                        style={{ padding: '5px 12px', borderRadius: '6px', border: '1px solid #475569', background: 'transparent', color: '#94a3b8', fontSize: '0.8rem', cursor: 'pointer' }}
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  {/* Quick Test Progress */}
                  {(ctx.pageFirstPipeline as any).quickTestRunning && (ctx.pageFirstPipeline as any).quickTestProgress && (
                    <div style={{ marginTop: '12px', padding: '10px 14px', background: '#1e293b', borderRadius: '8px', border: '1px solid #334155' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#7c3aed', animation: 'pulse 1s infinite' }} />
                        <span style={{ color: '#a78bfa', fontSize: '0.85rem', fontWeight: 600 }}>
                          {(ctx.pageFirstPipeline as any).quickTestProgress.stage?.toUpperCase()}
                        </span>
                        <span style={{ color: '#94a3b8', fontSize: '0.82rem' }}>
                          {(ctx.pageFirstPipeline as any).quickTestProgress.message}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Quick Test Error */}
                  {(ctx.pageFirstPipeline as any).quickTestError && (
                    <div style={{ marginTop: '12px', padding: '10px 14px', background: '#450a0a', borderRadius: '8px', border: '1px solid #dc2626', color: '#fca5a5', fontSize: '0.85rem' }}>
                      <strong>Error:</strong> {(ctx.pageFirstPipeline as any).quickTestError}
                    </div>
                  )}

                  {/* Quick Test Results */}
                  {(ctx.pageFirstPipeline as any).quickTestResult && (() => {
                    const qr = (ctx.pageFirstPipeline as any).quickTestResult
                    const items: any[] = qr.items || []
                    return (
                      <div style={{ marginTop: '14px' }}>
                        {/* Summary bar */}
                        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '12px', padding: '10px 14px', background: '#0f172a', borderRadius: '8px', border: '1px solid #1e3a5f' }}>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#7c3aed' }}>{items.length}</div>
                            <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Items Extracted</div>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#10b981' }}>{qr.offersLinked}</div>
                            <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Linked</div>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f59e0b' }}>{qr.cropsGenerated}</div>
                            <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Crops</div>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#38bdf8' }}>${qr.estimatedCostUsd?.toFixed(4)}</div>
                            <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Est. Cost</div>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: qr.ok ? '#10b981' : '#ef4444' }}>{qr.ok ? '✓' : '✗'}</div>
                            <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Status</div>
                          </div>
                        </div>

                        {/* Offer cards */}
                        {items.length === 0 && (
                          <div style={{ color: '#f59e0b', padding: '10px', background: '#292524', borderRadius: '8px', fontSize: '0.85rem' }}>
                            ⚠️ No offers extracted. Check logs for details.
                          </div>
                        )}
                        {items.map((item: any, idx: number) => (
                          <div key={idx} style={{ marginBottom: '10px', padding: '14px', background: '#1e293b', borderRadius: '8px', border: '1px solid #334155' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                              <div>
                                <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', background: '#7c3aed22', color: '#a78bfa', border: '1px solid #7c3aed44', marginRight: '8px' }}>Item {idx + 1}</span>
                                <strong style={{ color: '#e2e8f0', fontSize: '0.9rem' }}>{item.product?.title_ar || item.product?.title_en || '(No title)'}</strong>
                                {item.product?.title_en && item.product?.title_ar && (
                                  <span style={{ color: '#94a3b8', fontSize: '0.8rem', marginLeft: '8px' }}>{item.product.title_en}</span>
                                )}
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#10b981' }}>
                                  {item.pricing?.offer_price ? `SAR ${item.pricing.offer_price}` : item.pricing?.display_price || 'N/A'}
                                </div>
                                {(item.pricing?.original_price || item.pricing?.was_price) && (
                                  <div style={{ fontSize: '0.8rem', color: '#64748b', textDecoration: 'line-through' }}>
                                    SAR {item.pricing.original_price || item.pricing.was_price}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', fontSize: '0.78rem', color: '#64748b' }}>
                              {item.product?.brand_name_en && <span>Brand: <strong style={{ color: '#94a3b8' }}>{item.product.brand_name_en}</strong></span>}
                              {item.product?.size_text && <span>Size: <strong style={{ color: '#94a3b8' }}>{item.product.size_text}</strong></span>}
                              {item.quality?.publish_decision && <span>Decision: <strong style={{ color: item.quality.publish_decision === 'publish' ? '#10b981' : '#f59e0b' }}>{item.quality.publish_decision}</strong></span>}
                              {item.quality?.overall_confidence && <span>Confidence: <strong style={{ color: '#94a3b8' }}>{item.quality.overall_confidence}</strong></span>}
                              {item.source?.source_item_number && <span>Item #: <strong style={{ color: '#94a3b8' }}>{item.source.source_item_number}</strong></span>}
                              {item.source?.crop_file_path && <span style={{ gridColumn: '1 / -1', wordBreak: 'break-all' }}>Crop: <strong style={{ color: '#38bdf8', fontSize: '0.72rem' }}>{item.source.crop_file_path.split(/[\/]/).slice(-2).join('/')}</strong></span>}
                            </div>
                            {item.quality?.non_blocking_warnings?.length > 0 && (
                              <div style={{ marginTop: '6px', fontSize: '0.75rem', color: '#f59e0b' }}>
                                ⚠️ {item.quality.non_blocking_warnings.map((w: any) => w.message || w).join(' | ')}
                              </div>
                            )}
                          </div>
                        ))}

                        {/* Quick Test Logs (last 5) */}
                        {(ctx.pageFirstPipeline as any).quickTestLogs?.length > 0 && (
                          <details style={{ marginTop: '8px' }}>
                            <summary style={{ color: '#64748b', fontSize: '0.8rem', cursor: 'pointer' }}>Show pipeline logs ({(ctx.pageFirstPipeline as any).quickTestLogs.length})</summary>
                            <div style={{ marginTop: '6px', maxHeight: '150px', overflowY: 'auto', background: '#0f172a', borderRadius: '6px', padding: '8px', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                              {(ctx.pageFirstPipeline as any).quickTestLogs.map((log: any, i: number) => (
                                <div key={i} style={{ color: log.level === 'error' ? '#fca5a5' : log.level === 'warning' ? '#fcd34d' : '#94a3b8', marginBottom: '2px' }}>
                                  [{log.code}] {log.message}
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    )
                  })()}
                </div>

                {/* Real-Time Progress Dashboard (Section 36) */}
                {ctx.pageFirstPipeline.progress && (
                  <div style={{ backgroundColor: '#ffffff', border: '1px solid #bfdbfe', borderRadius: '6px', padding: '14px', marginTop: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.9rem' }}>
                      <strong style={{ color: '#1e40af' }}>{ctx.pageFirstPipeline.progress.stage.toUpperCase()}: {ctx.pageFirstPipeline.progress.message}</strong>
                      <span style={{ color: '#64748b' }}>Elapsed: {Math.round(ctx.pageFirstPipeline.progress.elapsedMs / 1000)}s</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', fontSize: '0.85rem' }}>
                      <div>Pages Rendered: <strong>{streamingState.renderedPages} / {ctx.pageFirstPipeline.progress.totalPages}</strong></div>
                      <div>Primary OCR: <strong>{ctx.pageFirstPipeline.progress.primaryCompletedPages} / {ctx.pageFirstPipeline.progress.totalPages}</strong></div>
                      <div>Page Retries: <strong>{ctx.pageFirstPipeline.progress.retryCompletedPages}</strong></div>
                      <div>Unresolved Pages: <strong style={{ color: ctx.pageFirstPipeline.progress.unresolvedPages > 0 ? '#b91c1c' : '#15803d' }}>{ctx.pageFirstPipeline.progress.unresolvedPages}</strong></div>
                      <div>Offers Detected: <strong>{ctx.pageFirstPipeline.progress.offersDetected}</strong></div>
                      <div>Offers Linked: <strong>{ctx.pageFirstPipeline.progress.offersLinked}</strong></div>
                      <div>Crops Generated: <strong>{ctx.pageFirstPipeline.progress.cropsGenerated}</strong></div>
                      <div>Estimated Cost: <strong>${ctx.pageFirstPipeline.progress.estimatedCostUsd.toFixed(4)}</strong></div>
                    </div>
                  </div>
                )}

                {ctx.pageFirstPipeline.error && (
                  <div style={{ marginTop: '12px', padding: '10px', backgroundColor: '#fef2f2', border: '1px solid #f87171', borderRadius: '6px', color: '#991b1b', fontSize: '0.85rem' }}>
                    <strong>Pipeline Error:</strong> {ctx.pageFirstPipeline.error}
                  </div>
                )}

                {/* Advanced: Legacy & Exception Tools */}
                <div style={{ marginTop: '20px', borderTop: '1px solid #cbd5e1', paddingTop: '12px' }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: '0.8rem', background: '#e2e8f0', color: '#334155' }}
                    onClick={() => setShowAdvancedLegacy(!showAdvancedLegacy)}
                  >
                    {showAdvancedLegacy ? 'Hide Advanced / Exception Tools' : 'Show Advanced / Exception Tools'}
                  </button>

                  {showAdvancedLegacy && (
                    <div style={{ marginTop: '12px', padding: '14px', backgroundColor: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '6px' }}>
                      <h4 style={{ color: '#475569', margin: '0 0 10px 0' }}>Legacy / Exception Tools</h4>
                      <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => setShowManualCropEditor(true)}
                        >
                          Open Legacy / Exception Crop Editor
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => setExtractionMode('legacy_crop_first')}
                        >
                          Switch to Legacy Crop-First Mode
                        </button>
                      </div>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>
                        Current extraction mode: <strong>{extractionMode}</strong>. Manual grid editing, brand templates, and crop-first OCR are available here for diagnostic and rollback compatibility.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Legacy Crop-First Workflow */
              <div style={{ marginTop: '20px', borderTop: '1px solid #15803d', paddingTop: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h4 style={{ color: '#166534', margin: 0 }}>Legacy Crop-First Extraction</h4>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setExtractionMode('page_first_annotated_ocr')}
                  >
                    Switch to Page-First Mode (Recommended)
                  </button>
                </div>
                <div style={{ marginBottom: '16px' }}>
                  <h5 style={{ color: '#166534', margin: '0 0 8px 0' }}>Step 1: Crop Editor</h5>
                  <button
                    className="btn btn-primary"
                    onClick={() => setShowManualCropEditor(true)}
                    style={{ marginRight: '12px' }}
                  >
                    Open Legacy / Exception Crop Editor
                  </button>
                </div>

                <div style={{ borderTop: '1px solid #bbf7d0', paddingTop: '16px' }}>
                  <h5 style={{ color: '#166534', margin: '0 0 8px 0' }}>Step 2: Crop + OCR Items</h5>
                  <button
                    className="btn btn-primary"
                    disabled={ctx.cropAndItemOcr.running || !configStatus?.mistral.apiKey.configured}
                    onClick={async () => {
                      const loadRes = await window.wifranExtractor.manualCrop.loadSession(streamingState!.workspacePath!)
                      if (!loadRes.ok || !loadRes.session?.pageLayouts) return
                      const layouts = loadRes.session.pageLayouts.filter(Boolean)
                      const validation = await ctx.cropAndItemOcr.validateLayouts(layouts)
                      if (!validation.ok) return
                      ctx.cropAndItemOcr.runCropAndItemOcr({
                        workspacePath: streamingState!.workspacePath!,
                        layouts
                      })
                    }}
                  >
                    {ctx.cropAndItemOcr.running ? 'Processing...' : 'Proceed to Crop + OCR'}
                  </button>
                </div>
              </div>
            )}

            {streamingState?.chunks && streamingState.chunks.length > 0 && (
              <div style={{ marginTop: '20px', borderTop: '1px solid #15803d', paddingTop: '16px' }}>
                <h4 style={{ color: '#166534', margin: '0 0 12px 0' }}>Single Chunk OCR Test</h4>
                <p style={{ color: '#15803d', fontSize: '0.9rem', marginBottom: '16px' }}>
                  Test Mistral OCR extraction on the first chunk before running full batch.
                </p>
                <button
                  className="btn btn-secondary"
                  disabled={ocrRunning || !configStatus?.mistral.apiKey.configured}
                  onClick={() => {
                    const firstChunk = streamingState.chunks![0]
                    runSingleChunkTest({
                      workspacePath: streamingState.workspacePath!,
                      chunkId: firstChunk.chunkId,
                      chunkPdfPath: firstChunk.chunkPdfPath,
                      originalPageNumbers: firstChunk.originalPageNumbers,
                      renderedPages: streamingPages || []
                    })
                  }}
                >
                  {ocrRunning ? 'Running OCR...' : `Test OCR on ${streamingState.chunks[0].chunkId}`}
                </button>

                {ocrError && (
                  <div style={{ marginTop: '12px', color: '#c53030', fontSize: '0.9rem' }}>
                    <strong>OCR Failed:</strong> {ocrError}
                  </div>
                )}

                {ocrResult && ocrResult.ok && (
                  <div style={{ marginTop: '12px', padding: '12px', backgroundColor: '#e0f2fe', borderRadius: '4px', fontSize: '0.9rem', color: '#0369a1' }}>
                    <p style={{ margin: '0 0 8px 0' }}><strong>OCR Complete!</strong></p>
                    <ul style={{ margin: 0, paddingLeft: '20px' }}>
                      <li>Extracted Items: {ocrResult.extractedItemCount}</li>
                      <li>Normalized Rows: {ocrResult.normalizedRowCount}</li>
                      <li>Skipped (Banners): {ocrResult.skippedPromotionalRowCount}</li>
                      <li>Warnings: {ocrResult.warningRowCount}</li>
                      <li>Errors: {ocrResult.errorRowCount}</li>
                    </ul>
                    {ocrResult.debugFilePath && (
                      <p style={{ marginTop: '8px', fontSize: '0.8rem' }}>Debug data saved to: {ocrResult.debugFilePath}</p>
                    )}
                    <p style={{ marginTop: '8px' }}>Check the <strong>Results Tab</strong> to view the structured data.</p>
                  </div>
                )}
              </div>
            )}

            {streamingState?.chunks && streamingState.chunks.length > 0 && (
              <div style={{ marginTop: '20px', borderTop: '1px solid #15803d', paddingTop: '16px' }}>
                <h4 style={{ color: '#166534', margin: '0 0 12px 0' }}>Run Full OCR Pipeline</h4>
                <p style={{ color: '#15803d', fontSize: '0.9rem', marginBottom: '16px' }}>
                  Execute extraction across all {streamingState.chunks.length} chunks.
                </p>
                <button
                  className="btn btn-primary"
                  disabled={pipelineRunning || ocrRunning || !configStatus?.mistral.apiKey.configured}
                  onClick={() => {
                    runPipeline({
                      workspacePath: streamingState.workspacePath!,
                      chunks: streamingState.chunks!,
                      renderedPages: streamingPages || []
                    })
                  }}
                >
                  {pipelineRunning ? 'Running OCR Pipeline...' : 'Run OCR on All Chunks'}
                </button>

                {pipelineRunning && pipelineProgress && (
                  <div style={{ marginTop: '16px' }}>
                    <OcrProgressBar {...pipelineProgress} />
                  </div>
                )}

                {pipelineError && (
                  <div style={{ marginTop: '12px', color: '#c53030', fontSize: '0.9rem' }}>
                    <strong>Pipeline Failed:</strong> {pipelineError}
                  </div>
                )}

                {pipelineResult && (
                  <div style={{ marginTop: '12px', padding: '12px', backgroundColor: '#ecfdf5', borderRadius: '4px', fontSize: '0.9rem', color: '#065f46' }}>
                    <p style={{ margin: '0 0 8px 0' }}><strong>Pipeline Completed!</strong></p>
                    <ul style={{ margin: 0, paddingLeft: '20px' }}>
                      <li>Total Chunks: {pipelineResult.totalChunks}</li>
                      <li>Completed Chunks: {pipelineResult.completedChunks}</li>
                      <li>Failed Chunks: {pipelineResult.failedChunks}</li>
                      <li>Total Items: {pipelineResult.totalExtractedItems}</li>
                      <li>Total Rows: {pipelineResult.totalNormalizedRows}</li>
                    </ul>
                  </div>
                )}

                {pipelineResult && pipelineResult.failedChunks > 0 && (
                  <div style={{ marginTop: '16px', borderTop: '1px dashed #10b981', paddingTop: '16px' }}>
                    <h5 style={{ margin: '0 0 8px 0', color: '#b91c1c' }}>Failed OCR Chunks Detected ({pipelineResult.failedChunks})</h5>
                    <p style={{ fontSize: '0.9rem', color: '#b91c1c', marginBottom: '12px' }}>
                      Some pages failed OCR (e.g. due to rate limits or timeouts). You can retry just these chunks.
                    </p>
                    <div style={{ maxHeight: '100px', overflowY: 'auto', marginBottom: '12px', fontSize: '0.8rem', backgroundColor: '#fef2f2', padding: '8px', borderRadius: '4px' }}>
                      {pipelineResult.chunks.filter((c: any) => c.status === 'failed').map((c: any) => (
                        <div key={c.chunkId} style={{ color: '#991b1b', marginBottom: '4px' }}>
                          <strong>{c.chunkId}</strong> (Pages {c.originalPageNumbers.join(', ')}): {c.error?.message}
                        </div>
                      ))}
                    </div>
                    
                    {(cropResult || dbResult || matchResult || syncResult) ? (
                      <div style={{ fontSize: '0.85rem', color: '#9f1239', padding: '8px', backgroundColor: '#fff1f2', borderRadius: '4px' }}>
                        <strong>⚠️ Cannot Retry Now:</strong> You have already run downstream stages (cropping, import, etc). Retry failed OCR chunks before continuing to downstream stages. To retry now, reload the page to reset downstream results first.
                      </div>
                    ) : (
                      <button
                        className="btn btn-secondary"
                        disabled={ctx.ocrPipeline.retryingFailedChunks || pipelineRunning || ocrRunning}
                        onClick={() => {
                          ctx.ocrPipeline.retryFailedChunks({
                            workspacePath: streamingState!.workspacePath!,
                            originalPipelineResult: pipelineResult,
                            renderedPages: streamingPages || []
                          })
                        }}
                      >
                        {ctx.ocrPipeline.retryingFailedChunks ? 'Retrying Failed Chunks...' : 'Retry Only Failed OCR Chunks'}
                      </button>
                    )}

                    {ctx.ocrPipeline.retryingFailedChunks && pipelineProgress && (
                      <div style={{ marginTop: '16px' }}>
                        <OcrProgressBar {...pipelineProgress} />
                      </div>
                    )}

                    {ctx.ocrPipeline.retryResult && (
                      <div style={{ marginTop: '12px', padding: '8px', backgroundColor: '#e0e7ff', borderRadius: '4px', fontSize: '0.85rem', color: '#3730a3' }}>
                        <strong>Retry Outcome:</strong> {ctx.ocrPipeline.retryResult.successfulRetryCount} succeeded, {ctx.ocrPipeline.retryResult.failedRetryCount} still failed.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {pipelineResult && (
              <div style={{ marginTop: '20px', borderTop: '1px solid #15803d', paddingTop: '16px' }}>
                <h4 style={{ color: '#166534', margin: '0 0 12px 0' }}>Crop Item Images</h4>
                <p style={{ color: '#15803d', fontSize: '0.9rem', marginBottom: '16px' }}>
                  Extract product images using normalized bounding boxes.
                </p>
                <button
                  className="btn btn-primary"
                  disabled={cropRunning || pipelineRunning || ocrRunning}
                  onClick={() => {
                    if (!pipelineResult) return
                    const rows = pipelineResult.normalizedRows.map((r: any) => ({
                      rowId: r.source.row_id,
                      pageNumber: r.source.page_number,
                      status: r.status,
                      skipReason: r.skip_reason,
                      productNameAr: r.offer?.title_ar || r.original?.product_name_ar,
                      productNameEn: r.offer?.title_en || r.original?.product_name_en,
                      offerPrice: r.offer?.offer_price || r.original?.offer_price,
                      boundingBox: r.bounding_box || r.original?.bounding_box
                    }))
                    
                    cropRows({
                      workspacePath: streamingState!.workspacePath!,
                      renderedPages: streamingPages || [],
                      rows,
                      paddingPercent: 8,
                      outputFormat: 'jpg',
                      outputQuality: 85
                    })
                  }}
                >
                  {cropRunning ? 'Cropping Images...' : 'Crop Item Images Locally'}
                </button>

                {cropRunning && cropProgress && (
                  <div style={{ marginTop: '12px', fontSize: '0.9rem', color: '#1e40af' }}>
                    <strong>Progress:</strong> {cropProgress.message} {cropProgress.current && cropProgress.total ? `(${cropProgress.current}/${cropProgress.total})` : ''}
                  </div>
                )}

                {cropError && (
                  <div style={{ marginTop: '12px', color: '#c53030', fontSize: '0.9rem' }}>
                    <strong>Cropping Failed:</strong> {cropError}
                  </div>
                )}

                {cropResult && (
                  <div style={{ marginTop: '12px', padding: '12px', backgroundColor: '#ecfdf5', borderRadius: '4px', fontSize: '0.9rem', color: '#065f46' }}>
                    <p style={{ margin: '0 0 8px 0' }}><strong>Cropping Completed!</strong></p>
                    <ul style={{ margin: 0, paddingLeft: '20px' }}>
                      <li>Total Rows: {cropResult.totalRows}</li>
                      <li>Cropped: {cropResult.croppedRows}</li>
                      <li>Skipped: {cropResult.skippedRows}</li>
                      <li>Warnings: {cropResult.warningRows}</li>
                      <li>Errors: {cropResult.errorRows}</li>
                    </ul>
                    <p style={{ marginTop: '8px' }}>Check the <strong>Results Tab</strong> to view crop statuses.</p>
                  </div>
                )}
              </div>
            )}

            {pipelineResult && (
              <div style={{ marginTop: '20px', borderTop: '1px solid #15803d', paddingTop: '16px' }}>
                <h4 style={{ color: '#166534', margin: '0 0 12px 0' }}>Save Import Tracking</h4>
                <p style={{ color: '#15803d', fontSize: '0.9rem', marginBottom: '16px' }}>
                  Persist extraction metadata and statuses to Wifran Database (<code>offer_sources</code>, <code>import_batches</code>, <code>import_rows</code>, <code>validation_errors</code>). Final offers will <strong>not</strong> be published yet.
                </p>
                <button
                  id="open-prepublish-from-step3-btn"
                  className="btn btn-primary btn-large"
                  disabled={dbSaving || streamingRunning || pipelineRunning || cropRunning}
                  style={{ backgroundColor: '#0f766e' }}
                  onClick={() => {
                    setShowPrePublishPreview(true)
                  }}
                >
                  Review & Publish via Pre-Publish Preview
                </button>

                {dbError && (
                  <div style={{ marginTop: '12px', color: '#c53030', fontSize: '0.9rem' }}>
                    <strong>Database Save Failed:</strong> {dbError}
                  </div>
                )}

                {dbResult && (
                  <div style={{ marginTop: '12px', padding: '12px', backgroundColor: '#ecfdf5', borderRadius: '4px', fontSize: '0.9rem', color: '#065f46' }}>
                    <p style={{ margin: '0 0 8px 0' }}><strong>Import Tracking Saved Successfully!</strong></p>
                    <ul style={{ margin: 0, paddingLeft: '20px' }}>
                      <li>Offer Source ID: {dbResult.sourceId}</li>
                      <li>Import Batch ID: {dbResult.importBatchId}</li>
                      <li>Inserted Rows: {dbResult.insertedImportRowCount}</li>
                      <li>Inserted Errors: {dbResult.insertedValidationErrorCount}</li>
                      <li>Batch Status: {dbResult.batchStatus}</li>
                    </ul>
                    <p style={{ marginTop: '8px' }}>Check the <strong>Results Tab</strong> to view these IDs.</p>
                  </div>
                )}
              </div>
            )}

            {(dbResult || pipelineResult) && (
              <div style={{ marginTop: '20px', borderTop: '1px solid #15803d', paddingTop: '16px' }}>
                <h4 style={{ color: '#166534', margin: '0 0 12px 0' }}>Match Entities</h4>
                <p style={{ color: '#15803d', fontSize: '0.9rem', marginBottom: '16px' }}>
                  Match extracted rows to Wifran Database (<code>brands</code>, <code>categories</code>, <code>products</code>, <code>product_aliases</code>). Final offers will <strong>not</strong> be published yet.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px', fontSize: '0.9rem' }}>
                  <div className="status-row"><strong>Auto-create Brands:</strong> {configStatus?.importBehavior.autoCreateBrands ? <StatusBadge variant="success">Yes</StatusBadge> : <StatusBadge variant="warning">No</StatusBadge>}</div>
                  <div className="status-row"><strong>Auto-create Products:</strong> {configStatus?.importBehavior.autoCreateProducts ? <StatusBadge variant="success">Yes</StatusBadge> : <StatusBadge variant="warning">No</StatusBadge>}</div>
                  <div className="status-row"><strong>Auto-create Categories:</strong> {configStatus?.importBehavior.autoCreateCategories ? <StatusBadge variant="success">Yes</StatusBadge> : <StatusBadge variant="warning">No</StatusBadge>}</div>
                </div>
                <button
                  className="btn btn-primary btn-large"
                  disabled={matchRunning || streamingRunning || pipelineRunning || cropRunning || dbSaving}
                  style={{ backgroundColor: '#4338ca' }}
                  onClick={() => {
                    const inputRows = pipelineResult!.normalizedRows.map((r: any, index: number) => ({
                      importRowId: dbResult?.insertedImportRowCount ? `mock-row-${index}` : undefined, // Will be replaced by real DB row lookup in future, but service accepts nulls
                      rowNumber: index + 1,
                      rowId: r.source.row_id,
                      pageNumber: r.source.page_number,
                      status: r.status,
                      skipReason: r.skip_reason,
                      normalizedData: r
                    }))

                    matchRows({
                      importBatchId: dbResult?.importBatchId || null,
                      rows: inputRows,
                      options: {
                        autoCreateBrands: !!configStatus?.importBehavior.autoCreateBrands,
                        autoCreateProducts: !!configStatus?.importBehavior.autoCreateProducts,
                        autoCreateCategories: !!configStatus?.importBehavior.autoCreateCategories
                      }
                    })
                  }}
                >
                  {matchRunning ? 'Matching Entities...' : 'Match Entities'}
                </button>

                {matchError && (
                  <div style={{ marginTop: '12px', color: '#c53030', fontSize: '0.9rem' }}>
                    <strong>Entity Matching Failed:</strong> {matchError}
                  </div>
                )}

                {matchResult && (
                  <div style={{ marginTop: '12px', padding: '12px', backgroundColor: '#eef2ff', borderRadius: '4px', fontSize: '0.9rem', color: '#3730a3' }}>
                    <p style={{ margin: '0 0 8px 0' }}><strong>Entity Matching Completed!</strong></p>
                    <ul style={{ margin: 0, paddingLeft: '20px' }}>
                      <li>Matched Rows: {matchResult.matchedRows}</li>
                      <li>Warnings: {matchResult.warningRows}</li>
                      <li>Errors: {matchResult.errorRows}</li>
                      <li>Skipped: {matchResult.skippedRows}</li>
                      <li>Brands Created: {matchResult.brandsCreated}</li>
                      <li>Categories Created: {matchResult.categoriesCreated}</li>
                      <li>Products Created: {matchResult.productsCreated}</li>
                      <li>Aliases Created: {matchResult.aliasesCreated}</li>
                    </ul>
                    <p style={{ marginTop: '8px' }}>Check the <strong>Results Tab</strong> to view matches.</p>
                  </div>
                )}
              </div>
            )}

            {matchResult && (
              <div style={{ marginTop: '20px', borderTop: '1px solid #15803d', paddingTop: '16px' }}>
                <h4 style={{ color: '#166534', margin: '0 0 12px 0' }}>Prepare Offers and Check Duplicates</h4>
                <p style={{ color: '#15803d', fontSize: '0.9rem', marginBottom: '16px' }}>
                  Validate constraints, calculate discounts/scores, check for DB duplicates, and build the final payloads. Final offers will <strong>not</strong> be published yet.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px', fontSize: '0.9rem' }}>
                  <div className="status-row"><strong>Skip Duplicates:</strong> {configStatus?.importBehavior.skipDuplicateOffers ? <StatusBadge variant="success">Yes</StatusBadge> : <StatusBadge variant="warning">No</StatusBadge>}</div>
                  <div className="status-row"><strong>Default Status:</strong> <StatusBadge variant="info">{configStatus?.importBehavior.importDefaultStatus || 'published'}</StatusBadge></div>
                  <div className="status-row"><strong>Quality Threshold:</strong> <StatusBadge variant="info">{configStatus?.importBehavior.dataQualityNeedsReviewThreshold}</StatusBadge></div>
                  <div className="status-row"><strong>Require Image:</strong> {configStatus?.importBehavior.requireImageForDraft ? <StatusBadge variant="success">Yes</StatusBadge> : <StatusBadge variant="warning">No</StatusBadge>}</div>
                </div>
                <button
                  className="btn btn-primary btn-large"
                  disabled={prepRunning || matchRunning || streamingRunning || pipelineRunning || cropRunning || dbSaving}
                  style={{ backgroundColor: '#be185d' }}
                  onClick={() => {
                    // Collect rows that were matched (or at least passed to match step, excluding initial skipped ones)
                    // We can rebuild the input from the matchResult because it contains updatedNormalizedData
                    const prepRows = matchResult.results.map(mr => ({
                      importRowId: mr.importRowId,
                      rowNumber: mr.rowNumber,
                      rowId: mr.rowId,
                      pageNumber: mr.updatedNormalizedData?.source?.page_number || 1,
                      status: mr.status as any,
                      skipReason: mr.status === 'skipped' ? 'Skipped in previous steps' : null,
                      normalizedData: mr.updatedNormalizedData
                    }))

                    prepareOffers({
                      importBatchId: dbResult?.importBatchId || null,
                      sourceId: dbResult?.sourceId || null,
                      leafletId: formState.location?.leafletId || null,
                      supermarketId: formState.supermarketId!,
                      locationScope: formState.location?.locationScope || 'national',
                      cityId: formState.location?.cityId || null,
                      regionId: formState.location?.regionId || null,
                      offerStartDate: formState.offerStartDate,
                      offerEndDate: formState.offerEndDate,
                      rows: prepRows,
                      options: {
                        skipDuplicateOffers: !!configStatus?.importBehavior.skipDuplicateOffers,
                        defaultOfferStatus: configStatus?.importBehavior.defaultOfferStatus || 'published',
                        importDefaultStatus: configStatus?.importBehavior.importDefaultStatus || 'published',
                        allowNeedsReviewFallback: configStatus?.importBehavior.allowNeedsReviewFallback !== false,
                        publishWarningsAllowed: configStatus?.importBehavior.publishWarningsAllowed !== false,
                        dataQualityNeedsReviewThreshold: configStatus?.importBehavior.dataQualityNeedsReviewThreshold || 80,
                        requireImageForDraft: !!configStatus?.importBehavior.requireImageForDraft
                      }
                    })
                  }}
                >
                  {prepRunning ? 'Preparing Offers...' : 'Prepare Offer Payloads'}
                </button>

                {prepError && (
                  <div style={{ marginTop: '12px', color: '#9f1239', fontSize: '0.9rem' }}>
                    <strong>Preparation Failed:</strong> {prepError}
                  </div>
                )}

                {prepResult && (
                  <div style={{ marginTop: '12px', padding: '12px', backgroundColor: '#fdf2f8', borderRadius: '4px', fontSize: '0.9rem', color: '#9d174d' }}>
                    <p style={{ margin: '0 0 8px 0' }}><strong>Preparation Completed!</strong></p>
                    <ul style={{ margin: 0, paddingLeft: '20px' }}>
                      <li>Prepared (Draft): {prepResult.preparedRows}</li>
                      <li>Needs Review: {prepResult.needsReviewRows}</li>
                      <li>Duplicates: {prepResult.duplicateRows}</li>
                      <li>Errors: {prepResult.errorRows}</li>
                      <li>Skipped: {prepResult.skippedRows}</li>
                    </ul>
                    <p style={{ marginTop: '8px' }}>Check the <strong>Results Tab</strong> to view the structured payloads.</p>
                  </div>
                )}
              </div>
            )}

            {prepResult && (
              <div style={{ marginTop: '20px', borderTop: '1px solid #0369a1', paddingTop: '16px' }}>
                <h4 style={{ color: '#075985', margin: '0 0 12px 0' }}>Sync Offers to Wifran</h4>
                <p style={{ color: '#0369a1', fontSize: '0.9rem', marginBottom: '8px' }}>
                  This will upload cropped images to Supabase Storage and create/update offers in Wifran.
                </p>
                <div style={{ backgroundColor: '#fffbeb', borderLeft: '4px solid #f59e0b', padding: '12px', marginBottom: '16px', fontSize: '0.9rem', color: '#92400e' }}>
                  <strong>Operator Notice:</strong> Valid rows will be created or updated as <code>{configStatus?.importBehavior.importDefaultStatus || 'published'}</code> and may become live in Wifran immediately after sync.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px', fontSize: '0.9rem' }}>
                  <div className="status-row"><strong>Storage Bucket:</strong> <StatusBadge variant={configStatus?.supabase.storageBucket.configured ? 'success' : 'error'}>{configStatus?.supabase.storageBucket.configured ? 'Ready' : 'Missing'}</StatusBadge></div>
                </div>
                <button
                  id="open-prepublish-from-step6-btn"
                  className="btn btn-primary btn-large"
                  disabled={syncRunning || prepRunning || matchRunning || streamingRunning || pipelineRunning || cropRunning || dbSaving || !configStatus?.supabase.storageBucket.configured}
                  style={{ backgroundColor: '#0284c7' }}
                  onClick={() => {
                    setShowPrePublishPreview(true)
                  }}
                >
                  Open Pre-Publish Preview to Publish
                </button>

                {syncRunning && syncProgress && (
                  <div style={{ marginTop: '12px', fontSize: '0.9rem', color: '#0369a1' }}>
                    <p style={{ margin: '0 0 4px 0' }}><strong>Progress:</strong> {syncProgress.current} / {syncProgress.total}</p>
                    <p style={{ margin: 0 }}>{syncProgress.message}</p>
                  </div>
                )}

                {syncError && (
                  <div style={{ marginTop: '12px', color: '#b91c1c', fontSize: '0.9rem' }}>
                    <strong>Sync Failed:</strong> {syncError}
                  </div>
                )}

                {syncResult && (
                  <div style={{ marginTop: '12px', padding: '12px', backgroundColor: '#f0f9ff', borderRadius: '4px', fontSize: '0.9rem', color: '#0369a1' }}>
                    <p style={{ margin: '0 0 8px 0' }}><strong>Sync Completed!</strong></p>
                    <ul style={{ margin: 0, paddingLeft: '20px' }}>
                      <li>Imported (Published): {syncResult.publishedRows || 0}</li>
                      <li>Imported (Draft): {syncResult.importedRows}</li>
                      <li>Imported (Needs Review): {syncResult.needsReviewImportedRows}</li>
                      <li>Skipped / Duplicates: {syncResult.skippedRows + syncResult.duplicateRows}</li>
                      <li>Errors: {syncResult.errorRows}</li>
                      <li>Images Uploaded: {syncResult.imageUploadedRows}</li>
                    </ul>
                    <p style={{ marginTop: '8px' }}>Batch Status: <strong>{syncResult.status}</strong></p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
          </div>
        </div>
      
      <div style={{ flex: '0 0 300px', alignSelf: 'start', position: 'sticky', top: '20px' }}>
        <div className="card" style={{ padding: '16px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '1.1rem', color: '#f8fafc' }}>Actions</h3>
          {!loadedManifest ? (
            <button 
              className="btn btn-primary btn-large"
              style={{ width: '100%', marginBottom: '12px' }}
              disabled={!canStart || streamingRunning} 
              onClick={() => {
                if (formState.pdfFile && configStatus) {
                  setAutoRun(false)
                  startStreamingRender({
                    pdfPath: formState.pdfFile.path,
                    originalFileName: formState.pdfFile.name,
                    chunkSize: configStatus.ocr.chunkSize,
                    dpi: configStatus.pdf.renderDpi,
                    metadata: {
                      supermarketId: formState.supermarketId,
                      location: formState.location,
                      offerDates: {
                        offerStartDate: formState.offerStartDate,
                        offerEndDate: formState.offerEndDate
                      },
                      parsedMetadata: formState.pdfFile.parsedMetadata
                    }
                  })
                }
              }}
            >
              {streamingRunning ? 'Extracting...' : 'Start Extraction'}
            </button>
          ) : (
            <button 
              className="btn btn-primary btn-large"
              style={{ width: '100%', marginBottom: '12px' }}
              disabled={loadedManifest.extraction_status === 'completed' || streamingRunning} 
              onClick={async () => {
                if (loadedManifest && streamingState?.workspacePath) {
                  const res = await window.wifranExtractor.extractionPackage.continueExtraction(streamingState.workspacePath)
                  if (res.ok) {
                    if (res.resumeAction === 'open_manual_crop') {
                      setShowManualCropEditor(true)
                    } else if (res.resumeAction === 'start_rendering') {
                      if (formState.pdfFile && configStatus) {
                        startStreamingRender({
                          pdfPath: formState.pdfFile.path,
                          workspacePath: streamingState.workspacePath,
                          originalFileName: formState.pdfFile.name,
                          chunkSize: configStatus.ocr.chunkSize,
                          dpi: configStatus.pdf.renderDpi,
                          pageCount: loadedManifest.page_count
                        })
                      }
                    } else {
                      alert(`Resume Action: ${res.resumeAction}. (Routing for downstream stages to be implemented)`)
                    }
                  } else {
                    alert(`Failed to continue extraction: ${res.error}`)
                  }
                }
              }}
            >
              {loadedManifest.extraction_status === 'completed' ? 'Extraction Completed' : 'Continue Extraction'}
            </button>
          )}

          {loadedManifest?.extraction_status === 'completed' && packageValidation?.dbEligible && (
            <button 
              className="btn btn-primary btn-large"
              style={{ width: '100%', marginBottom: '12px' }}
              onClick={() => setShowPrePublishPreview(true)}
            >
              Pre-Publish Preview
            </button>
          )}

          <button 
            id="open-existing-extraction-folder-btn"
            className="btn btn-secondary btn-large"
            style={{ width: '100%', marginBottom: '12px' }}
            disabled={streamingRunning}
            onClick={() => setShowPreviousExtractions(true)}
          >
            Open Existing Extraction Folder...
          </button>
          
          {packageValidation && !packageValidation.dbEligible && (
            <div style={{ marginTop: '8px', fontSize: '0.8rem', color: '#dc2626' }}>
              Requires completed extraction and valid metadata to view preview.
            </div>
          )}
        </div>

        {loadedManifest && (
          <div className="card" style={{ padding: '16px', marginBottom: '20px' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', color: '#f8fafc' }}>Package Summary</h3>
            <div style={{ fontSize: '0.9rem', color: '#cbd5e1' }}>
              <div style={{ marginBottom: '4px' }}><strong>Status:</strong> {loadedManifest.extraction_status}</div>
              <div style={{ marginBottom: '4px' }}><strong>Pages:</strong> {loadedManifest.counts?.pages_rendered || 0}</div>
              <div style={{ marginBottom: '4px' }}><strong>Crops:</strong> {loadedManifest.counts?.crop_images || 0}</div>
              <div style={{ marginBottom: '4px' }}><strong>JSONs:</strong> {loadedManifest.counts?.json_files || 0}</div>
              <div style={{ marginBottom: '4px' }}><strong>Matches:</strong> {loadedManifest.counts?.matched_crop_json_pairs || 0}</div>
              {(loadedManifest.counts?.orphan_crop_images || 0) > 0 && (
                <div style={{ color: '#fb923c' }}><strong>Orphan Crops:</strong> {loadedManifest.counts?.orphan_crop_images}</div>
              )}
              {(loadedManifest.counts?.orphan_json_files || 0) > 0 && (
                <div style={{ color: '#fb923c' }}><strong>Orphan JSONs:</strong> {loadedManifest.counts?.orphan_json_files}</div>
              )}
            </div>
          </div>
        )}

        <div className="card" style={{ padding: '16px' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '1rem', color: '#f8fafc' }}>Pipeline Progress</h3>
          <ProgressTimeline stages={summary.stages} />
        </div>
      </div>
      </div>

      {showManualCropEditor && streamingState?.workspacePath && formState.pdfFile && (
        <ManualCropEditor 
          workspacePath={streamingState.workspacePath}
          pdfPath={formState.pdfFile.path}
          renderedPages={streamingPages}
          streamingState={streamingState}
          supermarketCode={formState.pdfFile?.parsedMetadata?.supermarket_code || loadedManifest?.leaflet_filename_metadata?.supermarket_code || undefined}
          supermarketDescription={formState.pdfFile?.parsedMetadata?.supermarket_description || loadedManifest?.leaflet_filename_metadata?.supermarket_description || undefined}
          onClose={() => setShowManualCropEditor(false)}
          onComplete={() => setShowManualCropEditor(false)}
        />
      )}

      {/* Pre-DB Review Summary — Step 3 */}
      {ctx.cropAndItemOcr.result && ctx.cropAndItemOcr.result.reviewItems.length > 0 && (
        <div style={{ marginTop: '24px' }}>
          <PreDbReviewSummary
            workflowResult={ctx.cropAndItemOcr.result}
            dbSyncEnabled={false} // Disabled in favor of PrePublishPreview
            dbSyncRunning={false}
            onProceedToUpdateDb={async () => {}}
          />
        </div>
      )}

      {showPrePublishPreview && (previewWorkspacePath || loadedManifest?.extraction_folder_path || streamingState?.workspacePath) && (
        <PrePublishPreview 
          workspacePath={(previewWorkspacePath || loadedManifest?.extraction_folder_path || streamingState?.workspacePath)!}
          isDryRun={(previewWorkspacePath || loadedManifest?.extraction_folder_path || streamingState?.workspacePath || '').toLowerCase().includes('_qa') || (previewWorkspacePath || loadedManifest?.extraction_folder_path || streamingState?.workspacePath || '').toLowerCase().includes('qa_')}
          qaMode={(previewWorkspacePath || loadedManifest?.extraction_folder_path || streamingState?.workspacePath || '').toLowerCase().includes('_qa') || (previewWorkspacePath || loadedManifest?.extraction_folder_path || streamingState?.workspacePath || '').toLowerCase().includes('qa_')}
          backButtonText={previewOrigin === 'previous_extractions' ? 'Back to Extractions' : 'Close'}
          onClose={() => setShowPrePublishPreview(false)}
          onPublishStarted={(isDryRun) => {
            setShowPrePublishPreview(false)
            if (pipelineResult && cropResult && data && formState.supermarketId) {
              const smLabel = data.supermarkets.find(s => s.id === formState.supermarketId)?.name_en || null
              const input = {
                metadata: {
                  supermarketId: formState.supermarketId,
                  locationScope: formState.location?.locationScope || 'national',
                  cityId: formState.location?.cityId || null,
                  regionId: formState.location?.regionId || null,
                  supermarketLabel: smLabel,
                  locationLabel: formState.location?.label || null,
                  offerStartDate: formState.offerStartDate,
                  offerEndDate: formState.offerEndDate,
                  originalFileName: formState.pdfFile?.name || 'unknown.pdf',
                  workspacePath: loadedManifest?.extraction_folder_path || streamingState?.workspacePath || '',
                  leafletId: formState.location?.leafletId || null
                },
                ocr: {
                  totalExtractedItems: pipelineResult.totalExtractedItems,
                  totalNormalizedRows: pipelineResult.totalNormalizedRows,
                  validRowCount: pipelineResult.validRowCount,
                  warningRowCount: pipelineResult.warningRowCount,
                  errorRowCount: pipelineResult.errorRowCount,
                  skippedRowCount: pipelineResult.failedChunks,
                  skippedPromotionalRowCount: pipelineResult.skippedPromotionalRowCount,
                  normalizedRows: pipelineResult.normalizedRows
                },
                crops: cropResult,
                dryRun: isDryRun
              }
              dbPersist(input as any)
              setAutoRun(true) // let the cascade continue
            } else {
              alert('DB Update started... (Requires pipelineResult in context, or integration with sync workflow)')
            }
          }}
        />
      )}
      
      {data && (
        <div style={{ marginTop: '20px', fontSize: '0.85rem', color: '#64748b' }}>
          <strong>Reference Data Loaded:</strong>{' '}
          <StatusBadge status="completed" variant="info" /> {data.supermarkets.length} Supermarkets{' '}
          <StatusBadge status="completed" variant="info" /> {data.categories.length} Categories{' '}
          <StatusBadge status="completed" variant="info" /> {data.brands.length} Brands
        </div>
      )}
    </div>
  )
}

