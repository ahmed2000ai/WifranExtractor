/**
 * WIFRAN-EXTRACTOR-IDENTITY-005H-B2
 * Isolated Controlled Core Extraction Live Validation Runner (Stage B2 ONLY).
 *
 * Strictly enforces:
 * - Authorized 4-request crop manifest ONLY (B2-REQ-01..04) with SHA-256 & dimension verification
 * - Model: gemini-3.8-flash | Service: Vertex AI Flex | Location: global | Thinking: MEDIUM
 * - Prompt: extraction_v3_crop_r1 | Schema: wifran.extractor.crop/3.0 | maxOutputTokens: 16384
 * - Concurrency: 1 | Automatic retries: 0 | Legacy fallback: disabled | Page-context calls: 0
 * - Zero Supabase reads/writes | Consumer publication: disabled | enabledByDefault: false
 * - Pre-dispatch conservative max-potential-cost check (using configured 16,384 output ceiling)
 *   against BOTH B2 ceiling ($0.15 USD) and cumulative B1+B2 ceiling ($0.25 USD; B1=$0.04934324)
 * - Sequential phases:
 *     --phase=preflight  (0 paid calls: verifies config, image hashes/dims, fingerprints, budget)
 *     --phase=req1       (1 paid call ONLY: B2-REQ-01 Pepsi Gate 1 validation, then STOPS)
 *     --phase=req2to4    (up to 3 sequential calls: B2-REQ-02 Tide, B2-REQ-03 Wafir, B2-REQ-04 Fakieh)
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import sharp from 'sharp';
import { calculateGeminiCost } from '../src/main/ocr/geminiPricingTable';
import {
  V3_CROP_PROMPT_VERSION,
  buildV3CardCropSystemPrompt,
  buildV3CardCropUserPrompt,
  getV3CropPromptAndSchemaFingerprints
} from '../src/main/ocr/geminiV3PromptBuilder';
import {
  HYBRID_LIVE_DEFAULT_MODEL,
  HYBRID_LIVE_DEFAULT_THINKING_LEVEL,
  HYBRID_LIVE_DEFAULT_TIER,
  HYBRID_LIVE_MIN_CARD_OUTPUT_TOKENS,
  createHybridGeminiLiveProvider,
  preflightHybridLiveProvider
} from '../src/main/ocr/hybrid/hybridGeminiLiveProvider';
import { resolveLeafletDateMetadata } from '../src/main/ocr/hybrid/leafletDateMetadata';
import { decomposeV3OfferCard } from '../src/main/ocr/offerV3DecompositionEngine';
import { adaptV3DecompositionToOfflineMatching } from '../src/main/db/v3MatchingInputAdapter';
import {
  V3_CROP_SCHEMA_VERSION,
  decodeV3PageExtractionToOfferCards,
  getV3CardCropGenAiSchema
} from '../src/shared/schemas/leafletPageExtractionV3Schema';

const REPO_ROOT = resolve(__dirname, '..');
const B2_DIR = join(REPO_ROOT, 'Extracts/pilot_v3_005h_b2');
const RAW_DIR = join(B2_DIR, 'raw');
const EVAL_DIR = join(B2_DIR, 'eval');
const LEDGER_FILE = join(B2_DIR, 'b2_execution_ledger.json');

const B1_ACTUAL_SPENT_USD = 0.04934324;
const B2_HARD_CAP_SPEND_USD = 0.15;
const CUMULATIVE_HARD_CAP_SPEND_USD = 0.25;
const MAX_OUTPUT_TOKENS = 16384;
const ESTIMATED_MAX_INPUT_TOKENS_PER_CROP = 5500;

export type StageB2RequestId = 'B2-REQ-01' | 'B2-REQ-02' | 'B2-REQ-03' | 'B2-REQ-04';

interface StageB2Spec {
  requestId: StageB2RequestId;
  label: string;
  leafletId: string;
  manifestRelPath: string;
  pageNumber: number;
  retailer: string;
  retailerId: string;
  sourceOfferId: string;
  imageRelPath: string;
  expectedSha256: string;
  expectedWidth: number;
  expectedHeight: number;
  baselineEstCostUsd: number;
}

const B2_MANIFEST_SPECS: readonly StageB2Spec[] = [
  {
    requestId: 'B2-REQ-01',
    label: 'Pepsi (B1 MAX_TOKENS retry + compact crop schema + multi-brand assortment)',
    leafletId: 'panda-national-national-2026-10-20',
    manifestRelPath: 'Extracts/Panda_Test/manifest.json',
    pageNumber: 2,
    retailer: 'Panda',
    retailerId: 'panda',
    sourceOfferId: 'panda-national-national-2026-10-20_p002_005',
    imageRelPath:
      'Extracts/pilot_v3_005h_b1/crops/panda-national-national-2026-10-20_p002/panda-national-national-2026-10-20_p002_005_crop.webp',
    expectedSha256: '7213fc8a14b6ba22a383810f6729ccd3702aa96c97c2b17f94be440fdaad026b',
    expectedWidth: 730,
    expectedHeight: 777,
    baselineEstCostUsd: 0.009795
  },
  {
    requestId: 'B2-REQ-02',
    label: 'Tide (complex assortment + unnamed/inferred variant prevention)',
    leafletId: 'bin-dawood-national-national-2026-10-20',
    manifestRelPath: 'Extracts/BNDW_Test/manifest.json',
    pageNumber: 4,
    retailer: 'BinDawood',
    retailerId: 'bindawood',
    sourceOfferId: 'BNDW_Test_p004_011',
    imageRelPath: 'Extracts/BNDW_Test/metadata/rev1/page-004/crops/offer-011/offer_card_crop.webp',
    expectedSha256: 'd921786d4a84f2850d9219dd2a30ce3686bbc2786263eed9ef039a4be9234566',
    expectedWidth: 461,
    expectedHeight: 575,
    baselineEstCostUsd: 0.009795
  },
  {
    requestId: 'B2-REQ-03',
    label: 'Wafir (2.5 kg caption vs 2 kg packaging conflict detection + quarantine)',
    leafletId: 'noori-jeddah-2026-11-15',
    manifestRelPath: 'Extracts/noori-supermarket-229798534-jeddah/manifest.json',
    pageNumber: 1,
    retailer: 'Noori Supermarket',
    retailerId: 'noori',
    sourceOfferId: 'noori-supermarket-229798534-jeddah_p001_008',
    imageRelPath:
      'Extracts/noori-supermarket-229798534-jeddah/metadata/rev1/page-001/crops/offer-008/offer_card_crop.webp',
    expectedSha256: '66d6ec00e804a9fafaf443c9fed94adb6aba4018bd95fceb4b3e45f3648f05cd',
    expectedWidth: 538,
    expectedHeight: 493,
    baselineEstCostUsd: 0.006608
  },
  {
    requestId: 'B2-REQ-04',
    label: 'Noori Fakieh (independent promotional tiers + mfg pack count preservation)',
    leafletId: 'noori-jeddah-229798534-jeddah',
    manifestRelPath: 'Extracts/noori-supermarket-229798534-jeddah/manifest.json',
    pageNumber: 1,
    retailer: 'Noori Supermarket',
    retailerId: 'noori',
    sourceOfferId: 'noori-supermarket-229798534-jeddah_p001_002',
    imageRelPath:
      'Extracts/noori-supermarket-229798534-jeddah/metadata/rev1/page-001/crops/offer-002/offer_card_crop.webp',
    expectedSha256: 'c297a98f0db95222b8fdded397eb0d80c6e90097cc360f8b74106cb9febe8fc8',
    expectedWidth: 600,
    expectedHeight: 505,
    baselineEstCostUsd: 0.006608
  }
];

export interface StageB2LedgerRecord {
  requestId: StageB2RequestId;
  sourceOfferId: string;
  sourceImagePath: string;
  sourceImageSha256: string;
  imageWidthPx: number;
  imageHeightPx: number;
  model: string;
  tier: string;
  location: string;
  thinkingLevel: string;
  maxOutputTokens: number;
  promptVersion: string;
  schemaVersion: string;
  promptSha256: string;
  schemaSha256: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  ok: boolean;
  outcomeUnknown: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  finishReason: string | null;
  tokenUsage: {
    inputTokens: number;
    textInputTokens: number | null;
    imageInputTokens: number | null;
    outputTokens: number;
    thinkingTokens: number;
    cachedInputTokens: number;
    totalTokens: number;
  } | null;
  conservativeMaxPotentialCostUsd: number;
  actualOrConservativeCostUsd: number;
  rawArchivePath: string | null;
  evalOutputPath: string | null;
}

export interface StageB2LedgerState {
  milestone: 'WIFRAN-EXTRACTOR-IDENTITY-005H-B2';
  b1ActualSpentUsd: number;
  b2HardCapSpendUsd: number;
  cumulativeHardCapSpendUsd: number;
  submittedRequestsCount: number;
  b2ConsumedCostUsd: number;
  cumulativeB1PlusB2CostUsd: number;
  haltedReason: string | null;
  records: StageB2LedgerRecord[];
}

function sha256File(absPath: string): string {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex');
}

function computeConservativeMaxPotentialCostUsd(inputTokensBound = ESTIMATED_MAX_INPUT_TOKENS_PER_CROP): number {
  // Under Gemini 3.8 Flash, `maxOutputTokens` (16,384) bounds combined candidates + thinking tokens at the output rate.
  return Number(
    calculateGeminiCost(
      {
        promptTokenCount: inputTokensBound,
        candidatesTokenCount: MAX_OUTPUT_TOKENS,
        thoughtsTokenCount: 0
      },
      HYBRID_LIVE_DEFAULT_MODEL,
      HYBRID_LIVE_DEFAULT_TIER
    ).totalCostUsd.toFixed(8)
  );
}

function loadLedger(): StageB2LedgerState {
  if (existsSync(LEDGER_FILE)) {
    return JSON.parse(readFileSync(LEDGER_FILE, 'utf8')) as StageB2LedgerState;
  }
  return {
    milestone: 'WIFRAN-EXTRACTOR-IDENTITY-005H-B2',
    b1ActualSpentUsd: B1_ACTUAL_SPENT_USD,
    b2HardCapSpendUsd: B2_HARD_CAP_SPEND_USD,
    cumulativeHardCapSpendUsd: CUMULATIVE_HARD_CAP_SPEND_USD,
    submittedRequestsCount: 0,
    b2ConsumedCostUsd: 0,
    cumulativeB1PlusB2CostUsd: B1_ACTUAL_SPENT_USD,
    haltedReason: null,
    records: []
  };
}

function saveLedger(state: StageB2LedgerState): void {
  mkdirSync(B2_DIR, { recursive: true });
  writeFileSync(LEDGER_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function parseArg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

async function verifyAllManifestAssets() {
  const verified: Array<{
    requestId: StageB2RequestId;
    path: string;
    exists: boolean;
    width: number | null;
    height: number | null;
    sha256: string | null;
    matchesExpected: boolean;
  }> = [];

  for (const spec of B2_MANIFEST_SPECS) {
    const absPath = join(REPO_ROOT, spec.imageRelPath);
    const exists = existsSync(absPath);
    if (!exists) {
      verified.push({
        requestId: spec.requestId,
        path: spec.imageRelPath,
        exists: false,
        width: null,
        height: null,
        sha256: null,
        matchesExpected: false
      });
      continue;
    }
    const meta = await sharp(absPath).metadata();
    const sha256 = sha256File(absPath);
    const matches =
      meta.width === spec.expectedWidth &&
      meta.height === spec.expectedHeight &&
      sha256 === spec.expectedSha256;
    verified.push({
      requestId: spec.requestId,
      path: spec.imageRelPath,
      exists: true,
      width: meta.width ?? null,
      height: meta.height ?? null,
      sha256,
      matchesExpected: matches
    });
  }
  return verified;
}

async function runPreflight() {
  const pre = preflightHybridLiveProvider({
    executionContext: 'isolated_hybrid_workflow',
    featureEnabled: true,
    explicitLiveAuthorization: true
  });
  const cropFps = getV3CropPromptAndSchemaFingerprints();
  const maxCostPerReq = computeConservativeMaxPotentialCostUsd();
  const assets = await verifyAllManifestAssets();
  const allAssetsValid = assets.every((a) => a.exists && a.matchesExpected);
  const ledger = loadLedger();

  const b2Remaining = Number((B2_HARD_CAP_SPEND_USD - ledger.b2ConsumedCostUsd).toFixed(8));
  const cumulativeRemaining = Number(
    (CUMULATIVE_HARD_CAP_SPEND_USD - ledger.cumulativeB1PlusB2CostUsd).toFixed(8)
  );

  console.log(
    JSON.stringify(
      {
        mode: 'STAGE_B2_PREFLIGHT_ZERO_CALLS',
        providerPreflight: pre,
        modelConfig: {
          model: HYBRID_LIVE_DEFAULT_MODEL,
          tier: HYBRID_LIVE_DEFAULT_TIER,
          thinkingLevel: HYBRID_LIVE_DEFAULT_THINKING_LEVEL,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          minOutputTokenFloor: HYBRID_LIVE_MIN_CARD_OUTPUT_TOKENS,
          promptVersion: V3_CROP_PROMPT_VERSION,
          schemaVersion: V3_CROP_SCHEMA_VERSION,
          promptSha256: cropFps.promptSha256,
          schemaSha256: cropFps.schemaSha256,
          promptChars: buildV3CardCropSystemPrompt().length,
          schemaJsonChars: JSON.stringify(getV3CardCropGenAiSchema()).length
        },
        budget: {
          b1ActualSpentUsd: B1_ACTUAL_SPENT_USD,
          b2HardCapSpendUsd: B2_HARD_CAP_SPEND_USD,
          cumulativeHardCapSpendUsd: CUMULATIVE_HARD_CAP_SPEND_USD,
          conservativeMaxPotentialCostPerReqUsd: maxCostPerReq,
          fourRequestsWorstCaseSumUsd: Number((maxCostPerReq * 4).toFixed(8)),
          b2RemainingUsd: b2Remaining,
          cumulativeRemainingUsd: cumulativeRemaining,
          fitsBothCeilingsForNextRequest:
            maxCostPerReq <= b2Remaining && maxCostPerReq <= cumulativeRemaining
        },
        allAssetsValid,
        assets
      },
      null,
      2
    )
  );

  if (!pre.ok || !allAssetsValid) {
    process.exit(1);
  }
}

async function executeSingleB2Request(spec: StageB2Spec): Promise<{
  record: StageB2LedgerRecord;
  evalSummary: any;
  gatePassed: boolean;
  gateFailureReason: string | null;
}> {
  const pre = preflightHybridLiveProvider({
    executionContext: 'isolated_hybrid_workflow',
    featureEnabled: true,
    explicitLiveAuthorization: true
  });
  if (!pre.ok) {
    throw new Error(`PREFLIGHT_BLOCKED: ${pre.reason}`);
  }

  const ledger = loadLedger();
  if (ledger.haltedReason) {
    throw new Error(`LEDGER_ALREADY_HALTED: ${ledger.haltedReason}`);
  }
  if (ledger.records.some((r) => r.requestId === spec.requestId)) {
    throw new Error(
      `DUPLICATE_OR_RETRY_BLOCKED: ${spec.requestId} already exists in ledger (automatic retries = 0).`
    );
  }
  if (ledger.submittedRequestsCount >= 4) {
    throw new Error('HARD_CAP_REQUESTS_REACHED: max 4 requests allowed in Stage B2.');
  }

  const absImgPath = join(REPO_ROOT, spec.imageRelPath);
  if (!existsSync(absImgPath)) {
    throw new Error(`MISSING_IMAGE: ${absImgPath}`);
  }
  const actualSha = sha256File(absImgPath);
  const meta = await sharp(absImgPath).metadata();
  if (
    actualSha !== spec.expectedSha256 ||
    meta.width !== spec.expectedWidth ||
    meta.height !== spec.expectedHeight
  ) {
    throw new Error(
      `IMAGE_INTEGRITY_MISMATCH for ${spec.requestId}: got ${actualSha} (${meta.width}x${meta.height}), expected ${spec.expectedSha256} (${spec.expectedWidth}x${spec.expectedHeight}).`
    );
  }

  // Conservative worst-case pre-dispatch budget check
  const maxPotentialCostUsd = computeConservativeMaxPotentialCostUsd();
  const b2Remaining = B2_HARD_CAP_SPEND_USD - ledger.b2ConsumedCostUsd;
  const cumulativeRemaining = CUMULATIVE_HARD_CAP_SPEND_USD - ledger.cumulativeB1PlusB2CostUsd;
  if (maxPotentialCostUsd > b2Remaining || maxPotentialCostUsd > cumulativeRemaining) {
    const reason = `PRE_DISPATCH_BUDGET_GATE: maxPotential=${maxPotentialCostUsd} exceeds b2Remaining=${b2Remaining.toFixed(8)} or cumulativeRemaining=${cumulativeRemaining.toFixed(8)}.`;
    ledger.haltedReason = reason;
    saveLedger(ledger);
    throw new Error(reason);
  }

  const cropFps = getV3CropPromptAndSchemaFingerprints();
  const provider = createHybridGeminiLiveProvider({
    executionContext: 'isolated_hybrid_workflow',
    featureEnabled: true,
    explicitLiveAuthorization: true,
    model: HYBRID_LIVE_DEFAULT_MODEL,
    thinkingLevel: HYBRID_LIVE_DEFAULT_THINKING_LEVEL,
    tier: HYBRID_LIVE_DEFAULT_TIER,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    archiveDir: RAW_DIR
  });

  const userPrompt = buildV3CardCropUserPrompt({
    retailer: spec.retailer,
    leafletId: spec.leafletId,
    slotId: spec.sourceOfferId
  });

  const startedAt = new Date().toISOString();
  const rawResp = await provider.extractCardCrop({
    requestKind: 'card_crop',
    cacheKey: `b2_${spec.requestId.toLowerCase()}_${spec.expectedSha256.slice(0, 12)}`,
    leafletId: spec.leafletId,
    pageNumber: spec.pageNumber,
    retailer: spec.retailer,
    sourceOfferId: spec.sourceOfferId,
    imagePath: absImgPath,
    pixelBox: { x: 0, y: 0, width: spec.expectedWidth, height: spec.expectedHeight },
    promptText: userPrompt
  });
  const endedAt = new Date().toISOString();

  // Read rawArchive to extract modality token breakdown (TEXT vs IMAGE input tokens)
  let textInputTokens: number | null = null;
  let imageInputTokens: number | null = null;
  let usageRawFromArchive: any = null;
  if (rawResp.rawArchivePath && existsSync(rawResp.rawArchivePath)) {
    try {
      const archiveObj = JSON.parse(readFileSync(rawResp.rawArchivePath, 'utf8'));
      usageRawFromArchive = archiveObj?.usageMetadataRaw ?? null;
      const details: Array<{ modality?: string; tokenCount?: number }> =
        usageRawFromArchive?.promptTokensDetails || [];
      for (const d of details) {
        if (d.modality === 'TEXT') textInputTokens = d.tokenCount ?? null;
        if (d.modality === 'IMAGE') imageInputTokens = d.tokenCount ?? null;
      }
    } catch {
      // ignore archive parse issues
    }
  }

  let actualOrConservativeCost = 0;
  if (rawResp.outcomeUnknown) {
    actualOrConservativeCost = maxPotentialCostUsd;
  } else if (rawResp.usage) {
    actualOrConservativeCost = calculateGeminiCost(
      rawResp.usage,
      HYBRID_LIVE_DEFAULT_MODEL,
      HYBRID_LIVE_DEFAULT_TIER
    ).totalCostUsd;
  } else if (typeof rawResp.costUsdOverride === 'number') {
    actualOrConservativeCost = rawResp.costUsdOverride;
  }

  const resolvedDates = resolveLeafletDateMetadata({
    manifestPath: join(REPO_ROOT, spec.manifestRelPath),
    pageNumber: spec.pageNumber
  });

  // Decode + safety pipeline replay (strict + tolerateOmitted checks)
  let strictSchemaValid = false;
  let strictErrors: string[] = [];
  let tolerateSchemaValid = false;
  let decodedCardsCount = 0;
  let cardResults: any[] = [];

  if (rawResp.ok && rawResp.parsedJson) {
    try {
      decodeV3PageExtractionToOfferCards(rawResp.parsedJson, {
        leafletId: spec.leafletId,
        pageNumber: spec.pageNumber,
        sourceOfferIdPrefix: `${spec.leafletId}_p${String(spec.pageNumber).padStart(3, '0')}`,
        retailerId: spec.retailerId,
        retailerName: spec.retailer,
        explicitSingleOfferId: spec.sourceOfferId,
        sourceEvidenceRefInternal: spec.imageRelPath,
        locationScope: 'national',
        tolerateOmittedNullableFields: false
      });
      strictSchemaValid = true;
    } catch (e) {
      strictErrors = [e instanceof Error ? e.message : String(e)];
    }

    try {
      const dec = decodeV3PageExtractionToOfferCards(rawResp.parsedJson, {
        leafletId: spec.leafletId,
        pageNumber: spec.pageNumber,
        sourceOfferIdPrefix: `${spec.leafletId}_p${String(spec.pageNumber).padStart(3, '0')}`,
        retailerId: spec.retailerId,
        retailerName: spec.retailer,
        explicitSingleOfferId: spec.sourceOfferId,
        sourceEvidenceRefInternal: spec.imageRelPath,
        locationScope: 'national',
        tolerateOmittedNullableFields: true
      });
      tolerateSchemaValid = true;
      decodedCardsCount = dec.cards.length;

      cardResults = dec.cards.map((card, idx) => {
        card.source_card.offer_start_date = resolvedDates.offerStartDate;
        card.source_card.offer_end_date = resolvedDates.offerEndDate;
        const decomposition = decomposeV3OfferCard(card);
        const adapterAccuracy = adaptV3DecompositionToOfflineMatching(decomposition);
        const adapterLivePub = adaptV3DecompositionToOfflineMatching(decomposition, {
          enforceNonExpiredForPublication: true,
          publicationReferenceDateIso: '2026-11-14'
        });

        return {
          cardIndex: idx,
          sourceOfferId: card.source_card.source_offer_id,
          titleEn: card.source_card.raw_text.title_en,
          titleAr: card.source_card.raw_text.title_ar,
          sizeText: card.source_card.raw_text.size_text,
          promoBadgeText: card.source_card.raw_text.promo_badge_text,
          pricing: card.pricing,
          quantityAndPromo: card.quantity_and_promo,
          assortment: card.assortment,
          subItems: card.sub_items,
          evidenceConflictsOnCard: card.evidence_conflicts,
          compoundCardContext: card.compound_card_context,
          decomposition: {
            decomposed: decomposition.decomposed,
            basis: decomposition.decomposition_basis,
            retentionMode: decomposition.parent_offer_retention_mode,
            conflictCodes: decomposition.conflict_codes,
            children: decomposition.children.map((ch) => ({
              subItemRef: ch.sub_item_ref,
              brandEn: ch.brand_en,
              brandAr: ch.brand_ar,
              productNameEn: ch.product_name_en,
              productNameAr: ch.product_name_ar,
              variantOrFlavor: ch.variant_or_flavor,
              eachSizeValue: ch.each_size_value,
              eachSizeUnit: ch.each_size_unit,
              manufacturerPackCount: ch.manufacturer_pack_count,
              checkoutMultibuyQty: ch.retailer_checkout_multibuy_qty,
              promoPrice: ch.parent_promo_price,
              originalPrice: ch.parent_original_price
            })),
            unresolvedSubItems: decomposition.unresolved_sub_items.map((u) => ({
              subItemRef: u.sub_item_ref,
              brandEn: u.brand_en,
              productNameEn: u.product_name_en,
              variantOrFlavor: u.variant_or_flavor,
              unknownAttributes: u.unknown_attributes,
              conflictAttributes: u.conflict_attributes
            }))
          },
          matchingAdapter: {
            matchableChildrenCount: adapterAccuracy.matchableChildren.length,
            matchableKeys: adapterAccuracy.matchableChildren.map((m) => m.candidate_key),
            unresolvedChildrenCount: adapterAccuracy.unresolvedChildren.length,
            parentOutcomeAccuracy: adapterAccuracy.parentPublicationAssessment.outcome,
            parentEligibleAccuracy:
              adapterAccuracy.parentPublicationAssessment.isEligibleForNonCatalogPublication,
            parentQuarantineReasonsAccuracy:
              adapterAccuracy.parentPublicationAssessment.quarantineReasons,
            parentOutcomeLivePubGate: adapterLivePub.parentPublicationAssessment.outcome,
            parentEligibleLivePubGate:
              adapterLivePub.parentPublicationAssessment.isEligibleForNonCatalogPublication,
            parentQuarantineReasonsLivePubGate:
              adapterLivePub.parentPublicationAssessment.quarantineReasons
          }
        };
      });
    } catch (e) {
      strictErrors.push(`TOLERATE_DECODE_ERROR: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  mkdirSync(EVAL_DIR, { recursive: true });
  const evalOutputPath = join(EVAL_DIR, `${spec.requestId}.eval.json`);
  const evalSummary = {
    requestId: spec.requestId,
    label: spec.label,
    ok: rawResp.ok,
    finishReason: rawResp.finishReason ?? null,
    errorCode: rawResp.errorCode ?? null,
    errorMessage: rawResp.errorMessage ?? null,
    durationMs: rawResp.durationMs,
    resolvedLeafletDates: resolvedDates,
    strictSchemaValid,
    strictErrors,
    tolerateSchemaValid,
    decodedCardsCount,
    tokenUsage: rawResp.usage
      ? {
          inputTokens: rawResp.usage.promptTokenCount,
          textInputTokens,
          imageInputTokens,
          outputTokens: rawResp.usage.candidatesTokenCount ?? 0,
          thinkingTokens: rawResp.usage.thoughtsTokenCount ?? 0,
          cachedInputTokens: rawResp.usage.cachedContentTokenCount ?? 0,
          totalTokens: rawResp.usage.totalTokenCount ?? 0
        }
      : null,
    usageRawFromArchive,
    costUsd: Number(actualOrConservativeCost.toFixed(8)),
    rawArchivePath: rawResp.rawArchivePath ?? null,
    cards: cardResults
  };
  writeFileSync(evalOutputPath, JSON.stringify(evalSummary, null, 2), 'utf8');

  const record: StageB2LedgerRecord = {
    requestId: spec.requestId,
    sourceOfferId: spec.sourceOfferId,
    sourceImagePath: spec.imageRelPath,
    sourceImageSha256: actualSha,
    imageWidthPx: spec.expectedWidth,
    imageHeightPx: spec.expectedHeight,
    model: HYBRID_LIVE_DEFAULT_MODEL,
    tier: HYBRID_LIVE_DEFAULT_TIER,
    location: process.env.GOOGLE_CLOUD_LOCATION || 'global',
    thinkingLevel: HYBRID_LIVE_DEFAULT_THINKING_LEVEL,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    promptVersion: V3_CROP_PROMPT_VERSION,
    schemaVersion: V3_CROP_SCHEMA_VERSION,
    promptSha256: cropFps.promptSha256,
    schemaSha256: cropFps.schemaSha256,
    startedAt,
    endedAt,
    durationMs: rawResp.durationMs,
    ok: rawResp.ok,
    outcomeUnknown: Boolean(rawResp.outcomeUnknown),
    errorCode: rawResp.errorCode ?? null,
    errorMessage: rawResp.errorMessage ?? null,
    finishReason: rawResp.finishReason ?? null,
    tokenUsage: evalSummary.tokenUsage,
    conservativeMaxPotentialCostUsd: maxPotentialCostUsd,
    actualOrConservativeCostUsd: Number(actualOrConservativeCost.toFixed(8)),
    rawArchivePath: rawResp.rawArchivePath ?? null,
    evalOutputPath
  };

  let gatePassed = true;
  let gateFailureReason: string | null = null;
  if (!rawResp.ok || rawResp.finishReason !== 'STOP') {
    gatePassed = false;
    gateFailureReason = `${spec.requestId} failed finishReason/ok gate: ok=${rawResp.ok}, finishReason=${rawResp.finishReason}, error=${rawResp.errorCode || rawResp.errorMessage}`;
  } else if (!tolerateSchemaValid || decodedCardsCount === 0) {
    gatePassed = false;
    gateFailureReason = `${spec.requestId} failed schema/decode gate: tolerateSchemaValid=${tolerateSchemaValid}, decodedCardsCount=${decodedCardsCount}`;
  } else if (spec.requestId === 'B2-REQ-01') {
    const anyCard = cardResults[0];
    if (!anyCard || anyCard.matchingAdapter.matchableChildrenCount > 0 && !anyCard.decomposition.decomposed) {
      gatePassed = false;
      gateFailureReason = 'B2-REQ-01 consistency failure on Pepsi card';
    }
  }

  const refreshed = loadLedger();
  refreshed.submittedRequestsCount += 1;
  refreshed.b2ConsumedCostUsd = Number(
    (refreshed.b2ConsumedCostUsd + actualOrConservativeCost).toFixed(8)
  );
  refreshed.cumulativeB1PlusB2CostUsd = Number(
    (B1_ACTUAL_SPENT_USD + refreshed.b2ConsumedCostUsd).toFixed(8)
  );
  refreshed.records.push(record);
  if (!gatePassed && gateFailureReason) {
    refreshed.haltedReason = gateFailureReason;
  }
  saveLedger(refreshed);

  return { record, evalSummary, gatePassed, gateFailureReason };
}

async function runPhaseReq1() {
  const pepsiSpec = B2_MANIFEST_SPECS[0];
  const res = await executeSingleB2Request(pepsiSpec);
  console.log(JSON.stringify({ phase: 'req1', ...res }, null, 2));
  if (!res.gatePassed) {
    console.error(`GATE 1 FAILED — STOPPING STAGE B2: ${res.gateFailureReason}`);
    process.exit(1);
  }
}

async function runPhaseReq2To4() {
  const ledger = loadLedger();
  const req1 = ledger.records.find((r) => r.requestId === 'B2-REQ-01');
  if (!req1 || !req1.ok || req1.finishReason !== 'STOP') {
    throw new Error('Cannot execute req2to4 before B2-REQ-01 has passed Gate 1.');
  }

  const results = [];
  for (const spec of B2_MANIFEST_SPECS.slice(1)) {
    const res = await executeSingleB2Request(spec);
    results.push(res);
    if (!res.gatePassed) {
      console.log(JSON.stringify({ phase: 'req2to4_halted', results, ledger: loadLedger() }, null, 2));
      process.exit(1);
    }
  }

  console.log(
    JSON.stringify(
      {
        phase: 'req2to4_completed',
        ledger: loadLedger(),
        results: results.map((r) => ({
          requestId: r.record.requestId,
          ok: r.record.ok,
          finishReason: r.record.finishReason,
          durationMs: r.record.durationMs,
          tokenUsage: r.record.tokenUsage,
          actualCostUsd: r.record.actualOrConservativeCostUsd,
          evalSummary: r.evalSummary
        }))
      },
      null,
      2
    )
  );
}

async function main() {
  const phase = parseArg('phase') || 'preflight';
  if (phase === 'preflight') {
    await runPreflight();
  } else if (phase === 'req1') {
    await runPhaseReq1();
  } else if (phase === 'req2to4') {
    await runPhaseReq2To4();
  } else {
    throw new Error(`Unsupported phase: ${phase}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
