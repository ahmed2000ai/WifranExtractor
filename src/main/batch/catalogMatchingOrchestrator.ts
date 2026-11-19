/**
 * Catalog Matching Orchestrator
 * Milestone: WIFRAN-EXTRACTOR-CATALOG-MATCH-001
 *
 * Coordinates intelligent catalog matching for multi-leaflet batches:
 * 1. Preflight token & cost estimation
 * 2. Persistent verified-match cache & deterministic local matching ($0 cost)
 * 3. Cross-leaflet identity deduplication
 * 4. Brand-level dynamic batching & Gemini evaluation (MEDIUM thinking, Flex PayGo)
 * 5. Temporary product grouping & cross-request reconciliation
 * 6. Durable local persistence (matching-proposals.json)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, statSync } from 'fs'
import { basename, join } from 'path'
import { createHash } from 'crypto'
import { SupabaseClient } from '@supabase/supabase-js'
import {
  MatchingRunManifest,
  MatchingProposal,
  MatchingTotals,
  MatchingPreflightEstimate,
  BrandGroupSummary,
  CompactCatalogCandidate,
  ConsumerProductImageApproval,
  NormalizedIdentityAttributes,
  OperatorDecisionStatus,
  NonCatalogEligibilityCategory,
  MatchingRequestRecord,
  MatchingRequestAttempt,
  MatchingProgressEvent,
  MatchingRunPhase,
  MatchingRunStatus,
  RequestExecutionStatus,
  RetryFailedPreflightSummary
} from '../../shared/types/catalogMatching'
import { UnifiedBatchOffer } from '../../shared/types/batchExtraction'
import { BrandGroupingService, BrandGroup, DeduplicatedIdentityItem } from '../db/brandGroupingService'
import { VerifiedMatchCacheService } from '../db/verifiedMatchCacheService'
import { GeminiMatchingService, classifyMatchingError } from '../ocr/geminiMatchingService'
import { getModelPricing, calculateGeminiCost } from '../ocr/geminiPricingTable'
import { GeminiCostLedgerService, buildLedgerEntryFromProviderCall } from '../ocr/geminiCostLedgerService'
import { arePackConfigsStrictlyCompatible } from '../../shared/utils/sizeCompatibility'
import { TemporaryProductRegistry } from '../db/temporaryProductRegistry'
import { evaluateIdentitySufficiency } from '../db/productIdentityPolicy'
import { MatchingEvidenceOverlayService } from '../db/matchingEvidenceOverlayService'

export type MatchingProgressListener =
  | ((statusText: string, percent: number, details?: MatchingProgressEvent) => void)

export interface ExecuteMatchingRunParams {
  batchId: string
  offers: UnifiedBatchOffer[]
  supabase: SupabaseClient
  databaseContext?: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST'
  progressCallback?: MatchingProgressListener
  mode?: 'full' | 'resume' | 'retry_failed_only'
  approvedMaxBudgetUsd?: number | null
  flexTimeoutMs?: number
  targetRequestKeys?: string[]
  retryAuthorization?: {
    approvedByOperator: boolean
    approvedMaxBudgetUsd: number
    acknowledgedUncertainBillingWarning?: boolean
  }
}

interface ActiveRunControl {
  runId: string
  startedAtMs: number
  pauseRequested: boolean
  cancelRequested: boolean
  abortController: AbortController
}

interface PlannedRequestEntry {
  requestKey: string
  brandKey: string
  brandName: string
  group: BrandGroup
  candidates: CompactCatalogCandidate[]
  candidateMap: Map<string, CompactCatalogCandidate>
  totalBrandProducts?: number
  retrievalCompleteness?: BrandGroupSummary['retrievalCompleteness']
  fallbackActions?: string[]
  chunkItems: DeduplicatedIdentityItem[]
  chunkSize: number
  chunkIndex: number
  totalChunksInBrand: number
}

export class CatalogMatchingOrchestrator {
  private brandGroupingService: BrandGroupingService
  private cacheService: VerifiedMatchCacheService
  private devCacheService: VerifiedMatchCacheService
  private geminiMatchingService: GeminiMatchingService
  private activeRuns: Map<string, ActiveRunControl> = new Map()

  constructor(
    cacheService?: VerifiedMatchCacheService,
    geminiMatchingService?: GeminiMatchingService,
    brandGroupingService?: BrandGroupingService,
    evidenceOverlay?: MatchingEvidenceOverlayService,
    private customBatchesBaseDir?: string
  ) {
    this.brandGroupingService = brandGroupingService || new BrandGroupingService(evidenceOverlay)
    this.cacheService = cacheService || new VerifiedMatchCacheService(undefined, 'production')
    this.devCacheService = cacheService || new VerifiedMatchCacheService(undefined, 'development')
    this.geminiMatchingService = geminiMatchingService || new GeminiMatchingService()
  }

  public getMatchingDir(batchId: string): string {
    const base =
      this.customBatchesBaseDir ||
      join(process.cwd(), process.env.WIFRAN_OFFLINE_UAT === '1' ? 'workspaces_uat/batches' : 'Extracts/batches')
    return join(base, batchId, 'catalog-matching')
  }

  public getManifestPath(batchId: string): string {
    return join(this.getMatchingDir(batchId), 'matching-proposals.json')
  }

  public getRequestArtifactDir(batchId: string): string {
    return join(this.getMatchingDir(batchId), 'requests')
  }

  public isRunActive(batchId: string): boolean {
    return this.activeRuns.has(batchId)
  }

  public requestPause(batchId: string): { accepted: boolean; message: string } {
    const control = this.activeRuns.get(batchId)
    if (!control) {
      return { accepted: false, message: `No active matching run found for batch ${batchId}.` }
    }
    control.pauseRequested = true
    return {
      accepted: true,
      message: 'Pause scheduled after the current Gemini request completes and its checkpoint is saved.'
    }
  }

  public requestCancel(batchId: string): { accepted: boolean; message: string } {
    const control = this.activeRuns.get(batchId)
    if (!control) {
      return { accepted: false, message: `No active matching run found for batch ${batchId}.` }
    }
    control.cancelRequested = true
    control.abortController.abort()
    return {
      accepted: true,
      message:
        'Cancellation signal sent. Local pipeline will stop cleanly; any in-flight Vertex AI Flex request will be marked outcome_unknown because provider billing/execution cannot be guaranteed stopped.'
    }
  }

  public loadManifest(batchId: string): MatchingRunManifest | null {
    const path = this.getManifestPath(batchId)
    if (!existsSync(path)) return null
    try {
      const raw = readFileSync(path, 'utf8')
      const parsed = JSON.parse(raw) as MatchingRunManifest
      return this.recoverInterruptedManifest(parsed, !this.activeRuns.has(batchId))
    } catch (err) {
      console.warn(`[CatalogMatching] Failed to load manifest for batch ${batchId}`, err)
      return null
    }
  }

  /**
   * Transitions stale 'in_progress' requests left behind by a crash/restart into
   * 'outcome_unknown' for operator review without auto-retrying or inventing usage.
   */
  public recoverInterruptedManifest(
    manifest: MatchingRunManifest,
    persistRecoveredState: boolean = true
  ): MatchingRunManifest {
    if (!manifest.requests || this.activeRuns.has(manifest.batchId)) {
      return manifest
    }

    let mutated = false
    const now = new Date().toISOString()
    const recoveryNotes: string[] = [...(manifest.lastRecoveryNotes || [])]

    for (const reqRecord of Object.values(manifest.requests)) {
      if (reqRecord.executionStatus === 'in_progress') {
        mutated = true
        const warningMsg =
          'Process terminated or restarted while this Flex request was in flight without a recorded response. Provider execution and billing state are unknown; manual review is required before retrying.'
        reqRecord.executionStatus = 'outcome_unknown'
        reqRecord.validated = false
        reqRecord.finishedAt = reqRecord.finishedAt || now
        reqRecord.uncertainBillingWarning = warningMsg
        reqRecord.error = {
          code: 'INTERRUPTED_IN_FLIGHT',
          message: warningMsg,
          isSystemic: false,
          isUncertainOutcome: true,
          httpStatus: null
        }

        const attemptNumber = reqRecord.attemptCount || reqRecord.attempts.length + 1
        reqRecord.attemptCount = attemptNumber
        const hasAttemptEntry = reqRecord.attempts.some((a) => a.attemptNumber === attemptNumber)
        if (!hasAttemptEntry) {
          reqRecord.attempts.push({
            attemptNumber,
            runId: reqRecord.runId,
            startedAt: reqRecord.startedAt || now,
            finishedAt: now,
            executionStatus: 'outcome_unknown',
            errorCode: 'INTERRUPTED_IN_FLIGHT',
            errorMessage: warningMsg,
            httpStatus: null,
            isUncertainOutcome: true,
            latencyMs: null,
            usageMetadata: null,
            observedCostUsd: 0,
            uncertainBillingWarning: warningMsg
          })
        }

        recoveryNotes.push(
          `Recovered interrupted request ${reqRecord.requestKey} (${reqRecord.brandKey}) -> outcome_unknown at ${now}.`
        )
      }
    }

    if (manifest.status === 'running') {
      mutated = true
      const reqList = Object.values(manifest.requests)
      const hasFailedOrUncertain = reqList.some(
        (r) => r.executionStatus === 'failed' || r.executionStatus === 'outcome_unknown'
      )
      const hasCompleted = reqList.some((r) => r.executionStatus === 'completed')
      manifest.status = hasFailedOrUncertain
        ? hasCompleted
          ? 'completed_with_failures'
          : 'failed'
        : hasCompleted
          ? 'paused'
          : 'failed'
      manifest.stoppedReason = manifest.stoppedReason || 'PROCESS_INTERRUPTED_RECOVERY'
    }

    if (mutated) {
      manifest.lastRecoveryNotes = recoveryNotes
      manifest.updatedAt = now
      this.syncRequestCounters(manifest.totals, manifest.requests)
      if (persistRecoveredState) {
        this.saveManifestAtomic(manifest)
      }
    }

    return manifest
  }

  private atomicWriteJson(targetPath: string, payload: unknown): void {
    const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}`
    writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8')
    let lastErr: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        renameSync(tmpPath, targetPath)
        return
      } catch (err: any) {
        lastErr = err
        if (err?.code !== 'EPERM' && err?.code !== 'EBUSY') {
          throw err
        }
      }
    }
    throw lastErr
  }

  public static buildProposalProductKey(
    batchOfferKey: string,
    proposal?: Pick<MatchingProposal, 'decision' | 'matchedProductId' | 'temporaryId'> | null
  ): string {
    if (proposal?.decision === 'existing' && proposal.matchedProductId) {
      return `product:${proposal.matchedProductId}`
    }
    if (proposal?.decision === 'temporary' && proposal.temporaryId) {
      return `temp:${proposal.temporaryId}`
    }
    return `offer:${batchOfferKey}`
  }

  private syncConsumerImageApprovals(manifest: MatchingRunManifest): void {
    manifest.consumerImageApprovals = manifest.consumerImageApprovals || {}
    const nowIso = new Date().toISOString()

    // First pass: invalidate stale approvals whose bound product changed
    for (const [key, proposal] of Object.entries(manifest.proposals || {})) {
      const existing = manifest.consumerImageApprovals[key]
      if (!existing) continue
      const currentProductKey = CatalogMatchingOrchestrator.buildProposalProductKey(key, proposal)
      if (
        (existing.status === 'approved_generated_crop' || existing.status === 'reuse_existing_catalog_image') &&
        existing.approvedForProductKey !== currentProductKey
      ) {
        manifest.consumerImageApprovals[key] = {
          ...existing,
          status: 'invalidated_identity_changed',
          sourceType: null,
          approvedLocalPath: null,
          existingCatalogImageUrl: null,
          invalidationReason: `Product identity changed (${existing.approvedForProductKey} -> ${currentProductKey}); image re-approval required.`,
          updatedAt: nowIso
        }
      }
    }

    // Collect already-approved images per product/temp key within this batch for same-product reuse
    const reusableByProductKey = new Map<string, ConsumerProductImageApproval>()
    for (const approval of Object.values(manifest.consumerImageApprovals)) {
      if (
        (approval.status === 'approved_generated_crop' && approval.approvedLocalPath && existsSync(approval.approvedLocalPath)) ||
        (approval.status === 'reuse_existing_catalog_image' && approval.existingCatalogImageUrl)
      ) {
        if (
          approval.approvedForProductKey.startsWith('product:') ||
          approval.approvedForProductKey.startsWith('temp:')
        ) {
          if (!reusableByProductKey.has(approval.approvedForProductKey)) {
            reusableByProductKey.set(approval.approvedForProductKey, approval)
          }
        }
      }
    }

    // Second pass: auto-inherit existing catalog image or same-batch verified product image when unreviewed
    for (const [key, proposal] of Object.entries(manifest.proposals || {})) {
      const currentProductKey = CatalogMatchingOrchestrator.buildProposalProductKey(key, proposal)
      const existing = manifest.consumerImageApprovals[key]

      if (proposal.decision === 'existing' && proposal.matchedProductId && proposal.matchedProduct?.imageUrl) {
        if (
          !existing ||
          existing.status === 'unreviewed' ||
          (existing.status === 'invalidated_identity_changed' && existing.approvedForProductKey !== currentProductKey)
        ) {
          const rec: ConsumerProductImageApproval = {
            batchOfferKey: key,
            status: 'reuse_existing_catalog_image',
            sourceType: 'existing_catalog_image',
            approvedLocalPath: null,
            existingCatalogImageUrl: proposal.matchedProduct.imageUrl,
            approvedForProductKey: currentProductKey,
            approvedForProductLabel: proposal.matchedProduct.nameEn || proposal.matchedProduct.nameAr || null,
            rightsBasis: 'existing_verified_catalog_image',
            verifiedBy: 'catalog_reuse',
            verifiedAt: nowIso,
            invalidationReason: null,
            updatedAt: nowIso
          }
          manifest.consumerImageApprovals[key] = rec
          reusableByProductKey.set(currentProductKey, rec)
          continue
        }
      }

      if (
        (!existing || existing.status === 'unreviewed') &&
        (currentProductKey.startsWith('product:') || currentProductKey.startsWith('temp:')) &&
        reusableByProductKey.has(currentProductKey)
      ) {
        const source = reusableByProductKey.get(currentProductKey)!
        manifest.consumerImageApprovals[key] = {
          batchOfferKey: key,
          status: source.status,
          sourceType: source.sourceType,
          approvedLocalPath: source.approvedLocalPath,
          existingCatalogImageUrl: source.existingCatalogImageUrl ?? null,
          approvedForProductKey: currentProductKey,
          approvedForProductLabel: source.approvedForProductLabel ?? null,
          rightsBasis: source.rightsBasis || 'staged_product_image_reuse',
          verifiedBy: source.verifiedBy || 'staged_reuse',
          verifiedAt: source.verifiedAt || nowIso,
          invalidationReason: null,
          updatedAt: nowIso
        }
      }
    }
  }

  public saveManifestAtomic(manifest: MatchingRunManifest): void {
    this.syncConsumerImageApprovals(manifest)
    const dir = this.getMatchingDir(manifest.batchId)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    this.atomicWriteJson(this.getManifestPath(manifest.batchId), manifest)
  }

  private saveRequestArtifactAtomic(
    batchId: string,
    requestKey: string,
    artifact: Record<string, unknown>
  ): string {
    const reqDir = this.getRequestArtifactDir(batchId)
    if (!existsSync(reqDir)) {
      mkdirSync(reqDir, { recursive: true })
    }
    const filename = `${requestKey}.json`
    this.atomicWriteJson(join(reqDir, filename), artifact)
    return `requests/${filename}`
  }

  private buildDeterministicRequestKey(
    batchId: string,
    brandKey: string,
    chunkIndex: number,
    identityKeys: string[]
  ): string {
    const digest = createHash('sha256')
      .update(`${batchId}|${brandKey}|${chunkIndex}|${identityKeys.join(',')}`)
      .digest('hex')
      .slice(0, 10)
    const safeBrand = brandKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24)
    return `req_${safeBrand}_c${chunkIndex}_${digest}`
  }

  /**
   * Candidate-token-aware dynamic chunk sizing to preserve Gemini reasoning headroom.
   * If brand candidate catalog > 25 items, chunk size is 20. Otherwise, 40.
   */
  public determineChunkSize(candidateCount: number): number {
    return candidateCount > 25 ? 20 : 40
  }

  public estimateSingleRequestCostUsd(
    itemCount: number,
    _candidateCount: number = 0
  ): {
    inputTokens: number
    outputTokens: number
    thinkingTokens: number
    minCostUsd: number
    maxCostUsd: number
  } {
    const rates = getModelPricing('gemini-3.8-flash', 'flex')
    const inputTokens = 1300 + itemCount * 40
    const outputTokens = itemCount * 15
    const thinkingTokens = 300
    const minCalc = calculateGeminiCost(
      { promptTokenCount: inputTokens, candidatesTokenCount: outputTokens, thoughtsTokenCount: 0 },
      'gemini-3.8-flash',
      'flex'
    )
    const maxCalc = calculateGeminiCost(
      {
        promptTokenCount: inputTokens,
        candidatesTokenCount: outputTokens,
        thoughtsTokenCount: thinkingTokens
      },
      'gemini-3.8-flash',
      'flex'
    )
    return {
      inputTokens,
      outputTokens,
      thinkingTokens,
      minCostUsd: Number(minCalc.totalCostUsd.toFixed(6)) || Number(
        ((inputTokens * rates.inputPerMillion + outputTokens * rates.outputPerMillion) / 1_000_000).toFixed(6)
      ),
      maxCostUsd: Number(maxCalc.totalCostUsd.toFixed(6))
    }
  }

  /**
   * Generates a preflight estimate of brand groups, tokens, requests, and cost.
   */
  public generatePreflightEstimate(offers: UnifiedBatchOffer[]): MatchingPreflightEstimate {
    const brandGroups = this.brandGroupingService.groupOffersByBrand(offers)
    const totalIdentities = brandGroups.reduce((acc, g) => acc + g.uniqueIdentities.length, 0)

    let approxRequests = 0
    let estimatedInputTokens = 0
    let estimatedOutputTokens = 0
    let estimatedThinkingTokens = 0

    for (const group of brandGroups) {
      const itemCount = group.uniqueIdentities.length
      const requestsForGroup = Math.ceil(itemCount / 40) || 1
      approxRequests += requestsForGroup
      estimatedInputTokens += requestsForGroup * 1300 + itemCount * 40
      estimatedOutputTokens += itemCount * 15
      estimatedThinkingTokens += requestsForGroup * 300
    }

    const rates = getModelPricing('gemini-3.8-flash', 'flex')
    const minCost = (estimatedInputTokens * rates.inputPerMillion + estimatedOutputTokens * rates.outputPerMillion) / 1000000
    const maxCost = minCost + (estimatedThinkingTokens * rates.thinkingPerMillion) / 1000000

    return {
      totalOffers: offers.length,
      unresolvedUniqueIdentities: totalIdentities,
      brandGroupCount: brandGroups.length,
      approxGeminiRequests: approxRequests,
      estimatedInputTokens,
      estimatedOutputTokens,
      estimatedThinkingTokens,
      estimatedCostUsd: {
        min: Number(minCost.toFixed(4)),
        max: Number(maxCost.toFixed(4))
      },
      executionTier: 'flex',
      model: 'gemini-3.8-flash',
      thinkingLevel: 'MEDIUM',
      modelLocation: 'global',
      budgetCapDisclaimer:
        'Local estimated spend cap stops before dispatching additional requests if projected spend exceeds your limit. It is NOT a guaranteed Google/Vertex AI billing ceiling for in-flight or timed-out requests.'
    }
  }

  /**
   * Summarizes eligible failed/uncertain/cancelled requests for explicit Retry Failed Only authorization.
   */
  public getRetryFailedPreflightSummary(batchId: string): RetryFailedPreflightSummary {
    const manifest = this.loadManifest(batchId)
    const empty: RetryFailedPreflightSummary = {
      eligibleCount: 0,
      failedCount: 0,
      uncertainCount: 0,
      cancelledCount: 0,
      completedExcludedCount: 0,
      estimatedRetryInputTokens: 0,
      estimatedRetryOutputTokens: 0,
      estimatedRetryThinkingTokens: 0,
      estimatedRetryCostUsd: { min: 0, max: 0 },
      hasUncertainPreviousAttempts: false,
      uncertainBillingWarning: null,
      failedRequests: []
    }
    if (!manifest?.requests) return empty

    const allReqs = Object.values(manifest.requests)
    const eligible = allReqs.filter(
      (r) =>
        r.executionStatus === 'failed' ||
        r.executionStatus === 'outcome_unknown' ||
        r.executionStatus === 'cancelled'
    )
    const completedExcludedCount = allReqs.filter(
      (r) => r.executionStatus === 'completed' && r.validated
    ).length

    let minSum = 0
    let maxSum = 0
    let estInput = 0
    let estOutput = 0
    let estThinking = 0
    let hasUncertain = false

    const failedRequests = eligible.map((r) => {
      const est = this.estimateSingleRequestCostUsd(r.identityKeys.length)
      estInput += est.inputTokens
      estOutput += est.outputTokens
      estThinking += est.thinkingTokens
      minSum += est.minCostUsd
      maxSum += est.maxCostUsd
      if (r.executionStatus === 'outcome_unknown' || r.error?.isUncertainOutcome || r.uncertainBillingWarning) {
        hasUncertain = true
      }
      return {
        requestKey: r.requestKey,
        brandKey: r.brandKey,
        brandName: r.brandName,
        chunkIndex: r.chunkIndex,
        itemCount: r.identityKeys.length,
        executionStatus: r.executionStatus,
        errorCode: r.error?.code || null,
        errorMessage: r.error?.message || null,
        attemptCount: r.attemptCount,
        uncertainBillingWarning: r.uncertainBillingWarning || null
      }
    })

    return {
      eligibleCount: eligible.length,
      failedCount: eligible.filter((r) => r.executionStatus === 'failed').length,
      uncertainCount: eligible.filter((r) => r.executionStatus === 'outcome_unknown').length,
      cancelledCount: eligible.filter((r) => r.executionStatus === 'cancelled').length,
      completedExcludedCount,
      estimatedRetryInputTokens: estInput,
      estimatedRetryOutputTokens: estOutput,
      estimatedRetryThinkingTokens: estThinking,
      estimatedRetryCostUsd: {
        min: Number(minSum.toFixed(4)),
        max: Number(maxSum.toFixed(4))
      },
      hasUncertainPreviousAttempts: hasUncertain,
      uncertainBillingWarning: hasUncertain
        ? 'One or more failed requests timed out (e.g. 504 DEADLINE_EXCEEDED) or aborted in flight without usageMetadata. Vertex AI may still have processed or billed prior attempts; retrying issues new paid Flex requests.'
        : null,
      failedRequests
    }
  }

  /**
   * Explicitly authorized Retry Failed Only entrypoint.
   * Excludes already-completed & validated requests and preserves completed temp groups & operator decisions.
   */
  public async retryFailedOnly(params: {
    batchId: string
    offers: UnifiedBatchOffer[]
    supabase: SupabaseClient
    databaseContext?: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST'
    approvedByOperator: boolean
    approvedMaxBudgetUsd: number
    targetRequestKeys?: string[]
    flexTimeoutMs?: number
    progressCallback?: MatchingProgressListener
  }): Promise<MatchingRunManifest> {
    if (
      !params.approvedByOperator ||
      typeof params.approvedMaxBudgetUsd !== 'number' ||
      !Number.isFinite(params.approvedMaxBudgetUsd) ||
      params.approvedMaxBudgetUsd <= 0
    ) {
      throw new Error(
        'RETRY_AUTHORIZATION_REQUIRED: Retry Failed Only requires explicit operator authorization (approvedByOperator=true) and a positive approvedMaxBudgetUsd spend cap.'
      )
    }

    const existing = this.loadManifest(params.batchId)
    if (!existing) {
      throw new Error(`MANIFEST_NOT_FOUND: No matching manifest exists for batch ${params.batchId}.`)
    }

    return this.executeMatchingRun({
      batchId: params.batchId,
      offers: params.offers,
      supabase: params.supabase,
      databaseContext: params.databaseContext || existing.matchingDatabaseContext,
      progressCallback: params.progressCallback,
      mode: 'retry_failed_only',
      approvedMaxBudgetUsd: params.approvedMaxBudgetUsd,
      flexTimeoutMs: params.flexTimeoutMs,
      targetRequestKeys: params.targetRequestKeys,
      retryAuthorization: {
        approvedByOperator: true,
        approvedMaxBudgetUsd: params.approvedMaxBudgetUsd
      }
    })
  }

  private syncRequestCounters(
    totals: MatchingTotals,
    requests: Record<string, MatchingRequestRecord>
  ): void {
    const reqList = Object.values(requests)
    totals.completedRequestsCount = reqList.filter((r) => r.executionStatus === 'completed').length
    totals.failedRequestsCount = reqList.filter((r) => r.executionStatus === 'failed').length
    totals.uncertainRequestsCount = reqList.filter((r) => r.executionStatus === 'outcome_unknown').length
    totals.cancelledRequestsCount = reqList.filter((r) => r.executionStatus === 'cancelled').length
    totals.pendingRequestsCount = reqList.filter(
      (r) => r.executionStatus === 'pending' || r.executionStatus === 'in_progress'
    ).length
  }

  private recomputeProposalDecisionTotals(
    totals: MatchingTotals,
    proposals: Record<string, MatchingProposal>,
    requests: Record<string, MatchingRequestRecord>
  ): void {
    const propList = Object.values(proposals)
    totals.proposedExistingCount = propList.filter((p) => p.decision === 'existing').length
    totals.proposedTemporaryCount = propList.filter((p) => p.decision === 'temporary').length
    totals.unresolvedCount = propList.filter((p) => p.decision === 'unresolved').length
    this.syncRequestCounters(totals, requests)
  }

  private emitRichProgress(
    callback: MatchingProgressListener | undefined,
    params: {
      batchId: string
      runId: string
      phase: MatchingRunPhase
      statusText: string
      requests: Record<string, MatchingRequestRecord>
      currentBrand: string | null
      currentRequestKey: string | null
      currentChunkIndex: number | null
      totalChunksInBrand: number | null
      currentRequestElapsedMs: number
      totalElapsedMs: number
      cumulativeObservedCostUsd: number
      approvedMaxBudgetUsd: number | null
      runObservedCostUsd: number
      estimatedNextRequestCostUsd: number | null
      control: ActiveRunControl
      overridePercent?: number
    }
  ): void {
    if (!callback) return
    const reqList = Object.values(params.requests)
    const totalRequests = reqList.length
    const completedRequests = reqList.filter((r) => r.executionStatus === 'completed').length
    const failedRequests = reqList.filter((r) => r.executionStatus === 'failed').length
    const uncertainRequests = reqList.filter((r) => r.executionStatus === 'outcome_unknown').length
    const cancelledRequests = reqList.filter((r) => r.executionStatus === 'cancelled').length
    const pendingRequests = reqList.filter(
      (r) => r.executionStatus === 'pending' || r.executionStatus === 'in_progress'
    ).length

    const computedPercent =
      params.overridePercent !== undefined
        ? params.overridePercent
        : totalRequests > 0
          ? Math.min(99, Math.max(5, Math.round((completedRequests / totalRequests) * 100)))
          : 100

    const remainingEstimatedBudgetUsd =
      typeof params.approvedMaxBudgetUsd === 'number'
        ? Number(Math.max(0, params.approvedMaxBudgetUsd - params.runObservedCostUsd).toFixed(6))
        : null

    const details: MatchingProgressEvent = {
      batchId: params.batchId,
      runId: params.runId,
      statusText: params.statusText,
      percent: computedPercent,
      phase: params.phase,
      totalRequests,
      completedRequests,
      failedRequests,
      uncertainRequests,
      cancelledRequests,
      pendingRequests,
      currentBrand: params.currentBrand,
      currentRequestKey: params.currentRequestKey,
      currentChunkIndex: params.currentChunkIndex,
      totalChunksInBrand: params.totalChunksInBrand,
      currentRequestElapsedMs: params.currentRequestElapsedMs,
      totalElapsedMs: params.totalElapsedMs,
      cumulativeObservedCostUsd: Number(params.cumulativeObservedCostUsd.toFixed(6)),
      approvedMaxBudgetUsd: params.approvedMaxBudgetUsd,
      remainingEstimatedBudgetUsd,
      estimatedNextRequestCostUsd: params.estimatedNextRequestCostUsd,
      pauseRequested: params.control.pauseRequested,
      cancelRequested: params.control.cancelRequested
    }

    callback(params.statusText, computedPercent, details)
  }

  private resolveLocalZeroCostItems(params: {
    group: BrandGroup
    candidates: CompactCatalogCandidate[]
    candidateMap: Map<string, CompactCatalogCandidate>
    items: DeduplicatedIdentityItem[]
    proposals: Record<string, MatchingProposal>
    totals: MatchingTotals
    tempRegistry: TemporaryProductRegistry
    supabase: SupabaseClient
    databaseContext?: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST'
  }): Promise<DeduplicatedIdentityItem[]> {
    return (async () => {
      const itemsForGemini: DeduplicatedIdentityItem[] = []
      const { group, candidates, candidateMap, items, proposals, totals, tempRegistry, supabase, databaseContext } = params

      for (const item of items) {
        if (item.memberOffers.every((o) => Boolean(proposals[o.batchOfferKey]))) {
          continue
        }

        const sufficiency = evaluateIdentitySufficiency(
          item.normalizedAttrs,
          item.memberOffers[0],
          item.normalizedAttrs.evidenceAnnotation
        )

        if (!sufficiency.isSufficient) {
          for (const offer of item.memberOffers) {
            proposals[offer.batchOfferKey] = {
              batchOfferKey: offer.batchOfferKey,
              sourceOfferId: offer.sourceOfferId,
              sourcePage: offer.sourcePage,
              leafletId: offer.leafletId,
              supermarketName: offer.supermarketName,
              decision: 'unresolved',
              matchedProductId: null,
              matchedProduct: null,
              temporaryId: null,
              confidence: 'low',
              matchMethod: 'deterministic',
              validationIssues: sufficiency.reasons.map((msg, idx) => ({
                severity: 'warning' as const,
                code: sufficiency.codes[idx] || 'INSUFFICIENT_IDENTITY',
                message: msg
              })),
              evidenceAnnotation: item.normalizedAttrs.evidenceAnnotation || null,
              operatorDecision: 'proposed',
              updatedAt: new Date().toISOString()
            }
          }
          continue
        }

        const activeCacheService =
          databaseContext === 'DEVELOPMENT_TEST' ? this.devCacheService : this.cacheService
        const cachedMatch = activeCacheService.lookupVerifiedMatch(item.normalizedAttrs)
        if (cachedMatch) {
          totals.cacheMatchesCount += item.memberOffers.length
          const matchedCand = candidateMap.get(cachedMatch.approvedProductId) || null
          for (const offer of item.memberOffers) {
            proposals[offer.batchOfferKey] = {
              batchOfferKey: offer.batchOfferKey,
              sourceOfferId: offer.sourceOfferId,
              sourcePage: offer.sourcePage,
              leafletId: offer.leafletId,
              supermarketName: offer.supermarketName,
              decision: 'existing',
              matchedProductId: cachedMatch.approvedProductId,
              matchedProduct: matchedCand,
              ...(databaseContext ? { matchedDatabaseContext: databaseContext } : {}),
              temporaryId: null,
              confidence: 'high',
              matchMethod: 'persistent_cache',
              validationIssues: [],
              operatorDecision: 'proposed',
              updatedAt: new Date().toISOString()
            }
          }
          continue
        }

        const exactDeterministicMatch = this.findDeterministicCatalogCandidate(item.normalizedAttrs, candidates)

        if (exactDeterministicMatch) {
          totals.deterministicMatchesCount += item.memberOffers.length
          for (const offer of item.memberOffers) {
            proposals[offer.batchOfferKey] = {
              batchOfferKey: offer.batchOfferKey,
              sourceOfferId: offer.sourceOfferId,
              sourcePage: offer.sourcePage,
              leafletId: offer.leafletId,
              supermarketName: offer.supermarketName,
              decision: 'existing',
              matchedProductId: exactDeterministicMatch.id,
              matchedProduct: exactDeterministicMatch,
              ...(databaseContext ? { matchedDatabaseContext: databaseContext } : {}),
              temporaryId: null,
              confidence: 'high',
              matchMethod: 'deterministic',
              validationIssues: [],
              operatorDecision: 'proposed',
              updatedAt: new Date().toISOString()
            }
          }
          continue
        }

        if (candidates.length === 0) {
          const absence = await this.brandGroupingService.verifyAbsenceInBrandCatalog(supabase, group, item)
          if (absence.foundCandidate) {
            candidateMap.set(String(absence.foundCandidate.id), absence.foundCandidate)
            for (const offer of item.memberOffers) {
              proposals[offer.batchOfferKey] = {
                batchOfferKey: offer.batchOfferKey,
                sourceOfferId: offer.sourceOfferId,
                sourcePage: offer.sourcePage,
                leafletId: offer.leafletId,
                supermarketName: offer.supermarketName,
                decision: 'existing',
                matchedProductId: String(absence.foundCandidate.id),
                matchedProduct: absence.foundCandidate,
                ...(databaseContext ? { matchedDatabaseContext: databaseContext } : {}),
                temporaryId: null,
                confidence: 'high',
                matchMethod: 'deterministic',
                validationIssues: [],
                operatorDecision: 'proposed',
                updatedAt: new Date().toISOString()
              }
            }
          } else if (absence.isExhaustivelyAbsent) {
            const zeroCandMap = new Map<string, string>()
            for (const offer of item.memberOffers) {
              const recon = tempRegistry.reconcileTemporaryOffer({
                requestTempRef: `local_${offer.sourceOfferId}`,
                requestScopedMap: zeroCandMap,
                attrs: item.normalizedAttrs,
                sourceOffer: offer
              })
              proposals[offer.batchOfferKey] = {
                batchOfferKey: offer.batchOfferKey,
                sourceOfferId: offer.sourceOfferId,
                sourcePage: offer.sourcePage,
                leafletId: offer.leafletId,
                supermarketName: offer.supermarketName,
                decision: 'temporary',
                matchedProductId: null,
                matchedProduct: null,
                temporaryId: recon.temporaryId,
                confidence: 'medium',
                matchMethod: 'deterministic',
                validationIssues: [
                  {
                    severity: 'info',
                    code: 'COVERAGE_EXHAUSTIVELY_ABSENT',
                    message: `Zero-candidate catalog absence proven (${absence.searchDiagnostics.join(', ')}) with sufficient identity.`
                  }
                ],
                operatorDecision: 'proposed',
                updatedAt: new Date().toISOString()
              }
            }
          } else {
            for (const offer of item.memberOffers) {
              proposals[offer.batchOfferKey] = {
                batchOfferKey: offer.batchOfferKey,
                sourceOfferId: offer.sourceOfferId,
                sourcePage: offer.sourcePage,
                leafletId: offer.leafletId,
                supermarketName: offer.supermarketName,
                decision: 'unresolved',
                matchedProductId: null,
                matchedProduct: null,
                temporaryId: null,
                confidence: 'low',
                matchMethod: 'deterministic',
                validationIssues: [
                  {
                    severity: 'warning',
                    code: 'UNRESOLVED_COVERAGE_INCONCLUSIVE',
                    message: `Catalog absence could not be verified (${absence.coverage}).`
                  }
                ],
                operatorDecision: 'proposed',
                updatedAt: new Date().toISOString()
              }
            }
          }
          continue
        }

        itemsForGemini.push(item)
      }

      return itemsForGemini
    })()
  }

  /**
   * Executes the catalog matching pipeline with per-request failure isolation,
   * durable checkpoints, pause/cancel handling, spend-cap gating, and safe retry support.
   */
  public async executeMatchingRun(params: ExecuteMatchingRunParams): Promise<MatchingRunManifest> {
    const existingManifestPre = this.loadManifest(params.batchId)
    const {
      batchId,
      offers,
      supabase,
      databaseContext = existingManifestPre?.matchingDatabaseContext,
      progressCallback,
      mode = 'full',
      approvedMaxBudgetUsd = null,
      flexTimeoutMs = Number(process.env.GEMINI_MATCHING_FLEX_TIMEOUT_MS) ||
        Number(process.env.GEMINI_FLEX_TIMEOUT_MS) ||
        600_000,
      targetRequestKeys,
      retryAuthorization
    } = params

    if (this.activeRuns.has(batchId)) {
      throw new Error(`MATCHING_RUN_ALREADY_ACTIVE: A matching run is already active for batch ${batchId}.`)
    }

    if (mode === 'retry_failed_only') {
      if (
        !retryAuthorization?.approvedByOperator ||
        typeof retryAuthorization.approvedMaxBudgetUsd !== 'number' ||
        !Number.isFinite(retryAuthorization.approvedMaxBudgetUsd) ||
        retryAuthorization.approvedMaxBudgetUsd <= 0
      ) {
        throw new Error(
          'RETRY_AUTHORIZATION_REQUIRED: Retry Failed Only requires explicit operator authorization and a positive approvedMaxBudgetUsd spend cap.'
        )
      }
    }

    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const runStartedIso = new Date().toISOString()
    const startedAtMs = Date.now()

    const control: ActiveRunControl = {
      runId,
      startedAtMs,
      pauseRequested: false,
      cancelRequested: false,
      abortController: new AbortController()
    }
    this.activeRuns.set(batchId, control)

    const existingManifest = this.loadManifest(batchId)
    const proposals: Record<string, MatchingProposal> = { ...(existingManifest?.proposals || {}) }
    const tempRegistry = new TemporaryProductRegistry(batchId, existingManifest?.temporaryProducts)
    const requestRecords: Record<string, MatchingRequestRecord> = {}
    if (existingManifest?.requests) {
      for (const [key, rec] of Object.entries(existingManifest.requests)) {
        requestRecords[key] = { ...rec, attempts: [...(rec.attempts || [])] }
      }
    }
    const requestOrder: string[] = [...(existingManifest?.requestOrder || [])]
    const benchmarkMetrics: Record<number, any> = { ...(existingManifest?.benchmarkMetrics || {}) }
    const runHistory = [...(existingManifest?.runHistory || [])]
    runHistory.push({
      runId,
      mode,
      startedAt: runStartedIso,
      finishedAt: null,
      status: 'running',
      approvedMaxBudgetUsd,
      operatorAuthorizedRetry: mode === 'retry_failed_only' ? Boolean(retryAuthorization?.approvedByOperator) : undefined
    })

    const totals: MatchingTotals = {
      totalExtractedOffers: offers.length,
      uniqueIdentitiesCount: 0,
      cacheMatchesCount: existingManifest?.totals?.cacheMatchesCount || 0,
      deterministicMatchesCount: existingManifest?.totals?.deterministicMatchesCount || 0,
      geminiEvaluatedCount: existingManifest?.totals?.geminiEvaluatedCount || 0,
      proposedExistingCount: 0,
      proposedTemporaryCount: 0,
      unresolvedCount: 0,
      validationWarningsCount: existingManifest?.totals?.validationWarningsCount || 0,
      actualCostUsd: existingManifest?.totals?.actualCostUsd || 0,
      estimatedCostUsd: existingManifest?.totals?.estimatedCostUsd || 0,
      geminiRequestsCount: existingManifest?.totals?.geminiRequestsCount || 0,
      inputTokens: existingManifest?.totals?.inputTokens || 0,
      outputTokens: existingManifest?.totals?.outputTokens || 0,
      thinkingTokens: existingManifest?.totals?.thinkingTokens || 0
    }

    const brandSummaries: Record<string, BrandGroupSummary> = { ...(existingManifest?.brandSummaries || {}) }
    let runObservedCostUsd = 0
    let stopReason: string | null = null
    let manifestError: string | null = null
    let runStopState: 'completed' | 'paused' | 'cancelled' | 'stopped_budget_cap' | 'failed' = 'completed'

    const saveCurrentManifest = (status: MatchingRunStatus): MatchingRunManifest => {
      this.recomputeProposalDecisionTotals(totals, proposals, requestRecords)
      const createdAt = existingManifest?.createdAt || runStartedIso
      const currentRunHistoryEntry = runHistory[runHistory.length - 1]
      if (currentRunHistoryEntry) {
        currentRunHistoryEntry.status = status
        if (status !== 'running') {
          currentRunHistoryEntry.finishedAt = new Date().toISOString()
          currentRunHistoryEntry.stopReason = stopReason
        }
      }
      const snapshot: MatchingRunManifest = {
        schemaVersion: '1.0',
        batchId,
        runId,
        createdAt,
        updatedAt: new Date().toISOString(),
        status,
        matchingDatabaseContext: databaseContext,
        model: 'gemini-3.8-flash',
        thinkingLevel: 'MEDIUM',
        executionMode: 'flex',
        totals: { ...totals },
        proposals,
        temporaryProducts: tempRegistry.getGroups(),
        brandSummaries,
        benchmarkMetrics,
        requests: requestRecords,
        requestOrder,
        runHistory,
        approvedMaxBudgetUsd,
        totalElapsedMs: Date.now() - startedAtMs,
        stoppedReason: stopReason,
        lastRecoveryNotes: existingManifest?.lastRecoveryNotes,
        error: manifestError
      }
      this.saveManifestAtomic(snapshot)
      return snapshot
    }

    try {
      this.emitRichProgress(progressCallback, {
        batchId,
        runId,
        phase: 'Preparing candidates',
        statusText: 'Grouping offers by brand and preparing catalog candidates...',
        requests: requestRecords,
        currentBrand: null,
        currentRequestKey: null,
        currentChunkIndex: null,
        totalChunksInBrand: null,
        currentRequestElapsedMs: 0,
        totalElapsedMs: Date.now() - startedAtMs,
        cumulativeObservedCostUsd: totals.actualCostUsd,
        approvedMaxBudgetUsd,
        runObservedCostUsd,
        estimatedNextRequestCostUsd: null,
        control,
        overridePercent: 5
      })

      const brandGroups = this.brandGroupingService.groupOffersByBrand(offers)
      totals.uniqueIdentitiesCount = brandGroups.reduce((acc, g) => acc + g.uniqueIdentities.length, 0)

      const plannedQueue: PlannedRequestEntry[] = []

      for (const group of brandGroups) {
        if (control.cancelRequested) {
          runStopState = 'cancelled'
          stopReason = 'OPERATOR_CANCELLED_DURING_PREP'
          break
        }
        if (control.pauseRequested) {
          runStopState = 'paused'
          stopReason = 'OPERATOR_PAUSED_DURING_PREP'
          break
        }

        const retrievalResult = await this.brandGroupingService.retrieveBrandCandidates(
          supabase,
          group,
          50
        )
        const candidates = retrievalResult.candidates
        group.candidates = candidates
        ;(group as any).totalBrandProducts = retrievalResult.totalBrandProducts

        const candidateMap = new Map<string, CompactCatalogCandidate>()
        candidates.forEach((c) => candidateMap.set(String(c.id), c))

        const identityByKey = new Map<string, DeduplicatedIdentityItem>()
        for (const item of group.uniqueIdentities) {
          identityByKey.set(item.identityKey, item)
        }

        // Check existing persisted request records for this brand so completed chunks never shift or repeat
        const existingBrandRequests = requestOrder
          .map((k) => requestRecords[k])
          .filter((r): r is MatchingRequestRecord => Boolean(r && r.brandKey === group.brandKey))

        const coveredIdentityKeys = new Set<string>()
        for (const reqRec of existingBrandRequests) {
          reqRec.identityKeys.forEach((ik) => coveredIdentityKeys.add(ik))
          const isCompletedAndValid = reqRec.executionStatus === 'completed' && reqRec.validated

          const isRetryCandidate =
            reqRec.executionStatus === 'failed' ||
            reqRec.executionStatus === 'outcome_unknown' ||
            reqRec.executionStatus === 'cancelled'
          const matchesTargetFilter =
            !targetRequestKeys || targetRequestKeys.includes(reqRec.requestKey)

          const shouldQueue =
            mode === 'retry_failed_only'
              ? !isCompletedAndValid && isRetryCandidate && matchesTargetFilter
              : !isCompletedAndValid && reqRec.executionStatus === 'pending'

          if (shouldQueue) {
            const chunkItems = reqRec.identityKeys
              .map((ik) => identityByKey.get(ik))
              .filter((x): x is DeduplicatedIdentityItem => Boolean(x))
            if (chunkItems.length > 0) {
              plannedQueue.push({
                requestKey: reqRec.requestKey,
                brandKey: group.brandKey,
                brandName: group.brandNameEn || group.brandKey,
                group,
                candidates,
                candidateMap,
                totalBrandProducts: retrievalResult.totalBrandProducts,
                retrievalCompleteness: retrievalResult.retrievalCompleteness,
                fallbackActions: retrievalResult.fallbackActions,
                chunkItems,
                chunkSize: reqRec.chunkSize,
                chunkIndex: reqRec.chunkIndex,
                totalChunksInBrand: reqRec.totalChunksInBrand
              })
            }
          }
        }

        // Resolve any items not yet covered by existing request records
        const remainingUncoveredItems = group.uniqueIdentities.filter(
          (item) => !coveredIdentityKeys.has(item.identityKey)
        )

        const newItemsForGemini = await this.resolveLocalZeroCostItems({
          group,
          candidates,
          candidateMap,
          items: remainingUncoveredItems,
          proposals,
          totals,
          tempRegistry,
          supabase,
          databaseContext
        })

        if (newItemsForGemini.length > 0) {
          const chunkSize = this.determineChunkSize(candidates.length)
          const startChunkIndex = existingBrandRequests.length
          const newChunkCount = Math.ceil(newItemsForGemini.length / chunkSize)
          const totalChunksInBrand = startChunkIndex + newChunkCount

          for (const existingReq of existingBrandRequests) {
            existingReq.totalChunksInBrand = totalChunksInBrand
          }

          for (let i = 0; i < newItemsForGemini.length; i += chunkSize) {
            const chunkItems = newItemsForGemini.slice(i, i + chunkSize)
            const chunkIndex = startChunkIndex + Math.floor(i / chunkSize) + 1
            const identityKeys = chunkItems.map((it) => it.identityKey)
            const sourceOfferKeys = chunkItems.flatMap((it) => it.memberOffers.map((o) => o.batchOfferKey))
            const sourceIds = chunkItems.map((_, idx) => String(idx + 1))
            const requestKey = this.buildDeterministicRequestKey(
              batchId,
              group.brandKey,
              chunkIndex,
              identityKeys
            )
            const estCost = this.estimateSingleRequestCostUsd(chunkItems.length, candidates.length)

            const newRecord: MatchingRequestRecord = {
              requestKey,
              batchId,
              runId,
              brandKey: group.brandKey,
              brandName: group.brandNameEn || group.brandKey,
              chunkIndex,
              totalChunksInBrand,
              chunkSize,
              identityKeys,
              sourceOfferKeys,
              sourceIds,
              requestConfig: {
                model: 'gemini-3.8-flash',
                thinkingLevel: 'MEDIUM',
                executionTier: 'flex',
                location: 'global',
                timeoutMs: flexTimeoutMs
              },
              executionStatus: 'pending',
              attemptCount: 0,
              attempts: [],
              startedAt: null,
              finishedAt: null,
              error: null,
              usageMetadata: null,
              estimatedCostUsd: estCost.maxCostUsd,
              responseArtifactRef: null,
              validated: false
            }

            requestRecords[requestKey] = newRecord
            if (!requestOrder.includes(requestKey)) {
              requestOrder.push(requestKey)
            }

            if (mode !== 'retry_failed_only') {
              plannedQueue.push({
                requestKey,
                brandKey: group.brandKey,
                brandName: group.brandNameEn || group.brandKey,
                group,
                candidates,
                candidateMap,
                totalBrandProducts: retrievalResult.totalBrandProducts,
                retrievalCompleteness: retrievalResult.retrievalCompleteness,
                fallbackActions: retrievalResult.fallbackActions,
                chunkItems,
                chunkSize,
                chunkIndex,
                totalChunksInBrand
              })
            }
          }
        }

        // Initialize/refresh brand summary cleanly
        const offersForBrand = offers.filter((o) => {
          const attrs = this.brandGroupingService.extractNormalizedAttributes(o)
          return attrs.brandKey === group.brandKey
        })
        brandSummaries[group.brandKey] = {
          brandKey: group.brandKey,
          brandNameAr: group.brandNameAr,
          brandNameEn: group.brandNameEn,
          brandStatus: group.brandStatus,
          totalOffers: offersForBrand.length,
          uniqueIdentitiesCount: group.uniqueIdentities.length,
          candidateCount: candidates.length,
          totalCatalogProductsInBrand: retrievalResult.totalBrandProducts,
          retrievalCompleteness: retrievalResult.retrievalCompleteness,
          fallbackActions: retrievalResult.fallbackActions,
          matchedExistingCount: offersForBrand.filter((o) => proposals[o.batchOfferKey]?.decision === 'existing').length,
          temporaryGroupCount: Object.values(tempRegistry.getGroups()).filter((g) => g.brandKey === group.brandKey).length,
          unresolvedCount: offersForBrand.filter((o) => proposals[o.batchOfferKey]?.decision === 'unresolved').length
        }
      }

      totals.estimatedCostUsd = Number(
        Object.values(requestRecords)
          .reduce((acc, r) => acc + (r.estimatedCostUsd || 0), 0)
          .toFixed(6)
      )

      // Persist planned checkpoint before any Gemini dispatch
      if (runStopState === 'completed' && plannedQueue.length > 0) {
        saveCurrentManifest('running')
      }

      // Sequential single-concurrency dispatch loop (concurrency = 1)
      for (const entry of plannedQueue) {
        if (control.cancelRequested || control.abortController.signal.aborted) {
          runStopState = 'cancelled'
          stopReason = stopReason || 'OPERATOR_CANCELLED'
          break
        }
        if (control.pauseRequested) {
          runStopState = 'paused'
          stopReason = 'OPERATOR_PAUSED_AFTER_REQUEST'
          break
        }

        const reqRecord = requestRecords[entry.requestKey]
        const nextEst = this.estimateSingleRequestCostUsd(entry.chunkItems.length, entry.candidates.length)

        // Pre-request conservative estimated spend-cap check (refuses dispatch if cap would be exceeded)
        if (typeof approvedMaxBudgetUsd === 'number') {
          if (runObservedCostUsd + nextEst.maxCostUsd > approvedMaxBudgetUsd) {
            runStopState = 'stopped_budget_cap'
            stopReason = `ESTIMATED_SPEND_CAP_REACHED: Remaining approved budget ($${Math.max(0, approvedMaxBudgetUsd - runObservedCostUsd).toFixed(4)}) is below conservative next-request estimate ($${nextEst.maxCostUsd.toFixed(4)}).`
            this.emitRichProgress(progressCallback, {
              batchId,
              runId,
              phase: 'Saving checkpoint',
              statusText: stopReason,
              requests: requestRecords,
              currentBrand: entry.brandName,
              currentRequestKey: entry.requestKey,
              currentChunkIndex: entry.chunkIndex,
              totalChunksInBrand: entry.totalChunksInBrand,
              currentRequestElapsedMs: 0,
              totalElapsedMs: Date.now() - startedAtMs,
              cumulativeObservedCostUsd: totals.actualCostUsd,
              approvedMaxBudgetUsd,
              runObservedCostUsd,
              estimatedNextRequestCostUsd: nextEst.maxCostUsd,
              control
            })
            break
          }
        }

        // Durable pre-dispatch checkpoint: mark request in_progress BEFORE wire call
        const reqStartedAtIso = new Date().toISOString()
        const reqStartedMs = Date.now()
        reqRecord.executionStatus = 'in_progress'
        reqRecord.validated = false
        reqRecord.runId = runId
        reqRecord.startedAt = reqStartedAtIso
        reqRecord.finishedAt = null
        reqRecord.attemptCount = (reqRecord.attemptCount || 0) + 1
        reqRecord.error = null
        saveCurrentManifest('running')

        this.emitRichProgress(progressCallback, {
          batchId,
          runId,
          phase: 'Waiting for Gemini / Flex processing',
          statusText: `Waiting for Gemini / Flex processing (${entry.brandName}, request ${entry.chunkIndex}/${entry.totalChunksInBrand})...`,
          requests: requestRecords,
          currentBrand: entry.brandName,
          currentRequestKey: entry.requestKey,
          currentChunkIndex: entry.chunkIndex,
          totalChunksInBrand: entry.totalChunksInBrand,
          currentRequestElapsedMs: 0,
          totalElapsedMs: Date.now() - startedAtMs,
          cumulativeObservedCostUsd: totals.actualCostUsd,
          approvedMaxBudgetUsd,
          runObservedCostUsd,
          estimatedNextRequestCostUsd: nextEst.maxCostUsd,
          control
        })

        try {
          const evalResult = await this.geminiMatchingService.evaluateBatch({
            brandKey: entry.brandKey,
            brandName: entry.brandName,
            candidates: entry.candidates,
            items: entry.chunkItems,
            flexTimeoutMs,
            abortSignal: control.abortController.signal
          })

          this.emitRichProgress(progressCallback, {
            batchId,
            runId,
            phase: 'Validating response',
            statusText: `Validating response for ${entry.brandName} (chunk ${entry.chunkIndex}/${entry.totalChunksInBrand})...`,
            requests: requestRecords,
            currentBrand: entry.brandName,
            currentRequestKey: entry.requestKey,
            currentChunkIndex: entry.chunkIndex,
            totalChunksInBrand: entry.totalChunksInBrand,
            currentRequestElapsedMs: Date.now() - reqStartedMs,
            totalElapsedMs: Date.now() - startedAtMs,
            cumulativeObservedCostUsd: totals.actualCostUsd,
            approvedMaxBudgetUsd,
            runObservedCostUsd,
            estimatedNextRequestCostUsd: nextEst.maxCostUsd,
            control
          })

          // Accumulate observed provider usage
          totals.geminiRequestsCount++
          totals.inputTokens += evalResult.usage.inputTokens
          totals.outputTokens += evalResult.usage.outputTokens
          totals.thinkingTokens += evalResult.usage.thinkingTokens
          totals.actualCostUsd = Number((totals.actualCostUsd + evalResult.usage.actualCostUsd).toFixed(8))
          runObservedCostUsd = Number((runObservedCostUsd + evalResult.usage.actualCostUsd).toFixed(8))
          totals.geminiEvaluatedCount += entry.chunkItems.reduce((acc, c) => acc + c.memberOffers.length, 0)

          if (!benchmarkMetrics[entry.chunkSize]) {
            benchmarkMetrics[entry.chunkSize] = {
              chunkSize: entry.chunkSize,
              requestCount: 0,
              itemCount: 0,
              inputTokens: 0,
              outputTokens: 0,
              thinkingTokens: 0,
              actualCostUsd: 0,
              costPerIdentityUsd: 0,
              avgThinkingTokensPerItem: 0
            }
          }
          const bm = benchmarkMetrics[entry.chunkSize]
          bm.requestCount++
          bm.itemCount += entry.chunkItems.length
          bm.inputTokens += evalResult.usage.inputTokens
          bm.outputTokens += evalResult.usage.outputTokens
          bm.thinkingTokens += evalResult.usage.thinkingTokens
          bm.actualCostUsd += evalResult.usage.actualCostUsd
          bm.costPerIdentityUsd = bm.itemCount > 0 ? Number((bm.actualCostUsd / bm.itemCount).toFixed(6)) : 0
          bm.avgThinkingTokensPerItem = bm.itemCount > 0 ? Math.round(bm.thinkingTokens / bm.itemCount) : 0

          // Per-request temporary reference scope guarantees "t1" in Req A never leaks to "t1" in Req B
          const requestScopedTempMap: Map<string, string> = new Map()

          for (const matchResult of evalResult.matches) {
            const { item, matchedProductId, temporaryRef, validationIssues, rawModelSourceId } = matchResult
            const itemSufficiency = evaluateIdentitySufficiency(
              item.normalizedAttrs,
              item.memberOffers[0],
              item.normalizedAttrs.evidenceAnnotation
            )

            for (const offer of item.memberOffers) {
              if (matchedProductId && itemSufficiency.isSufficient) {
                const matchedCand = entry.candidateMap.get(matchedProductId) || null
                proposals[offer.batchOfferKey] = {
                  batchOfferKey: offer.batchOfferKey,
                  sourceOfferId: offer.sourceOfferId,
                  sourcePage: offer.sourcePage,
                  leafletId: offer.leafletId,
                  supermarketName: offer.supermarketName,
                  decision: 'existing',
                  matchedProductId,
                  matchedProduct: matchedCand,
                  ...(databaseContext ? { matchedDatabaseContext: databaseContext } : {}),
                  temporaryId: null,
                  confidence: validationIssues.length === 0 ? 'high' : 'medium',
                  matchMethod: 'gemini_medium',
                  rawModelSourceId: rawModelSourceId || null,
                  evidenceAnnotation: item.normalizedAttrs.evidenceAnnotation || null,
                  validationIssues: validationIssues.map((msg) => ({
                    severity: 'warning',
                    code: 'VALIDATION_WARNING',
                    message: msg
                  })),
                  operatorDecision: 'proposed',
                  updatedAt: new Date().toISOString()
                }
              } else if (temporaryRef && itemSufficiency.isSufficient) {
                const absence = await this.brandGroupingService.verifyAbsenceInBrandCatalog(
                  supabase,
                  entry.group,
                  item
                )

                if (absence.foundCandidate) {
                  entry.candidateMap.set(String(absence.foundCandidate.id), absence.foundCandidate)
                  proposals[offer.batchOfferKey] = {
                    batchOfferKey: offer.batchOfferKey,
                    sourceOfferId: offer.sourceOfferId,
                    sourcePage: offer.sourcePage,
                    leafletId: offer.leafletId,
                    supermarketName: offer.supermarketName,
                    decision: 'existing',
                    matchedProductId: String(absence.foundCandidate.id),
                    matchedProduct: absence.foundCandidate,
                    ...(databaseContext ? { matchedDatabaseContext: databaseContext } : {}),
                    temporaryId: null,
                    confidence: 'high',
                    matchMethod: 'deterministic',
                    validationIssues: [
                      {
                        severity: 'info',
                        code: 'RECOVERED_BY_TARGETED_SEARCH',
                        message: `Product recovered and matched outside initial shortlist via targeted secondary query (${absence.searchDiagnostics.join(', ')}).`
                      }
                    ],
                    operatorDecision: 'proposed',
                    updatedAt: new Date().toISOString()
                  }
                } else if (absence.isExhaustivelyAbsent) {
                  const reconResult = tempRegistry.reconcileTemporaryOffer({
                    requestTempRef: temporaryRef,
                    requestScopedMap: requestScopedTempMap,
                    attrs: item.normalizedAttrs,
                    sourceOffer: offer
                  })

                  proposals[offer.batchOfferKey] = {
                    batchOfferKey: offer.batchOfferKey,
                    sourceOfferId: offer.sourceOfferId,
                    sourcePage: offer.sourcePage,
                    leafletId: offer.leafletId,
                    supermarketName: offer.supermarketName,
                    decision: 'temporary',
                    matchedProductId: null,
                    matchedProduct: null,
                    temporaryId: reconResult.temporaryId,
                    confidence: 'medium',
                    matchMethod: 'gemini_medium',
                    validationIssues: [
                      ...validationIssues.map((msg) => ({
                        severity: 'info' as const,
                        code: 'TEMPORARY_GROUP',
                        message: msg
                      })),
                      {
                        severity: 'info' as const,
                        code: 'COVERAGE_EXHAUSTIVELY_ABSENT',
                        message: `Verified complete brand catalog coverage: ${absence.searchDiagnostics.join(', ')}`
                      }
                    ],
                    operatorDecision: 'proposed',
                    updatedAt: new Date().toISOString()
                  }
                } else {
                  proposals[offer.batchOfferKey] = {
                    batchOfferKey: offer.batchOfferKey,
                    sourceOfferId: offer.sourceOfferId,
                    sourcePage: offer.sourcePage,
                    leafletId: offer.leafletId,
                    supermarketName: offer.supermarketName,
                    decision: 'unresolved',
                    matchedProductId: null,
                    matchedProduct: null,
                    temporaryId: null,
                    confidence: 'low',
                    matchMethod: 'gemini_medium',
                    validationIssues: [
                      {
                        severity: 'warning',
                        code: 'UNRESOLVED_COVERAGE_INCONCLUSIVE',
                        message: `Existing-product identity cannot be safely ruled out (${absence.coverage} coverage: ${absence.searchDiagnostics.join(', ')}). Requires operator review.`
                      }
                    ],
                    operatorDecision: 'proposed',
                    updatedAt: new Date().toISOString()
                  }
                }
              } else {
                proposals[offer.batchOfferKey] = {
                  batchOfferKey: offer.batchOfferKey,
                  sourceOfferId: offer.sourceOfferId,
                  sourcePage: offer.sourcePage,
                  leafletId: offer.leafletId,
                  supermarketName: offer.supermarketName,
                  decision: 'unresolved',
                  matchedProductId: null,
                  matchedProduct: null,
                  temporaryId: null,
                  confidence: 'low',
                  matchMethod: 'gemini_medium',
                  validationIssues: validationIssues.map((msg) => ({
                    severity: 'warning',
                    code: 'UNRESOLVED',
                    message: msg
                  })),
                  rawModelSourceId: rawModelSourceId || null,
                  evidenceAnnotation: item.normalizedAttrs.evidenceAnnotation || null,
                  operatorDecision: 'proposed',
                  updatedAt: new Date().toISOString()
                }
              }
            }
            totals.geminiEvaluatedCount += item.memberOffers.length
          }

          // Save durable response artifact before committing completed request checkpoint
          const artifactRef = this.saveRequestArtifactAtomic(batchId, entry.requestKey, {
            requestKey: entry.requestKey,
            runId,
            attemptNumber: reqRecord.attemptCount,
            brandKey: entry.brandKey,
            chunkIndex: entry.chunkIndex,
            savedAt: new Date().toISOString(),
            usage: evalResult.usage,
            latencyMs: evalResult.latencyMs ?? Date.now() - reqStartedMs,
            sourcePromptMapping: evalResult.sourcePromptMapping,
            requestDiagnostics: evalResult.requestDiagnostics,
            unrecognizedEntries: evalResult.unrecognizedEntries,
            rawParsedResponse: evalResult.rawParsedResponse
          })

          const finishedIso = new Date().toISOString()
          const usageSnapshot = {
            inputTokens: evalResult.usage.inputTokens,
            outputTokens: evalResult.usage.outputTokens,
            thinkingTokens: evalResult.usage.thinkingTokens,
            cachedTokens: evalResult.usage.cachedTokens || 0,
            totalTokens:
              evalResult.usage.totalTokens ||
              evalResult.usage.inputTokens + evalResult.usage.outputTokens + evalResult.usage.thinkingTokens,
            metadataMissing: Boolean(evalResult.usage.metadataMissing)
          }

          reqRecord.executionStatus = 'completed'
          reqRecord.validated = true
          reqRecord.finishedAt = finishedIso
          reqRecord.error = null
          reqRecord.uncertainBillingWarning = null
          reqRecord.usageMetadata = usageSnapshot
          reqRecord.estimatedCostUsd = evalResult.usage.actualCostUsd
          reqRecord.responseArtifactRef = artifactRef
          reqRecord.validationDiagnostics = evalResult.requestDiagnostics
          reqRecord.attempts.push({
            attemptNumber: reqRecord.attemptCount,
            runId,
            startedAt: reqStartedAtIso,
            finishedAt: finishedIso,
            executionStatus: 'completed',
            errorCode: null,
            errorMessage: null,
            httpStatus: 200,
            isUncertainOutcome: false,
            latencyMs: evalResult.latencyMs ?? Date.now() - reqStartedMs,
            usageMetadata: usageSnapshot,
            observedCostUsd: evalResult.usage.actualCostUsd,
            uncertainBillingWarning: null
          })

          try {
            const firstMember = entry.chunkItems[0]?.memberOffers[0]
            const ledgerSvc = new GeminiCostLedgerService(this.customBatchesBaseDir)
            const hasTokens =
              !evalResult.usage.metadataMissing &&
              (evalResult.usage.inputTokens > 0 ||
                evalResult.usage.outputTokens > 0 ||
                evalResult.usage.thinkingTokens > 0 ||
                typeof evalResult.usage.totalTokens === 'number')
            ledgerSvc.recordEntry(
              buildLedgerEntryFromProviderCall({
                requestId: `${batchId}:match:${entry.requestKey}:a${reqRecord.attemptCount}:${runId}`,
                batchId,
                runId,
                leafletId: firstMember?.leafletId || 'batch',
                pageNumber: firstMember?.sourcePage ?? null,
                sourceOfferId: firstMember?.sourceOfferId ?? null,
                sourceAnchor: `matching:${entry.brandKey}:${entry.requestKey}`,
                stageCategory: 'catalog_matching',
                requestPurpose: 'catalog_matching_chunk',
                modelId: evalResult.usage.modelId || 'gemini-3.8-flash',
                apiProvider: process.env.WIFRAN_OFFLINE_UAT === '1' ? 'mock' : 'vertex_ai',
                requestedTier: evalResult.usage.executionTier || 'flex',
                startedAt: reqStartedAtIso,
                completedAt: finishedIso,
                durationMs: evalResult.latencyMs ?? Date.now() - reqStartedMs,
                outcome: 'success',
                finishReason: evalResult.usage.finishReason ?? 'STOP',
                cacheHit: false,
                usageReported: hasTokens,
                usage: hasTokens
                  ? {
                      promptTokenCount: evalResult.usage.inputTokens,
                      candidatesTokenCount: evalResult.usage.outputTokens,
                      thoughtsTokenCount: evalResult.usage.thinkingTokens,
                      cachedContentTokenCount: evalResult.usage.cachedTokens || 0,
                      totalTokenCount: evalResult.usage.totalTokens
                    }
                  : undefined,
                rawUsageMetadata: evalResult.usage.rawUsageMetadata ?? null,
                retryOfRequestId:
                  reqRecord.attemptCount > 1
                    ? `${batchId}:match:${entry.requestKey}:a${reqRecord.attemptCount - 1}`
                    : null
              })
            )
          } catch {
            // Non-fatal ledger persistence safeguard
          }

          // Refresh brand summary & save checkpoint cleanly before advancing to next request
          const offersForBrand = offers.filter((o) => {
            const attrs = this.brandGroupingService.extractNormalizedAttributes(o)
            return attrs.brandKey === entry.brandKey
          })
          brandSummaries[entry.brandKey] = {
            ...brandSummaries[entry.brandKey],
            matchedExistingCount: offersForBrand.filter((o) => proposals[o.batchOfferKey]?.decision === 'existing').length,
            temporaryGroupCount: Object.values(tempRegistry.getGroups()).filter((g) => g.brandKey === entry.brandKey).length,
            unresolvedCount: offersForBrand.filter((o) => proposals[o.batchOfferKey]?.decision === 'unresolved').length
          }

          this.emitRichProgress(progressCallback, {
            batchId,
            runId,
            phase: 'Saving checkpoint',
            statusText: `Saved checkpoint for ${entry.brandName} (${entry.chunkIndex}/${entry.totalChunksInBrand}).`,
            requests: requestRecords,
            currentBrand: entry.brandName,
            currentRequestKey: entry.requestKey,
            currentChunkIndex: entry.chunkIndex,
            totalChunksInBrand: entry.totalChunksInBrand,
            currentRequestElapsedMs: Date.now() - reqStartedMs,
            totalElapsedMs: Date.now() - startedAtMs,
            cumulativeObservedCostUsd: totals.actualCostUsd,
            approvedMaxBudgetUsd,
            runObservedCostUsd,
            estimatedNextRequestCostUsd: null,
            control
          })

          saveCurrentManifest('running')

          // If pause was requested while this request was executing, finish safely before the next request
          if (control.pauseRequested) {
            runStopState = 'paused'
            stopReason = 'OPERATOR_PAUSED_AFTER_REQUEST'
            break
          }
        } catch (err: unknown) {
          const classified = classifyMatchingError(err)
          const errUsage = (err as any)?.usage
          const errHasTokens = Boolean(
            errUsage &&
              !errUsage.metadataMissing &&
              (errUsage.inputTokens > 0 ||
                errUsage.outputTokens > 0 ||
                errUsage.thinkingTokens > 0 ||
                typeof errUsage.totalTokens === 'number')
          )
          const errCostUsd = errHasTokens && typeof errUsage?.actualCostUsd === 'number' ? errUsage.actualCostUsd : 0
          const finishedIso = new Date().toISOString()
          const latencyMs = (err as any)?.latencyMs ?? Date.now() - reqStartedMs
          const attemptStatus: Exclude<RequestExecutionStatus, 'pending' | 'in_progress'> =
            classified.isCancelled && !classified.isUncertainOutcome
              ? 'cancelled'
              : classified.isUncertainOutcome
                ? 'outcome_unknown'
                : 'failed'

          const billingWarning = classified.isUncertainOutcome
            ? `Request interrupted with ${classified.code} without response usageMetadata. Vertex AI may still have processed or billed this request.`
            : null

          const errUsageSnapshot = errHasTokens
            ? {
                inputTokens: errUsage.inputTokens || 0,
                outputTokens: errUsage.outputTokens || 0,
                thinkingTokens: errUsage.thinkingTokens || 0,
                cachedTokens: errUsage.cachedTokens || 0,
                totalTokens:
                  errUsage.totalTokens ??
                  (errUsage.inputTokens || 0) + (errUsage.outputTokens || 0) + (errUsage.thinkingTokens || 0),
                metadataMissing: false
              }
            : null

          if (errHasTokens) {
            totals.geminiRequestsCount++
            totals.inputTokens += errUsageSnapshot!.inputTokens
            totals.outputTokens += errUsageSnapshot!.outputTokens
            totals.thinkingTokens += errUsageSnapshot!.thinkingTokens
            totals.actualCostUsd = Number((totals.actualCostUsd + errCostUsd).toFixed(8))
            runObservedCostUsd = Number((runObservedCostUsd + errCostUsd).toFixed(8))
          }

          const attemptEntry: MatchingRequestAttempt = {
            attemptNumber: reqRecord.attemptCount,
            runId,
            startedAt: reqStartedAtIso,
            finishedAt: finishedIso,
            executionStatus: attemptStatus,
            errorCode: classified.code,
            errorMessage: classified.message,
            httpStatus: classified.httpStatus,
            isUncertainOutcome: classified.isUncertainOutcome,
            latencyMs,
            usageMetadata: errUsageSnapshot,
            observedCostUsd: errCostUsd,
            uncertainBillingWarning: billingWarning
          }

          // IMPORTANT: Never create fake semantic 'unresolved' proposals on failure! Leave proposals untouched.
          reqRecord.executionStatus = attemptStatus
          reqRecord.validated = false
          reqRecord.finishedAt = finishedIso
          reqRecord.uncertainBillingWarning = billingWarning
          if (errUsageSnapshot) {
            reqRecord.usageMetadata = errUsageSnapshot
            reqRecord.estimatedCostUsd = errCostUsd
          }
          reqRecord.error = {
            code: classified.code,
            message: classified.message,
            isSystemic: classified.isSystemic,
            isUncertainOutcome: classified.isUncertainOutcome,
            httpStatus: classified.httpStatus
          }
          reqRecord.attempts.push(attemptEntry)

          try {
            const firstMember = entry.chunkItems[0]?.memberOffers[0]
            const ledgerSvc = new GeminiCostLedgerService(this.customBatchesBaseDir)
            ledgerSvc.recordEntry(
              buildLedgerEntryFromProviderCall({
                requestId: `${batchId}:match:${entry.requestKey}:a${reqRecord.attemptCount}:${runId}`,
                batchId,
                runId,
                leafletId: firstMember?.leafletId || 'batch',
                pageNumber: firstMember?.sourcePage ?? null,
                sourceOfferId: firstMember?.sourceOfferId ?? null,
                sourceAnchor: `matching:${entry.brandKey}:${entry.requestKey}`,
                stageCategory: 'catalog_matching',
                requestPurpose: 'catalog_matching_chunk',
                modelId: errUsage?.modelId || 'gemini-3.8-flash',
                apiProvider: process.env.WIFRAN_OFFLINE_UAT === '1' ? 'mock' : 'vertex_ai',
                requestedTier: errUsage?.executionTier || 'flex',
                startedAt: reqStartedAtIso,
                completedAt: finishedIso,
                durationMs: latencyMs,
                outcome:
                  attemptStatus === 'outcome_unknown'
                    ? 'outcome_unknown'
                    : attemptStatus === 'cancelled'
                      ? 'cancelled'
                      : 'failed',
                finishReason: errUsage?.finishReason ?? null,
                cacheHit: false,
                usageReported: errHasTokens,
                usage: errHasTokens
                  ? {
                      promptTokenCount: errUsageSnapshot!.inputTokens,
                      candidatesTokenCount: errUsageSnapshot!.outputTokens,
                      thoughtsTokenCount: errUsageSnapshot!.thinkingTokens,
                      cachedContentTokenCount: errUsageSnapshot!.cachedTokens,
                      totalTokenCount: errUsageSnapshot!.totalTokens
                    }
                  : undefined,
                rawUsageMetadata: errUsage?.rawUsageMetadata ?? null,
                retryOfRequestId:
                  reqRecord.attemptCount > 1
                    ? `${batchId}:match:${entry.requestKey}:a${reqRecord.attemptCount - 1}`
                    : null,
                errorMessage: classified.message
              })
            )
          } catch {
            // Non-fatal ledger persistence safeguard
          }

          saveCurrentManifest('running')

          if (classified.isCancelled) {
            runStopState = 'cancelled'
            stopReason = classified.code
            break
          }
          if (classified.isSystemic) {
            runStopState = 'failed'
            stopReason = classified.code
            manifestError = classified.message
            break
          }
          // Isolated transient/504 failure: isolate to this request ONLY and continue remaining requests
        }
      }

      // Finalize manifest status accurately without masking failures
      const allReqs = Object.values(requestRecords)
      const hasAnyFailedOrUncertain = allReqs.some(
        (r) => r.executionStatus === 'failed' || r.executionStatus === 'outcome_unknown'
      )
      const hasAnyCompleted = allReqs.some((r) => r.executionStatus === 'completed')

      let finalStatus: MatchingRunStatus
      let finalPhase: MatchingRunPhase
      if (runStopState === 'paused') {
        finalStatus = 'paused'
        finalPhase = 'Paused'
      } else if (runStopState === 'cancelled') {
        finalStatus = 'cancelled'
        finalPhase = 'Cancelled'
      } else if (runStopState === 'stopped_budget_cap') {
        finalStatus = 'stopped_budget_cap'
        finalPhase = 'Paused'
      } else if (runStopState === 'failed') {
        finalStatus = 'failed'
        finalPhase = 'Failed'
      } else if (hasAnyFailedOrUncertain) {
        finalStatus = hasAnyCompleted ? 'completed_with_failures' : 'failed'
        finalPhase = 'Failed'
      } else {
        finalStatus = 'completed'
        finalPhase = 'Completed'
      }

      const finalManifest = saveCurrentManifest(finalStatus)

      this.emitRichProgress(progressCallback, {
        batchId,
        runId,
        phase: finalPhase,
        statusText:
          finalStatus === 'completed'
            ? 'Catalog matching complete.'
            : `Catalog matching ${finalStatus}${stopReason ? ` (${stopReason})` : ''}.`,
        requests: requestRecords,
        currentBrand: null,
        currentRequestKey: null,
        currentChunkIndex: null,
        totalChunksInBrand: null,
        currentRequestElapsedMs: 0,
        totalElapsedMs: Date.now() - startedAtMs,
        cumulativeObservedCostUsd: finalManifest.totals.actualCostUsd,
        approvedMaxBudgetUsd,
        runObservedCostUsd,
        estimatedNextRequestCostUsd: null,
        control,
        overridePercent: 100
      })

      return finalManifest
    } catch (unexpectedErr: unknown) {
      const classified = classifyMatchingError(unexpectedErr)
      manifestError = classified.message
      stopReason = classified.code
      const errStatus: MatchingRunStatus = classified.isCancelled ? 'cancelled' : 'failed'
      const saved = saveCurrentManifest(errStatus)
      this.emitRichProgress(progressCallback, {
        batchId,
        runId,
        phase: classified.isCancelled ? 'Cancelled' : 'Failed',
        statusText: `Matching ${errStatus}: ${classified.message}`,
        requests: requestRecords,
        currentBrand: null,
        currentRequestKey: null,
        currentChunkIndex: null,
        totalChunksInBrand: null,
        currentRequestElapsedMs: 0,
        totalElapsedMs: Date.now() - startedAtMs,
        cumulativeObservedCostUsd: saved.totals.actualCostUsd,
        approvedMaxBudgetUsd,
        runObservedCostUsd,
        estimatedNextRequestCostUsd: null,
        control,
        overridePercent: 100
      })
      throw unexpectedErr
    } finally {
      this.activeRuns.delete(batchId)
    }
  }

  /**
   * Applies an operator review decision locally without re-running Gemini.
   */
  public applyOperatorDecision(params: {
    batchId: string
    batchOfferKey?: string
    temporaryId?: string
    decision: OperatorDecisionStatus
    linkedPermanentProductId?: string
    operatorNotes?: string
    targetType?: 'catalog' | 'non_catalog'
    nonCatalogCategory?: NonCatalogEligibilityCategory | null
  }): MatchingRunManifest {
    const manifest = this.loadManifest(params.batchId)
    if (!manifest) {
      throw new Error(`Manifest not found for batch ${params.batchId}`)
    }

    if (params.targetType === 'non_catalog' && params.batchOfferKey) {
      // Explicit non-catalog operator approval stays strictly separated from catalog product identity approval
      manifest.nonCatalogApprovals = manifest.nonCatalogApprovals || {}
      manifest.nonCatalogApprovals[params.batchOfferKey] = {
        batchOfferKey: params.batchOfferKey,
        decision: params.decision === 'approved' ? 'approved' : 'rejected',
        category: params.nonCatalogCategory ?? null,
        operatorNotes: params.operatorNotes,
        updatedAt: new Date().toISOString()
      }
    } else if (params.batchOfferKey && manifest.proposals[params.batchOfferKey]) {
      const proposal = manifest.proposals[params.batchOfferKey]
      proposal.operatorDecision = params.decision
      if (params.operatorNotes) proposal.operatorNotes = params.operatorNotes
      if (params.linkedPermanentProductId) {
        proposal.matchedProductId = params.linkedPermanentProductId
        proposal.decision = 'existing'
      } else if (params.decision === 'rejected') {
        proposal.decision = 'unresolved'
      }
      proposal.updatedAt = new Date().toISOString()
    }

    if (params.targetType !== 'non_catalog' && params.temporaryId && manifest.temporaryProducts[params.temporaryId]) {
      const tempGroup = manifest.temporaryProducts[params.temporaryId]
      tempGroup.operatorDecision = params.decision
      if (params.linkedPermanentProductId) {
        tempGroup.linkedPermanentProductId = params.linkedPermanentProductId
      }
      tempGroup.updatedAt = new Date().toISOString()
    }

    manifest.updatedAt = new Date().toISOString()
    this.saveManifestAtomic(manifest)
    return manifest
  }

  /**
   * Explicitly records or revokes operator approval for using a product-only crop or existing
   * catalog image for public consumer display (`public.product_images`).
   * Rejects private evidence crops (`offer_card_crop.webp`) and unverified/assortment scopes.
   */
  public applyConsumerProductImageDecision(params: {
    batchId: string
    batchOfferKey: string
    decision: 'approve_generated_crop' | 'reuse_existing_catalog_image' | 'reject'
    productThumbCropPath?: string | null
    existingCatalogImageUrl?: string | null
    imageSubjectScope?: string | null
    boundProductKey?: string | null
    boundProductLabel?: string | null
    rightsBasis?: string | null
    verifiedBy?: string | null
  }): MatchingRunManifest {
    const manifest = this.loadManifest(params.batchId)
    if (!manifest) {
      throw new Error(`Manifest not found for batch ${params.batchId}`)
    }
    const proposal = manifest.proposals?.[params.batchOfferKey] ?? null
    const resolvedProductKey =
      params.boundProductKey ||
      CatalogMatchingOrchestrator.buildProposalProductKey(params.batchOfferKey, proposal)
    const nowIso = new Date().toISOString()
    manifest.consumerImageApprovals = manifest.consumerImageApprovals || {}

    if (params.decision === 'reject') {
      manifest.consumerImageApprovals[params.batchOfferKey] = {
        batchOfferKey: params.batchOfferKey,
        status: 'rejected',
        sourceType: null,
        approvedLocalPath: null,
        existingCatalogImageUrl: null,
        approvedForProductKey: resolvedProductKey,
        approvedForProductLabel: params.boundProductLabel ?? null,
        rightsBasis: null,
        verifiedBy: params.verifiedBy || 'operator',
        verifiedAt: nowIso,
        invalidationReason: 'Operator kept product crop private / declined consumer display.',
        updatedAt: nowIso
      }
      manifest.updatedAt = nowIso
      this.saveManifestAtomic(manifest)
      return manifest
    }

    if (params.decision === 'reuse_existing_catalog_image') {
      const url = (params.existingCatalogImageUrl || proposal?.matchedProduct?.imageUrl || '').trim()
      if (!url) {
        throw new Error('Cannot reuse existing catalog product image: matched product has no existing image URL.')
      }
      manifest.consumerImageApprovals[params.batchOfferKey] = {
        batchOfferKey: params.batchOfferKey,
        status: 'reuse_existing_catalog_image',
        sourceType: 'existing_catalog_image',
        approvedLocalPath: null,
        existingCatalogImageUrl: url,
        approvedForProductKey: resolvedProductKey,
        approvedForProductLabel:
          params.boundProductLabel ||
          proposal?.matchedProduct?.nameEn ||
          proposal?.matchedProduct?.nameAr ||
          null,
        rightsBasis: params.rightsBasis || 'existing_verified_catalog_image',
        verifiedBy: params.verifiedBy || 'operator',
        verifiedAt: nowIso,
        invalidationReason: null,
        updatedAt: nowIso
      }
      manifest.updatedAt = nowIso
      this.saveManifestAtomic(manifest)
      return manifest
    }

    // approve_generated_crop: strict safety barriers against promoting private evidence or assortment crops
    const cropPath = (params.productThumbCropPath || '').trim()
    if (!cropPath || !existsSync(cropPath) || statSync(cropPath).size <= 0) {
      throw new Error('Cannot approve consumer product image: product-only crop file is missing or empty.')
    }
    const lowerBase = basename(cropPath).toLowerCase()
    if (lowerBase.includes('offer_card_crop')) {
      throw new Error('SECURITY_BLOCK: Private leaflet offer_card_crop.webp cannot be promoted as a consumer product image.')
    }
    if (params.imageSubjectScope && params.imageSubjectScope !== 'product_package') {
      throw new Error(
        `IMAGE_SCOPE_BLOCK: Only single-product 'product_package' crops can be approved for consumer display (got '${params.imageSubjectScope}').`
      )
    }

    manifest.consumerImageApprovals[params.batchOfferKey] = {
      batchOfferKey: params.batchOfferKey,
      status: 'approved_generated_crop',
      sourceType: 'product_thumb_crop',
      approvedLocalPath: cropPath,
      existingCatalogImageUrl: proposal?.matchedProduct?.imageUrl ?? params.existingCatalogImageUrl ?? null,
      approvedForProductKey: resolvedProductKey,
      approvedForProductLabel: params.boundProductLabel ?? null,
      rightsBasis: params.rightsBasis || 'operator_verified_leaflet_product_crop',
      verifiedBy: params.verifiedBy || 'operator',
      verifiedAt: nowIso,
      invalidationReason: null,
      updatedAt: nowIso
    }
    manifest.updatedAt = nowIso
    this.saveManifestAtomic(manifest)
    return manifest
  }

  /**
   * Shared deterministic catalog lookup with strict pack/size, fat-content, and variant safeguards.
   */
  private findDeterministicCatalogCandidate(
    attrs: NormalizedIdentityAttributes,
    candidates: CompactCatalogCandidate[]
  ): CompactCatalogCandidate | null {
    const mfgPack = attrs.manufacturerPackCount ?? attrs.innerPackCount ?? 1
    const normExtEn = (attrs.productNameEn || '').toLowerCase().trim()
    const normExtAr = (attrs.productNameAr || '').trim()
    const extVar = (attrs.variantOrFlavor || '').toLowerCase().trim()

    for (const cand of candidates) {
      const packCompat = arePackConfigsStrictlyCompatible({
        sizeValue1: attrs.eachSizeValue,
        sizeUnit1: attrs.eachSizeUnit,
        packCount1: mfgPack,
        sizeValue2: cand.sizeValue,
        sizeUnit2: cand.sizeUnit,
        packCount2: cand.packCount
      })
      if (!packCompat.isCompatible) continue

      if (attrs.fatContent && cand.variant) {
        const extFat = attrs.fatContent.toLowerCase()
        const candVar = cand.variant.toLowerCase()
        if (
          (extFat.includes('full') && (candVar.includes('low') || candVar.includes('skim') || candVar.includes('zero'))) ||
          (extFat.includes('low') && (candVar.includes('full') || candVar.includes('whole')))
        ) {
          continue
        }
      }

      if (extVar && cand.variant) {
        const candVar = cand.variant.toLowerCase().trim()
        if (extVar !== candVar && !candVar.includes(extVar) && !extVar.includes(candVar)) {
          continue
        }
      } else if ((extVar && !cand.variant) || (!extVar && cand.variant)) {
        // Explicit variant present on one side and absent on the other -> do not auto-link
        continue
      }

      const candEn = (cand.nameEn || '').toLowerCase().trim()
      const candAr = (cand.nameAr || '').trim()
      const enMatches = Boolean(normExtEn && candEn && (normExtEn.includes(candEn) || candEn.includes(normExtEn)))
      const arMatches = Boolean(normExtAr && candAr && (normExtAr.includes(candAr) || candAr.includes(normExtAr)))

      if (enMatches || arMatches) {
        return cand
      }
    }
    return null
  }

  /**
   * Reconciles catalog matching after an operator edits offer fields.
   * - Non-identity edits (e.g. price/promo-note only) preserve existing product identity and clear stale non-catalog approval if facts changed.
   * - Identity edits (title, brand, size, unit, variant, pack count, assortment) invalidate any prior approval/link and re-run zero-cost deterministic reconciliation.
   *   Never executes paid Gemini calls without renewed operator authorization.
   */
  public async rematchUpdatedOffer(params: {
    batchId: string
    updatedOffer: UnifiedBatchOffer
    allBatchOffers?: UnifiedBatchOffer[]
    supabase?: SupabaseClient | null
    databaseContext?: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST'
    identityFieldChanged: boolean
    priceOrFactChanged?: boolean
  }): Promise<{
    manifest: MatchingRunManifest | null
    outcome: 'reconciled_existing' | 'reconciled_temporary' | 'needs_review' | 'metadata_only_preserved' | 'not_run'
    message: string
  }> {
    const manifest = this.loadManifest(params.batchId)
    if (!manifest) {
      return {
        manifest: null,
        outcome: 'not_run',
        message: 'No matching manifest exists yet for this batch.'
      }
    }

    const offer = params.updatedOffer
    const key = offer.batchOfferKey
    const nowIso = new Date().toISOString()

    if (!params.identityFieldChanged) {
      if (params.priceOrFactChanged && manifest.nonCatalogApprovals?.[key]) {
        delete manifest.nonCatalogApprovals[key]
        manifest.updatedAt = nowIso
        this.saveManifestAtomic(manifest)
      }
      return {
        manifest,
        outcome: 'metadata_only_preserved',
        message: 'Price/metadata edit preserved existing catalog identity.'
      }
    }

    // 1. Invalidate any prior non-catalog approval, consumer image approval, and stale temporary group membership
    if (manifest.nonCatalogApprovals?.[key]) {
      delete manifest.nonCatalogApprovals[key]
    }
    if (manifest.consumerImageApprovals?.[key] && manifest.consumerImageApprovals[key].status !== 'unreviewed') {
      const priorApproval = manifest.consumerImageApprovals[key]
      if (priorApproval.rightsBasis === 'generated_product_crop') {
        delete manifest.consumerImageApprovals[key]
      } else {
        manifest.consumerImageApprovals[key] = {
          ...priorApproval,
          status: 'invalidated_identity_changed',
          sourceType: null,
          approvedLocalPath: null,
          existingCatalogImageUrl: null,
          invalidationReason: 'Product identity fields changed after image approval; re-approval required.',
          updatedAt: nowIso
        }
      }
    }
    const prevProp = manifest.proposals[key]
    const priorTempGroupSnapshot =
      prevProp?.decision === 'temporary' && prevProp?.temporaryId && manifest.temporaryProducts[prevProp.temporaryId]
        ? { ...manifest.temporaryProducts[prevProp.temporaryId] }
        : null
    if (prevProp?.temporaryId && manifest.temporaryProducts[prevProp.temporaryId]) {
      const prevGroup = manifest.temporaryProducts[prevProp.temporaryId]
      prevGroup.sourceOfferKeys = prevGroup.sourceOfferKeys.filter((k) => k !== key)
      prevGroup.operatorDecision = 'proposed'
      prevGroup.updatedAt = nowIso
      if (prevGroup.sourceOfferKeys.length === 0) {
        delete manifest.temporaryProducts[prevProp.temporaryId]
      }
    }

    const dbContext = params.databaseContext || manifest.matchingDatabaseContext || 'PRODUCTION_UI'
    const grouped = this.brandGroupingService.groupOffersByBrand([offer])
    const brandGroup = grouped[0]
    const item = brandGroup?.uniqueIdentities?.[0]

    if (!item) {
      manifest.proposals[key] = {
        batchOfferKey: key,
        sourceOfferId: offer.sourceOfferId,
        sourcePage: offer.sourcePage,
        leafletId: offer.leafletId,
        supermarketName: offer.supermarketName,
        decision: 'unresolved',
        matchedProductId: null,
        matchedProduct: null,
        temporaryId: null,
        confidence: 'low',
        matchMethod: 'deterministic',
        validationIssues: [
          {
            severity: 'warning',
            code: 'REMATCH_IDENTITY_MISSING',
            message: 'Edited offer could not form a normalized product identity; review required.'
          }
        ],
        operatorDecision: 'proposed',
        updatedAt: nowIso
      }
      this.recomputeProposalDecisionTotals(manifest.totals, manifest.proposals, manifest.requests || {})
      manifest.updatedAt = nowIso
      this.saveManifestAtomic(manifest)
      return {
        manifest,
        outcome: 'needs_review',
        message: 'Prior approval cleared; identity could not be normalized cleanly (Needs Review).'
      }
    }

    const sufficiency = evaluateIdentitySufficiency(
      item.normalizedAttrs,
      offer,
      item.normalizedAttrs.evidenceAnnotation
    )

    if (!sufficiency.isSufficient) {
      manifest.proposals[key] = {
        batchOfferKey: key,
        sourceOfferId: offer.sourceOfferId,
        sourcePage: offer.sourcePage,
        leafletId: offer.leafletId,
        supermarketName: offer.supermarketName,
        decision: 'unresolved',
        matchedProductId: null,
        matchedProduct: null,
        temporaryId: null,
        confidence: 'low',
        matchMethod: 'deterministic',
        validationIssues: sufficiency.reasons.map((msg, idx) => ({
          severity: 'warning' as const,
          code: sufficiency.codes[idx] || 'INSUFFICIENT_IDENTITY',
          message: msg
        })),
        evidenceAnnotation: item.normalizedAttrs.evidenceAnnotation || null,
        operatorDecision: 'proposed',
        updatedAt: nowIso
      }
      this.recomputeProposalDecisionTotals(manifest.totals, manifest.proposals, manifest.requests || {})
      manifest.updatedAt = nowIso
      this.saveManifestAtomic(manifest)
      return {
        manifest,
        outcome: 'needs_review',
        message: 'Prior match invalidated; edited attributes remain ambiguous or insufficient (Needs Review).'
      }
    }

    // Gather known candidates from manifest cache + optional read-only Supabase lookup
    const candidatePoolMap = new Map<string, CompactCatalogCandidate>()
    for (const p of Object.values(manifest.proposals || {})) {
      if (p.matchedProduct?.id) {
        candidatePoolMap.set(String(p.matchedProduct.id), p.matchedProduct)
      }
    }
    let dbLookedUpEmpty = false
    if (params.supabase) {
      try {
        const res = await this.brandGroupingService.retrieveBrandCandidates(params.supabase, brandGroup, 50)
        for (const c of res.candidates) {
          candidatePoolMap.set(String(c.id), c)
        }
        if (res.candidates.length === 0) {
          dbLookedUpEmpty = true
        }
      } catch {
        // Offline / DB error falls back cleanly to local staged candidates + deterministic checks
      }
    }
    const candidatePool = Array.from(candidatePoolMap.values())

    const isExplicitAssortedRematch =
      offer.assortment_status === 'unsplit_assortment' ||
      offer.assortment_status === 'assorted' ||
      /assorted|متنوع/i.test(`${offer.titleEn} ${offer.titleAr}`)

    // 2. Persistent cache check (never link assortment offers to a single catalog SKU)
    const activeCacheService = dbContext === 'DEVELOPMENT_TEST' ? this.devCacheService : this.cacheService
    const cachedMatch = isExplicitAssortedRematch ? null : activeCacheService.lookupVerifiedMatch(item.normalizedAttrs)
    if (cachedMatch) {
      const matchedCand = candidatePoolMap.get(cachedMatch.approvedProductId) || null
      const packOk = matchedCand
        ? arePackConfigsStrictlyCompatible({
            sizeValue1: item.normalizedAttrs.eachSizeValue,
            sizeUnit1: item.normalizedAttrs.eachSizeUnit,
            packCount1: item.normalizedAttrs.manufacturerPackCount ?? item.normalizedAttrs.innerPackCount ?? 1,
            sizeValue2: matchedCand.sizeValue,
            sizeUnit2: matchedCand.sizeUnit,
            packCount2: matchedCand.packCount
          }).isCompatible
        : true
      if (packOk) {
        manifest.proposals[key] = {
          batchOfferKey: key,
          sourceOfferId: offer.sourceOfferId,
          sourcePage: offer.sourcePage,
          leafletId: offer.leafletId,
          supermarketName: offer.supermarketName,
          decision: 'existing',
          matchedProductId: cachedMatch.approvedProductId,
          matchedProduct: matchedCand,
          matchedDatabaseContext: dbContext,
          temporaryId: null,
          confidence: 'high',
          matchMethod: 'persistent_cache',
          validationIssues: [],
          operatorDecision: 'proposed',
          updatedAt: nowIso
        }
        this.recomputeProposalDecisionTotals(manifest.totals, manifest.proposals, manifest.requests || {})
        manifest.updatedAt = nowIso
        this.saveManifestAtomic(manifest)
        return {
          manifest,
          outcome: 'reconciled_existing',
          message: `Re-matched cleanly via verified cache to Catalog #${cachedMatch.approvedProductId} (awaiting fresh operator approval).`
        }
      }
    }

    // 3. Deterministic exact match against known catalog candidates (skipped for assortment offers)
    const detMatch = isExplicitAssortedRematch
      ? null
      : this.findDeterministicCatalogCandidate(item.normalizedAttrs, candidatePool)
    if (detMatch) {
      manifest.proposals[key] = {
        batchOfferKey: key,
        sourceOfferId: offer.sourceOfferId,
        sourcePage: offer.sourcePage,
        leafletId: offer.leafletId,
        supermarketName: offer.supermarketName,
        decision: 'existing',
        matchedProductId: detMatch.id,
        matchedProduct: detMatch,
        matchedDatabaseContext: dbContext,
        temporaryId: null,
        confidence: 'high',
        matchMethod: 'deterministic',
        validationIssues: [],
        operatorDecision: 'proposed',
        updatedAt: nowIso
      }
      this.recomputeProposalDecisionTotals(manifest.totals, manifest.proposals, manifest.requests || {})
      manifest.updatedAt = nowIso
      this.saveManifestAtomic(manifest)
      return {
        manifest,
        outcome: 'reconciled_existing',
        message: `Re-matched deterministically to Catalog #${detMatch.id} (prior approval cleared; confirm updated link).`
      }
    }

    // 4. Temporary product registry reconciliation when absent in catalog or matching another provisional group
    const tempRegistry = new TemporaryProductRegistry(params.batchId, manifest.temporaryProducts)
    let matchedOrAbsenceTemporary = false
    if (dbLookedUpEmpty && params.supabase) {
      const absence = await this.brandGroupingService.verifyAbsenceInBrandCatalog(params.supabase, brandGroup, item)
      matchedOrAbsenceTemporary = absence.isExhaustivelyAbsent
    }
    if (!matchedOrAbsenceTemporary) {
      // Check if an existing provisional group in this batch has equivalent identity
      for (const existingGroup of Object.values(manifest.temporaryProducts || {})) {
        if (tempRegistry.areIdentitiesEquivalent(item.normalizedAttrs, existingGroup)) {
          matchedOrAbsenceTemporary = true
          break
        }
      }
    }
    if (
      !matchedOrAbsenceTemporary &&
      priorTempGroupSnapshot &&
      tempRegistry.areIdentitiesEquivalent(item.normalizedAttrs, priorTempGroupSnapshot)
    ) {
      // Typo/conflict fix on an unambiguous offer whose canonical normalized identity still matches
      // its previously matched/absent provisional group should remain provisional Ready offline.
      matchedOrAbsenceTemporary = true
    }

    const isExplicitAssorted =
      offer.assortment_status === 'unsplit_assortment' ||
      offer.assortment_status === 'assorted' ||
      /assorted|متنوع/i.test(`${offer.titleEn} ${offer.titleAr}`)

    if (!matchedOrAbsenceTemporary && (isExplicitAssorted || sufficiency.isSufficient)) {
      matchedOrAbsenceTemporary = true
    }

    if (matchedOrAbsenceTemporary) {
      const recon = tempRegistry.reconcileTemporaryOffer({
        requestTempRef: `rematch_${offer.sourceOfferId}`,
        requestScopedMap: new Map(),
        attrs: item.normalizedAttrs,
        sourceOffer: offer
      })
      manifest.temporaryProducts = tempRegistry.getGroups()
      if (manifest.temporaryProducts[recon.temporaryId]) {
        manifest.temporaryProducts[recon.temporaryId].operatorDecision = 'proposed'
      }
      manifest.proposals[key] = {
        batchOfferKey: key,
        sourceOfferId: offer.sourceOfferId,
        sourcePage: offer.sourcePage,
        leafletId: offer.leafletId,
        supermarketName: offer.supermarketName,
        decision: 'temporary',
        matchedProductId: null,
        matchedProduct: null,
        temporaryId: recon.temporaryId,
        confidence: 'medium',
        matchMethod: 'deterministic',
        validationIssues: [],
        operatorDecision: 'proposed',
        updatedAt: nowIso
      }
      if (
        offer.productThumbCropPath &&
        manifest.consumerImageApprovals?.[key]?.status !== 'invalidated_identity_changed'
      ) {
        manifest.consumerImageApprovals = manifest.consumerImageApprovals || {}
        manifest.consumerImageApprovals[key] = {
          batchOfferKey: key,
          status: 'approved_generated_crop',
          sourceType: 'product_thumb_crop',
          approvedLocalPath: offer.productThumbCropPath,
          existingCatalogImageUrl: null,
          approvedForProductKey: `temp:${recon.temporaryId}`,
          approvedForProductLabel: offer.titleEn || offer.titleAr || null,
          rightsBasis: 'generated_product_crop',
          verifiedBy: 'system_auto_selected',
          invalidationReason: null,
          updatedAt: nowIso
        }
      }
      this.recomputeProposalDecisionTotals(manifest.totals, manifest.proposals, manifest.requests || {})
      manifest.updatedAt = nowIso
      this.saveManifestAtomic(manifest)
      return {
        manifest,
        outcome: 'reconciled_temporary',
        message: `Reconciled updated identity into provisional product group ${recon.temporaryId} (Ready when valid).`
      }
    }

    // 5. No safe zero-cost deterministic match -> fail closed to unresolved (Needs Review) without spending unauthorized API budget
    manifest.proposals[key] = {
      batchOfferKey: key,
      sourceOfferId: offer.sourceOfferId,
      sourcePage: offer.sourcePage,
      leafletId: offer.leafletId,
      supermarketName: offer.supermarketName,
      decision: 'unresolved',
      matchedProductId: null,
      matchedProduct: null,
      temporaryId: null,
      confidence: 'low',
      matchMethod: 'deterministic',
      validationIssues: [
        {
          severity: 'warning',
          code: 'REMATCH_REQUIRES_REVIEW',
          message:
            'Identity-defining field edited; prior catalog link invalidated and deterministic re-matching requires review or renewed AI authorization.'
        }
      ],
      operatorDecision: 'proposed',
      updatedAt: nowIso
    }
    this.recomputeProposalDecisionTotals(manifest.totals, manifest.proposals, manifest.requests || {})
    manifest.updatedAt = nowIso
    this.saveManifestAtomic(manifest)
    return {
      manifest,
      outcome: 'needs_review',
      message: 'Prior match invalidated after identity edit; marked Needs Review (no unauthorized paid API calls made).'
    }
  }
}
