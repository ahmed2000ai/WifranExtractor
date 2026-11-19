import React, { useState, useEffect, useMemo } from 'react'
import type {
  MatchingRunManifest,
  MatchingPreflightEstimate,
  MatchingProgressEvent,
  RetryFailedPreflightSummary,
  OperatorDecisionStatus,
  NonCatalogEligibilityCategory
} from '../../../../shared/types/catalogMatching'
import { assessOfferPublicationOutcome } from '../../../../shared/utils/nonCatalogPublicationPolicy'
import {
  isOfferMetadataAccepted,
  summarizeBatchReviewTriage
} from '../../../../shared/utils/reviewTriageClassifier'
import {
  buildCrossRetailerGroups,
  type CrossRetailerOfferRow,
  type CrossRetailerProductGroup
} from '../../../../shared/utils/crossRetailerGrouping'
import type { UnifiedBatchOffer } from '../../../../shared/types/batchExtraction'
import type { BatchExtractionCostSummary } from '../../../../shared/types/costAccounting'
import { BatchWorkflowStepper } from './BatchWorkflowStepper'
import { ExtractionCostSummaryCard } from './ExtractionCostSummaryCard'

interface ProductMatchingReviewProps {
  batchId: string
  offers: UnifiedBatchOffer[]
  costSummary?: BatchExtractionCostSummary | null
  onBack: () => void
  onBatchUpdated?: () => Promise<void> | void
}

function formatDurationMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const mins = Math.floor(totalSec / 60)
  const secs = totalSec % 60
  return mins > 0 ? `${mins}m ${secs}s (${(ms / 1000).toFixed(1)}s)` : `${(ms / 1000).toFixed(1)}s`
}

