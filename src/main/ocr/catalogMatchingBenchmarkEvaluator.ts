/**
 * Wifran Catalog Matching Benchmark Evaluator
 * Milestone: WIFRAN-EXTRACTOR-CATALOG-MATCH-001B
 *
 * Evaluates matching run outcomes against gold-standard ground truth datasets.
 * Computes precision, recall, false merges, candidate retrieval recall,
 * token accounting, and cost per 100/1,000 unique identities.
 */

import { MatchingRunManifest } from '../../shared/types/catalogMatching'

export interface GoldBenchmarkItem {
  sourceOfferId: string
  retailer?: string
  titleEn: string
  titleAr: string
  extractedAttributes: any
  expectedDecision: 'existing' | 'temporary' | 'unresolved'
  expectedProductId?: string | null
  expectedTemporaryGroup?: string | null
  evidence?: string
}

export interface GoldBenchmarkDataset {
  version: string
  name: string
  description?: string
  totalItems: number
  items: GoldBenchmarkItem[]
}

export interface MatchingBenchmarkMetrics {
  totalItemsEvaluated: number
  // Existing product metrics
  expectedExistingCount: number
  proposedExistingCount: number
  trueExistingMatchesCount: number
  falseExistingMatchesCount: number
  existingPrecision: number // 0.0 - 1.0
  existingRecall: number // 0.0 - 1.0
  // Temporary group metrics
  expectedTemporaryCount: number
  proposedTemporaryCount: number
  incorrectTemporaryMergesCount: number // Distinct products merged into same tempId
  missedDuplicateNewProductsCount: number // Equivalent products split into distinct tempIds
  // Unresolved metrics
  expectedUnresolvedCount: number
  proposedUnresolvedCount: number
  unresolvedPercentage: number
  // Candidate coverage metrics
  candidateRetrievalRecall: number // % of expected existing products present in candidate list
  // Cost & token accounting
  totalCostUsd: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  thinkingTokens: number
  cachedInputTokens: number
  costPer100IdentitiesUsd: number
  costPer1000IdentitiesUsd: number
  cacheHitRate: number
  // Discrepancy details
  mismatches: {
    sourceOfferId: string
    expectedDecision: string
    actualDecision: string
    expectedId: string | null
    actualId: string | null
    reason: string
  }[]
}

