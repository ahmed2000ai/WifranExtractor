/**
 * WIFRAN-EXTRACTOR-IDENTITY-005G (WP6-A & WP6-G)
 * Hybrid Page-First -> Selective Crop -> Evidence Reconciliation Orchestrator.
 *
 * Strictly isolated behind disabled-by-default feature flags (`enabledByDefault = false`),
 * injectable `HybridExtractionProvider` (zero live Gemini/Vertex SDK calls here),
 * deterministic fingerprint cache reuse, durable checkpoint/resume, and WP1-WP5F
 * publication & matching safety re-evaluation. Never writes to Supabase (`databaseWritesEnabled: false`).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type { OfferContractV3Record } from '../../../shared/types/extractorContractV3';
import type {
  GeminiUsageLedgerEntry,
  GeminiUsageOutcome,
  GeminiUsageStageCategory
} from '../../../shared/types/costAccounting';
import {
  HYBRID_EXTRACTION_DEFAULT_FLAGS,
  type CardCropSelectionDecision,
  type CropLineageMetadata,
  type HybridBudgetPolicy,
  type HybridCheckpointState,
  type HybridExecutionContext,
  type HybridExtractionProvider,
  type HybridExtractionProviderResponse,
  type HybridP2AuditSummary,
  type HybridPageRunResult,
  type PageContextVerificationEvidence,
  type ReconciledV3CardResult,
  type V3RawComponentBoxes
} from '../../../shared/types/hybridExtractionV3';
import {
  V3_EXTRACTION_SCHEMA_VERSION,
  decodeV3PageExtractionToOfferCards,
  getV3LeafletPageGenAiSchema,
  type V3PageDecodeContext
} from '../../../shared/schemas/leafletPageExtractionV3Schema';
import { buildLedgerEntryFromProviderCall } from '../geminiCostLedgerService';
import { GeminiExtractionCacheService } from '../geminiExtractionCacheService';
import {
  V3_PROMPT_VERSION,
  buildV3PageExtractionSystemPrompt
} from '../geminiV3PromptBuilder';
import {
  assessPageContextVerificationNeed,
  evaluateCardForCropVerification,
  markDecisionAsIndependentP2Audit,
  selectIndependentP2AuditSample
} from './hybridCropSelector';
import { findPilotCropProvenanceBySlotId } from './pilotCropProvenanceLedger';
import { generateHybridRegionCrop } from './hybridCropGenerator';
import { applyScopedPageContextToCards } from './hybridPageContextVerifier';
import { reconcilePageAndCropCards } from './hybridEvidenceReconciler';
import {
  DEFAULT_HYBRID_BUDGET_POLICY,
  HybridCostLatencyGovernor
} from './hybridCostLatencyGovernor';
import {
  resolveLeafletDateMetadata,
  type ManifestOfferDates
} from './leafletDateMetadata';

export interface HybridResponseCacheStore {
  get(cacheKey: string): HybridExtractionProviderResponse | null;
  set(cacheKey: string, response: HybridExtractionProviderResponse): void;
}

export class InMemoryHybridCacheStore implements HybridResponseCacheStore {
  private readonly entries = new Map<string, HybridExtractionProviderResponse>();
  get(cacheKey: string): HybridExtractionProviderResponse | null {
    return this.entries.get(cacheKey) || null;
  }
  set(cacheKey: string, response: HybridExtractionProviderResponse): void {
    this.entries.set(cacheKey, response);
  }
  size(): number {
    return this.entries.size;
  }
}

export interface RunHybridPageExtractionInput {
  executionContext: HybridExecutionContext;
  explicitAuthorization: boolean;
  featureEnabled?: boolean;
  runId: string;
  batchId?: string;
  ledgerSessionRunId?: string;
  onLedgerEntry?: (entry: GeminiUsageLedgerEntry) => void;
  enableBoundedMaxTokensRecovery?: boolean;
  /**
   * Diagnostic B2 crop-verification flag (defaults to false).
   * Routine extractions strictly bypass B2 crop-analysis requests.
   */
  enableDiagnosticB2CropVerification?: boolean;
  leafletId: string;
  pageNumber: number;
  retailer: string;
  retailerId?: string | null;
  offerStartDate?: string | null;
  offerEndDate?: string | null;
  locationScope?: 'national' | 'region' | 'city' | null;
  pageAssetPath: string;
  pageImagePath: string;
  cropOutputDir: string;
  checkpointPath?: string;
  dryRunGeometryOnly?: boolean;
  budgetPolicy?: Partial<HybridBudgetPolicy>;
  governor?: HybridCostLatencyGovernor;
  provider: HybridExtractionProvider;
  cacheStore?: HybridResponseCacheStore;
  interruptAfterCropsCount?: number; // Allows offline deterministic interruption/resume testing
  /**
   * Optional explicit mapping from offer number -> historical 005E manifest slotId
   * so offline replay verifies provenance cryptographically without filename guessing.
   */
  auditedPilotSlotByOfferNumber?: Record<number, string>;
  /**
   * Optional workflow-planning crop allowlist (used by bounded live validation gates like 005H-B1).
   * Cards outside this list are STILL evaluated/flagged in selection decisions, but are blocked
   * at planning time (`skipped_budget`) without invoking `provider.extractCardCrop`.
   */
  allowedCropSourceOfferIds?: string[];
  /**
   * Optional guard restricting page_context verification strictly to the approved `[0, 0, 210, 1000]`
   * page_header box and permitting execution when explicitly authorized for smoke testing.
   */
  forceAllowlistedPageContext?: boolean;
  /**
   * Simplified leaflet date metadata sources (`manifest.json` `offer_dates` or verified cover page).
   * Folder names / slugs are never parsed for dates.
   */
  manifestPath?: string | null;
  manifestOfferDates?: ManifestOfferDates | null;
  isVerifiedCoverPage?: boolean;
  /**
   * Optional switch for core-extraction workflows that skip paid page-header/loyalty context calls.
   */
  disablePageContextVerification?: boolean;
  /**
   * When true, enforces live consumer expiry against `publicationReferenceDateIso` (`EXPIRED_OFFER_DATES`).
   * Keep false/omitted for isolated historical accuracy evaluations.
   */
  enforceNonExpiredForPublication?: boolean;
  publicationReferenceDateIso?: string | null;
}

function loadCheckpoint(path?: string): HybridCheckpointState | null {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as HybridCheckpointState;
  } catch {
    return null;
  }
}

function saveCheckpointAtomic(path: string | undefined, state: HybridCheckpointState): void {
  if (!path) return;
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  renameSync(tmp, path);
}

function clamp01000(v: number): number {
  return Math.max(0, Math.min(1000, Math.round(v)));
}

export function remapHalfNormalizedBoxToFullPage(
  box: number[] | null | undefined,
  regionBox: [number, number, number, number]
): [number, number, number, number] | null {
  if (!Array.isArray(box) || box.length !== 4 || box.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    return null;
  }
  const [ry1, rx1, ry2, rx2] = regionBox;
  const rH = ry2 - ry1;
  const rW = rx2 - rx1;
  const [y1, x1, y2, x2] = box;
  return [
    clamp01000(ry1 + (y1 / 1000) * rH),
    clamp01000(rx1 + (x1 / 1000) * rW),
    clamp01000(ry1 + (y2 / 1000) * rH),
    clamp01000(rx1 + (x2 / 1000) * rW)
  ];
}

function remapComponentBoxes(
  boxes: Record<string, any> | null | undefined,
  regionBox: [number, number, number, number]
): Record<string, any> | undefined {
  if (!boxes || typeof boxes !== 'object') return boxes ?? undefined;
  const out: Record<string, any> = { ...boxes };
  for (const [k, v] of Object.entries(boxes)) {
    if (Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number')) {
      out[k] = remapHalfNormalizedBoxToFullPage(v, regionBox);
    }
  }
  return out;
}

export function remapHalfOfferToFullPage(
  rawOffer: Record<string, any>,
  regionBox: [number, number, number, number]
): Record<string, any> {
  const cloned: Record<string, any> = { ...rawOffer };
  if (Array.isArray(cloned.bounding_box)) {
    cloned.bounding_box = remapHalfNormalizedBoxToFullPage(cloned.bounding_box, regionBox);
  }
  if (cloned.components) {
    cloned.components = remapComponentBoxes(cloned.components, regionBox);
  }
  if (cloned.component_boxes) {
    cloned.component_boxes = remapComponentBoxes(cloned.component_boxes, regionBox);
  }
  if (Array.isArray(cloned.sub_items)) {
    cloned.sub_items = cloned.sub_items.map((sub: any) => ({
      ...sub,
      ...(sub?.components ? { components: remapComponentBoxes(sub.components, regionBox) } : {}),
      ...(Array.isArray(sub?.bounding_box)
        ? { bounding_box: remapHalfNormalizedBoxToFullPage(sub.bounding_box, regionBox) }
        : {})
    }));
  }
  return cloned;
}

