import { useState, useEffect, useCallback, useMemo } from 'react'
import { PageHeader } from '../components/PageHeader'
import { useReferenceData } from '../hooks/useReferenceData'
import { useAppHealth } from '../hooks/useAppHealth'
import { MultiPdfSelector, evaluateSelectedFilePages } from '../components/batch/MultiPdfSelector'
import { BatchProgressDashboard } from '../components/batch/BatchProgressDashboard'
import { UnifiedBatchPreview } from '../components/batch/UnifiedBatchPreview'
import type { SelectedPdfFile } from '../../../shared/types/importForm'
import type { BatchManifest, ExtractionPipelineMode } from '../../../shared/types/batchExtraction'
import {
  mergeSupermarketCatalogLists,
  type PendingSupermarketCatalogEntry
} from '../../../shared/utils/supermarketCandidateUtils'

export function ImportPage(): JSX.Element {
  const [batchFiles, setBatchFiles] = useState<SelectedPdfFile[]>([])
  const [batchPipelineMode, setBatchPipelineMode] = useState<ExtractionPipelineMode>('hybrid_v3')
  const [geminiInferenceMode] = useState<'standard' | 'flex'>('flex')
  const [targetDatabaseContext, setTargetDatabaseContext] = useState<'PRODUCTION_UI' | 'DEVELOPMENT_TEST'>('PRODUCTION_UI')
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null)
  const [batchView, setBatchView] = useState<'selector' | 'progress' | 'preview'>('selector')
  const [previewInitialStep, setPreviewInitialStep] = useState<3 | 4>(3)
  const [isBatchExtracting, setIsBatchExtracting] = useState<boolean>(false)
  const [availableBatches, setAvailableBatches] = useState<BatchManifest[]>([])
  const [pendingCatalogSupermarkets] = useState<PendingSupermarketCatalogEntry[]>([])

  const { data } = useReferenceData()
  const { health } = useAppHealth()

  useEffect(() => {
    if (health?.databaseEnvironment?.context === 'DEVELOPMENT_TEST') {
      setTargetDatabaseContext('DEVELOPMENT_TEST')
    } else {
      setTargetDatabaseContext('PRODUCTION_UI')
    }
  }, [health?.databaseEnvironment?.context])

  const effectiveSupermarkets = useMemo(
    () => mergeSupermarketCatalogLists<any>(data?.supermarkets || [], pendingCatalogSupermarkets),
    [data?.supermarkets, pendingCatalogSupermarkets]
  )

  const loadBatchesList = useCallback(async () => {
    try {
      if (window.wifranExtractor?.batch?.list) {
        const list = await window.wifranExtractor.batch.list()
        setAvailableBatches(list)
      }
    } catch {
      // Non-fatal
    }
  }, [])

  useEffect(() => {
    void loadBatchesList()
  }, [loadBatchesList])

  // Restore persistent workflow session on mount (Part A)
  useEffect(() => {
    let isCancelled = false
    const initSession = async () => {
      try {
        if (!window.wifranExtractor?.batch?.getActiveSession) return
        const session = await window.wifranExtractor.batch.getActiveSession()
        if (isCancelled) return
        if (session?.activeBatchId) {
          const manifest = await window.wifranExtractor.batch.getManifest(session.activeBatchId)
          if (manifest && !isCancelled) {
            setActiveBatchId(session.activeBatchId)
            if (session.activeStep === 4) {
              setPreviewInitialStep(4)
              setBatchView('preview')
            } else if (session.activeStep === 3) {
              setPreviewInitialStep(3)
              setBatchView('preview')
            } else if (session.activeStep === 2) {
              setBatchView('progress')
            } else {
              setBatchView('selector')
            }
            return
          }
        }
        // Fallback: check available batches for November 19 batch or latest batch at Step 2
        const list = await window.wifranExtractor.batch.list()
        if (isCancelled || !list || list.length === 0) return
        const targetBatch =
          list.find((b) => b.batchId === 'batch-2026-11-19T13-01-05-9fd1a6') || list[0]
        if (targetBatch && !isCancelled) {
          setActiveBatchId(targetBatch.batchId)
          setBatchView('progress')
          await window.wifranExtractor.batch.setActiveSession({
            schemaVersion: 'wifran.workflow.session/1.0',
            activeBatchId: targetBatch.batchId,
            activeStep: 2,
            selectedLeafletIds: targetBatch.leaflets.map((l) => l.leafletId),
            updatedAt: new Date().toISOString()
          })
        }
      } catch (err) {
        console.warn('Failed restoring workflow session:', err)
      }
    }
    void initSession()
    return () => {
      isCancelled = true
    }
  }, [])

  // Sync session state on batch / view transitions
  useEffect(() => {
    if (activeBatchId && batchView !== 'selector') {
      const step: 1 | 2 | 3 | 4 = batchView === 'preview' ? previewInitialStep : 2
      void window.wifranExtractor?.batch?.setActiveSession?.({
        schemaVersion: 'wifran.workflow.session/1.0',
        activeBatchId,
        activeStep: step,
        selectedLeafletIds: [],
        updatedAt: new Date().toISOString()
      })
    } else if (batchView === 'selector') {
      void window.wifranExtractor?.batch?.clearActiveSession?.()
    }
  }, [activeBatchId, batchView, previewInitialStep])

  const handleStartBatchExtraction = async (startOpts?: {
    approvedMaxBudgetUsd?: number
    targetDatabaseContext?: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST'
    forceReextract?: boolean
  }) => {
    if (batchFiles.length === 0) return
    const evaluated = batchFiles.map((f) => ({
      file: f,
      evalSel: evaluateSelectedFilePages(f, batchPipelineMode)
    }))
    const invalid = evaluated.find((e) => e.evalSel.error || e.evalSel.selectedPages.length === 0)
    if (invalid) {
      alert(`Invalid page selection for ${invalid.file.name}: ${invalid.evalSel.error || 'No pages selected.'}`)
      return
    }

    const effectiveDbCtx = startOpts?.targetDatabaseContext ?? targetDatabaseContext
    setIsBatchExtracting(true)
    try {
      const manifest = await window.wifranExtractor.batch.create({
        files: evaluated.map(({ file: f, evalSel }) => ({
          path: f.path,
          name: f.name,
          sizeBytes: f.sizeBytes,
          contentFingerprint: f.contentFingerprint,
          pageCount: f.pageCount,
          pageSelectionMode: evalSel.mode,
          ...(evalSel.mode === 'specific' ? { pageSelectionInput: f.pageSelectionInput, pagesToProcess: evalSel.selectedPages } : {})
        })),
        executionMode: geminiInferenceMode,
        extractionPipelineMode: batchPipelineMode,
        approvedMaxBudgetUsd: startOpts?.approvedMaxBudgetUsd ?? null,
        autoRunCatalogMatching: true,
        targetDatabaseContext: effectiveDbCtx
      })

      setActiveBatchId(manifest.batchId)
      setBatchView('progress')
      void window.wifranExtractor.batch.start({
        batchId: manifest.batchId,
        autoRunCatalogMatching: true,
        forceReextract: Boolean(startOpts?.forceReextract),
        targetDatabaseContext: effectiveDbCtx,
        ...(batchPipelineMode === 'hybrid_v3'
          ? {
              hybridV3ExplicitAuthorization: true,
              hybridV3FeatureEnabled: true,
              hybridV3ExplicitLiveAuthorization: true,
              approvedMaxBudgetUsd: startOpts?.approvedMaxBudgetUsd ?? null
            }
          : {
              approvedMaxBudgetUsd: startOpts?.approvedMaxBudgetUsd ?? null
            })
      }).finally(() => {
        setIsBatchExtracting(false)
        void loadBatchesList()
      })
    } catch (err: any) {
      console.error('Failed to start batch extraction:', err)
      alert(`Batch creation error: ${err.message}`)
      setIsBatchExtracting(false)
    }
  }

  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-4">
        <PageHeader
          title="Batch Leaflets"
          description="Select multiple supermarket PDF leaflets, extract all offers via Gemini Flex PayGo, and review in a unified batch workspace."
        />
      </div>

      <div className="space-y-6">
        {batchView === 'selector' && (
          <div className="space-y-6">
            <MultiPdfSelector
              selectedFiles={batchFiles}
              onFilesChange={setBatchFiles}
              onStartExtraction={handleStartBatchExtraction}
              isExtracting={isBatchExtracting}
              extractionPipelineMode={batchPipelineMode}
              onExtractionPipelineModeChange={setBatchPipelineMode}
              targetDatabaseContext={targetDatabaseContext}
              onTargetDatabaseContextChange={setTargetDatabaseContext}
            />

            {availableBatches.length > 0 && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl">
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <span>🗄️</span> Recent Batch Extractions
                </h3>
                <div className="overflow-hidden border border-slate-800 rounded-lg">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="py-2.5 px-3 font-semibold">Batch ID</th>
                        <th className="py-2.5 px-3 font-semibold">Created</th>
                        <th className="py-2.5 px-3 font-semibold">Leaflets</th>
                        <th className="py-2.5 px-3 font-semibold">Offers</th>
                        <th className="py-2.5 px-3 font-semibold">Status</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 bg-slate-900/60">
                      {availableBatches.map((b) => (
                        <tr key={b.batchId} className="hover:bg-slate-800/30 transition-colors">
                          <td className="py-2.5 px-3 font-mono text-indigo-300 font-medium">
                            {b.batchId}
                          </td>
                          <td className="py-2.5 px-3 text-slate-400">
                            {new Date(b.createdAt).toLocaleString()}
                          </td>
                          <td className="py-2.5 px-3 text-slate-300">
                            {b.totals.totalPdfs} ({b.totals.completedPdfs} completed)
                          </td>
                          <td className="py-2.5 px-3 text-amber-300 font-bold">
                            {b.totals.totalOffers}
                            {b.publishedOffers && Object.keys(b.publishedOffers).length > 0 && (
                              <span className="ml-1.5 text-[10px] font-normal text-emerald-300">
                                ({Object.keys(b.publishedOffers).length} published / {Math.max(0, b.totals.totalOffers - Object.keys(b.publishedOffers).length)} remaining)
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              b.status === 'completed'
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                : b.status === 'partially_published'
                                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                                  : b.status === 'extracting'
                                    ? 'bg-indigo-950 text-indigo-300 border border-indigo-800 animate-pulse'
                                    : b.status === 'cancelled'
                                      ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                      : 'bg-slate-800 text-slate-300'
                            }`}>
                              {b.status === 'partially_published' ? 'Partially Published' : b.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => {
                                setActiveBatchId(b.batchId)
                                setBatchView(
                                  b.status === 'created' || b.status === 'extracting' || b.status === 'validating'
                                    ? 'progress'
                                    : 'preview'
                                )
                              }}
                              className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs transition-colors font-medium"
                            >
                              {b.status === 'created'
                                ? 'Setup & Start'
                                : b.status === 'extracting' || b.status === 'validating'
                                  ? 'View Queue'
                                  : b.status === 'partially_published'
                                    ? 'Reopen Deferred & Publish'
                                    : 'Review & Verify'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {batchView === 'progress' && activeBatchId && (
          <BatchProgressDashboard
            batchId={activeBatchId}
            catalogSupermarkets={effectiveSupermarkets}
            catalogRegions={data?.regions || []}
            catalogCities={data?.cities || []}
            onOpenUnifiedPreview={() => setBatchView('preview')}
            onBackToSelector={() => setBatchView('selector')}
            onSwitchBatch={(newBatchId) => {
              setActiveBatchId(newBatchId)
              setBatchView('progress')
            }}
          />
        )}

        {batchView === 'preview' && activeBatchId && (
          <UnifiedBatchPreview
            batchId={activeBatchId}
            catalogSupermarkets={effectiveSupermarkets}
            catalogRegions={data?.regions || []}
            catalogCities={data?.cities || []}
            initialStep={previewInitialStep}
            onStepChange={(step) => {
              setPreviewInitialStep(step)
              if (activeBatchId) {
                void window.wifranExtractor?.batch?.setActiveSession?.({
                  schemaVersion: 'wifran.workflow.session/1.0',
                  activeBatchId,
                  activeStep: step,
                  selectedLeafletIds: [],
                  updatedAt: new Date().toISOString()
                })
              }
            }}
            onBack={() => setBatchView('progress')}
          />
        )}
      </div>
    </div>
  )
}