export class CatalogMatchingBenchmarkEvaluator {
  /**
   * Evaluates a completed MatchingRunManifest against a GoldBenchmarkDataset.
   */
  public evaluateManifest(params: {
    goldDataset: GoldBenchmarkDataset
    manifest: MatchingRunManifest
    availableCandidateIds?: Set<string>
  }): MatchingBenchmarkMetrics {
    const { goldDataset, manifest, availableCandidateIds } = params

    let expectedExisting = 0
    let proposedExisting = 0
    let trueExisting = 0
    let falseExisting = 0

    let expectedTemporary = 0
    let proposedTemporary = 0

    let expectedUnresolved = 0
    let proposedUnresolved = 0

    let candidatesFoundForExisting = 0

    const mismatches: MatchingBenchmarkMetrics['mismatches'] = []

    // Temporary group tracking for merge/split verification
    const tempGroupToExpected: Map<string, Set<string>> = new Map() // tempId -> Set of expected temporary group names
    const expectedGroupToTempIds: Map<string, Set<string>> = new Map() // expected group name -> Set of tempIds

    for (const gold of goldDataset.items) {
      if (gold.expectedDecision === 'existing') expectedExisting++
      else if (gold.expectedDecision === 'temporary') expectedTemporary++
      else expectedUnresolved++

      // Check if candidate retrieval included the true product
      if (gold.expectedProductId && availableCandidateIds) {
        if (availableCandidateIds.has(String(gold.expectedProductId))) {
          candidatesFoundForExisting++
        }
      }

      // Find proposal matching this sourceOfferId
      const proposal = Object.values(manifest.proposals).find(
        (p) => p.sourceOfferId === gold.sourceOfferId || p.batchOfferKey === gold.sourceOfferId || p.batchOfferKey?.endsWith(`:${gold.sourceOfferId}`)
      )

      if (!proposal) {
        mismatches.push({
          sourceOfferId: gold.sourceOfferId,
          expectedDecision: gold.expectedDecision,
          actualDecision: 'missing_proposal',
          expectedId: gold.expectedProductId || gold.expectedTemporaryGroup || null,
          actualId: null,
          reason: 'No matching proposal found in manifest'
        })
        continue
      }

      if (proposal.decision === 'existing') proposedExisting++
      else if (proposal.decision === 'temporary') proposedTemporary++
      else proposedUnresolved++

      // Evaluate existing match accuracy
      if (gold.expectedDecision === 'existing') {
        if (proposal.decision === 'existing' && String(proposal.matchedProductId) === String(gold.expectedProductId)) {
          trueExisting++
        } else {
          falseExisting++
          mismatches.push({
            sourceOfferId: gold.sourceOfferId,
            expectedDecision: 'existing',
            actualDecision: proposal.decision,
            expectedId: String(gold.expectedProductId),
            actualId: String(proposal.matchedProductId || proposal.temporaryId),
            reason: `Expected match to ${gold.expectedProductId}, got ${proposal.decision} (${proposal.matchedProductId || proposal.temporaryId})`
          })
        }
      } else if (proposal.decision === 'existing') {
        // Proposed existing when not expected
        falseExisting++
        mismatches.push({
          sourceOfferId: gold.sourceOfferId,
          expectedDecision: gold.expectedDecision,
          actualDecision: 'existing',
          expectedId: gold.expectedTemporaryGroup || null,
          actualId: String(proposal.matchedProductId),
          reason: `Falsely matched non-existing product to catalog product ${proposal.matchedProductId}`
        })
      }

      // Track temporary groups for merge / split consistency
      if (proposal.decision === 'temporary' && proposal.temporaryId) {
        const tempId = proposal.temporaryId
        const expGroup = gold.expectedTemporaryGroup || `unknown_${gold.sourceOfferId}`

        if (!tempGroupToExpected.has(tempId)) tempGroupToExpected.set(tempId, new Set())
        tempGroupToExpected.get(tempId)!.add(expGroup)

        if (gold.expectedTemporaryGroup) {
          if (!expectedGroupToTempIds.has(gold.expectedTemporaryGroup)) {
            expectedGroupToTempIds.set(gold.expectedTemporaryGroup, new Set())
          }
          expectedGroupToTempIds.get(gold.expectedTemporaryGroup)!.add(tempId)
        }
      }
    }

    // Check for incorrect merges: 1 temporaryId contains multiple distinct expected groups
    let incorrectMerges = 0
    for (const [_tempId, expGroups] of tempGroupToExpected.entries()) {
      if (expGroups.size > 1) {
        incorrectMerges += expGroups.size - 1
      }
    }

    // Check for missed duplicates: 1 expected group split across multiple temporaryIds
    let missedDuplicates = 0
    for (const [_expGroup, tempIds] of expectedGroupToTempIds.entries()) {
      if (tempIds.size > 1) {
        missedDuplicates += tempIds.size - 1
      }
    }

    const totalItems = goldDataset.items.length
    const existingPrecision = proposedExisting > 0 ? Number((trueExisting / proposedExisting).toFixed(4)) : 1.0
    const existingRecall = expectedExisting > 0 ? Number((trueExisting / expectedExisting).toFixed(4)) : 1.0
    const candidateRecall = expectedExisting > 0 && availableCandidateIds
      ? Number((candidatesFoundForExisting / expectedExisting).toFixed(4))
      : 1.0
    const unresolvedPct = totalItems > 0 ? Number(((proposedUnresolved / totalItems) * 100).toFixed(2)) : 0

    const totals = manifest.totals
    const actualCost = (totals as any).actualCostUsd ?? (totals as any).totalCostUsd ?? 0
    const totalTokens = (totals.inputTokens || 0) + (totals.outputTokens || 0) + (totals.thinkingTokens || 0)
    const costPer100 = totalItems > 0 ? Number(((actualCost / totalItems) * 100).toFixed(4)) : 0
    const costPer1000 = totalItems > 0 ? Number(((actualCost / totalItems) * 1000).toFixed(4)) : 0
    const cacheHitRate = totals.uniqueIdentitiesCount > 0
      ? Number(((totals.cacheMatchesCount / totals.uniqueIdentitiesCount) * 100).toFixed(2))
      : 0

    return {
      totalItemsEvaluated: totalItems,
      expectedExistingCount: expectedExisting,
      proposedExistingCount: proposedExisting,
      trueExistingMatchesCount: trueExisting,
      falseExistingMatchesCount: falseExisting,
      existingPrecision,
      existingRecall,
      expectedTemporaryCount: expectedTemporary,
      proposedTemporaryCount: proposedTemporary,
      incorrectTemporaryMergesCount: incorrectMerges,
      missedDuplicateNewProductsCount: missedDuplicates,
      expectedUnresolvedCount: expectedUnresolved,
      proposedUnresolvedCount: proposedUnresolved,
      unresolvedPercentage: unresolvedPct,
      candidateRetrievalRecall: candidateRecall,
      totalCostUsd: actualCost,
      totalTokens,
      inputTokens: totals.inputTokens || 0,
      outputTokens: totals.outputTokens || 0,
      thinkingTokens: totals.thinkingTokens || 0,
      cachedInputTokens: 0,
      costPer100IdentitiesUsd: costPer100,
      costPer1000IdentitiesUsd: costPer1000,
      cacheHitRate,
      mismatches
    }
  }
}