export function computeNormalizedBoxIoU(
  a: number[] | null | undefined,
  b: number[] | null | undefined
): number {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 4 || b.length !== 4) return 0;
  const iy1 = Math.max(a[0], b[0]);
  const ix1 = Math.max(a[1], b[1]);
  const iy2 = Math.min(a[2], b[2]);
  const ix2 = Math.min(a[3], b[3]);
  if (iy2 <= iy1 || ix2 <= ix1) return 0;
  const inter = (iy2 - iy1) * (ix2 - ix1);
  const areaA = Math.max(1, (a[2] - a[0]) * (a[3] - a[1]));
  const areaB = Math.max(1, (b[2] - b[0]) * (b[3] - b[1]));
  return inter / Math.max(1, areaA + areaB - inter);
}

function getOfferPrimaryBox(offer: Record<string, any>): number[] | null {
  const c = offer?.components || offer?.component_boxes;
  if (Array.isArray(c?.offer_card_box) && c.offer_card_box.length === 4) return c.offer_card_box;
  if (Array.isArray(c?.offer_card) && c.offer_card.length === 4) return c.offer_card;
  if (Array.isArray(c?.product_graphic_box) && c.product_graphic_box.length === 4) return c.product_graphic_box;
  if (Array.isArray(c?.product_graphic) && c.product_graphic.length === 4) return c.product_graphic;
  if (Array.isArray(offer?.bounding_box) && offer.bounding_box.length === 4) return offer.bounding_box;
  return null;
}

