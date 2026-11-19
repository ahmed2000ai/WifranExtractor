import { useEffect, useState } from 'react';
import type {
  BatchManifest,
  BatchProcessingStages,
  BatchProgressEvent,
  ProcessingStageStatus
} from '../../../../shared/types/batchExtraction';
import { estimateBatchApiCost } from '../../../../shared/utils/geminiPricingAndCostEstimator';
import { BatchWorkflowStepper } from './BatchWorkflowStepper';
import { ExtractionCostSummaryCard } from './ExtractionCostSummaryCard';

interface RefItem {
  id: string;
  name_en?: string | null;
  name_ar?: string | null;
  slug?: string | null;
  region_id?: string | null;
  region_name_en?: string | null;
}

interface BatchProgressDashboardProps {
  batchId: string;
  catalogSupermarkets?: RefItem[];
  catalogRegions?: RefItem[];
  catalogCities?: RefItem[];
  onOpenUnifiedPreview: () => void;
  onBackToSelector: () => void;
  onSwitchBatch?: (batchId: string) => void;
}

export function BatchProgressDashboard({
  batchId,
  catalogSupermarkets: _catalogSupermarkets = [],
  catalogRegions: _catalogRegions = [],
  catalogCities: _catalogCities = [],
  onOpenUnifiedPreview,
  onBackToSelector,
  onSwitchBatch
}: BatchProgressDashboardProps): JSX.Element {
  const [manifest, setManifest] = useState<BatchManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [selectedLeafletIds, setSelectedLeafletIds] = useState<string[]>([]);
  const [isSplitting, setIsSplitting] = useState(false);
  const [latestProgressMessage, setLatestProgressMessage] = useState<string>('');
  const [liveProcessingStages, setLiveProcessingStages] = useState<BatchProcessingStages | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [authHybridFeature, setAuthHybridFeature] = useState(false);
  const [authHybridLive, setAuthHybridLive] = useState(false);
  const [authResumeExpandedScope, setAuthResumeExpandedScope] = useState(false);

  const loadManifest = async () => {
    try {
      const data = await window.wifranExtractor.batch.getManifest(batchId);
      if (data) {
        setManifest(data);
        setSelectedLeafletIds((prev) => {
          if (prev.length > 0) {
            const valid = new Set(data.leaflets.map((l) => l.leafletId));
            return prev.filter((id) => valid.has(id));
          }
          return data.leaflets
            .filter((l) => l.transferStatus !== 'transferred' && l.publicationStatus !== 'published')
            .map((l) => l.leafletId);
        });
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadManifest();

    const unsubscribe = window.wifranExtractor.batch.onProgress((event: BatchProgressEvent) => {
      if (event.batchId === batchId) {
        setLatestProgressMessage(event.message);
        if (event.processingStages) {
          setLiveProcessingStages(event.processingStages);
        }
        loadManifest();
      }
    });

    const interval = setInterval(() => {
      loadManifest();
    }, 2000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [batchId]);

  const handleCancel = async () => {
    setIsCancelling(true);
    try {
      const updated = await window.wifranExtractor.batch.cancel(batchId);
      setManifest(updated);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsCancelling(false);
    }
  };

  const handleResume = async () => {
    if (!manifest) return;
    const isHybridV3 = manifest.extractionPipelineMode === 'hybrid_v3';
    if (isHybridV3 && (!authHybridFeature || !authHybridLive)) {
      setError('Resuming Hybrid V3 requires explicit re-authorization for feature scope and live Gemini extraction.');
      return;
    }
    setIsResuming(true);
    setError(null);
    try {
      const updated = await window.wifranExtractor.batch.resume({
        batchId,
        autoRunCatalogMatching: manifest.approvedScope?.autoRunCatalogMatching ?? true,
        targetDatabaseContext: manifest.approvedScope?.targetDatabaseContext ?? 'PRODUCTION_UI',
        approvedMaxBudgetUsd: manifest.approvedScope?.approvedMaxBudgetUsd ?? null,
        hybridV3ExplicitAuthorization: isHybridV3 ? authHybridFeature : undefined,
        hybridV3FeatureEnabled: isHybridV3 ? authHybridFeature : undefined,
        hybridV3ExplicitLiveAuthorization: isHybridV3 ? authHybridLive : undefined,
        reauthorizeExpandedScope: authResumeExpandedScope
      });
      setManifest(updated);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsResuming(false);
    }
  };

  if (loading && !manifest) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-400">
        <span className="inline-block animate-spin text-2xl mb-2">⏳</span>
        <p className="text-sm">Loading batch extraction workspace...</p>
      </div>
    );
  }

  if (!manifest) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
        <p className="text-sm text-rose-400">Batch manifest not found: {batchId}</p>
        <button
          type="button"
          onClick={onBackToSelector}
          className="mt-4 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg"
        >
          ← Back to Leaflet Selection
        </button>
      </div>
    );
  }

  const { totals } = manifest;
  const isRunning = manifest.status === 'extracting' || manifest.status === 'validating';
  const progressPercent = totals.totalPages > 0
    ? Math.min(100, Math.round((totals.pagesProcessed / totals.totalPages) * 100))
    : totals.totalPdfs > 0
      ? Math.round((totals.completedPdfs / totals.totalPdfs) * 100)
      : 0;

  const canPreview = totals.completedPdfs > 0;
  const canResume = manifest.status === 'cancelled' || manifest.status === 'completed_with_errors' || manifest.status === 'failed';
  const isPreStart = manifest.status === 'created';
  const isHybridV3 = manifest.extractionPipelineMode === 'hybrid_v3';
  const costEstimate = estimateBatchApiCost({
    targetPageCount: totals.totalPages,
    extractionPipelineMode: manifest.extractionPipelineMode,
    modelId: manifest.model,
    tier: manifest.executionMode
  });
  const maxAuthorizedCapUsd = (
    manifest.approvedScope?.approvedMaxBudgetUsd ?? costEstimate.maxAuthorizedTotalCapUsd
  ).toFixed(4);

  const activeLeaflets = manifest.leaflets.filter((l) => l.transferStatus !== 'transferred');
  const selectableLeaflets = activeLeaflets.filter((l) => l.publicationStatus !== 'published');
  const isAllSelectableSelected =
    selectableLeaflets.length > 0 && selectableLeaflets.every((l) => selectedLeafletIds.includes(l.leafletId));
  const isAllActiveSelected =
    activeLeaflets.length > 0 && activeLeaflets.every((l) => selectedLeafletIds.includes(l.leafletId));
  const isProperSubsetSelected = selectedLeafletIds.length > 0 && !isAllActiveSelected;

  const toggleSelectAll = () => {
    if (isAllSelectableSelected) {
      setSelectedLeafletIds([]);
    } else {
      setSelectedLeafletIds(selectableLeaflets.map((l) => l.leafletId));
    }
  };

  const toggleSelectLeaflet = (leafletId: string) => {
    setSelectedLeafletIds((prev) =>
      prev.includes(leafletId) ? prev.filter((id) => id !== leafletId) : [...prev, leafletId]
    );
  };

  const handleSplitOrContinue = async () => {
    if (!manifest || selectedLeafletIds.length === 0) return;
    if (isAllActiveSelected) {
      onOpenUnifiedPreview();
      return;
    }

    setIsSplitting(true);
    setError(null);
    try {
      const res = await window.wifranExtractor.batch.split({
        sourceBatchId: batchId,
        selectedLeafletIds
      });
      if (res.success && res.newBatchId) {
        if (onSwitchBatch) {
          onSwitchBatch(res.newBatchId);
        } else {
          await loadManifest();
        }
      } else {
        await loadManifest();
      }
    } catch (err: any) {
      setError(`Batch splitting error: ${err.message}`);
    } finally {
      setIsSplitting(false);
    }
  };

  const effectiveStages: BatchProcessingStages = liveProcessingStages ||
    manifest.processingStages || {
      extraction:
        manifest.status === 'completed' || manifest.status === 'completed_with_errors'
          ? 'completed'
          : manifest.status === 'failed'
            ? 'failed'
            : isRunning
              ? 'running'
              : 'pending',
      metadata: manifest.leaflets.every((l) => l.status === 'completed') ? 'completed' : 'pending',
      crops: manifest.leaflets.some((l) => l.offersCount > 0)
        ? 'completed'
        : isRunning
          ? 'running'
          : 'pending',
      matching: (manifest.matchingSummary?.status || 'pending') as ProcessingStageStatus
    };

  const renderStagePill = (label: string, st: ProcessingStageStatus) => {
    const style =
      st === 'completed'
        ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800'
        : st === 'running'
          ? 'bg-indigo-950/80 text-indigo-300 border-indigo-700 animate-pulse'
          : st === 'failed'
            ? 'bg-rose-950/70 text-rose-300 border-rose-800'
            : st === 'skipped'
              ? 'bg-amber-950/50 text-amber-300 border-amber-800/70'
              : 'bg-slate-900 text-slate-400 border-slate-800';
    return (
      <div className={`px-2.5 py-1.5 rounded-lg border text-[11px] flex items-center justify-between gap-2 ${style}`}>
        <span className="font-semibold">{label}</span>
        <span className="uppercase font-mono text-[10px]">{st}</span>
      </div>
    );
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <span className="px-2 py-0.5 bg-emerald-950 text-emerald-300 border border-emerald-800 rounded text-[11px] font-semibold">Completed</span>;
      case 'processing':
        return <span className="px-2 py-0.5 bg-indigo-950 text-indigo-300 border border-indigo-800 rounded text-[11px] font-semibold animate-pulse">Processing</span>;
      case 'queued':
        return <span className="px-2 py-0.5 bg-slate-800 text-slate-400 border border-slate-700 rounded text-[11px]">Queued</span>;
      case 'cancelled':
        return <span className="px-2 py-0.5 bg-amber-950 text-amber-300 border border-amber-800 rounded text-[11px] font-semibold">Cancelled</span>;
      case 'failed':
        return <span className="px-2 py-0.5 bg-rose-950 text-rose-300 border border-rose-800 rounded text-[11px] font-semibold">Failed</span>;
      default:
        return <span className="px-2 py-0.5 bg-slate-800 text-slate-400 rounded text-[11px]">{status}</span>;
    }
  };

  const getExtractionStatusBadge = (status?: string) => {
    switch (status) {
      case 'completed':
        return <span className="px-1.5 py-0.5 bg-emerald-950 text-emerald-300 border border-emerald-800 rounded text-[10px] font-semibold">Completed</span>;
      case 'in_progress':
        return <span className="px-1.5 py-0.5 bg-blue-950 text-blue-300 border border-blue-800 rounded text-[10px] font-semibold animate-pulse">Extracting</span>;
      case 'partially_extracted':
        return <span className="px-1.5 py-0.5 bg-amber-950 text-amber-300 border border-amber-800 rounded text-[10px] font-semibold">Partial</span>;
      case 'failed':
        return <span className="px-1.5 py-0.5 bg-rose-950 text-rose-300 border border-rose-800 rounded text-[10px] font-semibold">Failed</span>;
      default:
        return <span className="px-1.5 py-0.5 bg-slate-800 text-slate-400 border border-slate-700 rounded text-[10px]">Not Started</span>;
    }
  };

  const getReviewStatusBadge = (status?: string) => {
    switch (status) {
      case 'completed':
        return <span className="px-1.5 py-0.5 bg-emerald-950 text-emerald-300 border border-emerald-800 rounded text-[10px] font-semibold">Reviewed</span>;
      case 'ready':
        return <span className="px-1.5 py-0.5 bg-teal-950 text-teal-300 border border-teal-800 rounded text-[10px] font-semibold">Ready</span>;
      case 'in_review':
        return <span className="px-1.5 py-0.5 bg-blue-950 text-blue-300 border border-blue-800 rounded text-[10px] font-semibold">In Review</span>;
      case 'needs_review':
        return <span className="px-1.5 py-0.5 bg-amber-950 text-amber-300 border border-amber-800 rounded text-[10px] font-semibold">Needs Review</span>;
      default:
        return <span className="px-1.5 py-0.5 bg-slate-800 text-slate-400 border border-slate-700 rounded text-[10px]">Pending</span>;
    }
  };

  const getPublicationStatusBadge = (status?: string) => {
    switch (status) {
      case 'published':
        return <span className="px-1.5 py-0.5 bg-emerald-950 text-emerald-300 border border-emerald-800 rounded text-[10px] font-semibold">Published</span>;
      case 'partially_published':
        return <span className="px-1.5 py-0.5 bg-amber-950 text-amber-300 border border-amber-800 rounded text-[10px] font-semibold">Partial Pub</span>;
      case 'failed':
        return <span className="px-1.5 py-0.5 bg-rose-950 text-rose-300 border border-rose-800 rounded text-[10px] font-semibold">Pub Failed</span>;
      default:
        return <span className="px-1.5 py-0.5 bg-slate-800 text-slate-400 border border-slate-700 rounded text-[10px]">Unpublished</span>;
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-6">
      <BatchWorkflowStepper
        currentStep={2}
        onStepClick={(step) => {
          if (step === 1) onBackToSelector();
          if (step >= 3 && canPreview) onOpenUnifiedPreview();
        }}
      />
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span>⚡</span> Step 2 — Batch Processing Queue
            </h2>
            <span className="font-mono text-xs px-2.5 py-0.5 bg-slate-800 border border-slate-700 text-indigo-300 rounded-full">
              {manifest.batchId}
            </span>
            {getStatusBadge(manifest.status)}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Engine: Gemini 3.8 Flash (Vertex AI Flex PayGo) • Pipeline:{' '}
            <span className="text-indigo-300 font-mono">
              Hybrid V3
            </span>
          </p>
        </div>

        <div className="flex items-center gap-3">
          {isRunning && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={isCancelling}
              className="px-3 py-2 bg-rose-900/60 hover:bg-rose-800 text-rose-200 text-xs font-semibold rounded-lg border border-rose-700 transition-all flex items-center gap-1.5"
            >
              <span>⏹</span> {isCancelling ? 'Stopping...' : 'Cancel Batch'}
            </button>
          )}

          {canResume && !isHybridV3 && (
            <button
              type="button"
              onClick={handleResume}
              disabled={isResuming}
              className="px-3 py-2 bg-amber-700 hover:bg-amber-600 text-white text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5"
            >
              <span>↻</span> {isResuming ? 'Resuming...' : 'Resume Unfinished'}
            </button>
          )}

          {canPreview && (
            <button
              type="button"
              onClick={onOpenUnifiedPreview}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg shadow-md transition-all flex items-center gap-2"
            >
              <span>📝</span> Step 3: Consolidated Review ({totals.totalOffers} Offers)
            </button>
          )}

          <button
            type="button"
            onClick={onBackToSelector}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-all"
          >
            ← Back
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-950/60 border border-rose-800 rounded-lg text-rose-200 text-xs">
          {error}
        </div>
      )}

      {/* Compact status banner if viewing a created/unstarted manifest */}
      {isPreStart && (
        <div className="bg-slate-950/75 border border-indigo-800/70 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div>
            <div className="font-bold text-white flex items-center gap-2">
              <span>⚡</span>
              <span>
                Step 2 — Authorized Scope ({manifest.leaflets.length} Leaflet(s) • {totals.totalPages} Page(s) • Cap ${maxAuthorizedCapUsd} USD)
              </span>
            </div>
            <p className="text-slate-400 text-[11px] mt-0.5">
              Extraction starts directly from Batch Setup authorization; draft metadata is auto-discovered during extraction.
            </p>
          </div>
          <button
            type="button"
            disabled={isStarting}
            onClick={async () => {
              setIsStarting(true);
              setError(null);
              try {
                const updated = await window.wifranExtractor.batch.start({
                  batchId,
                  autoRunCatalogMatching: manifest.approvedScope?.autoRunCatalogMatching ?? true,
                  targetDatabaseContext: manifest.approvedScope?.targetDatabaseContext ?? 'PRODUCTION_UI',
                  ...(isHybridV3
                    ? {
                        hybridV3ExplicitAuthorization: true,
                        hybridV3FeatureEnabled: true,
                        hybridV3ExplicitLiveAuthorization: true,
                        approvedMaxBudgetUsd: manifest.approvedScope?.approvedMaxBudgetUsd ?? Number(maxAuthorizedCapUsd)
                      }
                    : {
                        approvedMaxBudgetUsd: manifest.approvedScope?.approvedMaxBudgetUsd ?? Number(maxAuthorizedCapUsd)
                      })
                });
                setManifest(updated);
              } catch (err: any) {
                setError(err.message);
              } finally {
                setIsStarting(false);
              }
            }}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold rounded-lg shadow transition-all"
          >
            {isStarting ? 'Starting Processing...' : '▶ Start Processing'}
          </button>
        </div>
      )}

      {/* Explicit Resume Authorization Gate for paused/cancelled/failed Hybrid V3 batches */}
      {canResume && isHybridV3 && (
        <div className="bg-amber-950/40 border border-amber-700/80 rounded-xl p-4 space-y-2.5 text-xs">
          <h3 className="text-sm font-bold text-amber-200">
            ↻ Authorize Resumption of Interrupted Hybrid V3 Batch
          </h3>
          <p className="text-amber-100/80 text-[11px]">
            Completed leaflet/page checkpoints are preserved. Check both authorizations below to resume only the remaining unfinished pages within approved scope.
          </p>
          <label className="flex items-center gap-2 text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={authHybridFeature}
              onChange={(e) => setAuthHybridFeature(e.target.checked)}
            />
            <span>Re-authorize Hybrid V3 extraction feature &amp; remaining page scope.</span>
          </label>
          <label className="flex items-center gap-2 text-amber-200 cursor-pointer">
            <input
              type="checkbox"
              checked={authHybridLive}
              onChange={(e) => setAuthHybridLive(e.target.checked)}
            />
            <span>Explicitly authorize paid live Gemini API calls for remaining unfinished pages.</span>
          </label>
          <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={authResumeExpandedScope}
              onChange={(e) => setAuthResumeExpandedScope(e.target.checked)}
            />
            <span>Re-authorize expanded page scope (only check if target pages increased since initial start).</span>
          </label>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleResume}
              disabled={isResuming || !authHybridFeature || !authHybridLive}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white font-bold rounded-lg"
            >
              {isResuming ? 'Resuming...' : '↻ Resume Authorized Hybrid V3'}
            </button>
          </div>
        </div>
      )}

      {/* Progress Bar & Status message */}
      <div className="space-y-2 bg-slate-950/50 p-4 border border-slate-800 rounded-lg">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-slate-300">
            {isRunning ? (
              <span className="flex items-center gap-2">
                <span className="inline-block animate-spin text-indigo-400">⏳</span>
                <span>{latestProgressMessage || 'Extracting leaflet queue...'}</span>
              </span>
            ) : (
              <span>Extraction {manifest.status.replace(/_/g, ' ')}</span>
            )}
          </span>
          <span className="font-mono font-bold text-indigo-400">{progressPercent}%</span>
        </div>

        <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden">
          <div
            className={`h-2.5 rounded-full transition-all duration-300 ${
              manifest.status === 'completed'
                ? 'bg-emerald-500'
                : manifest.status === 'cancelled'
                  ? 'bg-amber-500'
                  : manifest.status === 'failed'
                    ? 'bg-rose-500'
                    : 'bg-indigo-500'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Sub-stage pipeline indicators (Extraction -> Metadata -> Crops -> Catalog Matching) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2">
          {renderStagePill('1. Extraction', effectiveStages.extraction)}
          {renderStagePill('2. Metadata Discovery', effectiveStages.metadata)}
          {renderStagePill('3. Offer & Product Crops', effectiveStages.crops)}
          {renderStagePill('4. Cross-Leaflet Matching', effectiveStages.matching)}
        </div>

        {manifest.matchingSummary?.status === 'failed' && manifest.matchingSummary?.error && (
          <div className="mt-2 p-2.5 bg-amber-950/50 border border-amber-800/80 rounded-lg text-[11px] text-amber-200 flex items-center justify-between gap-3">
            <span>
              Catalog matching paused/failed ({manifest.matchingSummary.error}) — completed extractions and crops are preserved for Consolidated Review.
            </span>
            {canPreview && (
              <button
                type="button"
                onClick={onOpenUnifiedPreview}
                className="shrink-0 px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[10px] font-semibold"
              >
                Open Consolidated Review
              </button>
            )}
          </div>
        )}
      </div>

      {/* Aggregated Totals Banner */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-lg text-center">
          <span className="text-[11px] text-slate-400">Total Leaflets</span>
          <p className="text-base font-bold text-white mt-0.5">{totals.totalPdfs}</p>
        </div>
        <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-lg text-center">
          <span className="text-[11px] text-emerald-400">Completed</span>
          <p className="text-base font-bold text-emerald-400 mt-0.5">{totals.completedPdfs}</p>
        </div>
        <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-lg text-center">
          <span className="text-[11px] text-rose-400">Failed</span>
          <p className="text-base font-bold text-rose-400 mt-0.5">{totals.failedPdfs}</p>
        </div>
        <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-lg text-center">
          <span className="text-[11px] text-slate-400">Pages Processed</span>
          <p className="text-base font-bold text-indigo-400 mt-0.5">
            {totals.pagesProcessed} / {totals.totalPages}
          </p>
        </div>
        <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-lg text-center">
          <span className="text-[11px] text-slate-400">Offers Extracted</span>
          <p className="text-base font-bold text-amber-400 mt-0.5">{totals.totalOffers}</p>
        </div>
        <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-lg text-center">
          <span className="text-[11px] text-slate-400">Actual API Cost</span>
          <p className="text-base font-bold text-cyan-400 mt-0.5 font-mono">${totals.totalCostUsd.toFixed(4)}</p>
          {typeof manifest.costSummary?.totalApiCalls === 'number' && (
            <p className="text-[10px] text-slate-400 mt-0.5 font-mono">
              {manifest.costSummary.totalApiCalls} call(s)
              {isRunning
                ? ` • Rem cap $${Math.max(0, Number(maxAuthorizedCapUsd) - totals.totalCostUsd).toFixed(4)}`
                : ''}
            </p>
          )}
        </div>
      </div>

      {/* Prominent Post-Run / Reopened Extraction Cost Summary */}
      {!isPreStart && manifest.costSummary && (
        <ExtractionCostSummaryCard
          costSummary={manifest.costSummary}
          batchStatus={manifest.status}
        />
      )}

      {/* Per-Leaflet Selection and Queue Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
            <span>Leaflet Extraction &amp; Publication Status</span>
            <span className="text-xs text-slate-500 font-normal">
              ({activeLeaflets.length} active of {manifest.leaflets.length} total)
            </span>
          </h3>

          {/* Action bar for split / continue */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">
              Selected: <strong className="text-indigo-300 font-mono">{selectedLeafletIds.length}</strong> / {activeLeaflets.length}
            </span>
            <button
              type="button"
              disabled={selectedLeafletIds.length === 0 || isSplitting}
              onClick={handleSplitOrContinue}
              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg shadow transition-all flex items-center gap-1.5"
            >
              {isSplitting ? (
                <>⏳ Splitting batch...</>
              ) : isProperSubsetSelected ? (
                <>⚡ Transfer &amp; Split ({selectedLeafletIds.length}) to New Batch</>
              ) : (
                <>Continue with Selected ({selectedLeafletIds.length}) Leaflets →</>
              )}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto border border-slate-800 rounded-lg">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 whitespace-nowrap">
              <tr>
                <th className="py-2.5 px-3 w-8">
                  <input
                    type="checkbox"
                    checked={isAllSelectableSelected}
                    onChange={toggleSelectAll}
                    disabled={selectableLeaflets.length === 0}
                    className="rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0 cursor-pointer disabled:cursor-not-allowed"
                    title="Select all active unpublished leaflets"
                  />
                </th>
                <th className="py-2.5 px-3 font-semibold">Retailer / Supermarket</th>
                <th className="py-2.5 px-3 font-semibold">PDF File &amp; ID</th>
                <th className="py-2.5 px-3 font-semibold">Pages (Done / Rem / Tot)</th>
                <th className="py-2.5 px-3 font-semibold">Offers</th>
                <th className="py-2.5 px-3 font-semibold">Extraction</th>
                <th className="py-2.5 px-3 font-semibold">Review</th>
                <th className="py-2.5 px-3 font-semibold">Publication</th>
                <th className="py-2.5 px-3 font-semibold">Offer Breakdown</th>
                <th className="py-2.5 px-3 font-semibold text-right">Cost (USD)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 bg-slate-900/60">
              {manifest.leaflets.map((leaflet) => {
                const meta = leaflet.metadata;
                const isTransferred = leaflet.transferStatus === 'transferred';
                const isPublished = leaflet.publicationStatus === 'published';
                const targetPages = leaflet.pagesToProcess?.length || leaflet.pageCount;
                const remainingPages = Math.max(0, targetPages - leaflet.pagesProcessed);

                return (
                  <tr
                    key={leaflet.leafletId}
                    className={`hover:bg-slate-800/30 transition-colors ${
                      isTransferred ? 'opacity-50 bg-slate-950/40' : ''
                    }`}
                  >
                    <td className="py-2.5 px-3">
                      {isTransferred ? (
                        <span title={`Transferred to ${leaflet.transferredToBatchId}`} className="text-slate-500">
                          ↗️
                        </span>
                      ) : isPublished ? (
                        <span title="Leaflet is fully published (locked)" className="text-emerald-400 text-xs">
                          🔒
                        </span>
                      ) : (
                        <input
                          type="checkbox"
                          checked={selectedLeafletIds.includes(leaflet.leafletId)}
                          onChange={() => toggleSelectLeaflet(leaflet.leafletId)}
                          className="rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0 cursor-pointer"
                        />
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {meta.supermarketName ? (
                          <span className="px-1.5 py-0.5 bg-blue-950/80 border border-blue-800/60 text-blue-300 text-[10px] rounded font-semibold">
                            {meta.supermarketName}
                          </span>
                        ) : (
                          <span className="text-[10px] text-amber-300">Unset retailer</span>
                        )}
                        {meta.locationLabel || meta.locationScope ? (
                          <span className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 text-slate-300 text-[10px] rounded">
                            {meta.scopeSource === 'default_national'
                              ? 'National (assumed)'
                              : meta.locationLabel || meta.locationScope}
                          </span>
                        ) : (
                          <span className="text-[10px] text-amber-300">Unset scope</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-white truncate max-w-xs" title={leaflet.fileName}>
                        {leaflet.fileName}
                      </div>
                      <div className="font-mono text-[10px] text-slate-400 mt-0.5">
                        {leaflet.leafletId}
                      </div>
                      {isTransferred && (
                        <div className="text-[10px] text-cyan-300 mt-0.5">
                          Transferred to: {leaflet.transferredToBatchId}
                        </div>
                      )}
                      {leaflet.error && (
                        <p className="text-[10px] text-rose-400 mt-0.5 truncate max-w-sm" title={leaflet.error}>
                          ⚠️ {leaflet.error}
                        </p>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-300 whitespace-nowrap">
                      <div>
                        {leaflet.pagesProcessed} done · {remainingPages} rem / {leaflet.pageCount} tot
                      </div>
                      {leaflet.pagesToProcess && leaflet.pagesToProcess.length > 0 && (
                        <div className="text-[10px] text-indigo-300 mt-0.5">
                          Selected: [{leaflet.pagesToProcess.join(', ')}]
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-bold text-amber-300 font-mono">
                      {leaflet.offersCount}
                    </td>
                    <td className="py-2.5 px-3">
                      {getExtractionStatusBadge(
                        leaflet.extractionStatus ||
                          (leaflet.status === 'completed'
                            ? 'completed'
                            : leaflet.status === 'processing'
                              ? 'in_progress'
                              : leaflet.pagesProcessed > 0
                                ? 'partially_extracted'
                                : leaflet.status === 'failed'
                                  ? 'failed'
                                  : 'not_started')
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      {getReviewStatusBadge(leaflet.reviewStatus || 'pending')}
                    </td>
                    <td className="py-2.5 px-3">
                      {getPublicationStatusBadge(leaflet.publicationStatus || 'not_published')}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span title="Published" className="text-emerald-400">
                          P:{leaflet.publishedOffersCount ?? 0}
                        </span>
                        <span title="Ready" className="text-teal-400">
                          R:{leaflet.readyOffersCount ?? 0}
                        </span>
                        <span title="Deferred" className="text-amber-400">
                          D:{leaflet.deferredOffersCount ?? 0}
                        </span>
                        <span title="Blocked" className="text-rose-400">
                          B:{leaflet.blockedOffersCount ?? 0}
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-cyan-300">
                      ${leaflet.estimatedCostUsd.toFixed(4)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
