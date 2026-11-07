import React, { useState, useRef } from 'react'
import type {
  ExportHybridImageRefsResult,
  CsvValidationSummary,
  UploadProductImagesResult,
  ValidatedCsvRow
} from '../../../../shared/types/productImageEnrichment'

interface ImageEnrichmentWorkflowProps {
  onSuccess?: () => void
}

export function ImageEnrichmentWorkflow({ onSuccess }: ImageEnrichmentWorkflowProps): JSX.Element {
  // -------------------------------------------------------------
  // Step 1: Export State
  // -------------------------------------------------------------
  const [includeUnresolvedOffers, setIncludeUnresolvedOffers] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportSuccess, setExportSuccess] = useState<{
    filePath?: string
    result: ExportHybridImageRefsResult
  } | null>(null)

  // -------------------------------------------------------------
  // Step 3: Import & Validation State
  // -------------------------------------------------------------
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null)
  const [csvContent, setCsvContent] = useState<string>('')
  const [validating, setValidating] = useState(false)
  const [validationSummary, setValidationSummary] = useState<CsvValidationSummary | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [tableFilter, setTableFilter] = useState<'all' | 'valid' | 'skipped' | 'errors'>('all')

  // -------------------------------------------------------------
  // Step 3: Execution State
  // -------------------------------------------------------------
  const [operatorConfirmedReview, setOperatorConfirmedReview] = useState(false)
  const [uploadingImages, setUploadingImages] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{
    current: number
    total: number
    message: string
    stage: string
  } | null>(null)
  const [uploadResult, setUploadResult] = useState<UploadProductImagesResult | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // =============================================================
  // Step 1: Export CSV Handler
  // =============================================================
  const handleExportCsv = async () => {
    setExporting(true)
    setExportError(null)
    setExportSuccess(null)

    try {
      // 1. Generate Hybrid CSV from backend
      const exportRes: ExportHybridImageRefsResult =
        await window.wifranExtractor.catalog.exportImageCsv({
          includeUnresolvedOffers
        })

      // 2. Open Electron Save Dialog
      const defaultFileName = 'wifran_v2_hybrid_image_refs_for_search.csv'
      let savedPath: string | undefined

      if (window.wifranExtractor.catalog.saveExportedCsvDialog) {
        const dialogRes = await window.wifranExtractor.catalog.saveExportedCsvDialog({
          defaultFileName,
          csvContent: exportRes.csvContent
        })

        if (dialogRes.canceled) {
          setExporting(false)
          return
        }
        savedPath = dialogRes.filePath
      } else {
        // Fallback for non-Electron / browser mock environments
        const blob = new Blob([exportRes.csvContent], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = defaultFileName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        savedPath = defaultFileName
      }

      setExportSuccess({
        filePath: savedPath,
        result: exportRes
      })
    } catch (err: any) {
      setExportError(err.message || 'Failed to export hybrid image search CSV')
    } finally {
      setExporting(false)
    }
  }

  // =============================================================
  // Step 3: File Selection & Read-Only Validation Handler
  // =============================================================
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    processSelectedFile(file)
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    processSelectedFile(file)
  }

  const processSelectedFile = (file: File) => {
    setSelectedFileName(file.name)
    setValidationError(null)
    setUploadResult(null)
    setUploadError(null)
    setOperatorConfirmedReview(false)
    setValidating(true)

    const reader = new FileReader()
    reader.onload = async (evt) => {
      const content = (evt.target?.result as string) || ''
      setCsvContent(content)

      try {
        // Read-only offline validation against DB references (NO network downloads or DB writes)
        const summary = await window.wifranExtractor.catalog.validateImageCsv(content)
        setValidationSummary(summary)
      } catch (err: any) {
        setValidationError(err.message || 'Failed to validate imported CSV')
        setValidationSummary(null)
      } finally {
        setValidating(false)
      }
    }
    reader.onerror = () => {
      setValidationError('Failed to read the selected file.')
      setValidating(false)
    }
    reader.readAsText(file)
  }

  // =============================================================
  // Step 3: Execution Upload Handler
  // =============================================================
  const handleUploadImages = async () => {
    if (!operatorConfirmedReview || !csvContent || !validationSummary?.ok) return

    setUploadingImages(true)
    setUploadError(null)
    setUploadResult(null)
    setUploadProgress({ current: 0, total: validationSummary.validRowsCount, message: 'Initiating upload batch...', stage: 'starting' })

    const unsubscribe = window.wifranExtractor.catalog.onUploadProgress((p: any) => {
      setUploadProgress(p)
    })

    try {
      const res = await window.wifranExtractor.catalog.uploadProductImages({
        csvContent,
        operatorConfirmedReview: true,
        reviewedBy: 'operator',
        rightsBasis: 'operator_manual_verified'
      })
      setUploadResult(res)
      if (onSuccess) {
        onSuccess()
      }
    } catch (err: any) {
      setUploadError(err.message || 'Failed to execute image batch upload')
    } finally {
      unsubscribe()
      setUploadingImages(false)
    }
  }

  // =============================================================
  // Reset Handler
  // =============================================================
  const handleResetImport = () => {
    setSelectedFileName(null)
    setCsvContent('')
    setValidationSummary(null)
    setValidationError(null)
    setOperatorConfirmedReview(false)
    setUploadProgress(null)
    setUploadResult(null)
    setUploadError(null)
    setTableFilter('all')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Filtered rows for preview table
  const displayedRows: ValidatedCsvRow[] = (validationSummary?.rows || []).filter((r) => {
    if (tableFilter === 'valid') return r.status === 'valid'
    if (tableFilter === 'skipped') return r.status === 'blank_skipped' || r.status === 'already_has_image'
    if (tableFilter === 'errors')
      return (
        r.status === 'invalid_url' ||
        r.status === 'unknown_product' ||
        r.status === 'duplicate_product'
      )
    return true
  })

  return (
    <div className="space-y-8 text-slate-100">
      {/* ========================================================= */}
      {/* SECTION 1: EXPORT HYBRID IMAGE SEARCH CSV (STEP 1)       */}
      {/* ========================================================= */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-md space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-indigo-600 text-white font-bold text-xs flex items-center justify-center shadow">
                1
              </span>
              <h3 className="text-base font-bold text-white tracking-wide">
                Step 1: Export Hybrid Image Search CSV
              </h3>
            </div>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed max-w-2xl">
              Generates a unified 2-column CSV (<code className="text-indigo-300 font-mono">Image_Ref,item_name</code>)
              with UTF-8 BOM. Combines verified catalog products (<code className="text-emerald-400 font-mono">P</code> refs)
              and visual-subject deduped merchandise offers (<code className="text-cyan-400 font-mono">O</code> refs).
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              id="export-image-search-csv-btn"
              onClick={handleExportCsv}
              disabled={exporting}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-xs px-5 py-2.5 rounded-lg shadow-lg flex items-center gap-2 transition"
            >
              {exporting ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                  </svg>
                  <span>Exporting &amp; Saving CSV...</span>
                </>
              ) : (
                <>
                  <span>📥</span>
                  <span>Export Image Search CSV</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Export Options */}
        <div className="flex items-center gap-2 pt-1 text-xs text-slate-300">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeUnresolvedOffers}
              onChange={(e) => setIncludeUnresolvedOffers(e.target.checked)}
              className="rounded border-slate-700 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
            />
            <span>Include distinct uncatalogued merchandise offers (<code className="text-cyan-300 font-mono">O...</code>) with visual subject grouping</span>
          </label>
        </div>

        {/* Export Error */}
        {exportError && (
          <div className="p-3 bg-red-950/60 border border-red-800 text-red-300 rounded-lg text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>⚠️</span>
              <span>{exportError}</span>
            </div>
            <button
              onClick={() => setExportError(null)}
              className="text-red-400 hover:text-white text-xs font-bold px-2 py-0.5"
            >
              ✕
            </button>
          </div>
        )}

        {/* Export Success Notification & Breakdown Card */}
        {exportSuccess && (
          <div className="bg-slate-950/80 border border-emerald-800/80 rounded-lg p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-emerald-400 text-base">✅</span>
                <div>
                  <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                    Export Complete &amp; Saved Successfully
                  </h4>
                  {exportSuccess.filePath && (
                    <p className="text-[11px] text-slate-300 font-mono mt-0.5 break-all">
                      Saved to: <span className="text-white font-semibold">{exportSuccess.filePath}</span>
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={() => setExportSuccess(null)}
                className="text-slate-400 hover:text-white text-xs px-2 py-0.5"
              >
                ✕
              </button>
            </div>

            {/* Metrics Breakdown */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-xs">
              <div className="bg-slate-900 border border-slate-800 p-2.5 rounded">
                <div className="text-[10px] text-slate-400 font-medium">Total Search Refs</div>
                <div className="text-lg font-bold text-white mt-0.5">{exportSuccess.result.count}</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 p-2.5 rounded">
                <div className="text-[10px] text-emerald-400 font-medium">Verified Products (P)</div>
                <div className="text-lg font-bold text-emerald-400 mt-0.5">{exportSuccess.result.pCount}</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 p-2.5 rounded">
                <div className="text-[10px] text-cyan-400 font-medium">Visual Offers (O)</div>
                <div className="text-lg font-bold text-cyan-400 mt-0.5">{exportSuccess.result.oCount}</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 p-2.5 rounded">
                <div className="text-[10px] text-indigo-400 font-medium">Assortment Grouped</div>
                <div className="text-lg font-bold text-indigo-400 mt-0.5">{exportSuccess.result.groupedOffersCount}</div>
              </div>
            </div>

            {/* Mini Preview of First 3 Rows */}
            {exportSuccess.result.rows?.length > 0 && (
              <div className="text-[11px] text-slate-400 border-t border-slate-800/80 pt-2 space-y-1">
                <span className="font-semibold text-slate-300">Sample Export Rows:</span>
                <div className="font-mono text-[10px] space-y-0.5 max-h-20 overflow-y-auto">
                  {exportSuccess.result.rows.slice(0, 3).map((r, i) => (
                    <div key={i} className="truncate bg-slate-900/60 px-2 py-1 rounded">
                      <span className="text-indigo-300 font-bold">{r.imageRef}</span>
                      <span className="text-slate-500">, </span>
                      <span className="text-slate-200">{r.itemName}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ========================================================= */}
      {/* SECTION 2: IMPORT APPROVED IMAGE CANDIDATES (STEP 3)     */}
      {/* ========================================================= */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-md space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-emerald-600 text-white font-bold text-xs flex items-center justify-center shadow">
                3
              </span>
              <h3 className="text-base font-bold text-white tracking-wide">
                Step 3: Import Approved Image Candidates
              </h3>
            </div>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed max-w-2xl">
              Import operator-reviewed CSV (<code className="text-emerald-300 font-mono">Image_Ref,image_url</code>).
              Performs strict offline reference validation before dual-routing binaries to{' '}
              <code className="text-emerald-400 font-mono">product-images</code> (<code className="text-emerald-300 font-mono">P</code>) or{' '}
              <code className="text-cyan-400 font-mono">offer-display-images</code> (<code className="text-cyan-300 font-mono">O</code>) with SHA-256 deduplication.
            </p>
          </div>

          {selectedFileName && (
            <button
              onClick={handleResetImport}
              disabled={uploadingImages}
              className="text-xs text-slate-400 hover:text-white border border-slate-700 hover:bg-slate-800 px-3 py-1.5 rounded-lg transition"
            >
              🔄 Clear &amp; Reset
            </button>
          )}
        </div>

        {/* 1. File Picker & Drag-and-Drop Dropzone */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl p-6 text-center transition ${
            selectedFileName
              ? 'border-emerald-600/60 bg-emerald-950/10'
              : 'border-slate-700 hover:border-indigo-500 bg-slate-950/40'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            id="step3-csv-file-input"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="hidden"
          />

          <div className="flex flex-col items-center justify-center space-y-2">
            <span className="text-3xl">📄</span>
            {selectedFileName ? (
              <div>
                <p className="text-sm font-bold text-emerald-400">{selectedFileName}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  File loaded • {validationSummary ? `${validationSummary.totalRows} rows parsed` : 'Processing...'}
                </p>
              </div>
            ) : (
              <div>
                <p className="text-sm font-semibold text-white">
                  Drop completed Step 2 CSV file here, or{' '}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-indigo-400 hover:text-indigo-300 underline font-medium"
                  >
                    browse to select
                  </button>
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Expected 2-column format: <code className="text-slate-400">Image_Ref,image_url</code>
                </p>
              </div>
            )}

            {!selectedFileName && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium px-4 py-1.5 rounded-lg transition"
              >
                Select CSV File
              </button>
            )}
          </div>
        </div>

        {/* Offline Validation Spinner */}
        {validating && (
          <div className="flex items-center gap-2 p-3 bg-indigo-950/40 border border-indigo-800 rounded-lg text-xs text-indigo-300">
            <svg className="animate-spin h-4 w-4 text-indigo-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
            </svg>
            <span>Validating CSV structure and database references (Offline / Zero Network)...</span>
          </div>
        )}

        {/* Validation Errors Notice */}
        {validationError && (
          <div className="p-3 bg-red-950/60 border border-red-800 text-red-300 rounded-lg text-xs">
            ⚠️ {validationError}
          </div>
        )}

        {/* 2. Validation Results & Preview Table */}
        {validationSummary && (
          <div className="space-y-4 pt-2">
            {/* Metric Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <div className="text-[11px] text-slate-400 font-medium">Total Rows in CSV</div>
                <div className="text-xl font-bold text-white mt-0.5">{validationSummary.totalRows}</div>
              </div>
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <div className="text-[11px] text-emerald-400 font-medium">Valid Rows to Fetch</div>
                <div className="text-xl font-bold text-emerald-400 mt-0.5">{validationSummary.validRowsCount}</div>
              </div>
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <div className="text-[11px] text-slate-400 font-medium">Blank Skipped</div>
                <div className="text-xl font-bold text-slate-300 mt-0.5">{validationSummary.blankSkippedCount}</div>
              </div>
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <div className="text-[11px] text-red-400 font-medium">Validation Errors</div>
                <div className={`text-xl font-bold mt-0.5 ${validationSummary.errorCount > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {validationSummary.errorCount}
                </div>
              </div>
            </div>

            {/* Error List Alert if any */}
            {validationSummary.errors.length > 0 && (
              <div className="p-3 bg-red-950/60 border border-red-800 rounded-lg text-xs space-y-1">
                <div className="font-bold text-red-300 flex items-center gap-1.5">
                  <span>⛔</span>
                  <span>Validation Blockers ({validationSummary.errors.length})</span>
                </div>
                <ul className="list-disc list-inside text-red-200 text-[11px] space-y-0.5 max-h-32 overflow-y-auto">
                  {validationSummary.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Table Filter Tabs */}
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
                <button
                  type="button"
                  onClick={() => setTableFilter('all')}
                  className={`px-3 py-1 rounded-md transition ${
                    tableFilter === 'all'
                      ? 'bg-indigo-600 text-white font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  All Rows ({validationSummary.rows.length})
                </button>
                <button
                  type="button"
                  onClick={() => setTableFilter('valid')}
                  className={`px-3 py-1 rounded-md transition ${
                    tableFilter === 'valid'
                      ? 'bg-emerald-600 text-white font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Valid to Fetch ({validationSummary.validRowsCount})
                </button>
                <button
                  type="button"
                  onClick={() => setTableFilter('skipped')}
                  className={`px-3 py-1 rounded-md transition ${
                    tableFilter === 'skipped'
                      ? 'bg-slate-700 text-white font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Skipped ({validationSummary.blankSkippedCount + validationSummary.alreadyHasImageCount})
                </button>
                {validationSummary.errorCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setTableFilter('errors')}
                    className={`px-3 py-1 rounded-md transition ${
                      tableFilter === 'errors'
                        ? 'bg-red-600 text-white font-semibold'
                        : 'text-red-400 hover:text-red-300'
                    }`}
                  >
                    Errors ({validationSummary.errorCount})
                  </button>
                )}
              </div>

              <span className="text-[11px] text-slate-500">
                Read-only DB verification • No network traffic invoked
              </span>
            </div>

            {/* Rows Preview Table */}
            <div className="border border-slate-800 rounded-lg overflow-hidden bg-slate-950/60 max-h-64 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 sticky top-0">
                  <tr>
                    <th className="p-2.5 w-10">#</th>
                    <th className="p-2.5 w-32">Image Ref</th>
                    <th className="p-2.5">Item Name</th>
                    <th className="p-2.5">Image URL</th>
                    <th className="p-2.5 w-28">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                  {displayedRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-slate-500 font-sans">
                        No rows match the selected filter.
                      </td>
                    </tr>
                  ) : (
                    displayedRows.map((r) => (
                      <tr key={r.rowNumber} className="hover:bg-slate-800/30">
                        <td className="p-2.5 text-slate-500 font-sans">{r.rowNumber}</td>
                        <td className="p-2.5">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              r.targetKind === 'product' || (r.imageRef && r.imageRef.startsWith('P'))
                                ? 'bg-indigo-950 text-indigo-300 border border-indigo-800'
                                : 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                            }`}
                          >
                            {r.imageRef}
                          </span>
                        </td>
                        <td className="p-2.5 font-sans text-slate-200 truncate max-w-xs" title={r.productName || ''}>
                          {r.productName || '—'}
                        </td>
                        <td className="p-2.5 text-slate-400 max-w-xs truncate" title={r.imageUrl || ''}>
                          {r.imageUrl ? (
                            <span className="text-slate-300 underline cursor-default">{r.imageUrl}</span>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                        <td className="p-2.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold font-sans ${
                              r.status === 'valid'
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                : r.status === 'blank_skipped'
                                ? 'bg-slate-800 text-slate-400'
                                : r.status === 'already_has_image'
                                ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                : 'bg-red-950 text-red-300 border border-red-800'
                            }`}
                          >
                            {r.status === 'valid'
                              ? 'Valid'
                              : r.status === 'blank_skipped'
                              ? 'Blank'
                              : r.status === 'already_has_image'
                              ? 'Has Image'
                              : r.status}
                          </span>
                          {r.issueMessage && (
                            <div className="text-[10px] text-red-400 font-sans mt-0.5" title={r.issueMessage}>
                              {r.issueMessage}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* 3. Operator Authorization Gate & Execution Trigger */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  id="operator-image-review-checkbox"
                  checked={operatorConfirmedReview}
                  onChange={(e) => setOperatorConfirmedReview(e.target.checked)}
                  disabled={uploadingImages || !validationSummary.ok}
                  className="mt-1 rounded border-slate-700 bg-slate-800 text-emerald-600 focus:ring-emerald-500"
                />
                <div className="text-xs text-slate-300 leading-relaxed select-none">
                  <span className="font-bold text-white">Operator Manual Review Authorization Gate (WIFRAN-07J §4):</span>{' '}
                  I confirm that I have personally inspected these images, verified exact product/offer match
                  (brand, variant, net weight/volume, and pack count), and confirmed that Wifran is authorized to download,
                  store, and display these catalog photos.
                </div>
              </label>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 border-t border-slate-800">
                <div className="text-xs text-slate-400">
                  Dual Routing Target: <code className="text-emerald-400 font-mono">product-images</code> (<code className="text-emerald-300">P</code>) &amp;{' '}
                  <code className="text-cyan-400 font-mono">offer-display-images</code> (<code className="text-cyan-300">O</code>)
                </div>

                <button
                  id="upload-product-images-db-btn"
                  onClick={handleUploadImages}
                  disabled={
                    uploadingImages ||
                    !operatorConfirmedReview ||
                    !validationSummary.ok ||
                    validationSummary.validRowsCount === 0
                  }
                  className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs px-6 py-2.5 rounded-lg shadow-lg flex items-center justify-center gap-2 transition"
                >
                  {uploadingImages ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                      </svg>
                      <span>Processing Batch...</span>
                    </>
                  ) : (
                    <>
                      <span>☁️</span>
                      <span>Upload Product Images to DB</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* 4. Live Upload Progress Indicator */}
            {uploadingImages && (
              <div className="p-4 bg-indigo-950/40 border border-indigo-800 rounded-xl space-y-2 text-xs">
                <div className="flex items-center justify-between text-indigo-300 font-semibold">
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-3.5 w-3.5 text-indigo-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                    </svg>
                    <span>Processing Batch: {uploadProgress?.current || 0} / {uploadProgress?.total || validationSummary.validRowsCount}</span>
                  </span>
                  <span className="capitalize text-slate-300 font-mono text-[11px]">{uploadProgress?.stage}</span>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-emerald-500 h-2 transition-all duration-300"
                    style={{
                      width: `${
                        uploadProgress && uploadProgress.total > 0
                          ? Math.round((uploadProgress.current / uploadProgress.total) * 100)
                          : 0
                      }%`
                    }}
                  ></div>
                </div>

                <p className="text-slate-400 text-[11px] truncate">
                  {uploadProgress?.message || 'Processing image batch...'}
                </p>
              </div>
            )}

            {/* Upload Error Alert */}
            {uploadError && (
              <div className="p-3 bg-red-950/60 border border-red-800 text-red-300 rounded-lg text-xs flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span>⚠️</span>
                  <span>{uploadError}</span>
                </div>
                <button
                  onClick={() => setUploadError(null)}
                  className="text-red-400 hover:text-white text-xs font-bold px-2 py-0.5"
                >
                  ✕
                </button>
              </div>
            )}

            {/* 5. Final Execution Summary Report */}
            {uploadResult && (
              <div className="bg-slate-950/90 border border-emerald-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400 text-lg">🎉</span>
                    <h4 className="text-sm font-bold text-white tracking-wide">
                      Batch Image Upload &amp; Deduplication Report
                    </h4>
                  </div>
                  <span
                    className={`px-2.5 py-0.5 rounded text-xs font-bold ${
                      uploadResult.success
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                        : 'bg-red-950 text-red-300 border border-red-800'
                    }`}
                  >
                    {uploadResult.success ? 'Success' : 'Partial / Errors'}
                  </span>
                </div>

                {/* Metrics Breakdown Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                  <div className="bg-slate-900 border border-slate-800 p-2.5 rounded">
                    <div className="text-[10px] text-slate-400 font-medium">Total Rows</div>
                    <div className="text-base font-bold text-white mt-0.5">{uploadResult.totalRows}</div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 p-2.5 rounded">
                    <div className="text-[10px] text-emerald-400 font-medium">Newly Uploaded</div>
                    <div className="text-base font-bold text-emerald-400 mt-0.5">{uploadResult.uploadedCount}</div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 p-2.5 rounded">
                    <div className="text-[10px] text-cyan-400 font-medium">Reused (Dedup)</div>
                    <div className="text-base font-bold text-cyan-400 mt-0.5">{uploadResult.reusedCount}</div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 p-2.5 rounded">
                    <div className="text-[10px] text-slate-400 font-medium">Skipped (Blank)</div>
                    <div className="text-base font-bold text-slate-300 mt-0.5">{uploadResult.skippedCount}</div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 p-2.5 rounded">
                    <div className="text-[10px] text-red-400 font-medium">Failed</div>
                    <div className={`text-base font-bold mt-0.5 ${uploadResult.failedCount > 0 ? 'text-red-400' : 'text-slate-500'}`}>
                      {uploadResult.failedCount}
                    </div>
                  </div>
                </div>

                {/* Per-row Result Details Summary */}
                {uploadResult.results && uploadResult.results.length > 0 && (
                  <div className="border border-slate-800 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                    <table className="w-full text-left font-mono text-[10px]">
                      <thead className="bg-slate-900 text-slate-400 border-b border-slate-800 sticky top-0 font-sans">
                        <tr>
                          <th className="p-2">Ref</th>
                          <th className="p-2">Target Storage Bucket</th>
                          <th className="p-2">Action</th>
                          <th className="p-2">Path / Hash</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {uploadResult.results.map((r, i) => {
                          const bucket =
                            r.targetKind === 'product' || (r.imageRef && r.imageRef.startsWith('P'))
                              ? 'product-images'
                              : 'offer-display-images'
                          return (
                            <tr key={i} className="hover:bg-slate-800/30">
                              <td className="p-2 font-bold text-slate-200">{r.imageRef}</td>
                              <td className="p-2 text-slate-400">
                                <span className={bucket === 'product-images' ? 'text-emerald-300' : 'text-cyan-300'}>
                                  {bucket}
                                </span>
                              </td>
                              <td className="p-2">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-sans font-semibold ${
                                    r.status === 'uploaded'
                                      ? 'bg-emerald-950 text-emerald-300'
                                      : r.status === 'reused'
                                      ? 'bg-cyan-950 text-cyan-300'
                                      : r.status === 'skipped'
                                      ? 'bg-slate-800 text-slate-400'
                                      : 'bg-red-950 text-red-300'
                                  }`}
                                >
                                  {r.status}
                                </span>
                              </td>
                              <td className="p-2 text-slate-400 truncate max-w-xs" title={r.storagePath || r.error || ''}>
                                {r.storagePath ? r.storagePath.split('/').pop() : r.error || '—'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="flex justify-end pt-2">
                  <button
                    onClick={handleResetImport}
                    className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold px-4 py-2 rounded-lg border border-slate-700 transition"
                  >
                    Reset &amp; Import Another Batch
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
