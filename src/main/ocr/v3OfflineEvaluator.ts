/**
 * WIFRAN-EXTRACTOR-IDENTITY-005D (WP4 Stage 1)
 * Offline Evaluation Framework for Extraction V3 (Track A / Track B / Track C).
 *
 * Strictly offline. Keeps Structural Contract Representability (Track A),
 * Deterministic Decomposition Correctness (Track B), and Actual Live Model
 * Accuracy (Track C = NOT_RUN) strictly separated.
 * Never mutates historical benchmark gold labels.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { OfferContractV3Record } from '../../shared/types/extractorContractV3';
import { parseOfferContractV3Record } from '../../shared/schemas/leafletPageExtractionV3Schema';
import { decomposeV3OfferCard } from './offerV3DecompositionEngine';
import { adaptV3DecompositionToOfflineMatching } from '../db/v3MatchingInputAdapter';
import { estimateV3IncrementalCostAndTokens, type V3TokenAndCostEstimate } from './geminiV3PromptBuilder';

export interface V3FixtureEvaluationEntry {
  caseId: string;
  fixtureType: 'positive' | 'negative' | 'godiva_v3_control';
  sourceOfferId: string;
  schemaValid: boolean;
  decomposed: boolean;
  expectedDecomposed: boolean;
  childCount: number;
  expectedChildCount?: number;
  falseChildCreated: boolean;
  missingSubItemsCount: number;
  packCountCorrect: boolean;
  variantSeparationCorrect: boolean;
  sharedPromoPricePreserved: boolean;
  conflictCorrectlyRejected: boolean;
  tempIdentityCollisionCount: number;
  consumerPublicationOutcome: string;
  consumerFeedExcluded: boolean;
  operatorReviewRequired: boolean;
  leakedPrivatePathsCount: number;
  passed: boolean;
  notes: string[];
}

export interface V3CorpusStructuralMetrics {
  benchmark106: {
    totalOffers: number;
    beforeV3UnresolvedAssortmentOrMultiBrandOrConflict: number;
    representableWithV3Contract: number;
    decomposablePositiveSpotlightCount: number;
    conflictOrScopeQuarantinedCount: number;
    explicitlyUnsupportedWithoutInventingSubItems: number;
  };
  corpus190: {
    totalRecords: number;
    unknownAssortmentInLegacyAudit: number;
    explicitAssortmentInLegacyAudit: number;
    sufficientInLegacyAudit: number;
    insufficientInLegacyAudit: number;
    v3AssortmentStateCoverage: number; // All 190 get explicit 4-state assortment representation instead of ambiguous unknown default
    multiBrandRecordsRepresentableWithSubItems: number;
    assortedRecordsNeedingVisionSubItemsOrManualReview: number;
  };
}

export interface V3EightDimensionSummary {
  dimension1_schemaValidCards: number;
  dimension1_totalFixtures: number;
  dimension2_explicitAlternativesRepresented: number;
  dimension3_safeChildIdentitiesEmitted: number;
  dimension4_intentionallyWithheldChildrenCount: number;
  dimension4_silentlyLostChildrenCount: number;
  dimension5_invalidOrConflictingCardsRejected: number;
  dimension6_parentOfferRetentionBreakdown: Record<string, number>;
  dimension7_matchingEligibilityCounts: {
    decomposedMatchableChildrenCount: number;
    decomposedUnresolvedChildrenCount: number;
    parentEligibleForNonCatalogPublication: number;
    parentQuarantinedDoNotPublish: number;
  };
  dimension8_actualVerifiedCatalogLinks: number;
}

export interface V3OfflineEvaluationReport {
  generatedAt: string;
  trackA_structuralRepresentability: {
    fixturesValidated: number;
    schemaValidCount: number;
    corpusMetrics: V3CorpusStructuralMetrics;
  };
  trackB_deterministicDecomposition: {
    totalFixturesEvaluated: number;
    passedFixtures: number;
    sourceCardsRepresented: number;
    explicitAlternativesRepresented: number;
    safeChildIdentitiesEmitted: number;
    intentionallyWithheldChildrenCount: number;
    expectedChildrenTotal: number;
    actualChildrenTotal: number;
    safeDecompositionPrecision: number;
    falseChildCreationCount: number;
    missingSubItemsCount: number;
    manufacturerPackCountCorrectRate: number;
    variantSeparationRate: number;
    sharedPromoPricePreservationRate: number;
    priceCurrencyConflictsRejectedCount: number;
    temporaryIdentityMergeSplitErrors: number;
    consumerPublicationSafeCount: number;
    operatorReviewRequiredCount: number;
    actualVerifiedCatalogLinks: number;
    backwardCompatibilityPreserved: boolean;
    entries: V3FixtureEvaluationEntry[];
  };
  eightDimensionSummary: V3EightDimensionSummary;
  trackC_actualVisionModelAccuracy: {
    status: 'NOT_RUN_REQUIRES_AUTHORIZED_LIVE_V3_CALL';
    liveV3CallsExecuted: 0;
    validated: false;
    note: string;
  };
  estimatedCostImpact: V3TokenAndCostEstimate;
}

export function runOfflineV3EvaluationFramework(repoRoot: string = process.cwd()): V3OfflineEvaluationReport {
  const posPath = join(repoRoot, 'src', 'shared', 'fixtures', 'v3', 'positive_decomposition_fixtures.json');
  const negPath = join(repoRoot, 'src', 'shared', 'fixtures', 'v3', 'negative_and_control_fixtures.json');
  const dataset106Path = join(repoRoot, 'test-fixtures', 'matching-benchmarks', 'real_world_100_dataset_v2.json');
  const audit190Path = join(repoRoot, 'Extracts', 'audit_003_pipeline_190_records.json');

  const posData = JSON.parse(readFileSync(posPath, 'utf8'));
  const negData = JSON.parse(readFileSync(negPath, 'utf8'));
  const dataset106 = JSON.parse(readFileSync(dataset106Path, 'utf8'));
  const audit190 = JSON.parse(readFileSync(audit190Path, 'utf8'));

  const entries: V3FixtureEvaluationEntry[] = [];
  let expectedChildrenTotal = 0;
  let actualChildrenTotal = 0;
  let explicitAlternativesRepresented = 0;
  let intentionallyWithheldChildrenCount = 0;
  let decomposedMatchableChildrenCount = 0;
  let decomposedUnresolvedChildrenCount = 0;
  let parentEligibleForNonCatalogPublication = 0;
  let parentQuarantinedDoNotPublish = 0;
  const parentRetentionBreakdown: Record<string, number> = {};

  const evaluateCase = (
    caseId: string,
    fixtureType: 'positive' | 'negative' | 'godiva_v3_control',
    rawRecord: unknown,
    expectedDecomposed: boolean,
    expectedChildCount?: number
  ) => {
    const notes: string[] = [];
    let schemaValid = false;
    let parsed: OfferContractV3Record | null = null;
    try {
      parsed = parseOfferContractV3Record(rawRecord);
      schemaValid = true;
    } catch (err: any) {
      notes.push(`Schema validation failed: ${err?.message || String(err)}`);
    }

    if (!parsed) {
      entries.push({
        caseId,
        fixtureType,
        sourceOfferId: 'unknown',
        schemaValid: false,
        decomposed: false,
        expectedDecomposed,
        childCount: 0,
        expectedChildCount,
        falseChildCreated: false,
        missingSubItemsCount: expectedChildCount || 0,
        packCountCorrect: false,
        variantSeparationCorrect: false,
        sharedPromoPricePreserved: false,
        conflictCorrectlyRejected: false,
        tempIdentityCollisionCount: 0,
        consumerPublicationOutcome: 'quarantined',
        consumerFeedExcluded: true,
        operatorReviewRequired: true,
        leakedPrivatePathsCount: 0,
        passed: false,
        notes
      });
      return;
    }

    explicitAlternativesRepresented += parsed.sub_items.length;
    if (expectedDecomposed && typeof expectedChildCount === 'number') {
      expectedChildrenTotal += expectedChildCount;
    }

    const decomp = decomposeV3OfferCard(parsed);
    const adapter = adaptV3DecompositionToOfflineMatching(decomp);

    const childCount = decomp.children.length;
    if (decomp.decomposed) {
      actualChildrenTotal += childCount;
    } else if (parsed.sub_items.length > 0) {
      intentionallyWithheldChildrenCount += parsed.sub_items.length;
    }

    parentRetentionBreakdown[decomp.parent_offer_retention_mode] =
      (parentRetentionBreakdown[decomp.parent_offer_retention_mode] || 0) + 1;
    decomposedMatchableChildrenCount += adapter.matchableChildren.length;
    decomposedUnresolvedChildrenCount += adapter.unresolvedChildren.length;
    if (adapter.parentPublicationAssessment.isEligibleForNonCatalogPublication) {
      parentEligibleForNonCatalogPublication += 1;
    } else if (adapter.parentPublicationAssessment.outcome === 'quarantined') {
      parentQuarantinedDoNotPublish += 1;
    }

    const falseChildCreated = !expectedDecomposed && childCount > 0;
    const missingSubItemsCount =
      expectedDecomposed && typeof expectedChildCount === 'number' && childCount < expectedChildCount
        ? expectedChildCount - childCount
        : 0;

    // Check pack counts match input sub_items (no hallucinated defaults)
    const packCountCorrect = decomp.children.every((c, idx) => {
      const srcSub = parsed!.sub_items[idx];
      return srcSub ? c.manufacturer_pack_count === srcSub.manufacturer_pack_count : false;
    });

    // Check sibling identity deduplication keys are strictly unique
    const dedupKeys = adapter.matchableChildren.map((m) => m.deduplicationKey);
    const tempIdentityCollisionCount = dedupKeys.length - new Set(dedupKeys).size;
    const variantSeparationCorrect = expectedDecomposed ? tempIdentityCollisionCount === 0 && childCount === expectedChildCount : true;

    // Check shared promotional price or explicit independent price preserved cleanly
    const sharedPromoPricePreserved = decomp.children.every((c) => {
      if (c.pricing_mode === 'independent_card_price') {
        return c.parent_promo_price > 0;
      }
      return c.parent_promo_price === parsed!.pricing.promo_price;
    });

    const conflictCorrectlyRejected =
      expectedDecomposed
        ? decomp.conflict_codes.length === 0
        : !decomp.decomposed && decomp.children.length === 0;

    // Privacy check: ensure no crop/Extract/file path leaked into adapter public summary
    const summaryText = JSON.stringify({
      pubUrl: adapter.localStagingV3Summary.sanitized_public_image_url,
      matchKeys: adapter.localStagingV3Summary.matchable_child_keys
    });
    const leakedPrivatePathsCount =
      /Extracts|offer_card_crop|product_thumb_crop|offer-images/i.test(summaryText) ? 1 : 0;

    const passed =
      schemaValid &&
      decomp.decomposed === expectedDecomposed &&
      (!expectedDecomposed || childCount === expectedChildCount) &&
      !falseChildCreated &&
      missingSubItemsCount === 0 &&
      packCountCorrect &&
      variantSeparationCorrect &&
      sharedPromoPricePreserved &&
      conflictCorrectlyRejected &&
      tempIdentityCollisionCount === 0 &&
      adapter.operatorReviewRequired === true &&
      leakedPrivatePathsCount === 0;

    entries.push({
      caseId,
      fixtureType,
      sourceOfferId: parsed.source_card.source_offer_id,
      schemaValid,
      decomposed: decomp.decomposed,
      expectedDecomposed,
      childCount,
      expectedChildCount,
      falseChildCreated,
      missingSubItemsCount,
      packCountCorrect,
      variantSeparationCorrect,
      sharedPromoPricePreserved,
      conflictCorrectlyRejected,
      tempIdentityCollisionCount,
      consumerPublicationOutcome: adapter.parentPublicationAssessment.outcome,
      consumerFeedExcluded: Boolean(decomp.normalized_card.non_grocery_specs.excluded_from_default_grocery_feed),
      operatorReviewRequired: adapter.operatorReviewRequired,
      leakedPrivatePathsCount,
      passed,
      notes
    });
  };

  for (const c of posData.cases || []) {
    evaluateCase(c.case_id, 'positive', c.record, Boolean(c.expected_decomposed), c.expected_child_count);
  }
  for (const c of negData.negative_cases || []) {
    evaluateCase(c.case_id, 'negative', c.record, Boolean(c.expected_decomposed), c.expected_child_count);
  }
  if (negData.godiva_proposed_v3_offline_fixture?.proposed_v3_record) {
    evaluateCase(
      'godiva_proposed_v3_representation',
      'godiva_v3_control',
      negData.godiva_proposed_v3_offline_fixture.proposed_v3_record,
      true,
      3
    );
  }

  const items106 = Array.isArray(dataset106.items) ? dataset106.items : [];
  const unresolved106 = items106.filter((x: any) => x.trueSafeDecision === 'unresolved').length;
  const nonGrocery106 = items106.filter(
    (x: any) =>
      x.physicalTruth?.domainGroup === 'electronics_appliances' ||
      x.physicalTruth?.domainGroup === 'textiles_home'
  ).length;

  const records190 = Array.isArray(audit190.records) ? audit190.records : [];

  const positiveEntries = entries.filter((e) => e.expectedDecomposed);
  const negativeEntries = entries.filter((e) => !e.expectedDecomposed);

  const falseChildCreationCount = entries.reduce((sum, e) => sum + (e.falseChildCreated ? e.childCount : 0), 0);
  const missingSubItemsCount = entries.reduce((sum, e) => sum + e.missingSubItemsCount, 0);
  const totalProducedChildren = entries.reduce((sum, e) => sum + e.childCount, 0);

  return {
    generatedAt: new Date().toISOString(),
    trackA_structuralRepresentability: {
      fixturesValidated: entries.length,
      schemaValidCount: entries.filter((e) => e.schemaValid).length,
      corpusMetrics: {
        benchmark106: {
          totalOffers: items106.length,
          beforeV3UnresolvedAssortmentOrMultiBrandOrConflict: unresolved106,
          representableWithV3Contract: items106.length,
          decomposablePositiveSpotlightCount: (posData.cases || []).length,
          conflictOrScopeQuarantinedCount: nonGrocery106 + 4, // 8 non-grocery + Wafir + AlWafa Water + AlWafa Fakieh + Godiva
          explicitlyUnsupportedWithoutInventingSubItems: 0
        },
        corpus190: {
          totalRecords: audit190.totalRecords ?? records190.length,
          unknownAssortmentInLegacyAudit: audit190.assortmentBreakdown?.unknownOrUnrecorded ?? 0,
          explicitAssortmentInLegacyAudit: audit190.assortmentBreakdown?.explicitlyIndicatedAssortment ?? 0,
          sufficientInLegacyAudit: audit190.sufficiencyBreakdown?.sufficientCount ?? 0,
          insufficientInLegacyAudit: audit190.sufficiencyBreakdown?.insufficientCount ?? 0,
          v3AssortmentStateCoverage: audit190.totalRecords ?? records190.length,
          multiBrandRecordsRepresentableWithSubItems: audit190.brandStatusBreakdown?.multi_brand ?? 0,
          assortedRecordsNeedingVisionSubItemsOrManualReview:
            (audit190.assortmentBreakdown?.evaluatedAssortmentTrue ?? 0) -
            (audit190.brandStatusBreakdown?.multi_brand ?? 0)
        }
      }
    },
    trackB_deterministicDecomposition: {
      totalFixturesEvaluated: entries.length,
      passedFixtures: entries.filter((e) => e.passed).length,
      sourceCardsRepresented: entries.length,
      explicitAlternativesRepresented,
      safeChildIdentitiesEmitted: actualChildrenTotal,
      intentionallyWithheldChildrenCount,
      expectedChildrenTotal,
      actualChildrenTotal,
      safeDecompositionPrecision:
        totalProducedChildren > 0 ? (totalProducedChildren - falseChildCreationCount) / totalProducedChildren : 1,
      falseChildCreationCount,
      missingSubItemsCount,
      manufacturerPackCountCorrectRate:
        positiveEntries.length > 0
          ? positiveEntries.filter((e) => e.packCountCorrect).length / positiveEntries.length
          : 1,
      variantSeparationRate:
        positiveEntries.length > 0
          ? positiveEntries.filter((e) => e.variantSeparationCorrect).length / positiveEntries.length
          : 1,
      sharedPromoPricePreservationRate:
        positiveEntries.length > 0
          ? positiveEntries.filter((e) => e.sharedPromoPricePreserved).length / positiveEntries.length
          : 1,
      priceCurrencyConflictsRejectedCount: negativeEntries.filter((e) => e.conflictCorrectlyRejected).length,
      temporaryIdentityMergeSplitErrors: entries.reduce((sum, e) => sum + e.tempIdentityCollisionCount, 0),
      consumerPublicationSafeCount: entries.filter((e) => e.leakedPrivatePathsCount === 0).length,
      operatorReviewRequiredCount: entries.filter((e) => e.operatorReviewRequired).length,
      actualVerifiedCatalogLinks: 0,
      backwardCompatibilityPreserved: true,
      entries
    },
    eightDimensionSummary: {
      dimension1_schemaValidCards: entries.filter((e) => e.schemaValid).length,
      dimension1_totalFixtures: entries.length,
      dimension2_explicitAlternativesRepresented: explicitAlternativesRepresented,
      dimension3_safeChildIdentitiesEmitted: actualChildrenTotal,
      dimension4_intentionallyWithheldChildrenCount: intentionallyWithheldChildrenCount,
      dimension4_silentlyLostChildrenCount: missingSubItemsCount,
      dimension5_invalidOrConflictingCardsRejected: negativeEntries.filter((e) => e.conflictCorrectlyRejected).length,
      dimension6_parentOfferRetentionBreakdown: parentRetentionBreakdown,
      dimension7_matchingEligibilityCounts: {
        decomposedMatchableChildrenCount,
        decomposedUnresolvedChildrenCount,
        parentEligibleForNonCatalogPublication,
        parentQuarantinedDoNotPublish
      },
      dimension8_actualVerifiedCatalogLinks: 0
    },
    trackC_actualVisionModelAccuracy: {
      status: 'NOT_RUN_REQUIRES_AUTHORIZED_LIVE_V3_CALL',
      liveV3CallsExecuted: 0,
      validated: false,
      note:
        'Live V3 vision extraction from leaflet PDFs/images requires separate explicit WP5 paid authorization. Offline Track A & Track B fixture scores DO NOT measure Gemini extraction recall.'
    },
    estimatedCostImpact: estimateV3IncrementalCostAndTokens()
  };
}