export const ProductMatchingReview: React.FC<ProductMatchingReviewProps> = ({
  batchId,
  offers,
  costSummary: propCostSummary,
  onBack,
  onBatchUpdated
}) => {
  const [manifest, setManifest] = useState<MatchingRunManifest | null>(null)
  const [batchCostSummary, setBatchCostSummary] = useState<BatchExtractionCostSummary | null>(
    propCostSummary ?? null
  )
  const [batchStatus, setBatchStatus] = useState<string | undefined>(undefined)
  const [estimate, setEstimate] = useState<MatchingPreflightEstimate | null>(null)
  const [retrySummary, setRetrySummary] = useState<RetryFailedPreflightSummary | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isMatching, setIsMatching] = useState<boolean>(false)
  const [progressText, setProgressText] = useState<string>('')
  const [progressPercent, setProgressPercent] = useState<number>(0)
  const [liveProgress, setLiveProgress] = useState<MatchingProgressEvent | null>(null)
  const [runStartClientMs, setRunStartClientMs] = useState<number | null>(null)
  const [reqStartClientMs, setReqStartClientMs] = useState<number | null>(null)
  const [elapsedTickMs, setElapsedTickMs] = useState<number>(0)
  const [reqElapsedTickMs, setReqElapsedTickMs] = useState<number>(0)
  const [controlFeedback, setControlFeedback] = useState<string | null>(null)

  const [showStartDialog, setShowStartDialog] = useState<boolean>(false)
  const [startMode, setStartMode] = useState<'full' | 'resume'>('full')
  const [approvedBudgetInput, setApprovedBudgetInput] = useState<string>('0.0500')

  const [showRetryDialog, setShowRetryDialog] = useState<boolean>(false)
  const [retryBudgetInput, setRetryBudgetInput] = useState<string>('0.0500')

  const [activeTab, setActiveTab] = useState<'existing' | 'temporary' | 'unresolved'>('existing')
  const [viewMode, setViewMode] = useState<'grouped' | 'offers'>('grouped')
  const [matchingTargetDb, setMatchingTargetDb] = useState<'PRODUCTION_UI' | 'DEVELOPMENT_TEST'>('PRODUCTION_UI')
  const [allowExpiredForDevTest, setAllowExpiredForDevTest] = useState<boolean>(false)
  const [inspectCropOffer, setInspectCropOffer] = useState<{
    title: string
    retailer: string
    sourcePage: number
    sourceOfferId: string
    offerCardCropPath: string | null
    productThumbCropPath: string | null
    originalPageImagePath: string | null
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [publishStatus, setPublishStatus] = useState<string | null>(null)
  const [publishTarget, setPublishTarget] = useState<'PRODUCTION_UI' | 'DEVELOPMENT_TEST'>('PRODUCTION_UI')
  const [devPublishAuthorized, setDevPublishAuthorized] = useState<boolean>(false)
  const [prodPublishAuthorized, setProdPublishAuthorized] = useState<boolean>(false)
  const [preflightResult, setPreflightResult] = useState<any | null>(null)
  const [approvedUpdateSourceIds, setApprovedUpdateSourceIds] = useState<Record<string, boolean>>({})
  const [overrideConflictSourceIds, setOverrideConflictSourceIds] = useState<Record<string, boolean>>({})

  const refreshStatusAndSummaries = async () => {
    const [currentManifest, currentEstimate, currentRetry, currentBatchSummary] = await Promise.all([
      window.wifranExtractor.matching.getStatus(batchId),
      window.wifranExtractor.matching.estimate(batchId),
      window.wifranExtractor.matching.getRetryFailedSummary(batchId),
      window.wifranExtractor.batch?.getSummary?.(batchId).catch(() => null) ?? Promise.resolve(null)
    ])
    setManifest(currentManifest)
    setEstimate(currentEstimate)
    setRetrySummary(currentRetry)
    if (currentBatchSummary) {
      if (currentBatchSummary.costSummary) setBatchCostSummary(currentBatchSummary.costSummary)
      setBatchStatus(currentBatchSummary.status)
    }
    if (currentEstimate) {
      const suggested = Math.max(0.05, Number((currentEstimate.estimatedCostUsd.max * 1.5).toFixed(4)))
      setApprovedBudgetInput(suggested.toFixed(4))
    }
    if (currentRetry && currentRetry.eligibleCount > 0) {
      const suggestedRetry = Math.max(0.02, Number((currentRetry.estimatedRetryCostUsd.max * 1.5).toFixed(4)))
      setRetryBudgetInput(suggestedRetry.toFixed(4))
    }
  }

  // Load manifest, estimate, and failed-request summary
  useEffect(() => {
    let unmounted = false

    const loadData = async () => {
      setIsLoading(true)
      try {
        const [currentManifest, currentEstimate, currentRetry, currentBatchSummary] = await Promise.all([
          window.wifranExtractor.matching.getStatus(batchId),
          window.wifranExtractor.matching.estimate(batchId),
          window.wifranExtractor.matching.getRetryFailedSummary(batchId),
          window.wifranExtractor.batch?.getSummary?.(batchId).catch(() => null) ?? Promise.resolve(null)
        ])
        if (!unmounted) {
          setManifest(currentManifest)
          if (currentBatchSummary) {
            if (currentBatchSummary.costSummary) setBatchCostSummary(currentBatchSummary.costSummary)
            setBatchStatus(currentBatchSummary.status)
          }
          if (currentManifest?.matchingDatabaseContext) {
            setMatchingTargetDb(currentManifest.matchingDatabaseContext)
            setPublishTarget(currentManifest.matchingDatabaseContext)
          }
          setEstimate(currentEstimate)
          setRetrySummary(currentRetry)
          if (currentEstimate) {
            const suggested = Math.max(0.05, Number((currentEstimate.estimatedCostUsd.max * 1.5).toFixed(4)))
            setApprovedBudgetInput(suggested.toFixed(4))
          }
          if (currentRetry && currentRetry.eligibleCount > 0) {
            const suggestedRetry = Math.max(0.02, Number((currentRetry.estimatedRetryCostUsd.max * 1.5).toFixed(4)))
            setRetryBudgetInput(suggestedRetry.toFixed(4))
          }
        }
      } catch (err: any) {
        if (!unmounted) setError(err.message || 'Failed to load matching status.')
      } finally {
        if (!unmounted) setIsLoading(false)
      }
    }

    loadData()

    const unsubProgress = window.wifranExtractor.matching.onProgress((data) => {
      if (data.batchId === batchId) {
        setProgressText(data.statusText)
        setProgressPercent(data.percent)
        setLiveProgress(data)
        if (data.phase === 'Waiting for Gemini / Flex processing') {
          setReqStartClientMs(Date.now() - (data.currentRequestElapsedMs || 0))
        } else if (data.phase === 'Saving checkpoint' || data.phase === 'Completed' || data.phase === 'Paused' || data.phase === 'Cancelled' || data.phase === 'Failed') {
          setReqStartClientMs(null)
          setReqElapsedTickMs(data.currentRequestElapsedMs || 0)
        }
      }
    })

    return () => {
      unmounted = true
      unsubProgress()
    }
  }, [batchId])

  // Live 1-second timer tick while run/request is active (honest elapsed duration, zero fake ETA)
  useEffect(() => {
    if (!isMatching || runStartClientMs === null) return
    const intervalId = setInterval(() => {
      const now = Date.now()
      setElapsedTickMs(now - runStartClientMs)
      if (reqStartClientMs !== null) {
        setReqElapsedTickMs(now - reqStartClientMs)
      }
    }, 1000)
    return () => clearInterval(intervalId)
  }, [isMatching, runStartClientMs, reqStartClientMs])

  const openStartPreflightDialog = (mode: 'full' | 'resume') => {
    setStartMode(mode)
    setError(null)
    if (estimate) {
      const suggested = Math.max(0.05, Number((estimate.estimatedCostUsd.max * 1.5).toFixed(4)))
      setApprovedBudgetInput(suggested.toFixed(4))
    }
    setShowStartDialog(true)
  }

  const handleConfirmStartMatching = async () => {
    const budget = Number(approvedBudgetInput)
    if (!Number.isFinite(budget) || budget <= 0) {
      setError('Enter a valid positive maximum estimated spend cap in USD before starting.')
      return
    }
    setShowStartDialog(false)
    setIsMatching(true)
    setError(null)
    setControlFeedback(null)
    const now = Date.now()
    setRunStartClientMs(now)
    setElapsedTickMs(0)
    setReqElapsedTickMs(0)
    setProgressText('Starting catalog matching pipeline...')
    setProgressPercent(5)
    try {
      const result = await window.wifranExtractor.matching.start({
        batchId,
        mode: startMode,
        approvedByOperator: true,
        approvedMaxBudgetUsd: budget,
        targetDatabaseContext: matchingTargetDb
      })
      setManifest(result)
      const latestRetry = await window.wifranExtractor.matching.getRetryFailedSummary(batchId)
      setRetrySummary(latestRetry)
    } catch (err: any) {
      setError(`Matching failed: ${err.message}`)
      await refreshStatusAndSummaries().catch(() => undefined)
    } finally {
      setIsMatching(false)
      setReqStartClientMs(null)
    }
  }

  const handleConfirmRetryFailedOnly = async () => {
    const budget = Number(retryBudgetInput)
    if (!Number.isFinite(budget) || budget <= 0) {
      setError('Enter a valid positive retry budget cap in USD before retrying failed requests.')
      return
    }
    setShowRetryDialog(false)
    setIsMatching(true)
    setError(null)
    setControlFeedback(null)
    const now = Date.now()
    setRunStartClientMs(now)
    setElapsedTickMs(0)
    setReqElapsedTickMs(0)
    setProgressText('Retrying failed/uncertain matching requests only...')
    setProgressPercent(5)
    try {
      const result = await window.wifranExtractor.matching.retryFailedOnly({
        batchId,
        approvedByOperator: true,
        approvedMaxBudgetUsd: budget,
        targetDatabaseContext: matchingTargetDb
      })
      setManifest(result)
      const latestRetry = await window.wifranExtractor.matching.getRetryFailedSummary(batchId)
      setRetrySummary(latestRetry)
    } catch (err: any) {
      setError(`Retry Failed Only error: ${err.message}`)
      await refreshStatusAndSummaries().catch(() => undefined)
    } finally {
      setIsMatching(false)
      setReqStartClientMs(null)
    }
  }

  const handlePauseAfterCurrent = async () => {
    try {
      const res = await window.wifranExtractor.matching.pause(batchId)
      setControlFeedback(res.message)
    } catch (err: any) {
      setError(`Pause failed: ${err.message}`)
    }
  }

  const handleCancelCurrentOperation = async () => {
    try {
      const res = await window.wifranExtractor.matching.cancel(batchId)
      setControlFeedback(res.message)
    } catch (err: any) {
      setError(`Cancel failed: ${err.message}`)
    }
  }

  const handleDecision = async (params: {
    batchOfferKey?: string
    temporaryId?: string
    decision: OperatorDecisionStatus
    linkedPermanentProductId?: string
    targetType?: 'catalog' | 'non_catalog'
    nonCatalogCategory?: NonCatalogEligibilityCategory | null
    operatorNotes?: string
  }) => {
    try {
      const updated = await window.wifranExtractor.matching.saveDecision({
        batchId,
        ...params
      })
      setManifest(updated)
    } catch (err: any) {
      setError(`Failed to save decision: ${err.message}`)
    }
  }

  const handlePublish = async (preflightOnly = false) => {
    setPublishStatus(preflightOnly ? 'Running publication preflight...' : 'Validating publication preflight...')
    try {
      const selectedUpdates = Object.keys(approvedUpdateSourceIds).filter((k) => approvedUpdateSourceIds[k])
      const selectedConflictOverrides = Object.keys(overrideConflictSourceIds).filter((k) => overrideConflictSourceIds[k])
      const result = await window.wifranExtractor.matching.publishApproved({
        batchId,
        operatorId: 'operator_ui',
        targetContext: publishTarget,
        operatorAuthorizedDevPublish: publishTarget === 'DEVELOPMENT_TEST' && devPublishAuthorized,
        operatorAuthorizedProductionPublish: publishTarget === 'PRODUCTION_UI' && prodPublishAuthorized,
        allowExpiredForDevTest: publishTarget === 'DEVELOPMENT_TEST' && allowExpiredForDevTest,
        enforceUpdateApproval: true,
        approvedUpdateSourceIds: selectedUpdates,
        overrideConflictSourceIds: selectedConflictOverrides,
        preflightOnly
      })
      if (result.preflight) {
        setPreflightResult(result.preflight)
      }
      if (preflightOnly) {
        const rec = result.preflight?.reconciliationSummary
        setPublishStatus(
          result.success
            ? `Preflight PASSED for ${publishTarget}: ${result.preflight?.existingProductMatchesCount || 0} catalog links, ${result.preflight?.approvedNonCatalogCount || 0} non-catalog, ${result.preflight?.quarantinedOffersCount || 0} quarantined${rec ? ` · DB Reconciliation: ${rec.newCount} new, ${rec.alreadyPublishedCount} already published, ${rec.updateCandidateCount} updates, ${rec.duplicateConflictCount} conflicts` : ''}.`
            : `Preflight BLOCKED (${publishTarget}): ${result.preflight?.blockingReasons?.join(' | ') || result.message}`
        )
        return
      }
      if (result.success) {
        const r = result.result
        setPublishStatus(
          r?.noop
            ? `No-op publish for ${publishTarget} (Op ${r?.publishOperationId || 'n/a'}): 0 new writes, ${r?.unchangedNoopCount || 0} unchanged already published.`
            : `Selective publication to ${publishTarget} complete (Op ${r?.publishOperationId || 'n/a'}): inserted ${r?.insertedOffersCount ?? r?.publishedOffersCount ?? 0}, updated ${r?.updatedOffersCount ?? 0}, created ${r?.createdProductsCount ?? 0} product(s), deferred ${r?.deferredBatchOfferKeys?.length ?? 0} offer(s).`
        )
        if (onBatchUpdated) {
          await onBatchUpdated()
        }
      } else {
        setPublishStatus(
          `Publication blocked (${publishTarget}): ${result.preflight?.blockingReasons?.join(' | ') || result.message}`
        )
      }
    } catch (err: any) {
      setPublishStatus(`Publication error: ${err.message}`)
    }
  }

  const getLocalImageUrl = (filePath?: string | null) => {
    if (!filePath) return null
    return `local-file://get?path=${encodeURIComponent(filePath)}`
  }

  const groupedView = useMemo(() => buildCrossRetailerGroups(offers, manifest), [offers, manifest])

  const handleGroupOfferDecisions = async (
    rows: CrossRetailerOfferRow[],
    decision: OperatorDecisionStatus
  ) => {
    for (const row of rows) {
      await handleDecision({ batchOfferKey: row.batchOfferKey, decision })
    }
  }

  const renderCrossRetailerGroupCard = (group: CrossRetailerProductGroup) => {
    const isCatalog = group.groupType === 'verified_catalog'
    return (
      <div
        key={group.groupKey}
        className={`p-4 bg-slate-950/85 border rounded-xl space-y-3 ${
          isCatalog ? 'border-slate-800' : 'border-indigo-950'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              {isCatalog ? (
                <span className="font-mono text-xs px-2.5 py-0.5 bg-emerald-950 border border-emerald-800 text-emerald-300 rounded font-semibold">
                  Catalog #{group.matchedProductId}
                </span>
              ) : (
                <span className="font-mono text-xs px-2.5 py-0.5 bg-indigo-950 border border-indigo-800 text-indigo-300 rounded font-semibold">
                  Provisional: {group.temporaryId}
                </span>
              )}
              {group.matchedDatabaseContext && (
                <span className="font-mono text-[10px] px-2 py-0.5 bg-slate-900 border border-slate-700 text-slate-300 rounded">
                  DB: {group.matchedDatabaseContext}
                </span>
              )}
              <span className="text-[11px] px-2 py-0.5 bg-sky-950/70 border border-sky-800/80 text-sky-300 rounded font-medium">
                {group.retailerCount} retailer{group.retailerCount === 1 ? '' : 's'} • {group.retailerRows.length} offer{group.retailerRows.length === 1 ? '' : 's'}
              </span>
            </div>
            <h4 className="text-sm font-bold text-white">
              {group.productTitleEn || group.productTitleAr}
              {group.productTitleAr && group.productTitleEn ? (
                <span className="text-xs font-normal text-slate-400 mr-2 ml-2">({group.productTitleAr})</span>
              ) : null}
            </h4>
            <p className="text-[11px] text-slate-400">
              {group.brandName || 'Unknown Brand'}
              {group.variantOrFlavor ? ` • ${group.variantOrFlavor}` : ''}
              {group.sizeLabel ? ` • ${group.sizeLabel}` : ''}
              {group.packCount && group.packCount > 1 ? ` • Pack x${group.packCount}` : ''}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                isCatalog
                  ? handleGroupOfferDecisions(group.retailerRows, 'approved')
                  : handleDecision({ temporaryId: group.temporaryId!, decision: 'approved' })
              }
              className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                group.operatorDecision === 'approved'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
              }`}
            >
              {group.operatorDecision === 'approved'
                ? '✓ Approved'
                : isCatalog
                  ? 'Approve All Offers'
                  : 'Approve as New Product'}
            </button>
            <button
              type="button"
              onClick={() =>
                isCatalog
                  ? handleGroupOfferDecisions(group.retailerRows, 'rejected')
                  : handleDecision({ temporaryId: group.temporaryId!, decision: 'rejected' })
              }
              className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                group.operatorDecision === 'rejected'
                  ? 'bg-rose-700 text-white'
                  : 'bg-slate-800 hover:bg-rose-950 hover:text-rose-300 text-slate-400'
              }`}
            >
              {isCatalog ? 'Reject All' : 'Reject Group'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto border border-slate-800/80 rounded-lg">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/90 text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-3 py-2">Retailer</th>
                <th className="px-3 py-2">Promo / Original</th>
                <th className="px-3 py-2">Validity Dates</th>
                <th className="px-3 py-2">Scope</th>
                <th className="px-3 py-2">Page / Source ID</th>
                <th className="px-3 py-2 text-right">Actions & Evidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {group.retailerRows.map((row) => (
                <tr key={row.batchOfferKey} className="hover:bg-slate-900/50">
                  <td className="px-3 py-2 font-semibold text-slate-200">{row.supermarketName}</td>
                  <td className="px-3 py-2 font-mono">
                    <span className="text-emerald-300 font-semibold">
                      {row.promoPrice != null ? `${row.promoPrice} ${row.currency || 'SAR'}` : 'N/A'}
                    </span>
                    {row.originalPrice != null && (
                      <span className="text-slate-500 line-through ml-1.5 text-[11px]">
                        {row.originalPrice}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-300 font-mono text-[11px]">
                    {row.offerStartDate || '?'} → {row.offerEndDate || '?'}
                  </td>
                  <td className="px-3 py-2 text-slate-300">
                    {row.locationLabel || row.locationScope || 'Unscoped'}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-400">
                    p.{row.sourcePage} • {row.sourceOfferId}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      {(row.offerCardCropPath || row.productThumbCropPath || row.originalPageImagePath) && (
                        <button
                          type="button"
                          onClick={() =>
                            setInspectCropOffer({
                              title: row.titleEn || row.titleAr || group.productTitleEn,
                              retailer: row.supermarketName,
                              sourcePage: row.sourcePage,
                              sourceOfferId: row.sourceOfferId,
                              offerCardCropPath: row.offerCardCropPath,
                              productThumbCropPath: row.productThumbCropPath,
                              originalPageImagePath: row.originalPageImagePath
                            })
                          }
                          className="px-2 py-0.5 text-[11px] bg-slate-800 hover:bg-slate-700 text-sky-300 rounded border border-slate-700"
                        >
                          View Crop
                        </button>
                      )}
                      {isCatalog && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleDecision({ batchOfferKey: row.batchOfferKey, decision: 'approved' })}
                            className={`px-2 py-0.5 text-[11px] font-semibold rounded ${
                              row.operatorDecision === 'approved'
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                            }`}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDecision({ batchOfferKey: row.batchOfferKey, decision: 'rejected' })}
                            className={`px-2 py-0.5 text-[11px] font-semibold rounded ${
                              row.operatorDecision === 'rejected'
                                ? 'bg-rose-700 text-white'
                                : 'bg-slate-800 hover:bg-rose-950 hover:text-rose-300 text-slate-300'
                            }`}
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  const publicationTriage = useMemo(
    () =>
      summarizeBatchReviewTriage({
        offers,
        manifest,
        targetDatabaseContext: publishTarget
      }),
    [offers, manifest, publishTarget]
  )

  if (isLoading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-300">
        <span className="inline-block animate-spin text-2xl mb-2">⏳</span>
        <p className="text-sm">Loading intelligent catalog matching workspace...</p>
      </div>
    )
  }

  const proposalsList = manifest ? Object.values(manifest.proposals) : []
  const existingMatches = proposalsList.filter((p) => p.decision === 'existing')
  const temporaryGroups = manifest ? Object.values(manifest.temporaryProducts) : []
  const unresolvedMatches = proposalsList.filter((p) => p.decision === 'unresolved')
  const requestRecords = manifest?.requests ? Object.values(manifest.requests) : []
  const failedOrUncertainRequests = requestRecords.filter(
    (r) =>
      r.executionStatus === 'failed' ||
      r.executionStatus === 'outcome_unknown' ||
      r.executionStatus === 'cancelled'
  )
  const pendingRequestsCount = requestRecords.filter((r) => r.executionStatus === 'pending').length
  const hasUnverifiedLeafletMetadata = offers.some((o) => !isOfferMetadataAccepted(o))

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-6">
      <BatchWorkflowStepper
        currentStep={4}
        onStepClick={(step) => {
          if (step <= 3) onBack()
        }}
      />

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span>🚀</span> Step 4 — Publication &amp; Product Reconciliation
            </h2>
            <span className="font-mono text-xs px-2.5 py-0.5 bg-slate-800 border border-slate-700 text-indigo-300 rounded-full">
              {batchId}
            </span>
            {manifest && (
              <span className="font-mono text-[11px] px-2 py-0.5 bg-slate-800 border border-slate-700 text-slate-300 rounded">
                Status: {manifest.status}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Sequential Flex PayGo (concurrency 1) • Gemini 3.8 Flash (MEDIUM thinking) • Durable per-request checkpoints.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={onBack}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-all"
          >
            ← Back to Consolidated Review
          </button>

          {retrySummary && retrySummary.eligibleCount > 0 && !isMatching && (
            <button
              type="button"
              onClick={() => setShowRetryDialog(true)}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
            >
              ↻ Retry Failed Only ({retrySummary.eligibleCount})
            </button>
          )}

          {manifest && pendingRequestsCount > 0 && !isMatching && (
            <button
              type="button"
              onClick={() => openStartPreflightDialog('resume')}
              className="px-4 py-2 bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-semibold rounded-lg shadow-sm transition-all"
            >
              ▶ Resume Pending ({pendingRequestsCount})
            </button>
          )}

          <button
            type="button"
            onClick={() => openStartPreflightDialog(manifest && pendingRequestsCount > 0 ? 'resume' : 'full')}
            disabled={isMatching}
            className={`px-4 py-2 text-xs font-semibold rounded-lg shadow-sm transition-all flex items-center gap-2 ${
              isMatching
                ? 'bg-indigo-900/60 text-indigo-300 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white'
            }`}
          >
            {isMatching ? 'Processing...' : '▶ Match Products'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-950/60 border border-rose-800 rounded-lg text-rose-200 text-xs">
          {error}
        </div>
      )}

      {controlFeedback && (
        <div className="p-3 bg-amber-950/50 border border-amber-800 rounded-lg text-amber-200 text-xs">
          {controlFeedback}
        </div>
      )}

      {/* Preflight & Spend-Cap Confirmation Dialog */}
      {showStartDialog && estimate && (
        <div className="p-5 bg-slate-950 border-2 border-indigo-600 rounded-xl space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-bold text-white">
                {startMode === 'resume' ? 'Confirm Resuming Catalog Matching' : 'Matching Preflight & Spend-Cap Confirmation'}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Review model, Flex latency expectation, token estimate, and set an estimated spend limit before dispatching Gemini calls.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowStartDialog(false)}
              className="text-xs text-slate-400 hover:text-white px-2 py-1"
            >
              ✕ Close
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="p-2.5 bg-slate-900 rounded border border-slate-800">
              <span className="text-[10px] text-slate-400">Model & Thinking</span>
              <p className="text-white font-mono mt-0.5">{estimate.model} ({estimate.thinkingLevel})</p>
            </div>
            <div className="p-2.5 bg-slate-900 rounded border border-slate-800">
              <span className="text-[10px] text-slate-400">Execution Tier</span>
              <p className="text-indigo-300 font-mono mt-0.5">
                Vertex {estimate.executionTier.toUpperCase()} ({estimate.modelLocation || 'global'})
              </p>
            </div>
            <div className="p-2.5 bg-slate-900 rounded border border-slate-800">
              <span className="text-[10px] text-slate-400">Requests / Identities</span>
              <p className="text-white font-semibold mt-0.5">
                ~{estimate.approxGeminiRequests} reqs / {estimate.unresolvedUniqueIdentities} identities
              </p>
            </div>
            <div className="p-2.5 bg-slate-900 rounded border border-slate-800">
              <span className="text-[10px] text-slate-400">Est. Cost Range (USD)</span>
              <p className="text-emerald-300 font-mono font-bold mt-0.5">
                ${estimate.estimatedCostUsd.min.toFixed(4)} – ${estimate.estimatedCostUsd.max.toFixed(4)}
              </p>
            </div>
          </div>

          <div className="text-[11px] text-slate-300 bg-slate-900/70 p-3 rounded border border-slate-800 space-y-1">
            <div>
              Estimated Tokens: ~{estimate.estimatedInputTokens.toLocaleString()} input, ~{estimate.estimatedOutputTokens.toLocaleString()} output
              {typeof estimate.estimatedThinkingTokens === 'number' ? `, ~${estimate.estimatedThinkingTokens.toLocaleString()} thinking headroom` : ''}.
            </div>
            <div>
              Latency Expectation: Vertex AI Flex PayGo executes sequentially (concurrency 1) with variable queue times (per-request timeout: 600s). You can safely Pause or Cancel anytime.
            </div>
            <div className="text-amber-300">
              ⚠️ Disclaimer: {estimate.budgetCapDisclaimer || 'Local estimated spend limit stops before sending the next request if projected cost exceeds your cap, and is NOT a strict Google/Vertex AI billing ceiling.'}
            </div>
          </div>

          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-[11px] text-slate-300 font-semibold mb-1">
                  Catalog Matching Reference DB
                </label>
                <select
                  aria-label="Catalog Matching Reference DB"
                  value={matchingTargetDb}
                  onChange={(e) => setMatchingTargetDb(e.target.value as 'PRODUCTION_UI' | 'DEVELOPMENT_TEST')}
                  className="px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-white"
                >
                  <option value="PRODUCTION_UI">PRODUCTION_UI (Read-Only Prod Catalog)</option>
                  <option value="DEVELOPMENT_TEST">DEVELOPMENT_TEST (Guarded UAT Catalog)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-300 font-semibold mb-1">
                  Max Approved Estimated Spend Cap (USD)
                </label>
                <input
                  type="number"
                  step="0.005"
                  min="0.001"
                  value={approvedBudgetInput}
                  onChange={(e) => setApprovedBudgetInput(e.target.value)}
                  className="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs font-mono text-white w-44"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowStartDialog(false)}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmStartMatching}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg"
              >
                Confirm &amp; Start Paid Matching
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Retry Failed Only Explicit Authorization Dialog */}
      {showRetryDialog && retrySummary && (
        <div className="p-5 bg-slate-950 border-2 border-amber-600 rounded-xl space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-bold text-amber-300">
                Authorize Retry Failed Only ({retrySummary.eligibleCount} Request(s))
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Completed &amp; validated requests ({retrySummary.completedExcludedCount}) and existing temporary product groups are preserved and will NOT be re-sent.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowRetryDialog(false)}
              className="text-xs text-slate-400 hover:text-white px-2 py-1"
            >
              ✕ Close
            </button>
          </div>

          {retrySummary.uncertainBillingWarning && (
            <div className="p-3 bg-rose-950/50 border border-rose-700 rounded text-xs text-rose-200">
              ⚠️ {retrySummary.uncertainBillingWarning}
            </div>
          )}

          <div className="max-h-40 overflow-y-auto space-y-1.5">
            {retrySummary.failedRequests.map((fr) => (
              <div
                key={fr.requestKey}
                className="p-2 bg-slate-900 border border-slate-800 rounded text-[11px] flex items-center justify-between gap-2"
              >
                <div>
                  <span className="font-mono text-amber-300">{fr.requestKey}</span>{' '}
                  <span className="text-slate-300">({fr.brandName} chunk {fr.chunkIndex}, {fr.itemCount} items)</span>
                  <div className="text-[10px] text-rose-300 mt-0.5">
                    [{fr.executionStatus}] {fr.errorCode || 'ERROR'}: {fr.errorMessage}
                  </div>
                </div>
                <span className="text-[10px] font-mono text-slate-400 shrink-0">
                  Attempts: {fr.attemptCount}
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div className="space-y-1">
              <div className="text-xs text-slate-300">
                Additional Retry Estimate: <span className="font-mono text-emerald-300">${retrySummary.estimatedRetryCostUsd.min.toFixed(4)} – ${retrySummary.estimatedRetryCostUsd.max.toFixed(4)}</span>
              </div>
              <label className="block text-[11px] text-slate-300 font-semibold">
                Approved Retry Spend Cap (USD)
              </label>
              <input
                type="number"
                step="0.005"
                min="0.001"
                value={retryBudgetInput}
                onChange={(e) => setRetryBudgetInput(e.target.value)}
                className="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs font-mono text-white w-44"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowRetryDialog(false)}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRetryFailedOnly}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg"
              >
                Authorize &amp; Retry Failed Only
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Real-Time Progress, Elapsed Timers, Cost, and Pause/Cancel Controls */}
      {isMatching && (
        <div className="p-4 bg-slate-950/90 border border-indigo-700/70 rounded-xl space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="text-xs font-bold text-indigo-200 flex items-center gap-2">
                <span className="inline-block animate-pulse text-indigo-400">●</span>
                <span>Phase: {liveProgress?.phase || 'Preparing candidates'}</span>
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                {progressText || 'Matching in progress...'}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePauseAfterCurrent}
                disabled={Boolean(liveProgress?.pauseRequested)}
                className="px-3 py-1.5 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white text-[11px] font-semibold rounded-lg"
                title="Finishes the active request cleanly and saves checkpoints before stopping"
              >
                {liveProgress?.pauseRequested ? 'Pausing after current...' : '⏸ Pause after current request'}
              </button>
              <button
                type="button"
                onClick={handleCancelCurrentOperation}
                className="px-3 py-1.5 bg-rose-700 hover:bg-rose-600 text-white text-[11px] font-semibold rounded-lg"
                title="Aborts locally via AbortController; in-flight Vertex AI requests become outcome_unknown"
              >
                ⏹ Cancel current operation
              </button>
            </div>
          </div>

          <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
            <div
              className="bg-indigo-500 h-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-[11px]">
            <div className="bg-slate-900 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500">Requests</span>
              <p className="font-mono text-white">
                {liveProgress?.completedRequests ?? 0}/{liveProgress?.totalRequests ?? 0} ({progressPercent}%)
              </p>
            </div>
            <div className="bg-slate-900 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500">Failed / Uncertain</span>
              <p className="font-mono text-amber-300">
                {(liveProgress?.failedRequests ?? 0) + (liveProgress?.uncertainRequests ?? 0)} failed / {liveProgress?.pendingRequests ?? 0} pending
              </p>
            </div>
            <div className="bg-slate-900 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500">Current Brand / Chunk</span>
              <p className="font-mono text-cyan-300 truncate">
                {liveProgress?.currentBrand || '—'} {liveProgress?.currentChunkIndex ? `(#${liveProgress.currentChunkIndex}/${liveProgress.totalChunksInBrand || '?'})` : ''}
              </p>
            </div>
            <div className="bg-slate-900 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500">Current Request Elapsed</span>
              <p className="font-mono text-white">
                {formatDurationMs(reqStartClientMs ? reqElapsedTickMs : liveProgress?.currentRequestElapsedMs || 0)}
              </p>
            </div>
            <div className="bg-slate-900 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500">Total Elapsed</span>
              <p className="font-mono text-white">
                {formatDurationMs(runStartClientMs ? elapsedTickMs : liveProgress?.totalElapsedMs || 0)}
              </p>
            </div>
            <div className="bg-slate-900 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500">Observed / Remaining Cap</span>
              <p className="font-mono text-emerald-300">
                ${(liveProgress?.cumulativeObservedCostUsd ?? 0).toFixed(4)} /{' '}
                {liveProgress?.remainingEstimatedBudgetUsd !== null && liveProgress?.remainingEstimatedBudgetUsd !== undefined
                  ? `$${liveProgress.remainingEstimatedBudgetUsd.toFixed(4)} left`
                  : 'uncapped'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Isolated Request Failures / Outcome Unknown Banner (Distinct from semantic unresolved!) */}
      {failedOrUncertainRequests.length > 0 && !isMatching && (
        <div className="p-4 bg-rose-950/30 border border-rose-800/70 rounded-xl space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h4 className="text-xs font-bold text-rose-200">
                Execution Failures / Uncertain Outcomes ({failedOrUncertainRequests.length} Request(s))
              </h4>
              <p className="text-[11px] text-slate-300 mt-0.5">
                These requests failed or timed out during Gemini processing and are NOT classified as semantic unresolved matches or publishable products.
              </p>
            </div>
            {retrySummary && retrySummary.eligibleCount > 0 && (
              <button
                type="button"
                onClick={() => setShowRetryDialog(true)}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold rounded-lg"
              >
                Review &amp; Retry Failed Only
              </button>
            )}
          </div>
          <div className="space-y-1">
            {failedOrUncertainRequests.map((req) => (
              <div key={req.requestKey} className="text-[11px] bg-slate-950/70 p-2 rounded border border-slate-800 flex justify-between gap-3">
                <div>
                  <span className="font-mono text-amber-300">{req.brandName} (#{req.chunkIndex})</span>{' '}
                  <span className="px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 font-mono text-[10px]">
                    {req.executionStatus}
                  </span>{' '}
                  <span className="text-slate-300">{req.error?.message || 'Execution did not complete.'}</span>
                  {req.uncertainBillingWarning && (
                    <div className="text-[10px] text-amber-300 mt-0.5">{req.uncertainBillingWarning}</div>
                  )}
                </div>
                <span className="text-[10px] font-mono text-slate-400 shrink-0">{req.sourceOfferKeys.length} offers</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Preflight Estimate Banner */}
      {!manifest && estimate && !showStartDialog && (
        <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-xl flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold text-white">Matching Preflight Estimate</h4>
            <p className="text-xs text-slate-400 mt-0.5">
              Found {estimate.brandGroupCount} brand groups across {estimate.totalOffers} offers. Estimated Gemini calls:{' '}
              {estimate.approxGeminiRequests}. Estimated cost: ${estimate.estimatedCostUsd.min.toFixed(4)} - $
              {estimate.estimatedCostUsd.max.toFixed(4)}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 bg-indigo-950 text-indigo-300 border border-indigo-800 rounded text-xs font-mono">
              Tier: Flex PayGo
            </span>
            <span className="px-2.5 py-1 bg-amber-950 text-amber-300 border border-amber-800 rounded text-xs font-mono">
              Thinking: MEDIUM
            </span>
          </div>
        </div>
      )}

      {/* Summary KPI Cards */}
      {manifest && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-lg text-center">
            <span className="text-[11px] text-slate-400">Total Offers</span>
            <p className="text-base font-bold text-white mt-0.5">{manifest.totals.totalExtractedOffers}</p>
          </div>
          <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-lg text-center">
            <span className="text-[11px] text-slate-400">Cache / Exact Matches</span>
            <p className="text-base font-bold text-emerald-400 mt-0.5">
              {manifest.totals.cacheMatchesCount + manifest.totals.deterministicMatchesCount} ($0)
            </p>
          </div>
          <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-lg text-center">
            <span className="text-[11px] text-slate-400">Catalog Matches</span>
            <p className="text-base font-bold text-cyan-400 mt-0.5">{existingMatches.length}</p>
          </div>
          <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-lg text-center">
            <span className="text-[11px] text-slate-400">New Product Groups</span>
            <p className="text-base font-bold text-indigo-400 mt-0.5">{temporaryGroups.length}</p>
          </div>
          <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-lg text-center">
            <span className="text-[11px] text-slate-400">Unresolved</span>
            <p className="text-base font-bold text-amber-400 mt-0.5">{unresolvedMatches.length}</p>
          </div>
          <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-lg text-center">
            <span className="text-[11px] text-slate-400">Matching Stage Cost</span>
            <p className="text-base font-bold text-rose-300 mt-0.5">${manifest.totals.actualCostUsd.toFixed(4)}</p>
          </div>
        </div>
      )}

      {(propCostSummary || batchCostSummary) && (
        <ExtractionCostSummaryCard
          costSummary={propCostSummary || batchCostSummary}
          batchStatus={batchStatus}
        />
      )}

      {/* Tabs */}
      {manifest && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('existing')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  activeTab === 'existing'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                Existing Matches ({viewMode === 'grouped' ? groupedView.verifiedGroups.length : existingMatches.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('temporary')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  activeTab === 'temporary'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                New Product Groups ({viewMode === 'grouped' ? groupedView.provisionalGroups.length : temporaryGroups.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('unresolved')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  activeTab === 'unresolved'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                Unresolved ({unresolvedMatches.length})
              </button>

              <div className="inline-flex rounded-md border border-slate-700 bg-slate-950 p-0.5 ml-2">
                <button
                  type="button"
                  onClick={() => setViewMode('grouped')}
                  className={`px-2 py-1 text-[11px] font-semibold rounded ${
                    viewMode === 'grouped' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Grouped Cross-Retailer
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('offers')}
                  className={`px-2 py-1 text-[11px] font-semibold rounded ${
                    viewMode === 'offers' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Offer-Level
                </button>
              </div>
              {manifest.matchingDatabaseContext && (
                <span className="font-mono text-[10px] px-2 py-1 bg-slate-950 border border-slate-700 text-slate-300 rounded">
                  Matched DB: {manifest.matchingDatabaseContext}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                value={publishTarget}
                onChange={(e) => {
                  const val = e.target.value as 'PRODUCTION_UI' | 'DEVELOPMENT_TEST'
                  setPublishTarget(val)
                  setPreflightResult(null)
                  if (val !== 'DEVELOPMENT_TEST') {
                    setDevPublishAuthorized(false)
                    setAllowExpiredForDevTest(false)
                  }
                  if (val !== 'PRODUCTION_UI') {
                    setProdPublishAuthorized(false)
                  }
                }}
                className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
              >
                <option value="PRODUCTION_UI">PRODUCTION_UI (Schema-Gated Live DB)</option>
                <option value="DEVELOPMENT_TEST">DEVELOPMENT_TEST (Guarded UAT DB)</option>
              </select>
              {publishTarget === 'PRODUCTION_UI' && (
                <label className="flex items-center gap-1 text-[11px] text-rose-300">
                  <input
                    type="checkbox"
                    checked={prodPublishAuthorized}
                    onChange={(e) => setProdPublishAuthorized(e.target.checked)}
                  />
                  Authorize Production DB Publish
                </label>
              )}
              {publishTarget === 'DEVELOPMENT_TEST' && (
                <>
                  <label className="flex items-center gap-1 text-[11px] text-amber-300">
                    <input
                      type="checkbox"
                      checked={devPublishAuthorized}
                      onChange={(e) => setDevPublishAuthorized(e.target.checked)}
                    />
                    Authorize Dev DB Write
                  </label>
                  <label className="flex items-center gap-1 text-[11px] text-slate-300">
                    <input
                      type="checkbox"
                      checked={allowExpiredForDevTest}
                      onChange={(e) => setAllowExpiredForDevTest(e.target.checked)}
                    />
                    Allow Historical Dates (UAT)
                  </label>
                </>
              )}
              <button
                type="button"
                onClick={() => handlePublish(true)}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700"
              >
                Preflight &amp; Reconcile DB
              </button>
              <button
                type="button"
                onClick={() => handlePublish(false)}
                disabled={
                  hasUnverifiedLeafletMetadata ||
                  (offers.length > 0 &&
                    publicationTriage.readyCount === 0 &&
                    !Object.values(approvedUpdateSourceIds).some(Boolean) &&
                    !Object.values(overrideConflictSourceIds).some(Boolean)) ||
                  (publishTarget === 'DEVELOPMENT_TEST' && !devPublishAuthorized) ||
                  (publishTarget === 'PRODUCTION_UI' && !prodPublishAuthorized)
                }
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg shadow transition-all flex items-center gap-1.5"
              >
                {publishTarget === 'PRODUCTION_UI'
                  ? `🚀 Publish ${publicationTriage.readyCount} Ready Offers${publicationTriage.deferredCount > 0 ? ` — ${publicationTriage.deferredCount} Deferred` : ''} (Prod)`
                  : `🧪 Publish ${publicationTriage.readyCount} Ready Offers${publicationTriage.deferredCount > 0 ? ` — ${publicationTriage.deferredCount} Deferred` : ''} (Dev Test)`}
              </button>
            </div>
          </div>

          {/* Publication Preflight Readiness Breakdown */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] bg-slate-950/70 border border-slate-800 rounded-lg p-2.5">
            <div>
              <span className="text-slate-400">Ready to Publish Now:</span>{' '}
              <strong className="text-emerald-300 font-mono">{publicationTriage.readyToPublishCount}</strong>
            </div>
            <div>
              <span className="text-slate-400">Deferred (Needs Review / Blocked):</span>{' '}
              <strong className="text-amber-300 font-mono">{publicationTriage.deferredCount}</strong>{' '}
              <span className="text-[10px] text-slate-500">
                ({publicationTriage.needsReviewCount} review · {publicationTriage.blockedCount} blocked)
              </span>
            </div>
            <div>
              <span className="text-slate-400">Previously Published (Skipped):</span>{' '}
              <strong className="text-cyan-300 font-mono">{publicationTriage.publishedCount}</strong>
            </div>
            <div>
              <span className="text-slate-400">Blocked / Excluded:</span>{' '}
              <strong className="text-rose-300 font-mono">{publicationTriage.blockedCount}</strong>
            </div>
          </div>

          {hasUnverifiedLeafletMetadata && (
            <div className="p-2.5 bg-amber-950/60 border border-amber-700/80 rounded-lg text-xs text-amber-200">
              ⚠ Step 4 Publication Blocked: One or more leaflets still have unverified metadata (retailer, validity dates, or geographic scope). Return to Step 3 Consolidated Review first.
            </div>
          )}

          {publishTarget === 'DEVELOPMENT_TEST' &&
            manifest.matchingDatabaseContext &&
            manifest.matchingDatabaseContext !== 'DEVELOPMENT_TEST' && (
              <div className="p-3 bg-amber-950/50 border border-amber-700/80 rounded-lg text-xs text-amber-200">
                CATALOG_ENVIRONMENT_MISMATCH: Matching results were generated against{' '}
                <span className="font-mono font-semibold">{manifest.matchingDatabaseContext}</span>, while publication
                target is <span className="font-mono font-semibold">DEVELOPMENT_TEST</span>. Re-run catalog matching with
                Target Reference DB set to DEVELOPMENT_TEST before publishing.
              </div>
            )}

          {publishStatus && (
            <div className="p-3 bg-slate-950 border border-emerald-800/80 rounded-lg text-xs text-emerald-200">
              {publishStatus}
            </div>
          )}

          {preflightResult?.reconciliationSummary && (
            <div className="p-3 bg-slate-950/85 border border-cyan-800/70 rounded-lg text-xs space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-cyan-200">
                  🗄️ Pre-Publication Database Reconciliation ({publishTarget})
                </strong>
                <div className="flex flex-wrap gap-2 font-mono text-[11px]">
                  <span className="text-emerald-300">
                    New: {preflightResult.reconciliationSummary.newCount}
                  </span>
                  <span className="text-slate-400">
                    Already Published (No-Op): {preflightResult.reconciliationSummary.alreadyPublishedCount}
                  </span>
                  <span className="text-amber-300">
                    Updates: {preflightResult.reconciliationSummary.updateCandidateCount}
                  </span>
                  <span className="text-rose-300">
                    Conflicts: {preflightResult.reconciliationSummary.duplicateConflictCount}
                  </span>
                </div>
              </div>

              {preflightResult.reconciliationSummary.entries
                ?.filter((e: any) => e.classification === 'update_candidate' || e.classification === 'duplicate_conflict')
                .map((entry: any) => (
                  <div
                    key={entry.sourceOfferId}
                    className="p-2 bg-slate-900 border border-slate-800 rounded space-y-1 text-[11px]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-slate-200">
                        [{entry.classification}] {entry.sourceOfferId}
                      </span>
                      {entry.classification === 'update_candidate' ? (
                        <label className="flex items-center gap-1 text-amber-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={Boolean(approvedUpdateSourceIds[entry.sourceOfferId])}
                            onChange={(e) =>
                              setApprovedUpdateSourceIds((prev) => ({
                                ...prev,
                                [entry.sourceOfferId]: e.target.checked
                              }))
                            }
                          />
                          <span>Approve Update</span>
                        </label>
                      ) : (
                        <label className="flex items-center gap-1 text-rose-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={Boolean(overrideConflictSourceIds[entry.sourceOfferId])}
                            onChange={(e) =>
                              setOverrideConflictSourceIds((prev) => ({
                                ...prev,
                                [entry.sourceOfferId]: e.target.checked
                              }))
                            }
                          />
                          <span>Override Logical Conflict</span>
                        </label>
                      )}
                    </div>
                    <div className="text-slate-400">{entry.reason}</div>
                    {Array.isArray(entry.fieldDiffs) && entry.fieldDiffs.length > 0 && (
                      <div className="text-[10px] font-mono text-slate-300">
                        Diffs:{' '}
                        {entry.fieldDiffs
                          .map((d: any) => `${d.field}: ${JSON.stringify(d.before)} → ${JSON.stringify(d.after)}`)
                          .join(' | ')}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          )}

          {/* TAB 1: EXISTING MATCHES */}
          {activeTab === 'existing' && (
            <div className="space-y-3">
              {viewMode === 'grouped' ? (
                groupedView.verifiedGroups.length === 0 ? (
                  <p className="text-xs text-slate-500 italic py-6 text-center">No existing catalog matches found.</p>
                ) : (
                  groupedView.verifiedGroups.map((grp) => renderCrossRetailerGroupCard(grp))
                )
              ) : existingMatches.length === 0 ? (
                <p className="text-xs text-slate-500 italic py-6 text-center">No existing catalog matches found.</p>
              ) : (
                existingMatches.map((p) => {
                  const offer = offers.find((o) => o.batchOfferKey === p.batchOfferKey)
                  const cand = p.matchedProduct
                  return (
                    <div
                      key={p.batchOfferKey}
                      className="p-3 bg-slate-950/80 border border-slate-800 rounded-lg flex items-center justify-between gap-4"
                    >
                      {/* Left: Extracted Offer */}
                      <div className="flex items-center gap-3 w-1/2">
                        <div className="w-12 h-12 bg-slate-900 border border-slate-800 rounded overflow-hidden flex items-center justify-center shrink-0">
                          {offer?.productThumbCropPath ? (
                            <img
                              src={getLocalImageUrl(offer.productThumbCropPath)!}
                              alt=""
                              className="w-full h-full object-contain"
                            />
                          ) : (
                            <span className="text-[9px] text-slate-600">No Img</span>
                          )}
                        </div>
                        <div>
                          <div className="text-xs font-bold text-white">{offer?.titleAr}</div>
                          <div className="text-[11px] text-slate-400 truncate">{offer?.titleEn}</div>
                          <div className="flex items-center gap-2 mt-1 text-[10px]">
                            <span className="text-amber-400 font-semibold">{offer?.brand || 'No brand'}</span>
                            <span className="text-slate-500">•</span>
                            <span className="text-slate-300">
                              {offer?.each_size_value} {offer?.each_size_unit}
                            </span>
                            <span className="text-slate-500">•</span>
                            <span className="text-indigo-400 font-mono">{offer?.supermarketName}</span>
                          </div>
                        </div>
                      </div>

                      {/* Middle: Matched Catalog Product */}
                      <div className="flex items-center gap-3 w-2/5 border-l border-slate-800 pl-4">
                        <div className="w-12 h-12 bg-slate-900 border border-slate-800 rounded overflow-hidden flex items-center justify-center shrink-0">
                          {cand?.imageUrl ? (
                            <img src={cand.imageUrl} alt="" className="w-full h-full object-contain" />
                          ) : (
                            <span className="text-[9px] text-slate-600">Catalog</span>
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-cyan-300">
                              {cand?.nameEn || cand?.nameAr || `Product #${p.matchedProductId}`}
                            </span>
                            <span className="font-mono text-[10px] px-1.5 py-0.2 bg-cyan-950 border border-cyan-800 text-cyan-300 rounded">
                              ID: {p.matchedProductId}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {cand?.brand} | {cand?.sizeValue} {cand?.sizeUnit} | Pack {cand?.packCount || 1}
                          </div>
                          <div className="text-[9px] text-emerald-400 mt-0.5">
                            Method: {p.matchMethod} ({p.confidence} confidence)
                          </div>
                        </div>
                      </div>

                      {/* Right: Actions */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            handleDecision({ batchOfferKey: p.batchOfferKey, decision: 'approved' })
                          }
                          className={`px-2.5 py-1 text-[11px] font-semibold rounded ${
                            p.operatorDecision === 'approved'
                              ? 'bg-emerald-600 text-white'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                          }`}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleDecision({ batchOfferKey: p.batchOfferKey, decision: 'rejected' })
                          }
                          className="px-2.5 py-1 text-[11px] font-semibold rounded bg-slate-800 hover:bg-rose-950 hover:text-rose-300 text-slate-300"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          )}

          {/* TAB 2: NEW TEMPORARY GROUPS */}
          {activeTab === 'temporary' && (
            <div className="space-y-3">
              {viewMode === 'grouped' ? (
                groupedView.provisionalGroups.length === 0 ? (
                  <p className="text-xs text-slate-500 italic py-6 text-center">No new temporary products identified.</p>
                ) : (
                  groupedView.provisionalGroups.map((grp) => renderCrossRetailerGroupCard(grp))
                )
              ) : temporaryGroups.length === 0 ? (
                <p className="text-xs text-slate-500 italic py-6 text-center">No new temporary products identified.</p>
              ) : (
                temporaryGroups.map((grp) => (
                  <div
                    key={grp.temporaryId}
                    className="p-4 bg-slate-950/80 border border-indigo-950 rounded-xl space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs px-2.5 py-0.5 bg-indigo-950 border border-indigo-800 text-indigo-300 rounded font-semibold">
                          {grp.temporaryId}
                        </span>
                        <h4 className="text-sm font-bold text-white">
                          {grp.productNameEn || grp.productNameAr}
                        </h4>
                        <span className="text-xs text-amber-400 font-semibold">({grp.brandNameEn || grp.brandKey})</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            handleDecision({ temporaryId: grp.temporaryId, decision: 'approved' })
                          }
                          className={`px-3 py-1 text-xs font-semibold rounded ${
                            grp.operatorDecision === 'approved'
                              ? 'bg-emerald-600 text-white'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                          }`}
                        >
                          {grp.operatorDecision === 'approved' ? '✓ Operator Verified' : 'Mark Operator-Verified (Optional)'}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleDecision({ temporaryId: grp.temporaryId, decision: 'rejected' })
                          }
                          className="px-3 py-1 text-xs font-semibold rounded bg-slate-800 hover:bg-rose-950 hover:text-rose-300 text-slate-400"
                        >
                          Reject
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2 text-xs bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                      <div>
                        <span className="text-[10px] text-slate-500">Size / Pack:</span>
                        <p className="text-white font-medium">
                          {grp.eachSizeValue || 'N/A'} {grp.eachSizeUnit || ''} (Pack: {grp.innerPackCount || 1})
                        </p>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500">Fat Content / Variant:</span>
                        <p className="text-white font-medium">{grp.fatContent || grp.variantOrFlavor || 'Standard'}</p>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500">Retailers Represented:</span>
                        <p className="text-indigo-300 font-medium">{grp.retailers.join(', ') || 'N/A'}</p>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500">Member Offers:</span>
                        <p className="text-amber-400 font-bold">{grp.sourceOfferKeys.length} offers</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB 3: UNRESOLVED */}
          {activeTab === 'unresolved' && (
            <div className="space-y-3">
              {unresolvedMatches.length === 0 ? (
                <p className="text-xs text-slate-500 italic py-6 text-center">Zero unresolved products.</p>
              ) : (
                unresolvedMatches.map((p) => {
                  const offer = offers.find((o) => o.batchOfferKey === p.batchOfferKey)
                  const approval = manifest?.nonCatalogApprovals?.[p.batchOfferKey]
                  const assessment = assessOfferPublicationOutcome({
                    offer: offer || { batchOfferKey: p.batchOfferKey },
                    proposal: p,
                    temporaryProducts: manifest?.temporaryProducts,
                    approval
                  })
                  const promoLabel = [
                    offer?.promoPrice != null ? `${offer.promoPrice} SAR` : 'Price missing',
                    offer?.originalPrice != null ? `(was ${offer.originalPrice})` : null,
                    offer?.promotion_mechanic || offer?.promoNotes || null,
                    offer?.offerStartDate && offer?.offerEndDate
                      ? `${offer.offerStartDate} → ${offer.offerEndDate}`
                      : 'Dates missing',
                    offer?.locationScope || 'national'
                  ]
                    .filter(Boolean)
                    .join(' • ')

                  return (
                    <div
                      key={p.batchOfferKey}
                      className="p-3 bg-slate-950/80 border border-amber-950 rounded-lg flex items-start justify-between gap-4 flex-wrap"
                    >
                      <div className="space-y-1 flex-1 min-w-[260px]">
                        <div className="text-xs font-bold text-white">{offer?.titleAr || '(No Arabic title)'}</div>
                        <div className="text-[11px] text-slate-400">{offer?.titleEn || '(No English title)'}</div>
                        <div className="text-[10px] text-cyan-300 font-mono">{promoLabel}</div>
                        <div className="text-[10px] text-slate-300">
                          Identity: <span className="font-mono text-amber-300">{assessment.catalogMatchStatus}</span> •{' '}
                          {assessment.unresolvedReason}
                        </div>
                        {assessment.perUnitPricing.basisEstablished && assessment.perUnitPricing.unitPrice != null && (
                          <div className="text-[10px] text-slate-400">
                            Unit basis: {assessment.perUnitPricing.unitPrice} SAR/{assessment.perUnitPricing.unitPriceUnit}
                          </div>
                        )}
                        <div className="flex items-center gap-2 flex-wrap pt-0.5">
                          <span
                            className={`px-2 py-0.5 text-[10px] rounded font-semibold border ${
                              assessment.outcome === 'approved_non_catalog'
                                ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                                : assessment.isSafeForNonCatalogPublication
                                ? 'bg-sky-950 text-sky-300 border-sky-800'
                                : 'bg-rose-950 text-rose-300 border-rose-800'
                            }`}
                          >
                            {assessment.outcome === 'approved_non_catalog'
                              ? `Approved Non-Catalog (${assessment.category || 'grocery'})`
                              : assessment.isSafeForNonCatalogPublication
                              ? `Safe for Non-Catalog (${assessment.category || 'grocery'})`
                              : 'Quarantined — Corrections Required'}
                          </span>
                          {assessment.comparisonDisabled && (
                            <span className="px-2 py-0.5 bg-slate-900 text-slate-300 border border-slate-700 text-[10px] rounded">
                              Exact-SKU Comparison Disabled
                            </span>
                          )}
                        </div>
                        {(assessment.quarantineReasons.length > 0 || assessment.correctionReasons.length > 0) && (
                          <details className="text-[10px] text-amber-400">
                            <summary className="cursor-pointer select-none">Developer Diagnostics</summary>
                            <div className="mt-0.5 font-mono">
                              {assessment.quarantineReasons.length > 0
                                ? `Quarantine: ${assessment.quarantineReasons.join(', ')} — ${assessment.correctionReasons.join(' ')}`
                                : `Notes: ${assessment.correctionReasons.join(' ')}`}
                            </div>
                          </details>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {assessment.isEligibleForNonCatalogPublication && (
                          <button
                            type="button"
                            onClick={() =>
                              handleDecision({
                                batchOfferKey: p.batchOfferKey,
                                decision: 'approved',
                                targetType: 'non_catalog',
                                nonCatalogCategory: assessment.category
                              })
                            }
                            className={`px-2.5 py-1 text-[10px] rounded font-semibold transition-all ${
                              approval?.decision === 'approved'
                                ? 'bg-emerald-600 text-white'
                                : 'bg-emerald-950 hover:bg-emerald-800 text-emerald-300 border border-emerald-800'
                            }`}
                          >
                            {approval?.decision === 'approved' ? '✓ Non-Catalog Approved' : 'Approve Non-Catalog'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            handleDecision({
                              batchOfferKey: p.batchOfferKey,
                              decision: 'rejected',
                              targetType: 'non_catalog',
                              nonCatalogCategory: assessment.category
                            })
                          }
                          className={`px-2.5 py-1 text-[10px] rounded font-semibold transition-all ${
                            approval?.decision === 'rejected'
                              ? 'bg-rose-600 text-white'
                              : 'bg-rose-950 hover:bg-rose-800 text-rose-300 border border-rose-800'
                          }`}
                        >
                          {approval?.decision === 'rejected' ? '✕ Quarantined' : 'Quarantine'}
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>
      )}

      {inspectCropOffer && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-3xl w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white">{inspectCropOffer.title}</h3>
                <p className="text-xs text-slate-400">
                  {inspectCropOffer.retailer} • Page {inspectCropOffer.sourcePage} •{' '}
                  <span className="font-mono">{inspectCropOffer.sourceOfferId}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectCropOffer(null)}
                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 rounded border border-slate-700"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-2">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Offer Card Evidence Crop
                </span>
                <div className="h-56 flex items-center justify-center bg-black/40 rounded overflow-hidden">
                  {getLocalImageUrl(inspectCropOffer.offerCardCropPath) ? (
                    <img
                      src={getLocalImageUrl(inspectCropOffer.offerCardCropPath)!}
                      alt="Offer Card Crop"
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <span className="text-xs text-slate-500 italic">No offer card crop</span>
                  )}
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-2">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Product Thumbnail Crop
                </span>
                <div className="h-56 flex items-center justify-center bg-black/40 rounded overflow-hidden">
                  {getLocalImageUrl(inspectCropOffer.productThumbCropPath) ? (
                    <img
                      src={getLocalImageUrl(inspectCropOffer.productThumbCropPath)!}
                      alt="Product Thumb Crop"
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <span className="text-xs text-slate-500 italic">No product thumbnail</span>
                  )}
                </div>
              </div>
            </div>

            {getLocalImageUrl(inspectCropOffer.originalPageImagePath) && (
              <div className="text-[11px] text-slate-400 font-mono truncate">
                Source Page Asset: {inspectCropOffer.originalPageImagePath}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
