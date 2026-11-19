import { useEffect, useState } from 'react';
import type { PageSelectionMode, SelectedPdfFile } from '../../../../shared/types/importForm';
import type { ExtractionPipelineMode } from '../../../../shared/types/batchExtraction';
import { parseStrictBatchPageSelection } from '../../../../shared/utils/pageRangeParser';
import { estimateBatchApiCost } from '../../../../shared/utils/geminiPricingAndCostEstimator';
import { BatchWorkflowStepper } from './BatchWorkflowStepper';

interface MultiPdfSelectorProps {
  selectedFiles: SelectedPdfFile[];
  onFilesChange: (files: SelectedPdfFile[]) => void;
  onStartExtraction: (options?: {
    approvedMaxBudgetUsd?: number;
    targetDatabaseContext?: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST';
    forceReextract?: boolean;
  }) => void;
  isExtracting: boolean;
  extractionPipelineMode?: ExtractionPipelineMode;
  onExtractionPipelineModeChange?: (mode: ExtractionPipelineMode) => void;
  targetDatabaseContext?: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST';
  onTargetDatabaseContextChange?: (ctx: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST') => void;
}

export function evaluateSelectedFilePages(
  file: SelectedPdfFile,
  pipelineMode: ExtractionPipelineMode
): { mode: PageSelectionMode; selectedPages: number[]; error: string | null } {
  const total = file.pageCount || 1;
  const effectiveMode: PageSelectionMode =
    file.pageSelectionMode ?? (pipelineMode === 'hybrid_v3' ? 'specific' : 'all');

  if (effectiveMode === 'all') {
    return {
      mode: 'all',
      selectedPages: Array.from({ length: total }, (_, idx) => idx + 1),
      error: null
    };
  }

  const rawInput = (file.pageSelectionInput || '').trim();
  if (!rawInput) {
    return {
      mode: 'specific',
      selectedPages: [],
      error: 'Enter page numbers (e.g. 2, 5) or choose All Pages.'
    };
  }

  const parsed = parseStrictBatchPageSelection(rawInput, total);
  if (parsed.error || parsed.pages.length === 0) {
    return {
      mode: 'specific',
      selectedPages: [],
      error: parsed.error || 'Enter at least one valid page number.'
    };
  }

  return {
    mode: 'specific',
    selectedPages: parsed.pages,
    error: null
  };
}

export function MultiPdfSelector({
  selectedFiles,
  onFilesChange,
  onStartExtraction,
  isExtracting,
  extractionPipelineMode = 'hybrid_v3',
  onExtractionPipelineModeChange: _onExtractionPipelineModeChange,
  targetDatabaseContext,
  onTargetDatabaseContextChange
}: MultiPdfSelectorProps): JSX.Element {
  const [localTargetDb, setLocalTargetDb] = useState<'PRODUCTION_UI' | 'DEVELOPMENT_TEST'>('PRODUCTION_UI');
  const effectiveTargetDb = targetDatabaseContext ?? localTargetDb;
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [customBudgetInput, setCustomBudgetInput] = useState<string | null>(null);
  const [forceReextract, setForceReextract] = useState(false);
  const [duplicateInspection, setDuplicateInspection] = useState<{
    totalSelectedFiles: number;
    totalSelectedPages: number;
    totalReusablePages: number;
    totalPayablePages: number;
    hasDuplicatesOrOverlaps: boolean;
    summaryMessage: string;
    originalCostEstimate?: {
      totalEstimatedLowUsd: number;
      totalEstimatedHighUsd: number;
    };
    adjustedCostEstimate?: {
      totalEstimatedLowUsd: number;
      totalEstimatedHighUsd: number;
    };
    perFile: Array<{
      filePath: string;
      fileName: string;
      fileFingerprint: string | null;
      documentId: string;
      targetPages: number[];
      reusablePages: number[];
      payablePages: number[];
      classification:
        | 'exact_duplicate_full_reuse'
        | 'partial_page_overlap_reuse'
        | 'within_batch_binary_duplicate'
        | 'filename_collision_different_content'
        | 'incompatible_or_corrupted_history'
        | 'new_document';
      matchedPriorFileName?: string | null;
      matchedPriorWorkspace?: string | null;
      incompatibilityReasons: string[];
    }>;
  } | null>(null);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const handleSelectFiles = async () => {
    setDuplicateWarning(null);
    try {
      const files = await window.wifranExtractor.files.selectMultiplePdfs();
      if (!files || files.length === 0) return;

      const existingPaths = new Set(selectedFiles.map((f) => f.path.toLowerCase()));
      const existingFingerprints = new Set(
        selectedFiles.map((f) => f.contentFingerprint).filter(Boolean)
      );

      const newFiles: SelectedPdfFile[] = [];
      const duplicates: string[] = [];

      for (const f of files) {
        const isPathDupe = existingPaths.has(f.path.toLowerCase());
        const isFingerprintDupe = f.contentFingerprint && existingFingerprints.has(f.contentFingerprint);

        if (isPathDupe || isFingerprintDupe) {
          duplicates.push(f.name);
        } else {
          const defaultMode: PageSelectionMode =
            extractionPipelineMode === 'hybrid_v3' ? 'specific' : 'all';
          const defaultSelectedPages =
            defaultMode === 'all'
              ? Array.from({ length: f.pageCount || 1 }, (_, i) => i + 1)
              : [];
          newFiles.push({
            ...f,
            pageSelectionMode: defaultMode,
            pageSelectionInput: '',
            selectedPages: defaultSelectedPages,
            pageSelectionError:
              defaultMode === 'specific'
                ? 'Enter page numbers (e.g. 2, 5) or choose All Pages.'
                : null
          });
          existingPaths.add(f.path.toLowerCase());
          if (f.contentFingerprint) existingFingerprints.add(f.contentFingerprint);
        }
      }

      if (duplicates.length > 0) {
        setDuplicateWarning(
          `Skipped ${duplicates.length} duplicate file(s): ${duplicates.join(', ')}`
        );
      }

      if (newFiles.length > 0) {
        onFilesChange([...selectedFiles, ...newFiles]);
      }
    } catch (err: any) {
      console.error('Failed to select multiple PDFs:', err);
    }
  };

  const handleUpdateFilePageSelection = (
    index: number,
    patch: { pageSelectionMode?: PageSelectionMode; pageSelectionInput?: string }
  ) => {
    const updated = selectedFiles.map((f, idx) => {
      if (idx !== index) return f;
      const merged: SelectedPdfFile = {
        ...f,
        ...(patch.pageSelectionMode !== undefined ? { pageSelectionMode: patch.pageSelectionMode } : {}),
        ...(patch.pageSelectionInput !== undefined ? { pageSelectionInput: patch.pageSelectionInput } : {})
      };
      const evalRes = evaluateSelectedFilePages(merged, extractionPipelineMode);
      return {
        ...merged,
        pageSelectionMode: evalRes.mode,
        selectedPages: evalRes.selectedPages,
        pageSelectionError: evalRes.error
      };
    });
    onFilesChange(updated);
  };

  const handleRemoveFile = (index: number) => {
    const updated = selectedFiles.filter((_, idx) => idx !== index);
    onFilesChange(updated);
  };

  const handleClearAll = () => {
    onFilesChange([]);
    setDuplicateWarning(null);
  };

  const evaluatedFiles = selectedFiles.map((f) => evaluateSelectedFilePages(f, extractionPipelineMode));
  const totalPages = selectedFiles.reduce((acc, f) => acc + (f.pageCount || 1), 0);
  const totalSelectedPages = evaluatedFiles.reduce((acc, e) => acc + e.selectedPages.length, 0);
  const hasPageSelectionErrors = evaluatedFiles.some((e) => Boolean(e.error) || e.selectedPages.length === 0);
  const totalBytes = selectedFiles.reduce((acc, f) => acc + f.sizeBytes, 0);

  const selectionSignature = selectedFiles
    .map((f, idx) => `${f.path}:${evaluatedFiles[idx]?.selectedPages.join(',') || ''}`)
    .join('|');

  useEffect(() => {
    let cancelled = false;
    const inspectFn = window.wifranExtractor?.batch?.inspectDuplicates;
    if (!inspectFn || selectedFiles.length === 0) {
      setDuplicateInspection(null);
      return;
    }
    inspectFn({
      files: selectedFiles.map((f, idx) => ({
        path: f.path,
        filePath: f.path,
        name: f.name,
        fileName: f.name,
        pageCount: f.pageCount,
        pagesToProcess: evaluatedFiles[idx]?.selectedPages || [],
        selectedPages: evaluatedFiles[idx]?.selectedPages || [],
        contentFingerprint: f.contentFingerprint
      })),
      extractionPipelineMode,
      forceReextract
    })
      .then((res) => {
        if (cancelled || !res) return;
        const reusableTotal = res.totalReusablePages ?? res.totalReusedPages ?? 0;
        const perFileNormalized =
          Array.isArray(res.perFile) && res.perFile.length > 0
            ? res.perFile
            : (res.matches || []).map((m) => ({
                filePath: m.filePath,
                fileName: m.fileName,
                fileFingerprint: null,
                documentId: '',
                targetPages: [...(m.reusedPages || []), ...(m.payablePages || [])],
                reusablePages: m.reusedPages || [],
                payablePages: m.payablePages || [],
                classification: (m.reusedPages?.length
                  ? m.payablePages?.length
                    ? 'partial_page_overlap_reuse'
                    : 'exact_duplicate_full_reuse'
                  : m.matchedFilenameHistory
                  ? 'filename_collision_different_content'
                  : 'new_document') as
                  | 'exact_duplicate_full_reuse'
                  | 'partial_page_overlap_reuse'
                  | 'within_batch_binary_duplicate'
                  | 'filename_collision_different_content'
                  | 'incompatible_or_corrupted_history'
                  | 'new_document',
                matchedPriorFileName: m.previousBatchIds?.length
                  ? `prev batch: ${m.previousBatchIds.slice(0, 2).join(', ')}`
                  : null,
                matchedPriorWorkspace: null,
                incompatibilityReasons: []
              }));
        setDuplicateInspection({
          totalSelectedFiles: res.totalSelectedFiles ?? selectedFiles.length,
          totalSelectedPages: res.totalSelectedPages,
          totalReusablePages: reusableTotal,
          totalPayablePages: res.totalPayablePages,
          hasDuplicatesOrOverlaps:
            res.hasDuplicatesOrOverlaps ??
            (reusableTotal > 0 || perFileNormalized.some((p) => p.classification !== 'new_document')),
          summaryMessage: res.summaryMessage || '',
          perFile: perFileNormalized
        });
      })
      .catch(() => {
        if (!cancelled) setDuplicateInspection(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectionSignature, forceReextract]);

  const effectivePayablePages = forceReextract
    ? totalSelectedPages
    : duplicateInspection?.totalPayablePages ?? totalSelectedPages;

  const costEstimate = estimateBatchApiCost({
    targetPageCount: effectivePayablePages,
    extractionPipelineMode: 'hybrid_v3',
    tier: 'flex'
  });
  const defaultBudgetString = costEstimate.maxAuthorizedTotalCapUsd.toFixed(4);
  const displayedBudgetInput = customBudgetInput !== null ? customBudgetInput : defaultBudgetString;
  const parsedBudgetCap = Number(displayedBudgetInput);
  const budgetCapInvalid =
    selectedFiles.length > 0 &&
    (!Number.isFinite(parsedBudgetCap) || parsedBudgetCap <= 0);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-4">
      <BatchWorkflowStepper currentStep={1} />
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span>📑</span> Multi-Leaflet Batch Selection
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Select multiple supermarket PDF leaflets to extract in one consolidated queue without manual image sourcing.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSelectFiles}
            disabled={isExtracting}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg shadow transition-all flex items-center gap-2"
          >
            <span>➕</span> Add PDF Leaflets
          </button>

          {selectedFiles.length > 0 && (
            <button
              type="button"
              onClick={handleClearAll}
              disabled={isExtracting}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-xs font-medium rounded-lg transition-all"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {duplicateWarning && (
        <div className="mb-4 p-3 bg-amber-950/60 border border-amber-800/80 rounded-lg text-amber-200 text-xs flex items-center gap-2">
          <span>⚠️</span>
          <span>{duplicateWarning}</span>
        </div>
      )}

      {duplicateInspection &&
        (duplicateInspection.totalReusablePages > 0 ||
          duplicateInspection.perFile.some(
            (m) =>
              m.classification === 'filename_collision_different_content' ||
              m.classification === 'incompatible_or_corrupted_history' ||
              m.classification === 'within_batch_binary_duplicate'
          )) && (
          <div className="p-3 bg-cyan-950/50 border border-cyan-700/70 rounded-lg text-xs text-cyan-100 space-y-1.5">
            <div className="font-semibold flex items-center justify-between gap-2">
              <span>
                ♻️ Pre-Extraction Duplicate &amp; Artifact Cache Detected:{' '}
                {duplicateInspection.totalReusablePages} of {duplicateInspection.totalSelectedPages} selected page(s) will reuse $0.00 verified local artifacts
              </span>
              <span className="font-mono text-emerald-300">
                Payable Pages: {effectivePayablePages}
              </span>
            </div>
            <div className="text-[11px] text-cyan-200/90 space-y-1">
              {duplicateInspection.perFile
                .filter(
                  (m) =>
                    m.reusablePages.length > 0 ||
                    m.classification === 'filename_collision_different_content' ||
                    m.classification === 'incompatible_or_corrupted_history' ||
                    m.classification === 'within_batch_binary_duplicate'
                )
                .map((m) => (
                  <div key={`${m.filePath}:${m.fileName}`}>
                    • <strong>{m.fileName}</strong>:{' '}
                    {m.reusablePages.length > 0 && (
                      <span>
                        Reusable pages [{m.reusablePages.join(', ')}] at $0.00
                        {m.matchedPriorFileName && m.matchedPriorFileName !== m.fileName
                          ? ` (SHA-256 match with ${m.matchedPriorFileName})`
                          : ''}
                        ; payable pages [{m.payablePages.join(', ') || 'none'}]
                      </span>
                    )}
                    {m.classification === 'within_batch_binary_duplicate' && (
                      <span className="text-amber-300">
                        Identical binary duplicate of {m.matchedPriorFileName} within this batch.
                      </span>
                    )}
                    {m.classification === 'filename_collision_different_content' && (
                      <span className="text-amber-300">
                        Filename matches prior leaflet ({m.matchedPriorFileName}) with different PDF bytes — requires fresh extraction.
                      </span>
                    )}
                    {m.classification === 'incompatible_or_corrupted_history' && (
                      <span className="text-amber-300">
                        Prior artifacts incompatible/unrecoverable ({m.incompatibilityReasons.join('; ') || 'requires reprocessing'}).
                      </span>
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}

      {selectedFiles.length === 0 ? (
        <div
          onClick={handleSelectFiles}
          className="border-2 border-dashed border-slate-800 hover:border-indigo-500/50 rounded-xl p-10 text-center cursor-pointer transition-all bg-slate-950/40 hover:bg-slate-900/60"
        >
          <div className="text-4xl mb-3">📂</div>
          <p className="text-sm font-medium text-slate-300">
            No PDFs selected for batch extraction
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Click here or use the button above to select one or multiple PDF leaflets.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-slate-950/60 border border-slate-800 p-3 rounded-lg text-center">
              <span className="text-xs text-slate-400">Total Leaflets</span>
              <p className="text-lg font-bold text-white">{selectedFiles.length}</p>
            </div>
            <div className="bg-slate-950/60 border border-slate-800 p-3 rounded-lg text-center">
              <span className="text-xs text-slate-400">Pages Selected / Doc Total</span>
              <p className="text-lg font-bold text-indigo-400">
                {totalSelectedPages} <span className="text-xs font-normal text-slate-400">/ {totalPages}</span>
              </p>
            </div>
            <div className="bg-slate-950/60 border border-slate-800 p-3 rounded-lg text-center">
              <span className="text-xs text-slate-400">Total File Size</span>
              <p className="text-lg font-bold text-emerald-400">{formatFileSize(totalBytes)}</p>
            </div>
          </div>

          <div className="overflow-hidden border border-slate-800 rounded-lg max-h-96 overflow-y-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950/80 sticky top-0 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3 font-semibold">#</th>
                  <th className="py-2.5 px-3 font-semibold">Leaflet File Name</th>
                  <th className="py-2.5 px-3 font-semibold">Total</th>
                  <th className="py-2.5 px-3 font-semibold">Pages to Extract</th>
                  <th className="py-2.5 px-3 font-semibold">Size</th>
                  <th className="py-2.5 px-3 font-semibold">Detected Retailer / Coverage</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-slate-900/40">
                {selectedFiles.map((file, idx) => {
                  const meta = file.parsedMetadata;
                  const evalSel = evaluatedFiles[idx];
                  return (
                    <tr key={`${file.path}-${idx}`} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-2 px-3 text-slate-500 font-mono">{idx + 1}</td>
                      <td className="py-2 px-3 font-medium text-white truncate max-w-xs" title={file.name}>
                        {file.name}
                      </td>
                      <td className="py-2 px-3 text-slate-300 font-mono">
                        {file.pageCount ?? '—'}
                      </td>
                      <td className="py-2 px-3 min-w-[230px]">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5">
                            <select
                              aria-label={`Page selection mode for ${file.name}`}
                              value={evalSel.mode}
                              disabled={isExtracting}
                              onChange={(e) =>
                                handleUpdateFilePageSelection(idx, {
                                  pageSelectionMode: e.target.value as PageSelectionMode
                                })
                              }
                              className="bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-indigo-500"
                            >
                              <option value="specific">Specific Pages</option>
                              <option value="all">All Pages ({file.pageCount ?? 1})</option>
                            </select>
                            {evalSel.mode === 'specific' && (
                              <input
                                type="text"
                                aria-label={`Page numbers for ${file.name}`}
                                placeholder="e.g. 2, 5"
                                value={file.pageSelectionInput || ''}
                                disabled={isExtracting}
                                onChange={(e) =>
                                  handleUpdateFilePageSelection(idx, {
                                    pageSelectionMode: 'specific',
                                    pageSelectionInput: e.target.value
                                  })
                                }
                                className="w-28 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] font-mono text-white focus:outline-none focus:border-indigo-500"
                              />
                            )}
                          </div>
                          {evalSel.error ? (
                            <span className="text-[10px] text-rose-400">{evalSel.error}</span>
                          ) : (
                            <span className="text-[10px] text-emerald-400 font-mono">
                              Selected ({evalSel.selectedPages.length}): {evalSel.selectedPages.join(', ')}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-slate-400">
                        {formatFileSize(file.sizeBytes)}
                      </td>
                      <td className="py-2 px-3">
                        {meta?.ok ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {meta.supermarket_description && (
                              <span className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 text-slate-300 text-[10px] rounded">
                                Hint: {meta.supermarket_description}
                              </span>
                            )}
                            <span className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 text-slate-300 text-[10px] rounded font-semibold">
                              Auto-discovered during extraction (review only if flagged)
                            </span>
                          </div>
                        ) : (
                          <span className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 text-slate-300 text-[10px] rounded">
                            Auto-discovered during extraction (review only if flagged)
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleRemoveFile(idx)}
                          disabled={isExtracting}
                          className="px-2 py-1 text-rose-400 hover:text-rose-300 hover:bg-rose-950/50 rounded transition-colors text-xs"
                          title="Remove from batch"
                        >
                          ✕ Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Consolidated Batch Cost & Processing Authorization Summary */}
          <div className="bg-slate-950/75 border border-indigo-800/70 rounded-lg p-3.5 text-xs space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1.5 flex-1 min-w-[260px]">
                <div className="font-semibold text-white flex items-center gap-1.5">
                  <span>🛡️</span>
                  <span>
                    Batch Scope &amp; Total Cost Authorization ({selectedFiles.length} Leaflet{selectedFiles.length > 1 ? 's' : ''} • {totalSelectedPages} Selected Page{totalSelectedPages !== 1 ? 's' : ''})
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-[11px] bg-slate-900/70 border border-slate-800 rounded-md p-2">
                  <div>
                    <div className="text-slate-400">Full-Page Extraction</div>
                    <div className="font-mono text-slate-200 font-semibold">
                      ${costEstimate.estimatedFullPageLowUsd.toFixed(4)} – ${costEstimate.estimatedFullPageHighUsd.toFixed(4)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Selective Crop Verification</div>
                    <div className="font-mono text-slate-200 font-semibold">
                      ${costEstimate.estimatedCropLowUsd.toFixed(4)} – ${costEstimate.estimatedCropHighUsd.toFixed(4)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Catalog Matching (Gemini)</div>
                    <div className="font-mono text-slate-200 font-semibold">
                      ${costEstimate.estimatedMatchingLowUsd.toFixed(4)} – ${costEstimate.estimatedMatchingHighUsd.toFixed(4)}
                    </div>
                  </div>
                  <div>
                    <div className="text-emerald-300 font-semibold">Estimated Total Cost</div>
                    <div className="font-mono text-emerald-300 font-bold">
                      ${costEstimate.totalEstimatedLowUsd.toFixed(4)} – ${costEstimate.totalEstimatedHighUsd.toFixed(4)}
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-emerald-300 font-medium">
                  {`Expected Normal Cost (~${costEstimate.expectedOffersPerPage} offers/page @ $${costEstimate.expectedNormalCostPerOfferLowUsd.toFixed(3)}–$${costEstimate.expectedNormalCostPerOfferHighUsd.toFixed(3)}/offer): $${costEstimate.expectedNormalLowUsd.toFixed(4)} – $${costEstimate.expectedNormalHighUsd.toFixed(4)} USD (B1 baseline ~$${costEstimate.b1BaselinePerOfferUsd.toFixed(3)}/offer)`}
                </p>
                <p className="text-[11px] text-slate-400">
                  {`Hard Cap Range: $${costEstimate.totalEstimatedLowUsd.toFixed(4)} – $${costEstimate.totalEstimatedHighUsd.toFixed(4)} USD • ${costEstimate.modelId} Flex (${effectivePayablePages} payable page${effectivePayablePages === 1 ? '' : 's'}) covering 65K output headroom, B2 crops, recovery, & catalog matching.`}
                </p>
                <p className="text-[10px] text-slate-400">
                  Selecting PDFs makes zero paid API calls. Clicking Start Processing authorizes bounded extraction, selective crops, and catalog matching strictly for the selected pages up to your total spending cap (zero DB writes until Step 4).
                </p>
              </div>

              <div className="flex flex-col items-end gap-2">
                <div className="flex flex-col items-end gap-1">
                  <label htmlFor="batch-reference-db-select" className="text-[11px] text-slate-300 font-semibold">
                    Reference Matching DB Context
                  </label>
                  <select
                    id="batch-reference-db-select"
                    aria-label="Reference Matching DB Context"
                    disabled={isExtracting}
                    value={effectiveTargetDb}
                    onChange={(e) => {
                      const nextCtx = e.target.value as 'PRODUCTION_UI' | 'DEVELOPMENT_TEST';
                      setLocalTargetDb(nextCtx);
                      onTargetDatabaseContextChange?.(nextCtx);
                    }}
                    className="w-48 bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-white text-xs focus:outline-none focus:border-indigo-500"
                  >
                    <option value="PRODUCTION_UI">PRODUCTION_UI (Read-Only Match Ref)</option>
                    <option value="DEVELOPMENT_TEST">DEVELOPMENT_TEST (Sandbox)</option>
                  </select>
                </div>

                <div className="flex flex-col items-end gap-1">
                  <label htmlFor="batch-max-budget-input" className="text-[11px] text-amber-300 font-semibold">
                    Max Authorized Total Spending Cap (USD)
                  </label>
                  <input
                    id="batch-max-budget-input"
                    aria-label="Maximum Authorized Spending Cap (USD)"
                    type="number"
                    min="0.0001"
                    step="0.01"
                    disabled={isExtracting}
                    value={displayedBudgetInput}
                    onChange={(e) => setCustomBudgetInput(e.target.value)}
                    className="w-36 bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-right font-mono text-white text-xs focus:outline-none focus:border-indigo-500"
                  />
                  {budgetCapInvalid && (
                    <span className="text-[10px] text-rose-400">Enter a spending cap &gt; $0.00</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-slate-400">Pipeline:</span>
              <span className="px-2.5 py-1 rounded-md bg-indigo-600/90 text-white text-xs font-semibold">
                Hybrid V3
              </span>
              <span className="text-[11px] text-indigo-300">
                Extract → Crops → Metadata → Auto Catalog Matching
              </span>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer ml-2">
                <input
                  type="checkbox"
                  checked={forceReextract}
                  disabled={isExtracting}
                  onChange={(e) => setForceReextract(e.target.checked)}
                />
                <span>Force Re-extraction (bypass local cache)</span>
              </label>
            </div>

            <button
              type="button"
              onClick={() =>
                onStartExtraction({
                  approvedMaxBudgetUsd: parsedBudgetCap,
                  targetDatabaseContext: effectiveTargetDb,
                  forceReextract
                })
              }
              disabled={isExtracting || selectedFiles.length === 0 || hasPageSelectionErrors || budgetCapInvalid}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg shadow-lg shadow-emerald-900/30 transition-all flex items-center gap-2"
            >
              {isExtracting ? (
                <>
                  <span className="inline-block animate-spin">⏳</span>
                  <span>Processing Batch...</span>
                </>
              ) : (
                <>
                  <span>▶</span>
                  <span>
                    Start Processing ({selectedFiles.length} Leaflet{selectedFiles.length > 1 ? 's' : ''}, {totalSelectedPages} Page{totalSelectedPages !== 1 ? 's' : ''})
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