function normalizeTextForDedup(v: unknown): string {
  return String(v || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function computeHalfSafetyMarginScore(
  offer: Record<string, any>,
  half: 'top' | 'bottom',
  topCut = 540,
  bottomCut = 460
): number {
  const box = getOfferPrimaryBox(offer);
  if (!box) return 0;
  const centerY = (box[0] + box[2]) / 2;
  // Gemini native normalized box format: [ymin, xmin, ymax, xmax] in 0..1000 space.
  // Top half covers [0..topCut]; bottom half covers [bottomCut..1000] across full width (xmin=0, xmax=1000).
  const distFromCut = half === 'top' ? topCut - box[2] : box[0] - bottomCut;
  const centerBonus = half === 'top' ? (centerY < 500 ? 10 : 0) : centerY > 500 ? 10 : 0;
  return distFromCut + centerBonus;
}

/**
 * Merges raw extraction outputs from top and bottom MAX_TOKENS recovery split regions.
 *
 * COORDINATE CONVENTION:
 * Bounding boxes are strictly in Gemini native `[ymin, xmin, ymax, xmax]` normalized format (0..1000 space):
 * - Index 0: ymin (vertical coordinate from top)
 * - Index 1: xmin (horizontal coordinate from left)
 * - Index 2: ymax (vertical coordinate to bottom)
 * - Index 3: xmax (horizontal coordinate to right)
 *
 * Therefore:
 * - `topRegionBox: [0, 0, 540, 1000]` spans y=0..540 (top 54% height) and x=0..1000 (100% full width) -> horizontal TOP HALF.
 * - `bottomRegionBox: [460, 0, 1000, 1000]` spans y=460..1000 (bottom 54% height) and x=0..1000 (100% full width) -> horizontal BOTTOM HALF.
 *
 * (Note: in external systems using `xyxy` ([xmin, ymin, xmax, ymax]), these would be left/right columns;
 * in Wifran and Gemini, coordinate 0 is vertical, so the physical crops are horizontal top and bottom slices.)
 *
 * STRADDLING OFFERS & OVERLAP DEDUPLICATION:
 * Offers in the overlapping band (Y in [460..540], such as Al Nokhbah Page 1 Offers 5-8 at Y=[465..595])
 * are extracted with safety margins. Overlapping candidates are matched via IoU (>= 0.45, or >= 0.22 with
 * identical promo price and title). The candidate with the larger safety margin from its cut boundary is selected,
 * guaranteeing no straddling offers are lost, truncated, or duplicated.
 */
export function mergeRecoveredHalfRawExtractions(
  topRaw: Record<string, any>,
  bottomRaw: Record<string, any>,
  topRegionBox: [number, number, number, number] = [0, 0, 540, 1000],
  bottomRegionBox: [number, number, number, number] = [460, 0, 1000, 1000]
): Record<string, any> {
  const topOffers: Record<string, any>[] = Array.isArray(topRaw?.offers)
    ? topRaw.offers.map((o: any) => remapHalfOfferToFullPage(o, topRegionBox))
    : [];
  const bottomOffers: Record<string, any>[] = Array.isArray(bottomRaw?.offers)
    ? bottomRaw.offers.map((o: any) => remapHalfOfferToFullPage(o, bottomRegionBox))
    : [];

  const merged: Record<string, any>[] = [...topOffers];
  const matchedTopIdx = new Set<number>();

  for (const bOffer of bottomOffers) {
    const bBox = getOfferPrimaryBox(bOffer);
    const bPrice = typeof bOffer?.promo_price === 'number' ? bOffer.promo_price : Number(bOffer?.promo_price);
    const bTitle = normalizeTextForDedup(`${bOffer?.brand_name || bOffer?.brand || ''} ${bOffer?.title_en || bOffer?.english_title || ''} ${bOffer?.title_ar || bOffer?.arabic_title || ''}`);

    let duplicateIdx = -1;
    for (let i = 0; i < merged.length; i++) {
      if (matchedTopIdx.has(i)) continue;
      const tOffer = merged[i];
      const tBox = getOfferPrimaryBox(tOffer);
      const iou = computeNormalizedBoxIoU(tBox, bBox);
      if (iou >= 0.45) {
        duplicateIdx = i;
        break;
      }
      if (iou >= 0.22) {
        const tPrice = typeof tOffer?.promo_price === 'number' ? tOffer.promo_price : Number(tOffer?.promo_price);
        const samePrice = Number.isFinite(tPrice) && Number.isFinite(bPrice) && Math.abs(tPrice - bPrice) < 0.01;
        const tTitle = normalizeTextForDedup(`${tOffer?.brand_name || tOffer?.brand || ''} ${tOffer?.title_en || tOffer?.english_title || ''} ${tOffer?.title_ar || tOffer?.arabic_title || ''}`);
        const sameTitle = tTitle.length > 0 && bTitle.length > 0 && (tTitle === bTitle || tTitle.includes(bTitle) || bTitle.includes(tTitle));
        if (samePrice && sameTitle) {
          duplicateIdx = i;
          break;
        }
      }
    }

    if (duplicateIdx >= 0) {
      matchedTopIdx.add(duplicateIdx);
      const topScore = computeHalfSafetyMarginScore(merged[duplicateIdx], 'top', topRegionBox[2], bottomRegionBox[0]);
      const bottomScore = computeHalfSafetyMarginScore(bOffer, 'bottom', topRegionBox[2], bottomRegionBox[0]);
      if (bottomScore > topScore) {
        merged[duplicateIdx] = bOffer;
      }
    } else {
      merged.push(bOffer);
    }
  }

  const renumbered = merged.map((o, idx) => ({
    ...o,
    offer_number: idx + 1
  }));

  const ignoredBanners = Array.from(
    new Set([
      ...(Array.isArray(topRaw?.ignored_banners) ? topRaw.ignored_banners : []),
      ...(Array.isArray(bottomRaw?.ignored_banners) ? bottomRaw.ignored_banners : [])
    ])
  );

  return {
    ...(topRaw || {}),
    ...(bottomRaw || {}),
    validity_start_date: topRaw?.validity_start_date || bottomRaw?.validity_start_date || null,
    validity_end_date: topRaw?.validity_end_date || bottomRaw?.validity_end_date || null,
    page_currency: topRaw?.page_currency || bottomRaw?.page_currency || null,
    is_loyalty_page: Boolean(topRaw?.is_loyalty_page || bottomRaw?.is_loyalty_page),
    loyalty_program_name: topRaw?.loyalty_program_name || bottomRaw?.loyalty_program_name || null,
    ignored_banners: ignoredBanners,
    offers: renumbered
  };
}

function isMaxTokensOrTruncatedPageFailure(res: HybridExtractionProviderResponse): boolean {
  if (res.ok) return false;
  if (res.finishReason === 'MAX_TOKENS') return true;
  const hay = `${res.errorCode || ''} ${res.errorMessage || ''}`;
  return /MAX_TOKENS|truncated|unterminated/i.test(hay);
}

function parseProviderJson(res: HybridExtractionProviderResponse): unknown {
  if (res.parsedJson !== undefined) return res.parsedJson;
  if (res.rawText) {
    return JSON.parse(res.rawText);
  }
  throw new Error('Provider response contained neither parsedJson nor rawText.');
}

function buildDecodeContext(
  leafletId: string,
  pageNumber: number,
  sourceOfferIdPrefix: string,
  retailer: string,
  retailerId?: string | null,
  explicitSingleOfferId?: string,
  sourceEvidenceRefInternal?: string | null,
  locationScope?: 'national' | 'region' | 'city' | null
): V3PageDecodeContext {
  return {
    leafletId,
    pageNumber,
    sourceOfferIdPrefix,
    retailerId: retailerId ?? null,
    retailerName: retailer,
    explicitSingleOfferId,
    sourceEvidenceRefInternal: sourceEvidenceRefInternal ?? null,
    locationScope: locationScope ?? null,
    tolerateOmittedNullableFields: true
  };
}

function assertHybridAuthorized(input: {
  executionContext: HybridExecutionContext;
  explicitAuthorization: boolean;
  featureEnabled?: boolean;
}): { ok: boolean; reason: string | null } {
  const effectiveEnabled =
    typeof input.featureEnabled === 'boolean'
      ? input.featureEnabled
      : HYBRID_EXTRACTION_DEFAULT_FLAGS.enableHybridOrchestration;

  if (input.executionContext !== 'isolated_hybrid_workflow') {
    return {
      ok: false,
      reason:
        'HYBRID_NORMAL_WORKFLOW_BLOCKED: WP6 hybrid orchestration is strictly disabled in normal_app workflow.'
    };
  }
  if (!input.explicitAuthorization || !effectiveEnabled) {
    return {
      ok: false,
      reason:
        'HYBRID_FEATURE_DISABLED: explicitAuthorization=true and featureEnabled=true are both required (enabledByDefault=false).'
    };
  }
  return { ok: true, reason: null };
}

function computeSummaryMetrics(cards: ReconciledV3CardResult[]): HybridPageRunResult['summary'] {
  let verifiedSingleSkuCards = 0;
  let verifiedDecomposedParents = 0;
  let verifiedDecomposedChildren = 0;
  let verifiedMatchableChildren = 0;
  let compoundTierCardsEmitted = 0;
  let nonCatalogReviewCards = 0;
  let quarantinedCards = 0;
  let heldUnverifiedP0Cards = 0;
  let consumerEligibleCards = 0;
  let excludedNonGroceryCards = 0;

  for (const r of cards) {
    if (
      r.overallStatus === 'evidence_confirmed_single_sku' ||
      r.overallStatus === 'unverified_page_only_p2'
    ) {
      if (r.decomposition.parent_offer_retention_mode === 'unsplit_single_sku') {
        verifiedSingleSkuCards++;
      }
    }
    if (r.decomposition.decomposed && r.decomposition.children.length > 0) {
      verifiedDecomposedParents++;
      verifiedDecomposedChildren += r.decomposition.children.length;
      verifiedMatchableChildren += r.matchingAdapterSummary.matchableChildrenCount;
    }
    if (r.overallStatus === 'evidence_confirmed_compound_tiers') {
      compoundTierCardsEmitted++;
    }
    if (r.overallStatus === 'retained_non_catalog_review') {
      nonCatalogReviewCards++;
    }
    if (r.overallStatus === 'quarantined_conflict') {
      quarantinedCards++;
    }
    if (r.overallStatus === 'held_unverified_p0_budget_or_failure') {
      heldUnverifiedP0Cards++;
    }
    if (r.publicationAssessment.isEligibleForNonCatalogPublication) {
      consumerEligibleCards++;
    }
    if (r.reconciledCard.non_grocery_specs.excluded_from_default_grocery_feed) {
      excludedNonGroceryCards++;
    }
  }

  return {
    verifiedSingleSkuCards,
    verifiedDecomposedParents,
    verifiedDecomposedChildren,
    verifiedMatchableChildren,
    compoundTierCardsEmitted,
    nonCatalogReviewCards,
    quarantinedCards,
    heldUnverifiedP0Cards,
    consumerEligibleCards,
    excludedNonGroceryCards
  };
}

function createEmptyP2AuditSummary(enabled = false): HybridP2AuditSummary {
  return {
    enabled,
    eligibleP2Count: 0,
    selectedAuditCount: 0,
    executedAuditCount: 0,
    selectedSourceOfferIds: [],
    auditEstimatedCostUsd: 0,
    findings: []
  };
}

/**
 * Executes the hybrid WP6/WP7 workflow for a single leaflet page behind strict authorization,
 * cache reuse, budget caps, checkpoint/resume, lineage validation, and publication safety gates.
 */
export async function runHybridPageWorkflow(
  input: RunHybridPageExtractionInput
): Promise<HybridPageRunResult> {
  const gate = assertHybridAuthorized(input);
  const emptyTelemetry = new HybridCostLatencyGovernor({ policy: input.budgetPolicy }).getTelemetry();
  const baseCheckpoint: HybridCheckpointState = {
    checkpointVersion: 'wifran.v3.hybrid.checkpoint/1.0',
    runId: input.runId,
    leafletId: input.leafletId,
    pageNumber: input.pageNumber,
    stage: 'init',
    completedPageKey: null,
    pageContextDone: false,
    completedCropKeys: [],
    failedCropKeys: [],
    cumulativeCostUsd: 0,
    cumulativeRequests: 0,
    updatedAt: new Date().toISOString()
  };

  if (!gate.ok) {
    return {
      ok: false,
      abortedReason: gate.reason,
      featureEnabled: false,
      databaseWritesEnabled: false,
      leafletId: input.leafletId,
      pageNumber: input.pageNumber,
      retailer: input.retailer,
      totalSourceCards: 0,
      p0FlaggedCount: 0,
      p1FlaggedCount: 0,
      p2NoCropCount: 0,
      flaggedForCropRatePercent: 0,
      cropsExecutedCount: 0,
      cropsCacheHitCount: 0,
      cropsSkippedBudgetCount: 0,
      cropsFailedOrInvalidCount: 0,
      pageContextVerificationNeed: {
        needsPageContextVerification: false,
        triggerCodes: [],
        reasons: [],
        recommendedRegions: []
      },
      pageContextApplied: null,
      p2AuditSummary: createEmptyP2AuditSummary(false),
      reconciledCards: [],
      telemetry: emptyTelemetry,
      checkpoint: baseCheckpoint,
      summary: computeSummaryMetrics([])
    };
  }

  const cacheService = new GeminiExtractionCacheService();
  const cacheStore = input.cacheStore || new InMemoryHybridCacheStore();
  const governor =
    input.governor || new HybridCostLatencyGovernor({ policy: input.budgetPolicy });
  const effectivePolicy: HybridBudgetPolicy = {
    ...DEFAULT_HYBRID_BUDGET_POLICY,
    ...(input.budgetPolicy || {})
  };
  const systemPrompt = buildV3PageExtractionSystemPrompt();
  const schema = getV3LeafletPageGenAiSchema();
  const existingCheckpoint = loadCheckpoint(input.checkpointPath);
  const checkpoint: HybridCheckpointState = existingCheckpoint
    ? {
        ...baseCheckpoint,
        ...existingCheckpoint,
        runId: input.runId,
        completedCropKeys: Array.isArray(existingCheckpoint.completedCropKeys)
          ? [...existingCheckpoint.completedCropKeys]
          : [],
        failedCropKeys: Array.isArray(existingCheckpoint.failedCropKeys)
          ? [...existingCheckpoint.failedCropKeys]
          : [],
        failedAttemptsCount: existingCheckpoint.failedAttemptsCount || 0
      }
    : { ...baseCheckpoint };
  const priorCostUsd = checkpoint.cumulativeCostUsd || 0;
  const priorRequests = checkpoint.cumulativeRequests || 0;
  let attemptSeq = checkpoint.cumulativeRequests || 0;
  const ledgerEntries: GeminiUsageLedgerEntry[] = [];
  const effectiveBatchId = input.batchId || input.leafletId;
  const effectiveSessionRunId = input.ledgerSessionRunId || input.runId;

  const pushLedgerFromResponse = (params: {
    stageCategory: GeminiUsageStageCategory;
    requestPurpose: string;
    cacheKey: string;
    response: HybridExtractionProviderResponse;
    startedAtIso: string;
    completedAtIso: string;
    sourceOfferId?: string | null;
    sourceAnchor?: string | null;
    recoveryParentRequestId?: string | null;
  }): GeminiUsageLedgerEntry => {
    attemptSeq++;
    const fromCache = Boolean(params.response.fromCache);
    const outcome: GeminiUsageOutcome = fromCache
      ? 'cache_hit'
      : params.response.outcomeUnknown
        ? 'outcome_unknown'
        : params.response.ok
          ? 'success'
          : 'failed';
    const hasUsageTokens = Boolean(
      params.response.usage &&
        (params.response.usage.promptTokenCount !== undefined ||
          params.response.usage.candidatesTokenCount !== undefined ||
          params.response.usage.totalTokenCount !== undefined)
    );
    const usageReported =
      typeof params.response.usageReported === 'boolean'
        ? params.response.usageReported
        : hasUsageTokens;
    const reqId = fromCache
      ? `${effectiveBatchId}:${input.leafletId}:p${input.pageNumber}:${params.requestPurpose}:cache:${params.cacheKey.slice(0, 12)}:${effectiveSessionRunId}`
      : params.response.requestId ||
        `${effectiveBatchId}:${input.leafletId}:p${input.pageNumber}:${params.requestPurpose}:${attemptSeq}:${params.cacheKey.slice(0, 8)}`;

    let entry = buildLedgerEntryFromProviderCall({
      requestId: reqId,
      batchId: effectiveBatchId,
      runId: effectiveSessionRunId,
      leafletId: input.leafletId,
      pageNumber: input.pageNumber,
      sourceOfferId: params.sourceOfferId ?? null,
      sourceAnchor: params.sourceAnchor ?? `page:${input.pageNumber}`,
      stageCategory: params.stageCategory,
      requestPurpose: params.requestPurpose,
      modelId: params.response.model || 'gemini-3.8-flash',
      modelVersion: params.response.model || 'gemini-3.8-flash',
      apiProvider: fromCache
        ? 'cache'
        : params.response.apiProvider || (input.provider.isOfflineOrMock ? 'mock' : 'vertex_ai'),
      requestedTier: params.response.tier === 'standard' ? 'standard' : 'flex',
      actualTier: params.response.actualTier ?? null,
      startedAt: params.startedAtIso,
      completedAt: params.completedAtIso,
      durationMs: params.response.durationMs || 0,
      outcome,
      finishReason: params.response.finishReason ?? null,
      cacheHit: fromCache,
      usageReported,
      usage: params.response.usage,
      rawUsageMetadata: params.response.rawUsageMetadata ?? (params.response.usage as any) ?? null,
      recoveryParentRequestId: params.recoveryParentRequestId ?? null,
      errorMessage: params.response.errorMessage ?? null
    });

    // Preserve explicit mock-provider costUsdOverride when an offline test fixture omits token counts
    if (
      !fromCache &&
      input.provider.isOfflineOrMock &&
      params.response.ok &&
      !usageReported &&
      typeof params.response.costUsdOverride === 'number' &&
      Number.isFinite(params.response.costUsdOverride)
    ) {
      entry = {
        ...entry,
        usageStatus: 'measured',
        measuredCostUsd: Number(params.response.costUsdOverride.toFixed(8))
      };
    }

    ledgerEntries.push(entry);
    input.onLedgerEntry?.(entry);
    return entry;
  };

  // Step 1: Full-page extraction (cache-aware)
  const pageBuffer = existsSync(input.pageAssetPath)
    ? readFileSync(input.pageAssetPath)
    : Buffer.from(`${input.leafletId}:p${input.pageNumber}`, 'utf8');
  const pagePrompt = `Extract ALL promotional offer cards visible on page ${input.pageNumber} (${input.retailer}, ${input.leafletId}).`;
  const { fingerprintHash: pageCacheKey } = cacheService.computeFingerprint({
    imageBuffer: pageBuffer,
    model: 'gemini-3.8-flash',
    systemInstruction: systemPrompt,
    promptText: pagePrompt,
    promptVersion: V3_PROMPT_VERSION,
    schema,
    schemaVersion: V3_EXTRACTION_SCHEMA_VERSION,
    thinkingConfig: { thinkingLevel: 'MEDIUM' },
    serviceTier: 'flex'
  });

  let pageResponse: HybridExtractionProviderResponse;
  let recoveryApplied: HybridPageRunResult['recoveryApplied'] = null;
  const cachedPage = cacheStore.get(pageCacheKey);
  if (cachedPage && cachedPage.ok) {
    const nowIso = new Date().toISOString();
    pageResponse = { ...cachedPage, fromCache: true };
    governor.recordExecution({
      kind: 'full_page',
      ok: true,
      fromCache: true,
      durationMs: 0
    });
    pushLedgerFromResponse({
      stageCategory: 'b1_full_page',
      requestPurpose: 'b1_full_page',
      cacheKey: pageCacheKey,
      response: pageResponse,
      startedAtIso: nowIso,
      completedAtIso: nowIso
    });
  } else {
    const b1StartIso = new Date().toISOString();
    pageResponse = await input.provider.extractPage({
      requestKind: 'full_page',
      requestPurpose: 'b1_full_page',
      cacheKey: pageCacheKey,
      leafletId: input.leafletId,
      pageNumber: input.pageNumber,
      retailer: input.retailer,
      imagePath: input.pageAssetPath,
      promptText: pagePrompt
    });
    const b1EndIso = new Date().toISOString();
    governor.recordExecution({
      kind: 'full_page',
      ok: pageResponse.ok,
      outcomeUnknown: pageResponse.outcomeUnknown,
      fromCache: pageResponse.fromCache,
      durationMs: pageResponse.durationMs,
      usage: pageResponse.usage,
      costUsdOverride: pageResponse.costUsdOverride
    });
    const b1LedgerEntry = pushLedgerFromResponse({
      stageCategory: 'b1_full_page',
      requestPurpose: 'b1_full_page',
      cacheKey: pageCacheKey,
      response: pageResponse,
      startedAtIso: b1StartIso,
      completedAtIso: b1EndIso
    });

    if (pageResponse.ok) {
      cacheStore.set(pageCacheKey, pageResponse);
      checkpoint.completedPageKey = pageCacheKey;
    } else if (
      isMaxTokensOrTruncatedPageFailure(pageResponse) &&
      (input.enableBoundedMaxTokensRecovery ?? true)
    ) {
      // Bounded MAX_TOKENS recovery: NEVER retry the exact same oversized request; split once into 2 overlapping halves
      const pagePrefixForSplit = `${input.leafletId}_p${String(input.pageNumber).padStart(3, '0')}`;
      const telemetryBeforeSplit = governor.getTelemetry();
      if (telemetryBeforeSplit.totalEstimatedCostUsd < effectivePolicy.maxSpendUsdPerJob) {
        // Bounded MAX_TOKENS recovery split regions in Gemini [ymin, xmin, ymax, xmax] 0..1000 normalized space:
        // top: [0, 0, 540, 1000] -> horizontal top half (y=0..540, full width x=0..1000)
        // bottom: [460, 0, 1000, 1000] -> horizontal bottom half (y=460..1000, full width x=0..1000)
        // Overlap band [460..540] safely accommodates straddling offer rows across full width
        const halfDefs: Array<{ name: 'top' | 'bottom'; box: [number, number, number, number] }> = [
          { name: 'top', box: [0, 0, 540, 1000] },
          { name: 'bottom', box: [460, 0, 1000, 1000] }
        ];
        const halfParsedOutputs: Record<string, any>[] = [];
        let splitFailureMsg: string | null = null;

        for (const half of halfDefs) {
          let halfImagePath = input.pageAssetPath;
          if (existsSync(input.pageImagePath)) {
            try {
              const splitCrop = await generateHybridRegionCrop({
                cropId: `${pagePrefixForSplit}_split_${half.name}`,
                parentSourceOfferId: `${pagePrefixForSplit}_split`,
                regionKind: 'page_header',
                pageImagePath: input.pageImagePath,
                outputDir: join(input.cropOutputDir, 'recovery_splits'),
                explicitNormalizedBox: half.box,
                paddingPercent: 0,
                dryRunGeometryOnly: input.dryRunGeometryOnly
              });
              if (splitCrop.cropImagePath && existsSync(splitCrop.cropImagePath)) {
                halfImagePath = splitCrop.cropImagePath;
              }
            } catch {
              // Fallback to page asset path if local PNG split crop unavailable (e.g., synthetic mock test)
            }
          }

          const halfPrompt = `Extract ALL promotional offer cards visible in the ${half.name} half region (${JSON.stringify(half.box)}) of page ${input.pageNumber} (${input.retailer}, ${input.leafletId}).`;
          const halfBuf = existsSync(halfImagePath)
            ? readFileSync(halfImagePath)
            : Buffer.from(`${pageCacheKey}:${half.name}`, 'utf8');
          const { fingerprintHash: halfCacheKey } = cacheService.computeFingerprint({
            imageBuffer: halfBuf,
            model: 'gemini-3.8-flash',
            systemInstruction: systemPrompt,
            promptText: halfPrompt,
            promptVersion: `${V3_PROMPT_VERSION}:split_${half.name}`,
            schema,
            schemaVersion: V3_EXTRACTION_SCHEMA_VERSION,
            thinkingConfig: { thinkingLevel: 'MEDIUM' },
            serviceTier: 'flex'
          });

          const hStartIso = new Date().toISOString();
          const halfResp = await input.provider.extractPage({
            requestKind: 'full_page',
            requestPurpose: 'b1_max_tokens_split_half',
            recoveryParentRequestId: b1LedgerEntry.requestId,
            cacheKey: halfCacheKey,
            leafletId: input.leafletId,
            pageNumber: input.pageNumber,
            retailer: input.retailer,
            imagePath: halfImagePath,
            promptText: halfPrompt
          });
          const hEndIso = new Date().toISOString();

          governor.recordExecution({
            kind: 'full_page',
            ok: halfResp.ok,
            outcomeUnknown: halfResp.outcomeUnknown,
            fromCache: halfResp.fromCache,
            durationMs: halfResp.durationMs,
            usage: halfResp.usage,
            costUsdOverride: halfResp.costUsdOverride
          });
          pushLedgerFromResponse({
            stageCategory: 'b1_full_page',
            requestPurpose: 'b1_max_tokens_split_half',
            cacheKey: halfCacheKey,
            response: halfResp,
            startedAtIso: hStartIso,
            completedAtIso: hEndIso,
            sourceAnchor: `page:${input.pageNumber}:${half.name}_half`,
            recoveryParentRequestId: b1LedgerEntry.requestId
          });

          if (!halfResp.ok) {
            splitFailureMsg =
              halfResp.errorMessage || `MAX_TOKENS_RECOVERY_HALF_FAILED (${half.name})`;
            break;
          }
          try {
            halfParsedOutputs.push(parseProviderJson(halfResp) as Record<string, any>);
          } catch (parseErr: any) {
            splitFailureMsg = `MAX_TOKENS_RECOVERY_PARSE_FAILED (${half.name}): ${parseErr?.message || String(parseErr)}`;
            break;
          }
        }

        if (!splitFailureMsg && halfParsedOutputs.length === 2) {
          const mergedRaw = mergeRecoveredHalfRawExtractions(
            halfParsedOutputs[0],
            halfParsedOutputs[1]
          );
          const mergedCount = Array.isArray(mergedRaw.offers) ? mergedRaw.offers.length : 0;
          if (mergedCount > 0) {
            const originalTriggerReason =
              pageResponse.errorCode || pageResponse.finishReason || 'MAX_TOKENS_BOUNDED_SPLIT_2_HALVES';
            pageResponse = {
              ...pageResponse,
              ok: true,
              parsedJson: mergedRaw,
              rawText: JSON.stringify(mergedRaw),
              finishReason: 'STOP',
              errorCode: undefined,
              errorMessage: undefined
            };
            checkpoint.completedPageKey = pageCacheKey;
            cacheStore.set(pageCacheKey, pageResponse);
            recoveryApplied = {
              triggered: true,
              reason: originalTriggerReason,
              regionsProcessed: 2,
              recoveredOffersCount: mergedCount
            };
          } else {
            pageResponse = {
              ...pageResponse,
              ok: false,
              errorCode: 'MAX_TOKENS_RECOVERY_EMPTY',
              errorMessage: 'Bounded 2-half recovery returned 0 merged offers.'
            };
          }
        } else if (splitFailureMsg) {
          pageResponse = {
            ...pageResponse,
            ok: false,
            errorMessage: `${pageResponse.errorMessage || 'MAX_TOKENS'}; Bounded recovery failed: ${splitFailureMsg}`
          };
        }
      }
    }
  }

  const pageTelemetryNow = governor.getTelemetry();
  checkpoint.cumulativeCostUsd = Number((priorCostUsd + pageTelemetryNow.totalEstimatedCostUsd).toFixed(6));
  checkpoint.cumulativeRequests =
    priorRequests +
    pageTelemetryNow.pageRequests +
    pageTelemetryNow.cropRequests +
    pageTelemetryNow.pageContextRequests +
    pageTelemetryNow.p2AuditRequests;

  if (!pageResponse.ok) {
    checkpoint.stage = 'page_failed';
    checkpoint.completedPageKey = null;
    checkpoint.failedAttemptsCount = (checkpoint.failedAttemptsCount || 0) + 1;
    checkpoint.lastError = pageResponse.errorMessage || 'PAGE_EXTRACTION_FAILED';
    checkpoint.lastFinishReason = pageResponse.finishReason ?? null;
    saveCheckpointAtomic(input.checkpointPath, {
      ...checkpoint,
      updatedAt: new Date().toISOString()
    });
    return {
      ok: false,
      abortedReason: pageResponse.errorMessage || 'PAGE_EXTRACTION_FAILED',
      featureEnabled: true,
      databaseWritesEnabled: false,
      leafletId: input.leafletId,
      pageNumber: input.pageNumber,
      retailer: input.retailer,
      totalSourceCards: 0,
      p0FlaggedCount: 0,
      p1FlaggedCount: 0,
      p2NoCropCount: 0,
      flaggedForCropRatePercent: 0,
      cropsExecutedCount: 0,
      cropsCacheHitCount: 0,
      cropsSkippedBudgetCount: 0,
      cropsFailedOrInvalidCount: 0,
      pageContextVerificationNeed: {
        needsPageContextVerification: false,
        triggerCodes: [],
        reasons: [],
        recommendedRegions: []
      },
      pageContextApplied: null,
      p2AuditSummary: createEmptyP2AuditSummary(Boolean(effectivePolicy.enableIndependentP2Audit)),
      reconciledCards: [],
      telemetry: pageTelemetryNow,
      checkpoint,
      ledgerEntries,
      recoveryApplied,
      summary: computeSummaryMetrics([])
    };
  }

  checkpoint.stage = 'page_done';
  checkpoint.lastError = null;
  checkpoint.lastFinishReason = pageResponse.finishReason ?? 'STOP';
  saveCheckpointAtomic(input.checkpointPath, {
    ...checkpoint,
    updatedAt: new Date().toISOString()
  });

  const parsedPageJson = parseProviderJson(pageResponse);
  const pagePrefix = `${input.leafletId}_p${String(input.pageNumber).padStart(3, '0')}`;
  const decodedPage = decodeV3PageExtractionToOfferCards(
    parsedPageJson,
    buildDecodeContext(
      input.leafletId,
      input.pageNumber,
      pagePrefix,
      input.retailer,
      input.retailerId,
      undefined,
      input.pageAssetPath,
      input.locationScope
    )
  );

  const rawOffers = decodedPage.rawExtraction.offers || [];
  const componentBoxesBySourceOfferId: Record<string, V3RawComponentBoxes> = {};
  rawOffers.forEach((rawOffer: any, idx: number) => {
    const card = decodedPage.cards[idx];
    const boxes = rawOffer?.components || rawOffer?.component_boxes;
    if (card && boxes) {
      componentBoxesBySourceOfferId[card.source_card.source_offer_id] = boxes;
    }
  });
  const resolvedLeafletDates = resolveLeafletDateMetadata({
    offerStartDate: input.offerStartDate ?? null,
    offerEndDate: input.offerEndDate ?? null,
    manifestPath: input.manifestPath ?? null,
    pageImagePath: input.pageImagePath,
    manifestOfferDates: input.manifestOfferDates ?? null,
    coverPageValidityStartDate: decodedPage.rawExtraction.validity_start_date ?? null,
    coverPageValidityEndDate: decodedPage.rawExtraction.validity_end_date ?? null,
    isVerifiedCoverPage: input.isVerifiedCoverPage ?? input.pageNumber === 1,
    pageNumber: input.pageNumber
  });

  let pageCards: OfferContractV3Record[] = decodedPage.cards.map((c) => ({
    ...c,
    source_card: {
      ...c.source_card,
      offer_start_date:
        resolvedLeafletDates.offerStartDate || c.source_card.offer_start_date || null,
      offer_end_date:
        resolvedLeafletDates.offerEndDate || c.source_card.offer_end_date || null,
      location_scope: c.source_card.location_scope ?? input.locationScope ?? null
    }
  }));

  // Step 2: WP6-C Page-Level Context Verification (optional; skipped when `disablePageContextVerification` is enabled)
  const pageContextNeed = assessPageContextVerificationNeed({
    cards: pageCards,
    isLoyaltyPage: Boolean(decodedPage.rawExtraction.is_loyalty_page),
    loyaltyProgramName: decodedPage.rawExtraction.loyalty_program_name ?? null,
    validityStartDate:
      resolvedLeafletDates.offerStartDate ?? decodedPage.rawExtraction.validity_start_date ?? null,
    validityEndDate:
      resolvedLeafletDates.offerEndDate ?? decodedPage.rawExtraction.validity_end_date ?? null,
    pageCurrency: decodedPage.rawExtraction.page_currency ?? null,
    ignoredBanners: decodedPage.rawExtraction.ignored_banners || []
  });

  let pageContextApplied: PageContextVerificationEvidence | null = null;
  if (
    !input.disablePageContextVerification &&
    (pageContextNeed.needsPageContextVerification || input.forceAllowlistedPageContext) &&
    input.provider.verifyPageContext
  ) {
    const headerRegion = pageContextNeed.recommendedRegions[0];
    const approvedBox = input.forceAllowlistedPageContext
      ? ([0, 0, 210, 1000] as [number, number, number, number])
      : headerRegion?.normalizedBox || ([0, 0, 210, 1000] as [number, number, number, number]);
    const contextCrop = await generateHybridRegionCrop({
      cropId: `${pagePrefix}_context_header`,
      parentSourceOfferId: `${pagePrefix}_context`,
      regionKind: 'page_header',
      pageImagePath: input.pageImagePath,
      outputDir: join(input.cropOutputDir, pagePrefix),
      explicitNormalizedBox: approvedBox,
      paddingPercent: 0,
      dryRunGeometryOnly: input.dryRunGeometryOnly
    });

    const ctxBuf =
      contextCrop.cropImagePath && existsSync(contextCrop.cropImagePath)
        ? readFileSync(contextCrop.cropImagePath)
        : pageBuffer;
    const { fingerprintHash: ctxCacheKey } = cacheService.computeFingerprint({
      imageBuffer: ctxBuf,
      model: 'gemini-3.8-flash',
      systemInstruction: 'Verify page-level header/footer promotional scope and dates.',
      promptText: `Verify page context for ${input.leafletId} p${input.pageNumber}.`,
      promptVersion: `${V3_PROMPT_VERSION}:page_context`,
      schema: { type: 'object' },
      schemaVersion: `${V3_EXTRACTION_SCHEMA_VERSION}:page_context`,
      thinkingConfig: { thinkingLevel: 'MEDIUM' },
      serviceTier: 'flex'
    });

    const cachedCtx = cacheStore.get(ctxCacheKey);
    const budgetOk = governor.canDispatchPageContext(Boolean(cachedCtx?.ok));
    if (budgetOk.allowed) {
      if (cachedCtx?.ok && cachedCtx.parsedJson) {
        const nowIso = new Date().toISOString();
        pageContextApplied = cachedCtx.parsedJson as PageContextVerificationEvidence;
        governor.recordExecution({
          kind: 'page_context',
          ok: true,
          fromCache: true,
          durationMs: 0
        });
        pushLedgerFromResponse({
          stageCategory: 'other_gemini',
          requestPurpose: 'page_context_verify',
          cacheKey: ctxCacheKey,
          response: { ...cachedCtx, fromCache: true },
          startedAtIso: nowIso,
          completedAtIso: nowIso
        });
      } else {
        const ctxStartIso = new Date().toISOString();
        const ctxRes = await input.provider.verifyPageContext({
          requestKind: 'page_context',
          cacheKey: ctxCacheKey,
          leafletId: input.leafletId,
          pageNumber: input.pageNumber,
          retailer: input.retailer,
          regionKind: 'page_header',
          imagePath: contextCrop.cropImagePath || input.pageImagePath,
          pixelBox: contextCrop.pixelBox,
          promptText: 'Inspect header/footer banners for printed validity dates and explicit regional/branch scope.'
        });
        const ctxEndIso = new Date().toISOString();
        governor.recordExecution({
          kind: 'page_context',
          ok: ctxRes.ok,
          fromCache: ctxRes.rawResponse?.fromCache,
          durationMs: ctxRes.rawResponse?.durationMs ?? 8000,
          usage: ctxRes.rawResponse?.usage,
          costUsdOverride: ctxRes.rawResponse?.costUsdOverride
        });
        pushLedgerFromResponse({
          stageCategory: 'other_gemini',
          requestPurpose: 'page_context_verify',
          cacheKey: ctxCacheKey,
          response: ctxRes.rawResponse || {
            ok: ctxRes.ok,
            durationMs: 8000,
            errorMessage: ctxRes.errorMessage
          },
          startedAtIso: ctxStartIso,
          completedAtIso: ctxEndIso
        });
        if (ctxRes.ok && ctxRes.evidence) {
          pageContextApplied = {
            ...ctxRes.evidence,
            rawCropSha256: contextCrop.cropSha256 ?? null
          };
          cacheStore.set(ctxCacheKey, {
            ok: true,
            parsedJson: pageContextApplied,
            durationMs: ctxRes.rawResponse?.durationMs ?? 8000
          });
        }
      }
    }

    if (pageContextApplied) {
      const propagated = applyScopedPageContextToCards({
        cards: pageCards,
        offerNumbers: rawOffers.map((r, i) => r.offer_number || i + 1),
        pageContext: pageContextApplied
      });
      pageCards = propagated.updatedCards;
    }
  }

  checkpoint.pageContextDone = true;
  checkpoint.stage = 'page_context_done';
  saveCheckpointAtomic(input.checkpointPath, {
    ...checkpoint,
    updatedAt: new Date().toISOString()
  });

  // Step 3: WP6-B Deterministic Card Selection
  const cardsWithLimitsCount = pageCards.filter(
    (c) => c.quantity_and_promo.customer_limit_pcs != null
  ).length;
  const pageHasPerCardLimits =
    cardsWithLimitsCount >= Math.max(3, Math.ceil(pageCards.length * 0.25));
  const selections: CardCropSelectionDecision[] = pageCards.map((card, idx) => {
    const raw = rawOffers[idx];
    const dec = evaluateCardForCropVerification(card, {
      components: (raw?.components as V3RawComponentBoxes | undefined) ?? undefined,
      rawConfidence: typeof raw?.confidence === 'number' ? raw.confidence : undefined,
      pageHasPerCardLimits,
      pageContextSuspectedIncomplete: pageContextNeed.needsPageContextVerification
    });
    return {
      ...dec,
      offerNumber: raw?.offer_number || idx + 1
    };
  });

  const p0Indices: number[] = [];
  const p1Indices: number[] = [];
  const p2Indices: number[] = [];
  selections.forEach((s, idx) => {
    if (s.priority === 'P0') p0Indices.push(idx);
    else if (s.priority === 'P1') p1Indices.push(idx);
    else p2Indices.push(idx);
  });

  // Independent P2 Quality Audit sampling (WP7-A): stratified over clean P2 cards without changing P0/P1 triggers
  const p2AuditEnabled = Boolean(effectivePolicy.enableIndependentP2Audit);
  const p2AuditPlan = selectIndependentP2AuditSample({
    items: pageCards.map((card, i) => ({ card, decision: selections[i] })),
    enabled: p2AuditEnabled,
    sampleRate: effectivePolicy.p2AuditSampleRate,
    seed: effectivePolicy.p2AuditSeed
  });
  const selectedP2AuditOfferIds = new Set(p2AuditPlan.selectedOfferIds);
  const p2AuditIndices: number[] = [];
  selections.forEach((s, idx) => {
    if (s.priority === 'P2' && selectedP2AuditOfferIds.has(s.sourceOfferId)) {
      selections[idx] = markDecisionAsIndependentP2Audit(
        s,
        p2AuditPlan.stratumByOfferId[s.sourceOfferId] || 'unknown',
        {
          samplingRate: effectivePolicy.p2AuditSampleRate,
          seed: effectivePolicy.p2AuditSeed
        }
      );
      p2AuditIndices.push(idx);
    }
  });

  // Dispatch queue prioritizes ALL P0 cards ahead of P1 cards, followed by stratified P2 audit samples
  const rawOrderedVerificationIndices = [...p0Indices, ...p1Indices, ...p2AuditIndices];
  const allowlistOrder = input.allowedCropSourceOfferIds;
  const allowlistSet = allowlistOrder ? new Set(allowlistOrder) : null;
  const orderedVerificationIndices = allowlistOrder
    ? [
        ...rawOrderedVerificationIndices
          .filter((idx) => allowlistSet!.has(pageCards[idx].source_card.source_offer_id))
          .sort(
            (a, b) =>
              allowlistOrder.indexOf(pageCards[a].source_card.source_offer_id) -
              allowlistOrder.indexOf(pageCards[b].source_card.source_offer_id)
          ),
        ...rawOrderedVerificationIndices.filter(
          (idx) => !allowlistSet!.has(pageCards[idx].source_card.source_offer_id)
        )
      ]
    : rawOrderedVerificationIndices;

  const cropResultsByCardIndex = new Map<
    number,
    {
      cropCards: OfferContractV3Record[];
      cropExecuted: boolean;
      cropStatus: ReconciledV3CardResult['cropStatus'];
      cropLineage: CropLineageMetadata | null;
    }
  >();

  let cropsExecutedCount = 0;
  let cropsCacheHitCount = 0;
  let cropsSkippedBudgetCount = 0;
  let cropsFailedOrInvalidCount = 0;
  let newlyDispatchedInThisInvocation = 0;

  const runB2DiagnosticCrops = Boolean(input.enableDiagnosticB2CropVerification);

  if (runB2DiagnosticCrops) {
    for (const idx of orderedVerificationIndices) {
      const card = pageCards[idx];
      const raw = rawOffers[idx];
      const decision = selections[idx];
      const offerId = card.source_card.source_offer_id;

      // Workflow-planning allowlist gate: non-allowlisted cards remain unverified without crop dispatch
      if (allowlistSet && !allowlistSet.has(offerId)) {
        cropsSkippedBudgetCount++;
        cropResultsByCardIndex.set(idx, {
          cropCards: [],
          cropExecuted: false,
          cropStatus: 'skipped_budget',
          cropLineage: null
        });
        continue;
      }

    // Interruption test hook
    if (
      typeof input.interruptAfterCropsCount === 'number' &&
      newlyDispatchedInThisInvocation >= input.interruptAfterCropsCount
    ) {
      checkpoint.stage = 'crops_in_progress';
      saveCheckpointAtomic(input.checkpointPath, {
        ...checkpoint,
        updatedAt: new Date().toISOString()
      });
      throw new Error(
        `HYBRID_INTERRUPTED_AFTER_${newlyDispatchedInThisInvocation}_CROPS (checkpoint saved for resume)`
      );
    }

    // Generate / validate high-res crop (WP6-D + WP7-B lineage metadata)
    const offerNumber = decision.offerNumber || raw?.offer_number || idx + 1;
    const auditedSlotId = input.auditedPilotSlotByOfferNumber?.[offerNumber] || null;
    const auditedEntry = auditedSlotId ? findPilotCropProvenanceBySlotId(auditedSlotId) : undefined;
    const lineage = await generateHybridRegionCrop({
      cropId: `${offerId}_crop`,
      parentSourceOfferId: offerId,
      regionKind:
        card.compound_card_context?.has_multiple_price_badges_in_card
          ? 'compound_card_full'
          : 'offer_card',
      pageImagePath: input.pageImagePath,
      outputDir: join(input.cropOutputDir, pagePrefix),
      components: (raw?.components as V3RawComponentBoxes | undefined) ?? null,
      dryRunGeometryOnly: input.dryRunGeometryOnly
    });
    lineage.expectedLeafletId = input.leafletId;
    lineage.expectedPageNumber = input.pageNumber;
    lineage.expectedOfferNumber = offerNumber;
    lineage.manifestSlotId = auditedSlotId;
    lineage.rawResponseArchivePath = auditedEntry?.rawResponseArchivePath ?? null;
    lineage.rawResponseSha256 = auditedEntry?.rawResponseSha256 ?? null;

    if (!lineage.geometryValid) {
      cropsFailedOrInvalidCount++;
      cropResultsByCardIndex.set(idx, {
        cropCards: [],
        cropExecuted: false,
        cropStatus: 'invalid_geometry',
        cropLineage: lineage
      });
      continue;
    }

    const cropBuf =
      lineage.cropImagePath && existsSync(lineage.cropImagePath)
        ? readFileSync(lineage.cropImagePath)
        : Buffer.from(
            `${offerId}:${JSON.stringify(lineage.paddedNormalizedBox)}`,
            'utf8'
          );

    const isP2AuditCard = Boolean(decision.p2Audit?.selectedForAudit);
    const cropPrompt = `Verify offer card ${offerId} (${input.retailer}, p${input.pageNumber}) at high resolution.`;
    const { fingerprintHash: cropCacheKey } = cacheService.computeFingerprint({
      imageBuffer: cropBuf,
      model: 'gemini-3.8-flash',
      systemInstruction: systemPrompt,
      promptText: cropPrompt,
      promptVersion: `${V3_PROMPT_VERSION}:crop`,
      schema,
      schemaVersion: `${V3_EXTRACTION_SCHEMA_VERSION}:crop`,
      thinkingConfig: { thinkingLevel: 'MEDIUM' },
      serviceTier: 'flex'
    });

    const cachedCrop = cacheStore.get(cropCacheKey);
    const remainingP0Count = p0Indices.filter(
      (pIdx) => pIdx !== idx && !cropResultsByCardIndex.has(pIdx)
    ).length;

    const budgetCheck = isP2AuditCard
      ? governor.canDispatchP2Audit(Boolean(cachedCrop?.ok))
      : governor.canDispatchCrop({
          priority: decision.priority,
          remainingPendingP0Count: remainingP0Count,
          isCached: Boolean(cachedCrop?.ok)
        });

    if (!budgetCheck.allowed) {
      cropsSkippedBudgetCount++;
      cropResultsByCardIndex.set(idx, {
        cropCards: [],
        cropExecuted: false,
        cropStatus: 'skipped_budget',
        cropLineage: lineage
      });
      continue;
    }

    let cropResp: HybridExtractionProviderResponse;
    if (cachedCrop && cachedCrop.ok) {
      const nowIso = new Date().toISOString();
      cropResp = { ...cachedCrop, fromCache: true };
      governor.recordExecution({
        kind: isP2AuditCard ? 'p2_audit' : 'card_crop',
        ok: true,
        fromCache: true,
        durationMs: 0
      });
      pushLedgerFromResponse({
        stageCategory: 'b2_selective_crop',
        requestPurpose: isP2AuditCard ? 'b2_p2_audit_crop' : 'b2_selective_crop',
        cacheKey: cropCacheKey,
        response: cropResp,
        startedAtIso: nowIso,
        completedAtIso: nowIso,
        sourceOfferId: offerId,
        sourceAnchor: `crop:${offerId}`
      });
      cropsCacheHitCount++;
    } else {
      const cStartIso = new Date().toISOString();
      cropResp = await input.provider.extractCardCrop({
        requestKind: 'card_crop',
        requestPurpose: isP2AuditCard ? 'b2_p2_audit_crop' : 'b2_selective_crop',
        cacheKey: cropCacheKey,
        leafletId: input.leafletId,
        pageNumber: input.pageNumber,
        retailer: input.retailer,
        sourceOfferId: offerId,
        regionKind: 'offer_card',
        imagePath: lineage.cropImagePath || input.pageImagePath,
        pixelBox: lineage.pixelBox,
        promptText: cropPrompt
      });
      const cEndIso = new Date().toISOString();
      governor.recordExecution({
        kind: isP2AuditCard ? 'p2_audit' : 'card_crop',
        ok: cropResp.ok,
        outcomeUnknown: cropResp.outcomeUnknown,
        fromCache: cropResp.fromCache,
        durationMs: cropResp.durationMs,
        usage: cropResp.usage,
        costUsdOverride: cropResp.costUsdOverride
      });
      const isMissingOfflineArchive =
        cropResp.errorCode === 'NO_SAVED_005E_CROP_AVAILABLE';
      if (!isMissingOfflineArchive) {
        pushLedgerFromResponse({
          stageCategory: 'b2_selective_crop',
          requestPurpose: isP2AuditCard ? 'b2_p2_audit_crop' : 'b2_selective_crop',
          cacheKey: cropCacheKey,
          response: cropResp,
          startedAtIso: cStartIso,
          completedAtIso: cEndIso,
          sourceOfferId: offerId,
          sourceAnchor: `crop:${offerId}`
        });
      }
      newlyDispatchedInThisInvocation++;

      if (cropResp.ok) {
        cacheStore.set(cropCacheKey, cropResp);
        if (!checkpoint.completedCropKeys.includes(cropCacheKey)) {
          checkpoint.completedCropKeys.push(cropCacheKey);
        }
        cropsExecutedCount++;
      } else {
        if (!isMissingOfflineArchive) {
          if (!checkpoint.failedCropKeys.includes(cropCacheKey)) {
            checkpoint.failedCropKeys.push(cropCacheKey);
          }
          cropsFailedOrInvalidCount++;
        }
        checkpoint.stage = 'crops_in_progress';
        saveCheckpointAtomic(input.checkpointPath, {
          ...checkpoint,
          cumulativeCostUsd: Number((priorCostUsd + governor.getTelemetry().totalEstimatedCostUsd).toFixed(6)),
          updatedAt: new Date().toISOString()
        });
        cropResultsByCardIndex.set(idx, {
          cropCards: [],
          cropExecuted: false,
          cropStatus: isMissingOfflineArchive ? 'missing_offline_archive' : 'failed',
          cropLineage: lineage
        });
        continue;
      }
    }

    checkpoint.stage = 'crops_in_progress';
    saveCheckpointAtomic(input.checkpointPath, {
      ...checkpoint,
      cumulativeCostUsd: governor.getTelemetry().totalEstimatedCostUsd,
      updatedAt: new Date().toISOString()
    });

    const parsedCropJson = parseProviderJson(cropResp);
    const decodedCrop = decodeV3PageExtractionToOfferCards(
      parsedCropJson,
      buildDecodeContext(
        input.leafletId,
        input.pageNumber,
        offerId,
        input.retailer,
        input.retailerId,
        offerId,
        lineage.cropImagePath || input.pageImagePath,
        input.locationScope
      )
    );

    // Preserve verified leaflet date context on crop cards when crop image omitted outer page header dates
    for (const cropCard of decodedCrop.cards) {
      cropCard.source_card.offer_start_date =
        resolvedLeafletDates.offerStartDate ||
        cropCard.source_card.offer_start_date ||
        pageCards[idx]?.source_card.offer_start_date ||
        null;
      cropCard.source_card.offer_end_date =
        resolvedLeafletDates.offerEndDate ||
        cropCard.source_card.offer_end_date ||
        pageCards[idx]?.source_card.offer_end_date ||
        null;
    }

    if (decodedCrop.cards.length === 0) {
      cropsFailedOrInvalidCount++;
      cropResultsByCardIndex.set(idx, {
        cropCards: [],
        cropExecuted: false,
        cropStatus: 'failed',
        cropLineage: lineage
      });
      continue;
    }

    cropResultsByCardIndex.set(idx, {
      cropCards: decodedCrop.cards,
      cropExecuted: true,
      cropStatus: cropResp.fromCache ? 'cache_hit' : 'executed',
      cropLineage: lineage
    });
  }
  } else {
    // Routine MVP extraction: zero automatic B2 Gemini crop-analysis requests.
    for (const idx of orderedVerificationIndices) {
      cropsSkippedBudgetCount++;
      cropResultsByCardIndex.set(idx, {
        cropCards: [],
        cropExecuted: false,
        cropStatus: 'skipped_budget',
        cropLineage: null
      });
    }
  }

  // Step 4: WP6-E / WP6-F / WP6-G / WP7-B Reconciliation in source card order
  const reconciledCards: ReconciledV3CardResult[] = [];
  const p2AuditFindings: HybridP2AuditSummary['findings'] = [];
  for (let idx = 0; idx < pageCards.length; idx++) {
    const decision = selections[idx];
    const cropBundle = cropResultsByCardIndex.get(idx) || {
      cropCards: [],
      cropExecuted: false,
      cropStatus: 'not_needed' as const,
      cropLineage: null
    };

    const reconciledList = reconcilePageAndCropCards({
      pageCard: pageCards[idx],
      selectionDecision: decision,
      cropCards: cropBundle.cropCards,
      cropExecuted: cropBundle.cropExecuted,
      cropStatus: cropBundle.cropStatus,
      cropLineage: cropBundle.cropLineage,
      failClosedOnUnverifiedP0: Boolean(
        runB2DiagnosticCrops && effectivePolicy.failClosedOnUnverifiedP0
      ),
      expectedLeafletId: input.leafletId,
      expectedPageNumber: input.pageNumber,
      expectedSourcePageImagePath: input.pageImagePath,
      auditedPilotManifestSlotId:
        input.auditedPilotSlotByOfferNumber?.[decision.offerNumber] ?? null,
      enforceNonExpiredForPublication: input.enforceNonExpiredForPublication,
      publicationReferenceDateIso: input.publicationReferenceDateIso
    });
    reconciledCards.push(...reconciledList);

    if (decision.p2Audit?.selectedForAudit && cropBundle.cropExecuted && reconciledList[0]) {
      const r0 = reconciledList[0];
      const unresolvedOrCorrected = r0.fieldDecisions
        .filter((d) => d.outcome !== 'confirmed')
        .map((d) => `${d.field}:${d.outcome}`);
      p2AuditFindings.push({
        sourceOfferId: decision.sourceOfferId,
        stratumKey: decision.p2Audit.stratum,
        pageVsCropAgreed: unresolvedOrCorrected.length === 0 && r0.reconciledCard.evidence_conflicts.length === 0,
        newlyDetectedRisks: unresolvedOrCorrected
      });
    }
  }

  const telemetry = governor.getTelemetry();
  checkpoint.stage = 'completed';
  checkpoint.cumulativeCostUsd = Number((priorCostUsd + telemetry.totalEstimatedCostUsd).toFixed(6));
  checkpoint.cumulativeRequests =
    priorRequests +
    telemetry.pageRequests +
    telemetry.cropRequests +
    telemetry.pageContextRequests +
    telemetry.p2AuditRequests;
  saveCheckpointAtomic(input.checkpointPath, {
    ...checkpoint,
    updatedAt: new Date().toISOString()
  });

  const totalFlagged = p0Indices.length + p1Indices.length;
  const flaggedRate =
    pageCards.length > 0
      ? Number(((totalFlagged / pageCards.length) * 100).toFixed(2))
      : 0;

  return {
    ok: true,
    abortedReason: null,
    featureEnabled: true,
    databaseWritesEnabled: false,
    leafletId: input.leafletId,
    pageNumber: input.pageNumber,
    retailer: input.retailer,
    totalSourceCards: pageCards.length,
    p0FlaggedCount: p0Indices.length,
    p1FlaggedCount: p1Indices.length,
    p2NoCropCount: p2Indices.length,
    flaggedForCropRatePercent: flaggedRate,
    cropsExecutedCount,
    cropsCacheHitCount,
    cropsSkippedBudgetCount,
    cropsFailedOrInvalidCount,
    pageContextVerificationNeed: pageContextNeed,
    pageContextApplied,
    p2AuditSummary: {
      enabled: p2AuditEnabled,
      eligibleP2Count: p2AuditPlan.eligibleP2Count,
      selectedAuditCount: p2AuditPlan.selectedOfferIds.length,
      executedAuditCount: telemetry.p2AuditRequests,
      selectedSourceOfferIds: p2AuditPlan.selectedOfferIds,
      auditEstimatedCostUsd: telemetry.p2AuditCostUsd,
      findings: p2AuditFindings
    },
    reconciledCards,
    componentBoxesBySourceOfferId,
    rawPageMetadata: {
      validityStartDate: decodedPage.rawExtraction.validity_start_date ?? null,
      validityEndDate: decodedPage.rawExtraction.validity_end_date ?? null,
      pageCurrency: decodedPage.rawExtraction.page_currency ?? null,
      ignoredBanners: Array.isArray(decodedPage.rawExtraction.ignored_banners)
        ? decodedPage.rawExtraction.ignored_banners
        : []
    },
    telemetry,
    checkpoint,
    ledgerEntries,
    recoveryApplied,
    summary: computeSummaryMetrics(reconciledCards)
  };
}

/**
 * Offline replay provider over saved `005E` raw archives (zero live API calls).
 */
export interface OfflineSavedPageBundle {
  pageSlotId: string;
  rawPageFile: string;
  /**
   * Maps decoded page offer number (e.g. 5 for Panda Baskin Robbins, 8 for Moussy)
   * OR normalized offer key to saved `005E` crop archive file path.
   */
  savedCropFilesByOfferNumber: Record<number, string>;
  /**
   * Optional offline fixture representing a header/footer verification response
   * (used strictly for offline page-context regression tests, labeled clearly as fixture/synthetic when not from a saved 005E crop).
   */
  pageContextFixture?: PageContextVerificationEvidence;
}

export function createOffline005eReplayProvider(
  bundlesByLeafletPage: Record<string, OfflineSavedPageBundle>
): HybridExtractionProvider {
  const byKey = bundlesByLeafletPage;

  return {
    providerId: 'offline_005e_saved_replay',
    isOfflineOrMock: true,
    async extractPage(req) {
      const key = `${req.leafletId}::p${req.pageNumber}`;
      const bundle = byKey[key];
      if (!bundle || !existsSync(bundle.rawPageFile)) {
        return {
          ok: false,
          errorCode: 'OFFLINE_PAGE_ARCHIVE_MISSING',
          errorMessage: `Saved raw page archive not found for ${key}.`,
          durationMs: 0
        };
      }
      const raw = JSON.parse(readFileSync(bundle.rawPageFile, 'utf8'));
      return {
        ok: true,
        parsedJson: raw.parsedResponse || JSON.parse(raw.rawResponseText),
        durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : 0,
        usage: raw.usageMetadataRaw,
        costUsdOverride: raw.costCalculation?.totalCostUsd
      };
    },
    async extractCardCrop(req) {
      const key = `${req.leafletId}::p${req.pageNumber}`;
      const bundle = byKey[key];
      if (!bundle) {
        return {
          ok: false,
          errorCode: 'OFFLINE_BUNDLE_MISSING',
          errorMessage: `No bundle registered for ${key}.`,
          durationMs: 0
        };
      }
      const offerNum = Number((req.sourceOfferId || '').split('_').pop() || 0);
      const cropFile = bundle.savedCropFilesByOfferNumber[offerNum];
      if (!cropFile || !existsSync(cropFile)) {
        return {
          ok: false,
          errorCode: 'NO_SAVED_005E_CROP_AVAILABLE',
          errorMessage: `No saved 005E crop archive overlaps ${req.sourceOfferId || 'unknown'}.`,
          durationMs: 0,
          costUsdOverride: 0
        };
      }
      const raw = JSON.parse(readFileSync(cropFile, 'utf8'));
      return {
        ok: true,
        parsedJson: raw.parsedResponse || JSON.parse(raw.rawResponseText),
        durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : 0,
        usage: raw.usageMetadataRaw,
        costUsdOverride: raw.costCalculation?.totalCostUsd
      };
    },
    async verifyPageContext(req) {
      const key = `${req.leafletId}::p${req.pageNumber}`;
      const bundle = byKey[key];
      if (!bundle?.pageContextFixture) {
        return {
          ok: false,
          errorMessage: `No offline page-context verification fixture available for ${key}.`
        };
      }
      return {
        ok: true,
        evidence: bundle.pageContextFixture,
        rawResponse: {
          ok: true,
          parsedJson: bundle.pageContextFixture,
          durationMs: 6500,
          costUsdOverride: 0.0032
        }
      };
    }
  };
}
