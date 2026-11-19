/**
 * WIFRAN-EXTRACTOR-IDENTITY-005G (WP6-I)
 * Offline End-to-End Evaluation Harness for Hybrid Orchestration.
 *
 * Strictly offline (ZERO live Gemini/Vertex API calls, ZERO Supabase writes).
 * Preserves frozen `pilot_005e_frozen_ground_truth.json`, historical `005E` pilot archives,
 * and `005E`/`005F` evaluation reports untouched. Writes only additive `evaluation_report_wp6_005g.json`.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import {
  createOffline005eReplayProvider,
  runHybridPageWorkflow,
  type OfflineSavedPageBundle
} from '../src/main/ocr/hybrid/hybridWorkflowOrchestrator';
import { PILOT_005E_TELEMETRY_BASELINE } from '../src/main/ocr/hybrid/hybridCostLatencyGovernor';
import { auditHybridSafetyInvariants } from '../src/main/ocr/hybrid/hybridSafetyInvariants';

const REPO_ROOT = resolve(__dirname, '..');
const PILOT_DIR = join(REPO_ROOT, 'Extracts/pilot_v3_005e');
const RESPONSES_DIR = join(PILOT_DIR, 'responses');

interface PilotPageSpec {
  leafletId: string;
  pageNumber: number;
  retailer: string;
  retailerId: string;
  offerStartDate: string;
  offerEndDate: string;
  pageSlotId: string;
  pageAssetPath: string;
  pageImagePath: string;
  savedCropFilesByOfferNumber: Record<number, string>;
  auditedPilotSlotByOfferNumber: Record<number, string>;
}

const PILOT_PAGES: PilotPageSpec[] = [
  {
    leafletId: 'panda-national-national-2026-10-20',
    pageNumber: 2,
    retailer: 'Panda',
    retailerId: 'sm-panda-offline',
    offerStartDate: '2026-10-14',
    offerEndDate: '2026-10-20',
    pageSlotId: 'pilot_page_01_panda_p002',
    pageAssetPath: join(REPO_ROOT, 'Extracts/Panda_Test/chunks/chunk-002-pages-002-002.pdf'),
    pageImagePath: join(REPO_ROOT, 'Extracts/Panda_Test/pages/page.2.png'),
    savedCropFilesByOfferNumber: {
      5: join(RESPONSES_DIR, 'pilot_crop_01_baskin_robbins.raw.json'),
      8: join(RESPONSES_DIR, 'pilot_crop_02_moussy.raw.json')
    },
    auditedPilotSlotByOfferNumber: {
      5: 'pilot_crop_01_baskin_robbins',
      8: 'pilot_crop_02_moussy'
    }
  },
  {
    leafletId: 'bin-dawood-national-national-2026-10-20',
    pageNumber: 4,
    retailer: 'BinDawood',
    retailerId: 'sm-bindawood-offline',
    offerStartDate: '2026-07-15',
    offerEndDate: '2026-07-21',
    pageSlotId: 'pilot_page_02_bndw_p004',
    pageAssetPath: join(REPO_ROOT, 'Extracts/BNDW_Test/chunks/chunk-004-pages-004-004.pdf'),
    pageImagePath: join(REPO_ROOT, 'Extracts/BNDW_Test/pages/page.4.png'),
    savedCropFilesByOfferNumber: {
      1: join(RESPONSES_DIR, 'pilot_crop_05_abu_kass.raw.json'),
      11: join(RESPONSES_DIR, 'pilot_crop_06_tide_partial_negative.raw.json'),
      12: join(RESPONSES_DIR, 'pilot_crop_07_persil_sku_negative.raw.json')
    },
    auditedPilotSlotByOfferNumber: {
      1: 'pilot_crop_05_abu_kass',
      11: 'pilot_crop_06_tide_partial_negative',
      12: 'pilot_crop_07_persil_sku_negative'
    }
  },
  {
    leafletId: 'noori-jeddah-2026-11-15',
    pageNumber: 1,
    retailer: 'Noori Supermarket',
    retailerId: 'sm-noori-offline',
    offerStartDate: '2026-11-05',
    offerEndDate: '2026-11-15',
    pageSlotId: 'pilot_page_03_noori_p001',
    pageAssetPath: join(
      REPO_ROOT,
      'Extracts/noori-supermarket-229798534-jeddah/chunks/chunk-001-pages-001-001.pdf'
    ),
    pageImagePath: join(
      REPO_ROOT,
      'Extracts/noori-supermarket-229798534-jeddah/pages/page.1.png'
    ),
    savedCropFilesByOfferNumber: {
      2: join(RESPONSES_DIR, 'pilot_crop_08_fakieh_compound.raw.json'),
      7: join(RESPONSES_DIR, 'pilot_crop_10_wafir_conflict_negative.raw.json'),
      8: join(RESPONSES_DIR, 'pilot_crop_09_softy_arabic_only_bonus.raw.json')
    },
    auditedPilotSlotByOfferNumber: {
      2: 'pilot_crop_08_fakieh_compound',
      7: 'pilot_crop_10_wafir_conflict_negative',
      8: 'pilot_crop_09_softy_arabic_only_bonus'
    }
  },
  {
    leafletId: 'alwafa-city-jeddah-2026-10-20',
    pageNumber: 1,
    retailer: 'AlWafa',
    retailerId: 'sm-alwafa-offline',
    offerStartDate: '2026-10-14',
    offerEndDate: '2026-10-20',
    pageSlotId: 'pilot_page_04_alwafa_p001',
    pageAssetPath: join(REPO_ROOT, 'Extracts/Alwafa_Test/chunks/chunk-001-pages-001-001.pdf'),
    pageImagePath: join(REPO_ROOT, 'Extracts/Alwafa_Test/pages/page.1.png'),
    savedCropFilesByOfferNumber: {
      4: join(RESPONSES_DIR, 'pilot_crop_11_fakieh_multibuy_en_ar_conflict.raw.json')
    },
    auditedPilotSlotByOfferNumber: {
      4: 'pilot_crop_11_fakieh_multibuy_en_ar_conflict'
    }
  }
];

function computeBeforeAfterLedger() {
  const rE = JSON.parse(readFileSync(join(PILOT_DIR, 'evaluation_report.json'), 'utf8'));
  const rF = JSON.parse(readFileSync(join(PILOT_DIR, 'evaluation_report_005f.json'), 'utf8'));

  const summarize = (rep: any) => {
    let rawOfferCards = 0;
    let atomicTiersExtracted = 0;
    let decomposedParents = 0;
    let decomposedChildren = 0;
    let matchableChildren = 0;
    let distinctSkuCandidates = 0;
    let unsupportedOrIncompleteAssortments = 0;
    let unresolvedNonCatalogParents = 0;
    let quarantinedRecords = 0;
    let consumerEligibleRecords = 0;

    for (const p of rep.pageEvaluations) {
      atomicTiersExtracted = p.matchedAtomicOffersCount
        ? atomicTiersExtracted + p.matchedAtomicOffersCount
        : atomicTiersExtracted;
      for (const d of p.decompositions) {
        rawOfferCards++;
        if (d.decomposed || d.children_count > 0) {
          decomposedParents++;
          decomposedChildren += d.children_count;
          matchableChildren += d.matchable_children_count;
          distinctSkuCandidates += d.children_count;
        } else if (d.retention_mode === 'unsplit_single_sku') {
          distinctSkuCandidates += 1;
        } else if (d.retention_mode === 'unsplit_non_catalog_candidate') {
          unresolvedNonCatalogParents++;
        } else if (d.retention_mode === 'quarantined_do_not_publish') {
          quarantinedRecords++;
        }
        if (!d.is_enumerated_list_complete || d.assortment_status === 'visual_multiple_variants') {
          unsupportedOrIncompleteAssortments++;
        }
        if (d.active_context_eligible) {
          consumerEligibleRecords++;
        }
      }
    }
    return {
      rawOfferCards,
      atomicTiersMatchedToGt: atomicTiersExtracted,
      decomposedParents,
      decomposedChildren,
      matchableChildren,
      distinctSkuCandidates,
      unsupportedOrIncompleteAssortments,
      unresolvedNonCatalogParents,
      quarantinedRecords,
      consumerEligibleRecords
    };
  };

  return {
    baseline005e: summarize(rE),
    hardened005f: summarize(rF)
  };
}

async function runPass(options: {
  includeSyntheticAlwafaPageContext: boolean;
  enableIndependentP2Audit?: boolean;
  p2AuditSampleRate?: number;
  workDir: string;
}) {
  const bundles: Record<string, OfflineSavedPageBundle> = {};
  for (const p of PILOT_PAGES) {
    const key = `${p.leafletId}::p${p.pageNumber}`;
    bundles[key] = {
      pageSlotId: p.pageSlotId,
      rawPageFile: join(RESPONSES_DIR, `${p.pageSlotId}.raw.json`),
      savedCropFilesByOfferNumber: p.savedCropFilesByOfferNumber,
      ...(options.includeSyntheticAlwafaPageContext &&
      p.pageSlotId === 'pilot_page_04_alwafa_p001'
        ? {
            pageContextFixture: {
              verified: true,
              is_loyalty_page: true,
              loyalty_program_name: 'الوفاء Rewards',
              applies_to_all_page_offers: true,
              explicit_scope_evidence:
                '[SYNTHETIC_TEST_FIXTURE] Top header banner reads "الوفاء Rewards" across all page items',
              scope_proof_quote:
                '[SYNTHETIC_TEST_FIXTURE] Member exclusive pricing valid across items on this page',
              validity_start_date: '2026-10-14',
              validity_end_date: '2026-10-20',
              page_currency: 'SAR',
              page_wide_customer_limit_pcs: null,
              page_wide_exclusions: [],
              regional_scope: null,
              exception_offer_numbers: [],
              sourceRegionKind: 'page_header' as const
            }
          }
        : {})
    };
  }

  const provider = createOffline005eReplayProvider(bundles);
  const pageResults = [];

  for (const p of PILOT_PAGES) {
    const res = await runHybridPageWorkflow({
      executionContext: 'isolated_hybrid_workflow',
      explicitAuthorization: true,
      featureEnabled: true,
      runId: options.enableIndependentP2Audit
        ? 'wp7_eval_with_p2_audit'
        : options.includeSyntheticAlwafaPageContext
          ? 'wp6_eval_with_synthetic_ctx'
          : 'wp6_eval_saved_only',
      leafletId: p.leafletId,
      pageNumber: p.pageNumber,
      retailer: p.retailer,
      retailerId: p.retailerId,
      offerStartDate: p.offerStartDate,
      offerEndDate: p.offerEndDate,
      locationScope: 'national',
      pageAssetPath: p.pageAssetPath,
      pageImagePath: p.pageImagePath,
      cropOutputDir: join(options.workDir, 'crops'),
      checkpointPath: join(options.workDir, `${p.pageSlotId}.checkpoint.json`),
      budgetPolicy: {
        maxCropsPerPage: 15,
        maxSpendUsdPerPage: 0.15,
        maxSpendUsdPerJob: 0.60,
        allowP1WhenBudgetAllows: true,
        failClosedOnUnverifiedP0: true,
        enableIndependentP2Audit: Boolean(options.enableIndependentP2Audit),
        p2AuditSampleRate: options.p2AuditSampleRate ?? 0.25,
        p2AuditSeed: 'wp7_preflight_eval_v1'
      },
      auditedPilotSlotByOfferNumber: p.auditedPilotSlotByOfferNumber,
      provider
    });
    const safetyAudit = auditHybridSafetyInvariants(res);
    pageResults.push({ pageSlotId: p.pageSlotId, result: res, safetyAudit });
  }

  // Aggregate totals
  let totalSourceCards = 0;
  let totalP0 = 0;
  let totalP1 = 0;
  let totalP2 = 0;
  let cropsExecuted = 0;
  let cropsMissingArchive = 0;
  let totalDecomposedParents = 0;
  let totalDecomposedChildren = 0;
  let totalMatchableChildren = 0;
  let compoundTierCards = 0;
  let heldUnverifiedP0 = 0;
  let quarantinedCards = 0;
  let consumerEligibleCards = 0;
  let totalObservedCostUsd = 0;
  let totalObservedLatencyMs = 0;

  for (const { result } of pageResults) {
    totalSourceCards += result.totalSourceCards;
    totalP0 += result.p0FlaggedCount;
    totalP1 += result.p1FlaggedCount;
    totalP2 += result.p2NoCropCount;
    cropsExecuted += result.cropsExecutedCount;
    cropsMissingArchive += result.cropsFailedOrInvalidCount;
    totalDecomposedParents += result.summary.verifiedDecomposedParents;
    totalDecomposedChildren += result.summary.verifiedDecomposedChildren;
    totalMatchableChildren += result.summary.verifiedMatchableChildren;
    compoundTierCards += result.summary.compoundTierCardsEmitted;
    heldUnverifiedP0 += result.summary.heldUnverifiedP0Cards;
    quarantinedCards += result.summary.quarantinedCards;
    consumerEligibleCards += result.summary.consumerEligibleCards;
    totalObservedCostUsd += result.telemetry.totalEstimatedCostUsd;
    totalObservedLatencyMs += result.telemetry.totalLatencyMs;
  }

  const flaggedTotal = totalP0 + totalP1;
  const actualFlaggedPercent =
    totalSourceCards > 0
      ? Number(((flaggedTotal / totalSourceCards) * 100).toFixed(2))
      : 0;

  // Compute hypothetical full-hybrid cost/latency projections using 005E observed means
  const projectedHybridCost4PagesUsd = Number(
    (
      4 * PILOT_005E_TELEMETRY_BASELINE.meanPageCostUsd +
      flaggedTotal * PILOT_005E_TELEMETRY_BASELINE.meanCropCostUsd +
      pageResults.filter((x) => x.result.pageContextVerificationNeed.needsPageContextVerification).length *
        PILOT_005E_TELEMETRY_BASELINE.meanCropCostUsd
    ).toFixed(6)
  );
  const projectedHybridLatency4PagesSec = Number(
    (
      (4 * PILOT_005E_TELEMETRY_BASELINE.meanPageLatencyMs +
        flaggedTotal * PILOT_005E_TELEMETRY_BASELINE.meanCropLatencyMs) /
      1000
    ).toFixed(2)
  );

  const invariantViolationsCount = pageResults.reduce(
    (sum, x) => sum + x.safetyAudit.violations.length,
    0
  );
  const p2AuditEligibleCount = pageResults.reduce(
    (sum, x) => sum + x.result.p2AuditSummary.eligibleP2Count,
    0
  );
  const p2AuditSelectedCount = pageResults.reduce(
    (sum, x) => sum + x.result.p2AuditSummary.selectedAuditCount,
    0
  );

  return {
    totalSourceCards,
    totalP0,
    totalP1,
    totalP2,
    flaggedTotal,
    actualFlaggedPercent,
    cropsExecuted,
    cropsMissingArchive,
    totalDecomposedParents,
    totalDecomposedChildren,
    totalMatchableChildren,
    compoundTierCards,
    heldUnverifiedP0,
    quarantinedCards,
    consumerEligibleCards,
    invariantViolationsCount,
    p2AuditEligibleCount,
    p2AuditSelectedCount,
    totalObservedReplayCostUsd: Number(totalObservedCostUsd.toFixed(8)),
    totalObservedReplayLatencyMs: totalObservedLatencyMs,
    projectedHybridCost4PagesUsd,
    projectedHybridLatency4PagesSec,
    perPage: pageResults.map(({ pageSlotId, result, safetyAudit }) => ({
      pageSlotId,
      totalSourceCards: result.totalSourceCards,
      p0: result.p0FlaggedCount,
      p1: result.p1FlaggedCount,
      p2: result.p2NoCropCount,
      flaggedPercent: result.flaggedForCropRatePercent,
      cropsExecuted: result.cropsExecutedCount,
      cropsMissingArchive: result.cropsFailedOrInvalidCount,
      pageContextTriggers: result.pageContextVerificationNeed.triggerCodes,
      pageContextApplied: Boolean(result.pageContextApplied),
      p2AuditSummary: result.p2AuditSummary,
      safetyAuditPassed: safetyAudit.passed,
      loyaltyCardsCount: result.reconciledCards.filter(
        (c) => c.reconciledCard.quantity_and_promo.loyalty_required
      ).length,
      summary: result.summary,
      cards: result.reconciledCards.map((c) => ({
        sourceOfferId: c.sourceOfferId,
        offerNumber: c.offerNumber,
        priority: c.selectionDecision.priority,
        triggers: c.selectionDecision.triggerCodes,
        requiresCropVerificationForCatalogMatch: c.requiresCropVerificationForCatalogMatch,
        cropStatus: c.cropStatus,
        overallStatus: c.overallStatus,
        legacyOverallStatusAlias: c.legacyOverallStatusAlias,
        visionVerificationStatus: c.visionVerificationStatus,
        catalogVerificationStatus: c.catalogVerificationStatus,
        decomposed: c.decomposition.decomposed,
        childrenCount: c.decomposition.children.length,
        matchableChildrenCount: c.matchingAdapterSummary.matchableChildrenCount,
        eligibleForConsumerFeed: c.publicationAssessment.isEligibleForNonCatalogPublication,
        outcome: c.publicationAssessment.outcome,
        loyaltyRequired: c.reconciledCard.quantity_and_promo.loyalty_required,
        conflicts: c.reconciledCard.evidence_conflicts,
        fieldOutcomes: c.fieldDecisions.map((fd) => `${fd.field}:${fd.outcome}`),
        tierCompletenessUnresolved: c.tierCompletenessUnresolved
      }))
    }))
  };
}

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), 'wifran-wp6-eval-'));
  try {
    const ledger = computeBeforeAfterLedger();
    const passSavedOnly = await runPass({
      includeSyntheticAlwafaPageContext: false,
      workDir: join(workDir, 'saved-only')
    });
    const passWithSyntheticContext = await runPass({
      includeSyntheticAlwafaPageContext: true,
      workDir: join(workDir, 'with-ctx')
    });
    const passWithP2Audit = await runPass({
      includeSyntheticAlwafaPageContext: false,
      enableIndependentP2Audit: true,
      p2AuditSampleRate: 0.25,
      workDir: join(workDir, 'with-p2-audit')
    });

    const pMean = PILOT_005E_TELEMETRY_BASELINE.meanPageCostUsd;
    const cMean = PILOT_005E_TELEMETRY_BASELINE.meanCropCostUsd;
    const pLat = PILOT_005E_TELEMETRY_BASELINE.meanPageLatencyMs;
    const cLat = PILOT_005E_TELEMETRY_BASELINE.meanCropLatencyMs;
    const ctxPages = passSavedOnly.perPage.filter(
      (p) => p.pageContextTriggers.length > 0
    ).length;

    const fourModeComparison = {
      mode1_pageOnly: {
        requests: 4,
        estimatedCostUsd: Number((4 * pMean).toFixed(6)),
        estimatedLatencySec: Number(((4 * pLat) / 1000).toFixed(2)),
        notes: 'Fastest & cheapest, but misses Wafir conflict, Panda Sun Top / Moussy tiers, and AlWafa header loyalty.'
      },
      mode2_hybridP0P1: {
        requests: 4 + passSavedOnly.flaggedTotal + ctxPages,
        cardCrops: passSavedOnly.flaggedTotal,
        pageContextCrops: ctxPages,
        estimatedCostUsd: Number(
          (4 * pMean + (passSavedOnly.flaggedTotal + ctxPages) * cMean).toFixed(6)
        ),
        estimatedLatencySec: Number(
          ((4 * pLat + (passSavedOnly.flaggedTotal + ctxPages) * cLat) / 1000).toFixed(2)
        ),
        notes: 'Catches P0/P1 risks (including Wafir small monolingual bag) & header/footer terms while holding unresolved P0 fail-closed.'
      },
      mode3_hybridP0P1PlusP2Audit: {
        requests: 4 + passSavedOnly.flaggedTotal + ctxPages + passWithP2Audit.p2AuditSelectedCount,
        cardCrops: passSavedOnly.flaggedTotal,
        pageContextCrops: ctxPages,
        p2AuditCrops: passWithP2Audit.p2AuditSelectedCount,
        estimatedCostUsd: Number(
          (
            4 * pMean +
            (passSavedOnly.flaggedTotal + ctxPages + passWithP2Audit.p2AuditSelectedCount) * cMean
          ).toFixed(6)
        ),
        estimatedLatencySec: Number(
          (
            (4 * pLat +
              (passSavedOnly.flaggedTotal + ctxPages + passWithP2Audit.p2AuditSelectedCount) *
                cLat) /
            1000
          ).toFixed(2)
        ),
        notes: 'Adds stratified quality monitoring across clean P2 cards to measure ongoing false-negative rate.'
      },
      mode4_fullPerCardCropAll43: {
        requests: 4 + passSavedOnly.totalSourceCards + ctxPages,
        cardCrops: passSavedOnly.totalSourceCards,
        pageContextCrops: ctxPages,
        estimatedCostUsd: Number(
          (4 * pMean + (passSavedOnly.totalSourceCards + ctxPages) * cMean).toFixed(6)
        ),
        estimatedLatencySec: Number(
          ((4 * pLat + (passSavedOnly.totalSourceCards + ctxPages) * cLat) / 1000).toFixed(2)
        ),
        notes: 'Maximum visual coverage but unnecessary cost/latency for clean large/loose cards.'
      }
    };

    // Exact bounded Stage B candidate request manifest split into Stage B1 (smoke gate) + Stage B2 (remaining validation)
    // Combined hard envelope: <= 20 requests, <= $0.25 USD total (non-uniform cost/token estimates by request type).
    const COST_FULL_PAGE_USD = Number(pMean.toFixed(6)); // 0.021159 USD (005E 4-page observed mean)
    const COST_CARD_CROP_USD = 0.004763; // 005E 11 non-compound card crops observed mean
    const COST_COMPOUND_CROP_USD = 0.007468; // 005E observed compound card crop (pilot_crop_08_fakieh_compound)
    // Approximate page_context estimate: ~1,300 input (~450 text + ~850 header image), ~250 output, ~400 thinking @ flex rates
    const COST_PAGE_CONTEXT_USD = 0.001706;

    const PAGE_SOURCE_METADATA: Record<
      string,
      {
        leafletId: string;
        pageNumber: number;
        pdfChunkPath: string;
        imagePath: string;
        widthPx: number;
        heightPx: number;
      }
    > = {
      pilot_page_01_panda_p002: {
        leafletId: 'panda-national-national-2026-10-20',
        pageNumber: 2,
        pdfChunkPath: 'Extracts/Panda_Test/chunks/chunk-002-pages-002-002.pdf',
        imagePath: 'Extracts/Panda_Test/pages/page.2.png',
        widthPx: 2067,
        heightPx: 2923
      },
      pilot_page_02_bndw_p004: {
        leafletId: 'bin-dawood-national-national-2026-10-20',
        pageNumber: 4,
        pdfChunkPath: 'Extracts/BNDW_Test/chunks/chunk-004-pages-004-004.pdf',
        imagePath: 'Extracts/BNDW_Test/pages/page.4.png',
        widthPx: 2067,
        heightPx: 2923
      },
      pilot_page_03_noori_p001: {
        leafletId: 'noori-jeddah-2026-11-15',
        pageNumber: 1,
        pdfChunkPath: 'Extracts/noori-supermarket-229798534-jeddah/chunks/chunk-001-pages-001-001.pdf',
        imagePath: 'Extracts/noori-supermarket-229798534-jeddah/pages/page.1.png',
        widthPx: 2066,
        heightPx: 2923
      },
      pilot_page_04_alwafa_p001: {
        leafletId: 'alwafa-city-jeddah-2026-10-20',
        pageNumber: 1,
        pdfChunkPath: 'Extracts/Alwafa_Test/chunks/chunk-001-pages-001-001.pdf',
        imagePath: 'Extracts/Alwafa_Test/pages/page.1.png',
        widthPx: 2067,
        heightPx: 2923
      }
    };

    const unionBoxByOfferId = new Map<string, [number, number, number, number]>();
    for (const [slotId, meta] of Object.entries(PAGE_SOURCE_METADATA)) {
      const rawPage = JSON.parse(readFileSync(join(RESPONSES_DIR, `${slotId}.raw.json`), 'utf8'));
      const offers: any[] = rawPage?.parsedResponse?.offers || [];
      const prefix = `${meta.leafletId}_p${String(meta.pageNumber).padStart(3, '0')}`;
      for (const offer of offers) {
        const comp = offer?.components || {};
        const boxes: number[][] = [
          comp.product_graphic_box,
          comp.promo_price_box,
          comp.original_price_box,
          comp.title_text_box,
          comp.unit_and_size_badge_box
        ].filter((b): b is number[] => Array.isArray(b) && b.length === 4);
        if (boxes.length > 0) {
          const union: [number, number, number, number] = [
            Math.min(...boxes.map((b) => b[0])),
            Math.min(...boxes.map((b) => b[1])),
            Math.max(...boxes.map((b) => b[2])),
            Math.max(...boxes.map((b) => b[3]))
          ];
          const oid = `${prefix}_${String(offer.offer_number).padStart(3, '0')}`;
          unionBoxByOfferId.set(oid, union);
        }
      }
    }
    const computeBoxDims = (
      box: [number, number, number, number] | null | undefined,
      pageW: number,
      pageH: number,
      paddingPct: number
    ) => {
      if (!box) return { cropWidthPx: pageW, cropHeightPx: pageH };
      const [ymin, xmin, ymax, xmax] = box;
      const rawW = ((xmax - xmin) / 1000) * pageW;
      const rawH = ((ymax - ymin) / 1000) * pageH;
      const padFactor = 1 + (paddingPct / 100) * 2;
      return {
        cropWidthPx: Math.min(pageW, Math.round(rawW * padFactor)),
        cropHeightPx: Math.min(pageH, Math.round(rawH * padFactor))
      };
    };

    type StageBRequestItem = {
      requestId: string;
      stage: 'B1_smoke_gate' | 'B2_remaining_validation';
      requestType: 'full_page' | 'page_context' | 'card_crop' | 'compound_card_crop' | 'p2_audit';
      pageSlotId: string;
      leafletId: string;
      pageNumber: number;
      sourceOfferId: string;
      priority: 'P0' | 'P1' | 'P2';
      triggers: string[];
      sourceImagePath: string;
      pdfChunkPath: string;
      sourceImageWidthPx: number;
      sourceImageHeightPx: number;
      sourceBoxNormalized: [number, number, number, number];
      cropWidthPx: number;
      cropHeightPx: number;
      cropPaddingPercent: number;
      promptVersion: string;
      schemaVersion: string;
      cacheStatus: 'cache_miss_prompt_version_changed' | 'cache_miss_unexecuted';
      estimatedTokens: {
        input: number;
        output: number;
        thinking: number;
        estimateBasis: string;
      };
      estimatedCostUsd: number;
    };

    const makeFullPageRequest = (
      requestId: string,
      stage: 'B1_smoke_gate' | 'B2_remaining_validation',
      pageSlotId: string
    ): StageBRequestItem => {
      const meta = PAGE_SOURCE_METADATA[pageSlotId];
      return {
        requestId,
        stage,
        requestType: 'full_page',
        pageSlotId,
        leafletId: meta.leafletId,
        pageNumber: meta.pageNumber,
        sourceOfferId: `${meta.leafletId}_p${String(meta.pageNumber).padStart(3, '0')}_full_page`,
        priority: 'P0',
        triggers: ['STAGE2_R1_PROMPT_LIVE_FULL_PAGE_VALIDATION'],
        sourceImagePath: meta.imagePath,
        pdfChunkPath: meta.pdfChunkPath,
        sourceImageWidthPx: meta.widthPx,
        sourceImageHeightPx: meta.heightPx,
        sourceBoxNormalized: [0, 0, 1000, 1000],
        cropWidthPx: meta.widthPx,
        cropHeightPx: meta.heightPx,
        cropPaddingPercent: 0,
        promptVersion: 'extraction_v3_stage2_r1',
        schemaVersion: 'wifran.extractor.card/3.0',
        cacheStatus: 'cache_miss_prompt_version_changed',
        estimatedTokens: {
          input: 4605,
          output: 9220,
          thinking: 1144,
          estimateBasis: '005E 4-page observed mean (flex tier); prompt updated stage1_r1 -> stage2_r1'
        },
        estimatedCostUsd: COST_FULL_PAGE_USD
      };
    };

    const makePageContextRequest = (
      requestId: string,
      stage: 'B1_smoke_gate' | 'B2_remaining_validation',
      pageSlotId: string,
      triggers: string[]
    ): StageBRequestItem => {
      const meta = PAGE_SOURCE_METADATA[pageSlotId];
      const box: [number, number, number, number] = [0, 0, 210, 1000];
      const dims = computeBoxDims(box, meta.widthPx, meta.heightPx, 0);
      return {
        requestId,
        stage,
        requestType: 'page_context',
        pageSlotId,
        leafletId: meta.leafletId,
        pageNumber: meta.pageNumber,
        sourceOfferId: `${pageSlotId}_header_footer`,
        priority: 'P0',
        triggers,
        sourceImagePath: meta.imagePath,
        pdfChunkPath: meta.pdfChunkPath,
        sourceImageWidthPx: meta.widthPx,
        sourceImageHeightPx: meta.heightPx,
        sourceBoxNormalized: box,
        cropWidthPx: dims.cropWidthPx,
        cropHeightPx: dims.cropHeightPx,
        cropPaddingPercent: 0,
        promptVersion: 'extraction_v3_stage2_r1:page_context',
        schemaVersion: 'wifran.extractor.card/3.0:page_context',
        cacheStatus: 'cache_miss_unexecuted',
        estimatedTokens: {
          input: 1300,
          output: 250,
          thinking: 400,
          estimateBasis: 'Approximate compact 13-field header/footer schema + [0,0,210,1000] header crop'
        },
        estimatedCostUsd: COST_PAGE_CONTEXT_USD
      };
    };

    const makeCardCropRequest = (
      requestId: string,
      stage: 'B1_smoke_gate' | 'B2_remaining_validation',
      pageSlotId: string,
      sourceOfferId: string,
      priority: 'P0' | 'P1' | 'P2',
      triggers: string[],
      forceType?: 'p2_audit'
    ): StageBRequestItem => {
      const meta = PAGE_SOURCE_METADATA[pageSlotId];
      const box = (unionBoxByOfferId.get(sourceOfferId) || [0, 0, 1000, 1000]) as [
        number,
        number,
        number,
        number
      ];
      const paddingPct = 8;
      const dims = computeBoxDims(box, meta.widthPx, meta.heightPx, paddingPct);
      const isCompound =
        forceType !== 'p2_audit' && triggers.includes('COMPOUND_MULTI_TIER_OR_UNPAIRED_WEIGHT');
      const requestType: StageBRequestItem['requestType'] =
        forceType === 'p2_audit' ? 'p2_audit' : isCompound ? 'compound_card_crop' : 'card_crop';
      return {
        requestId,
        stage,
        requestType,
        pageSlotId,
        leafletId: meta.leafletId,
        pageNumber: meta.pageNumber,
        sourceOfferId,
        priority,
        triggers,
        sourceImagePath: meta.imagePath,
        pdfChunkPath: meta.pdfChunkPath,
        sourceImageWidthPx: meta.widthPx,
        sourceImageHeightPx: meta.heightPx,
        sourceBoxNormalized: box,
        cropWidthPx: dims.cropWidthPx,
        cropHeightPx: dims.cropHeightPx,
        cropPaddingPercent: paddingPct,
        promptVersion: 'extraction_v3_stage2_r1',
        schemaVersion: 'wifran.extractor.card/3.0',
        cacheStatus: 'cache_miss_unexecuted',
        estimatedTokens: isCompound
          ? {
              input: 5121,
              output: 1626,
              thinking: 1333,
              estimateBasis: '005E observed compound card crop (pilot_crop_08_fakieh_compound)'
            }
          : {
              input: 5134,
              output: 903,
              thinking: 608,
              estimateBasis: '005E 11 non-compound card crops observed mean (flex tier)'
            },
        estimatedCostUsd: isCompound ? COST_COMPOUND_CROP_USD : COST_CARD_CROP_USD
      };
    };

    const pageCtxBySlot = new Map(
      passSavedOnly.perPage.map((p) => [p.pageSlotId, p.pageContextTriggers])
    );
    const cardLookup = new Map(
      passSavedOnly.perPage.flatMap((p) =>
        p.cards.map((c) => [c.sourceOfferId, { pageSlotId: p.pageSlotId, card: c }] as const)
      )
    );

    // Stage B1: Minimal live smoke gate (4 requests) through runHybridPageWorkflow on Panda Page 2
    const stageB1Requests: StageBRequestItem[] = [
      makeFullPageRequest('B1-REQ-01', 'B1_smoke_gate', 'pilot_page_01_panda_p002'),
      makePageContextRequest(
        'B1-REQ-02',
        'B1_smoke_gate',
        'pilot_page_01_panda_p002',
        pageCtxBySlot.get('pilot_page_01_panda_p002') || ['PAGE_WIDE_LOYALTY_SUSPECTED_OR_MISSING']
      ),
      makeCardCropRequest(
        'B1-REQ-03',
        'B1_smoke_gate',
        'pilot_page_01_panda_p002',
        'panda-national-national-2026-10-20_p002_007',
        'P0',
        cardLookup.get('panda-national-national-2026-10-20_p002_007')?.card.triggers || []
      ),
      makeCardCropRequest(
        'B1-REQ-04',
        'B1_smoke_gate',
        'pilot_page_01_panda_p002',
        'panda-national-national-2026-10-20_p002_004',
        'P0',
        cardLookup.get('panda-national-national-2026-10-20_p002_004')?.card.triggers || []
      )
    ];

    // Stage B2: Remaining bounded validation (16 requests, requires explicit post-B1 authorization)
    const remainingP0Ids = passSavedOnly.perPage
      .flatMap((p) =>
        p.cards
          .filter(
            (c) =>
              c.priority === 'P0' &&
              c.cropStatus === 'missing_offline_archive' &&
              c.sourceOfferId !== 'panda-national-national-2026-10-20_p002_007' &&
              c.sourceOfferId !== 'panda-national-national-2026-10-20_p002_004'
          )
          .map((c) => ({
            pageSlotId: p.pageSlotId,
            sourceOfferId: c.sourceOfferId,
            triggers: c.triggers
          }))
      );

    let b2Seq = 1;
    const nextB2Id = () => `B2-REQ-${String(b2Seq++).padStart(2, '0')}`;
    const stageB2Requests: StageBRequestItem[] = [
      makeFullPageRequest(nextB2Id(), 'B2_remaining_validation', 'pilot_page_04_alwafa_p001'),
      makePageContextRequest(
        nextB2Id(),
        'B2_remaining_validation',
        'pilot_page_02_bndw_p004',
        pageCtxBySlot.get('pilot_page_02_bndw_p004') || ['PAGE_WIDE_LOYALTY_SUSPECTED_OR_MISSING']
      ),
      makePageContextRequest(
        nextB2Id(),
        'B2_remaining_validation',
        'pilot_page_03_noori_p001',
        pageCtxBySlot.get('pilot_page_03_noori_p001') || ['PAGE_WIDE_LOYALTY_SUSPECTED_OR_MISSING']
      ),
      makePageContextRequest(
        nextB2Id(),
        'B2_remaining_validation',
        'pilot_page_04_alwafa_p001',
        pageCtxBySlot.get('pilot_page_04_alwafa_p001') || ['PAGE_WIDE_LOYALTY_SUSPECTED_OR_MISSING']
      ),
      ...remainingP0Ids.map((item) =>
        makeCardCropRequest(
          nextB2Id(),
          'B2_remaining_validation',
          item.pageSlotId,
          item.sourceOfferId,
          'P0',
          item.triggers
        )
      ),
      makeCardCropRequest(
        nextB2Id(),
        'B2_remaining_validation',
        'pilot_page_02_bndw_p004',
        'bin-dawood-national-national-2026-10-20_p004_009',
        'P2',
        ['INDEPENDENT_P2_QUALITY_AUDIT'],
        'p2_audit'
      )
    ];

    const stageBBoundedRequests = [...stageB1Requests, ...stageB2Requests];
    const stageB1EstimatedUsd = Number(
      stageB1Requests.reduce((s, r) => s + r.estimatedCostUsd, 0).toFixed(6)
    );
    const stageB2EstimatedUsd = Number(
      stageB2Requests.reduce((s, r) => s + r.estimatedCostUsd, 0).toFixed(6)
    );
    const stageBEstimatedTotalUsd = Number(
      (stageB1EstimatedUsd + stageB2EstimatedUsd).toFixed(6)
    );

    const remainingUnselectedMissingP1Count = passSavedOnly.perPage.reduce(
      (sum, p) =>
        sum +
        p.cards.filter((c) => c.priority === 'P1' && c.cropStatus === 'missing_offline_archive')
          .length,
      0
    );

    const report = {
      generatedAt: new Date().toISOString(),
      mode: 'STRICT_OFFLINE_ZERO_PAID_CALLS_ZERO_DB_WRITES',
      preliminaryAudit43CellLedger: ledger,
      passA_saved005eReplayOnly: passSavedOnly,
      passB_saved005ePlusSyntheticHeaderContext: passWithSyntheticContext,
      passC_withIndependentP2Audit: passWithP2Audit,
      fourModeComparison,
      stageBCandidateManifest: {
        hardCapRequests: 20,
        hardCapSpendUsd: 0.25,
        stageB1: {
          gateName: 'Minimal Live Smoke Gate (Panda Page 2 via runHybridPageWorkflow)',
          hardCapRequests: 4,
          hardCapSpendUsd: 0.05,
          requestCount: stageB1Requests.length,
          estimatedTotalCostUsd: stageB1EstimatedUsd,
          withinStageB1Cap: stageB1Requests.length <= 4 && stageB1EstimatedUsd <= 0.05
        },
        stageB2: {
          gateName: 'Remaining Bounded Validation (Separate Authorization After B1 Pass)',
          hardCapRequests: 16,
          requestCount: stageB2Requests.length,
          estimatedTotalCostUsd: stageB2EstimatedUsd,
          requiresStageB1SignOff: true
        },
        totalUnboundedMissingCandidatesPlusContextAndP2Audit:
          2 + 4 + 2 + remainingP0Ids.length + remainingUnselectedMissingP1Count + 4,
        selectedBoundedCount: stageBBoundedRequests.length,
        estimatedTotalCostUsd: stageBEstimatedTotalUsd,
        withinCap: stageBBoundedRequests.length <= 20 && stageBEstimatedTotalUsd <= 0.25,
        requests: stageBBoundedRequests
      }
    };

    const outPath = join(PILOT_DIR, 'evaluation_report_wp7_005h.json');
    writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

    console.log('=== WP7 STAGE-A OFFLINE EVALUATION COMPLETE ===');
    console.log('Output written:', outPath);
    console.log('43-Cell Ledger (005E -> 005F):', JSON.stringify(ledger));
    console.log(
      'Pass A (Saved 005E Replay Only):',
      JSON.stringify({
        totalSourceCards: passSavedOnly.totalSourceCards,
        p0: passSavedOnly.totalP0,
        p1: passSavedOnly.totalP1,
        p2: passSavedOnly.totalP2,
        flaggedRatePct: passSavedOnly.actualFlaggedPercent,
        cropsExecuted: passSavedOnly.cropsExecuted,
        cropsMissingArchive: passSavedOnly.cropsMissingArchive,
        decomposedParents: passSavedOnly.totalDecomposedParents,
        decomposedChildren: passSavedOnly.totalDecomposedChildren,
        matchableChildren: passSavedOnly.totalMatchableChildren,
        compoundTierCards: passSavedOnly.compoundTierCards,
        heldUnverifiedP0: passSavedOnly.heldUnverifiedP0,
        quarantinedCards: passSavedOnly.quarantinedCards,
        invariantViolations: passSavedOnly.invariantViolationsCount,
        projectedCost4PagesUsd: passSavedOnly.projectedHybridCost4PagesUsd
      })
    );
    console.log(
      'Pass B (Saved + Synthetic AlWafa Header Fixture):',
      JSON.stringify({
        alwafaLoyaltyCardsPassA: passSavedOnly.perPage[3]?.loyaltyCardsCount,
        alwafaLoyaltyCardsPassB: passWithSyntheticContext.perPage[3]?.loyaltyCardsCount
      })
    );
    console.log(
      'Pass C (With Independent P2 Quality Audit):',
      JSON.stringify({
        p2Eligible: passWithP2Audit.p2AuditEligibleCount,
        p2AuditSelected: passWithP2Audit.p2AuditSelectedCount,
        invariantViolations: passWithP2Audit.invariantViolationsCount
      })
    );
    console.log('Four-Mode Comparison:', JSON.stringify(fourModeComparison));
    console.log(
      'Stage B Candidate Summary:',
      JSON.stringify({
        selectedBoundedCount: report.stageBCandidateManifest.selectedBoundedCount,
        totalUnboundedCandidates: report.stageBCandidateManifest.totalUnboundedCandidates,
        estimatedTotalCostUsd: report.stageBCandidateManifest.estimatedTotalCostUsd,
        withinCap: report.stageBCandidateManifest.withinCap
      })
    );
    console.log('\nPer-card selection & reconciliation summary (Pass A):');
    for (const p of passSavedOnly.perPage) {
      console.log(
        `PAGE ${p.pageSlotId} (${p.totalSourceCards} cards | P0=${p.p0}, P1=${p.p1}, P2=${p.p2} | flagged=${p.flaggedPercent}% | ctxTriggers=${p.pageContextTriggers.join(',')})`
      );
      for (const c of p.cards) {
        console.log(
          `  - ${c.sourceOfferId} [${c.priority}] crop=${c.cropStatus} -> ${c.overallStatus} (cat=${c.catalogVerificationStatus}, pub=${c.outcome}/${c.eligibleForConsumerFeed}, loy=${c.loyaltyRequired}, children=${c.childrenCount}, conflicts=${c.conflicts.join(',')})`
        );
      }
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
