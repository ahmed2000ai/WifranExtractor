/**
 * WIFRAN-EXTRACTOR-IDENTITY-005I
 * Hybrid V3 Leaflet Extraction Processor for Single & Batch App Workflows.
 *
 * Bridges validated `runHybridPageWorkflow` (`005G–005H-B2`) with:
 * - Page-level durable checkpointing, cancellation & resume
 * - Two-image cropping (`offer_card_crop.webp` + `product_thumb_crop.webp`)
 * - V3 safety & assortment decomposition (`adaptV3DecompositionToOfflineMatching`)
 * - Safe image-subject scoping (multi-product/conflicted crops never become verified SKU thumbnails)
 * - `staged-draft.json` persistence preserving full `originalOcr` evidence snapshots
 */

import fs from 'fs';
import path from 'path';
import type {
  HybridExecutionContext,
  HybridExtractionProvider,
  HybridPageRunResult,
  ReconciledV3CardResult
} from '../../shared/types/hybridExtractionV3';
import type {
  StagedLeafletDraft,
  StagedOfferItem
} from '../../shared/types/stagedDraft';
import type { LeafletMetadataScope } from '../../shared/types/batchExtraction';
import {
  InMemoryHybridCacheStore,
  runHybridPageWorkflow,
  type HybridResponseCacheStore
} from '../ocr/hybrid/hybridWorkflowOrchestrator';
import { createHybridGeminiLiveProvider } from '../ocr/hybrid/hybridGeminiLiveProvider';
import { auditHybridSafetyInvariants } from '../ocr/hybrid/hybridSafetyInvariants';
import { buildLedgerEntryFromProviderCall } from '../ocr/geminiCostLedgerService';
import type { GeminiUsageLedgerEntry } from '../../shared/types/costAccounting';
import {
  canAttachProductImageToCatalogSku,
  generateOfferAndProductCrops
} from '../ocr/hybrid/hybridCropGenerator';
import { adaptV3DecompositionToOfflineMatching } from '../db/v3MatchingInputAdapter';
import { detectSingleDayOfferException } from '../metadata/validityDateParser';
import {
  DocumentExtractionHistoryService,
  sharedDocumentExtractionHistoryService
} from '../cache/documentExtractionHistoryService';
import {
  CURRENT_HYBRID_COMPATIBILITY_PROFILE,
  computeDocumentIdFromFingerprint,
  computeOfferAnchorSignature
} from '../../shared/utils/sourceIdentityAndDuplicateUtils';

function annotateSingleDayOfferException(params: {
  promoNotes: string | null | undefined;
  card: ReconciledV3CardResult['reconciledCard'];
  conflictCodes: string[];
}): { promoNotes: string | null; conflictCodes: string[] } {
  const textToCheck = [
    params.promoNotes,
    params.card.pricing.promo_conditions,
    params.card.source_card.raw_text.title_en,
    params.card.source_card.raw_text.title_ar,
    params.card.source_card.raw_text.promo_badge_text,
    params.card.source_card.raw_text.size_text,
    ...(params.card.source_card.raw_text.price_text_candidates || [])
  ]
    .filter(Boolean)
    .join(' ');
  const singleDay = detectSingleDayOfferException(textToCheck);
  if (!singleDay.isSingleDay) {
    return {
      promoNotes: params.promoNotes ?? null,
      conflictCodes: params.conflictCodes
    };
  }
  const nextConflicts = params.conflictCodes.includes('SINGLE_DAY_OFFER_EXCEPTION')
    ? params.conflictCodes
    : [...params.conflictCodes, 'SINGLE_DAY_OFFER_EXCEPTION'];
  const baseNotes = (params.promoNotes || '').trim();
  const nextNotes = baseNotes.toLowerCase().includes('one day only')
    ? baseNotes
    : [baseNotes, singleDay.reason].filter(Boolean).join(' — ');
  return {
    promoNotes: nextNotes || singleDay.reason || null,
    conflictCodes: nextConflicts
  };
}

export interface HybridV3LeafletRunInput {
  batchId?: string;
  ledgerSessionRunId?: string;
  onLedgerEntry?: (entry: GeminiUsageLedgerEntry) => void;
  leafletId: string;
  fileName: string;
  filePath: string;
  fileFingerprint?: string | null;
  workspacePath: string;
  pageCount: number;
  pagesToProcess?: number[];
  metadata: LeafletMetadataScope;
  executionContext?: HybridExecutionContext;
  explicitAuthorization: boolean;
  featureEnabled: boolean;
  explicitLiveAuthorization?: boolean;
  disablePageContextVerification?: boolean;
  enforceNonExpiredForPublication?: boolean;
  publicationReferenceDateIso?: string | null;
  approvedMaxBudgetUsd?: number | null;
  forceReextract?: boolean;
  historyService?: DocumentExtractionHistoryService;
  provider?: HybridExtractionProvider;
  cacheStore?: HybridResponseCacheStore;
  isCancelled?: () => boolean;
  onPageProgress?: (info: {
    pageNumber: number;
    completedPages: number;
    totalPages: number;
    offersSoFar: number;
    costUsdSoFar: number;
    message: string;
  }) => void;
}

export interface HybridV3LeafletRunOutput {
  ok: boolean;
  cancelled: boolean;
  error?: string | null;
  pagesProcessed: number;
  completedPageNumbers: number[];
  reusedPageNumbers?: number[];
  offersCount: number;
  estimatedCostUsd: number;
  pageResults: HybridPageRunResult[];
  ledgerEntries?: GeminiUsageLedgerEntry[];
  safetyViolationsCount: number;
}

interface HybridV3LeafletProgressCheckpoint {
  schemaVersion: 'wifran.hybrid_v3.leaflet_progress/1.0';
  leafletId: string;
  completedPages: number[];
  failedPages?: Record<number, { attempts: number; lastError: string; updatedAt: string }>;
  totalCostUsd: number;
  updatedAt: string;
}

function listRenderedPageNumbers(workspacePath: string, fallbackCount: number): number[] {
  const pagesDir = path.join(workspacePath, 'pages');
  const discovered: number[] = [];
  if (fs.existsSync(pagesDir)) {
    for (const file of fs.readdirSync(pagesDir)) {
      const m = file.match(/^page\.(\d+)\.(png|jpg|jpeg|webp)$/i);
      if (m) {
        discovered.push(parseInt(m[1], 10));
      }
    }
  }
  if (discovered.length > 0) {
    return discovered.sort((a, b) => a - b);
  }
  const n = Math.max(1, fallbackCount || 1);
  return Array.from({ length: n }, (_, i) => i + 1);
}

function resolvePageImagePath(workspacePath: string, pageNumber: number): string {
  const candidates = [
    path.join(workspacePath, 'pages', `page.${pageNumber}.png`),
    path.join(workspacePath, 'pages', `page.${pageNumber}.webp`),
    path.join(workspacePath, 'pages', `page.${pageNumber}.jpg`)
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

function computeDiscountPercent(promo: number | null, orig: number | null): number | null {
  if (promo == null || orig == null || orig <= 0 || promo >= orig) return null;
  return Math.round(((orig - promo) / orig) * 100);
}

function createExtendedStagedItem(params: {
  itemId: string;
  sourceOfferId: string;
  parentSourceOfferId: string;
  pageNumber: number;
  titleEn: string | null;
  titleAr: string | null;
  brand: string | null;
  brandAr?: string | null;
  brandEn?: string | null;
  variantOrFlavor?: string | null;
  sizeOrWeight: string | null;
  priceBefore: number | null;
  priceAfter: number | null;
  promoNotes: string | null;
  innerPackCount: number | null;
  eachSizeValue: number | null;
  eachSizeUnit: string | null;
  totalContentValue: number | null;
  totalContentUnit: string | null;
  freeUnitsText: string | null;
  customerLimit: number | null;
  promoConditionQty: number | null;
  promotionMechanic: string | null;
  quantitySemantics: string | null;
  saleUnitType: string | null;
  assortmentStatus: string | null;
  category: string | null;
  confidence: 'high' | 'medium' | 'low';
  offerCardCropPath: string;
  productThumbCropPath: string | null;
  originalPageImagePath: string;
  imageSubjectScope: 'product_package' | 'representative_assortment' | 'unverified';
  canUseProductThumbForCatalogSku: boolean;
  conflictCodes: string[];
  quarantineReasons: string[];
  v3RetentionMode: string;
  v3CropStatus: string;
  decomposedChildIndex?: number | null;
  decomposedChildrenCount?: number | null;
  sourceDocumentId?: string | null;
  sourceOfferAnchor?: string | null;
  sourceBboxNorm?: [number, number, number, number] | null;
  reconciled: ReconciledV3CardResult;
}): StagedOfferItem {
  const discountPercent = computeDiscountPercent(params.priceAfter, params.priceBefore);
  // Supermarket provenance & leaflet validity dates are verified in Step 3 and dynamically
  // re-checked in Step 5 publication preflight; do not freeze them as stale item blockingErrors.
  const deferredLeafletCodes = new Set([
    'MISSING_SUPERMARKET_PROVENANCE',
    'MISSING_CRITICAL_OFFER_DATES',
    'MISSING_OR_INVALID_VALIDITY_DATES',
    'INVALID_LOCATION_SCOPE',
    'WEIGHT_RANGE_UNPAIRED',
    'MULTIPLE_PRODUCT_VARIANTS_DETECTED',
    'INCOMPLETE_VISIBLE_ASSORTMENT'
  ]);
  const itemLevelQuarantineReasons = params.quarantineReasons.filter(
    (code) => !deferredLeafletCodes.has(code)
  );

  const isAssortedOffer =
    params.assortmentStatus === 'multiple_variants' ||
    params.assortmentStatus === 'visual_multiple_variants' ||
    params.assortmentStatus === 'unsplit_assortment' ||
    params.assortmentStatus === 'ambiguous_alternatives' ||
    params.v3RetentionMode === 'unsplit_non_catalog_candidate';

  const formatAssorted = (text: string | null | undefined, lang: 'en' | 'ar'): string => {
    if (!text || !text.trim()) return '';
    const trimmed = text.trim();
    if (lang === 'en') {
      return /\b(?:assorted|asstd|variety|mixed)\b/i.test(trimmed) ? trimmed : `${trimmed} — Assorted`;
    }
    return /(?:متنوع|منوع|مشكل|نكهات)/u.test(trimmed) ? trimmed : `${trimmed} — متنوع`;
  };

  const finalTitleEn = isAssortedOffer ? formatAssorted(params.titleEn, 'en') : params.titleEn;
  const finalTitleAr = isAssortedOffer ? formatAssorted(params.titleAr, 'ar') : params.titleAr;

  const originalOcr = {
    titleEn: params.titleEn,
    titleAr: params.titleAr,
    brand: params.brand,
    sizeOrWeight: params.sizeOrWeight,
    priceBefore: params.priceBefore,
    priceAfter: params.priceAfter,
    discountPercent,
    promoNotes: params.promoNotes,
    inner_pack_count: params.innerPackCount,
    each_size_value: params.eachSizeValue,
    each_size_unit: params.eachSizeUnit,
    total_content_value: params.totalContentValue,
    total_content_unit: params.totalContentUnit,
    free_units_text: params.freeUnitsText,
    customer_limit: params.customerLimit != null ? String(params.customerLimit) : null,
    sale_unit_type: params.saleUnitType,
    productThumbLocalPath: params.productThumbCropPath
  };

  const selectedImageSource =
    params.productThumbCropPath && (params.canUseProductThumbForCatalogSku || isAssortedOffer)
      ? 'product_thumb'
      : 'none';

  return {
    id: params.itemId,
    sourceOfferId: params.sourceOfferId,
    pageNumber: params.pageNumber,
    originalOcr,
    isAiCorrected: false,
    operatorEditedFields: [],
    isOperatorModified: false,
    titleEn: finalTitleEn,
    titleAr: finalTitleAr,
    brand: params.brand,
    sizeOrWeight: params.sizeOrWeight,
    priceBefore: params.priceBefore,
    priceAfter: params.priceAfter,
    discountPercent,
    promoNotes: params.promoNotes,
    inner_pack_count: params.innerPackCount,
    each_size_value: params.eachSizeValue,
    each_size_unit: params.eachSizeUnit,
    total_content_value: params.totalContentValue,
    total_content_unit: params.totalContentUnit,
    free_units_text: params.freeUnitsText,
    customer_limit: params.customerLimit != null ? String(params.customerLimit) : null,
    sale_unit_type: params.saleUnitType,
    croppedEvidenceLocalPath: params.offerCardCropPath,
    productThumbLocalPath: params.productThumbCropPath,
    selectedImageSource,
    status: itemLevelQuarantineReasons.length > 0 ? 'pending' : 'ready',
    // Extended metadata preserved dynamically in staged-draft.json for UnifiedBatchOffer
    ...( {
      parentSourceOfferId: params.parentSourceOfferId,
      sourceDocumentId: params.sourceDocumentId ?? null,
      sourceOfferAnchor: params.sourceOfferAnchor ?? null,
      sourceBboxNorm: params.sourceBboxNorm ?? null,
      brandAr: params.brandAr ?? params.brand,
      brandEn: params.brandEn ?? params.brand,
      variantOrFlavor: params.variantOrFlavor ?? null,
      promo_condition_quantity: params.promoConditionQty,
      promotion_mechanic: params.promotionMechanic,
      quantity_semantics: params.quantitySemantics,
      assortment_status: params.assortmentStatus,
      category: params.category,
      confidence: params.confidence,
      originalPageImagePath: params.originalPageImagePath,
      imageSubjectScope: params.imageSubjectScope,
      conflictCodes: params.conflictCodes,
      quarantineReasons: itemLevelQuarantineReasons,
      v3RetentionMode: params.v3RetentionMode,
      v3CropStatus: params.v3CropStatus,
      decomposedChildIndex: params.decomposedChildIndex ?? null,
      decomposedChildrenCount: params.decomposedChildrenCount ?? null,
      warnings: params.conflictCodes,
      blockingErrors: itemLevelQuarantineReasons,
      canonical: {
        source: {
          source_item_number: params.sourceOfferId,
          source_page_number: params.pageNumber,
          parent_source_offer_id: params.parentSourceOfferId,
          crop_path: params.offerCardCropPath
        },
        product: {
          product_name_en: params.titleEn,
          product_name_ar: params.titleAr,
          brand: params.brand,
          brand_en: params.brandEn ?? params.brand,
          brand_ar: params.brandAr ?? params.brand,
          variant_or_flavor: params.variantOrFlavor ?? null,
          item_domain: params.category || 'grocery'
        },
        pricing: {
          promotional_price: params.priceAfter,
          original_price: params.priceBefore,
          currency: params.reconciled.reconciledCard.pricing.currency
        },
        reconciled_v3: params.reconciled.reconciledCard,
        publication_assessment_v3: params.reconciled.publicationAssessment
      }
    } as Record<string, unknown> )
  };
}

/**
 * Runs Hybrid V3 extraction across one leaflet's rendered pages with durable
 * page-level checkpointing, cancellation, two-image cropping, and V3 decomposition.
 */
export async function runHybridV3LeafletExtraction(
  input: HybridV3LeafletRunInput
): Promise<HybridV3LeafletRunOutput> {
  if (!input.featureEnabled || !input.explicitAuthorization) {
    return {
      ok: false,
      cancelled: false,
      error: 'HYBRID_V3_NOT_AUTHORIZED: Hybrid V3 mode requires explicit operator opt-in.',
      pagesProcessed: 0,
      completedPageNumbers: [],
      offersCount: 0,
      estimatedCostUsd: 0,
      pageResults: [],
      safetyViolationsCount: 0
    };
  }

  const allPages = listRenderedPageNumbers(input.workspacePath, input.pageCount);
  const targetPages =
    input.pagesToProcess && input.pagesToProcess.length > 0
      ? allPages.filter((p) => input.pagesToProcess!.includes(p))
      : allPages;

  const checkpointDir = path.join(input.workspacePath, 'hybrid_v3_checkpoints');
  const resultsDir = path.join(input.workspacePath, 'hybrid_v3_results');
  const archiveDir = path.join(input.workspacePath, 'hybrid_v3_archive');
  fs.mkdirSync(checkpointDir, { recursive: true });
  fs.mkdirSync(resultsDir, { recursive: true });

  const progressFile = path.join(checkpointDir, 'leaflet_v3_progress.json');
  let checkpoint: HybridV3LeafletProgressCheckpoint = {
    schemaVersion: 'wifran.hybrid_v3.leaflet_progress/1.0',
    leafletId: input.leafletId,
    completedPages: [],
    totalCostUsd: 0,
    updatedAt: new Date().toISOString()
  };

  if (!input.forceReextract && fs.existsSync(progressFile)) {
    try {
      checkpoint = JSON.parse(fs.readFileSync(progressFile, 'utf8')) as HybridV3LeafletProgressCheckpoint;
    } catch {
      // ignore corrupted progress checkpoint and restart cleanly
    }
  }

  const provider: HybridExtractionProvider =
    input.provider ||
    createHybridGeminiLiveProvider({
      executionContext: input.executionContext || 'normal_app',
      featureEnabled: input.featureEnabled,
      explicitLiveAuthorization: input.explicitLiveAuthorization === true,
      archiveDir
    });

  const cacheStore = input.cacheStore || new InMemoryHybridCacheStore();
  const historyService = input.historyService || sharedDocumentExtractionHistoryService;
  const documentId = computeDocumentIdFromFingerprint(input.fileFingerprint, input.fileName);
  const collectedLedgerEntries: GeminiUsageLedgerEntry[] = [];
  const effectiveBatchId = input.batchId || input.leafletId;
  const effectiveSessionRunId = input.ledgerSessionRunId || `run_${Date.now()}`;
  const draftPath = path.join(input.workspacePath, 'staged-draft.json');
  const existingDraft = fs.existsSync(draftPath)
    ? (JSON.parse(fs.readFileSync(draftPath, 'utf8')) as StagedLeafletDraft)
    : null;

  // ID-03: Preserve prior revision backup before overwriting when forceReextract is enabled
  if (input.forceReextract && fs.existsSync(draftPath)) {
    try {
      const revisionDir = path.join(input.workspacePath, '.revision_history');
      fs.mkdirSync(revisionDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(draftPath, path.join(revisionDir, `staged-draft.${ts}.json`));
    } catch {
      // Non-fatal archival backup
    }
  }

  // DUP-01E/F: Query validated historical extractions for overlapping pages across workspaces/filenames
  const historyLookup =
    !input.forceReextract && input.fileFingerprint
      ? historyService.getReusablePagesForDocument({
          fileFingerprint: input.fileFingerprint,
          fileName: input.fileName,
          targetPages,
          expectedProfile: {
            ...CURRENT_HYBRID_COMPATIBILITY_PROFILE,
            pipelineMode: 'hybrid_v3'
          },
          expectedMetadata: input.metadata
        })
      : { reusableByPage: {}, incompatibilityReasons: [], matchedPriorFileName: null, matchedPriorWorkspace: null };
  const reusedPageNumbers: number[] = [];

  // Preserve staged items from already-completed pages during resume
  const itemsByPage = new Map<number, StagedOfferItem[]>();
  if (!input.forceReextract && existingDraft?.items) {
    for (const item of existingDraft.items) {
      const p = item.pageNumber || 1;
      if (checkpoint.completedPages.includes(p)) {
        const arr = itemsByPage.get(p) || [];
        arr.push(item);
        itemsByPage.set(p, arr);
      }
    }
  }

  const pageResults: HybridPageRunResult[] = [];
  let safetyViolationsCount = 0;

  const persistStagedDraft = (): number => {
    const allStagedItems: StagedOfferItem[] = [];
    for (const p of Array.from(itemsByPage.keys()).sort((a, b) => a - b)) {
      allStagedItems.push(...(itemsByPage.get(p) || []));
    }

    const nowIso = new Date().toISOString();
    const stagedDraft: StagedLeafletDraft = {
      schemaVersion: 'wifran.staged.draft/1.0',
      jobDir: input.workspacePath,
      leafletHash: input.fileFingerprint || existingDraft?.leafletHash || undefined,
      documentId,
      sourcePdfPath: input.filePath,
      createdAt: existingDraft?.createdAt || nowIso,
      updatedAt: nowIso,
      status: 'draft',
      header: {
        supermarketId: input.metadata.supermarketId ?? existingDraft?.header?.supermarketId ?? null,
        region: input.metadata.locationLabel ?? existingDraft?.header?.region ?? null,
        locationScope: input.metadata.locationScope ?? existingDraft?.header?.locationScope ?? null,
        cityId: input.metadata.cityId ?? existingDraft?.header?.cityId ?? null,
        regionId: input.metadata.regionId ?? existingDraft?.header?.regionId ?? null,
        locationSlug: input.metadata.locationSlug ?? existingDraft?.header?.locationSlug ?? null,
        validFrom: input.metadata.offerStartDate ?? existingDraft?.header?.validFrom ?? null,
        validTo: input.metadata.offerEndDate ?? existingDraft?.header?.validTo ?? null,
        localPreviewPages: targetPages.map((p) => ({
          pageNumber: p,
          imagePath: resolvePageImagePath(input.workspacePath, p)
        })),
        headerModifiedByOperator: Boolean(input.metadata.verified)
      },
      items: allStagedItems
    } as StagedLeafletDraft;

    fs.writeFileSync(draftPath, JSON.stringify(stagedDraft, null, 2), 'utf8');
    return allStagedItems.length;
  };

  for (const pageNumber of targetPages) {
    if (input.isCancelled?.()) {
      const offersSoFar = persistStagedDraft();
      return {
        ok: false,
        cancelled: true,
        error: 'Cancelled by operator.',
        pagesProcessed: checkpoint.completedPages.length,
        completedPageNumbers: [...checkpoint.completedPages],
        reusedPageNumbers,
        offersCount: offersSoFar,
        estimatedCostUsd: Number(checkpoint.totalCostUsd.toFixed(6)),
        pageResults,
        safetyViolationsCount
      };
    }

    const pageImagePath = resolvePageImagePath(input.workspacePath, pageNumber);

    if (!input.forceReextract && checkpoint.completedPages.includes(pageNumber) && itemsByPage.has(pageNumber)) {
      reusedPageNumbers.push(pageNumber);
      continue;
    }

    // DUP-01E: Hydrate cross-workspace / renamed-PDF historical page artifacts at $0 API cost
    const historicalRec = !input.forceReextract ? historyLookup.reusableByPage[pageNumber] : undefined;
    if (historicalRec) {
      try {
        const histDraft = JSON.parse(fs.readFileSync(historicalRec.stagedDraftPath, 'utf8')) as StagedLeafletDraft;
        const histPageItems = (histDraft.items || []).filter((it) => (it.pageNumber || 1) === pageNumber);
        const histResult = JSON.parse(fs.readFileSync(historicalRec.resultJsonPath, 'utf8'));
        if (histPageItems.length > 0 && histResult?.pageResult) {
          // Copy page artifact into current workspace so local artifacts stay self-contained
          fs.writeFileSync(
            path.join(resultsDir, `page_${pageNumber}.v3.json`),
            JSON.stringify(histResult, null, 2),
            'utf8'
          );
          const sameWorkspace = path.resolve(input.workspacePath) === path.resolve(historicalRec.workspacePath);
          const reusedCropsDir = path.join(input.workspacePath, 'crops', `page_${pageNumber}`);
          if (!sameWorkspace && !fs.existsSync(reusedCropsDir)) {
            fs.mkdirSync(reusedCropsDir, { recursive: true });
          }
          const copyCropIfNeeded = (srcPath?: string | null, itemIdx?: number, suffix?: string): string | null | undefined => {
            if (!srcPath) return srcPath;
            if (sameWorkspace || !fs.existsSync(srcPath)) return srcPath;
            try {
              const baseName = path.basename(srcPath);
              const destName = itemIdx !== undefined ? `reused_${itemIdx}_${suffix || ''}_${baseName}` : baseName;
              const destPath = path.join(reusedCropsDir, destName);
              if (!fs.existsSync(destPath)) {
                fs.copyFileSync(srcPath, destPath);
              }
              return destPath;
            } catch {
              return srcPath;
            }
          };

          itemsByPage.set(
            pageNumber,
            histPageItems.map((it, idx) => ({
              ...it,
              croppedEvidenceLocalPath: copyCropIfNeeded(it.croppedEvidenceLocalPath, idx, 'offer') || it.croppedEvidenceLocalPath || '',
              productThumbLocalPath: copyCropIfNeeded(it.productThumbLocalPath, idx, 'thumb') ?? it.productThumbLocalPath,
              ...(pageImagePath || (it as any).originalPageImagePath
                ? { originalPageImagePath: pageImagePath || (it as any).originalPageImagePath }
                : {}),
              sourceDocumentId: documentId
            }))
          );
          pageResults.push({
            ...histResult.pageResult,
            telemetry: {
              ...(histResult.pageResult.telemetry || {}),
              totalEstimatedCostUsd: 0
            }
          });
          if (!checkpoint.completedPages.includes(pageNumber)) {
            checkpoint.completedPages.push(pageNumber);
            checkpoint.completedPages.sort((a, b) => a - b);
          }
          checkpoint.updatedAt = new Date().toISOString();
          fs.writeFileSync(progressFile, JSON.stringify(checkpoint, null, 2), 'utf8');
          persistStagedDraft();
          reusedPageNumbers.push(pageNumber);
          input.onPageProgress?.({
            pageNumber,
            completedPages: checkpoint.completedPages.length,
            totalPages: targetPages.length,
            offersSoFar: Array.from(itemsByPage.values()).reduce((sum, a) => sum + a.length, 0),
            costUsdSoFar: Number(checkpoint.totalCostUsd.toFixed(6)),
            message: `Reused validated historical extraction for page ${pageNumber} ($0.00 cost)`
          });
          const cacheEntry = buildLedgerEntryFromProviderCall({
            requestId: `${effectiveBatchId}:${input.leafletId}:p${pageNumber}:hist_cache:${effectiveSessionRunId}`,
            batchId: effectiveBatchId,
            runId: effectiveSessionRunId,
            leafletId: input.leafletId,
            pageNumber,
            sourceAnchor: `page:${pageNumber}`,
            stageCategory: 'b1_full_page',
            requestPurpose: 'b1_historical_cache_reuse',
            modelId: 'gemini-3.8-flash',
            apiProvider: 'cache',
            requestedTier: 'flex',
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: 0,
            outcome: 'cache_hit',
            cacheHit: true,
            usageReported: true
          });
          collectedLedgerEntries.push(cacheEntry);
          input.onLedgerEntry?.(cacheEntry);
          continue;
        }
      } catch {
        // Fall through cleanly to normal extraction if historical payload cannot be hydrated
      }
    }

    if (
      typeof input.approvedMaxBudgetUsd === 'number' &&
      Number.isFinite(input.approvedMaxBudgetUsd) &&
      input.approvedMaxBudgetUsd > 0 &&
      checkpoint.totalCostUsd >= input.approvedMaxBudgetUsd
    ) {
      const offersSoFar = persistStagedDraft();
      return {
        ok: false,
        cancelled: false,
        error: `BUDGET_CAP_EXCEEDED: Authorized spending cap ($${input.approvedMaxBudgetUsd.toFixed(4)}) reached before page ${pageNumber} ($${checkpoint.totalCostUsd.toFixed(4)} spent).`,
        pagesProcessed: checkpoint.completedPages.length,
        completedPageNumbers: [...checkpoint.completedPages],
        offersCount: offersSoFar,
        estimatedCostUsd: Number(checkpoint.totalCostUsd.toFixed(6)),
        pageResults,
        safetyViolationsCount
      };
    }

    const remainingLeafletBudgetUsd =
      typeof input.approvedMaxBudgetUsd === 'number' &&
      Number.isFinite(input.approvedMaxBudgetUsd) &&
      input.approvedMaxBudgetUsd > 0
        ? Math.max(0.0001, input.approvedMaxBudgetUsd - checkpoint.totalCostUsd)
        : undefined;

    const cropOutputDir = path.join(input.workspacePath, 'crops', 'hybrid_v3', `page_${pageNumber}`);
    const pageCheckpointPath = path.join(checkpointDir, `page_${pageNumber}.checkpoint.json`);

    const pageResult = await runHybridPageWorkflow({
      executionContext: input.executionContext || 'normal_app',
      explicitAuthorization: true,
      featureEnabled: true,
      runId: `${input.leafletId}_p${pageNumber}`,
      batchId: effectiveBatchId,
      ledgerSessionRunId: effectiveSessionRunId,
      onLedgerEntry: (entry) => {
        collectedLedgerEntries.push(entry);
        input.onLedgerEntry?.(entry);
      },
      leafletId: input.leafletId,
      pageNumber,
      retailer: input.metadata.supermarketName || input.metadata.supermarketId || 'Unverified Retailer',
      retailerId: input.metadata.supermarketId || null,
      offerStartDate: input.metadata.offerStartDate || null,
      offerEndDate: input.metadata.offerEndDate || null,
      locationScope: input.metadata.locationScope || null,
      pageAssetPath: pageImagePath,
      pageImagePath,
      cropOutputDir,
      checkpointPath: pageCheckpointPath,
      disablePageContextVerification: input.disablePageContextVerification ?? true,
      enforceNonExpiredForPublication: input.enforceNonExpiredForPublication ?? false,
      publicationReferenceDateIso: input.publicationReferenceDateIso ?? null,
      budgetPolicy: remainingLeafletBudgetUsd ? { maxSpendUsdPerJob: remainingLeafletBudgetUsd } : undefined,
      provider,
      cacheStore
    });

    pageResults.push(pageResult);

    if (!pageResult.ok) {
      checkpoint.totalCostUsd = Number(
        (checkpoint.totalCostUsd + (pageResult.telemetry?.totalEstimatedCostUsd || 0)).toFixed(6)
      );
      checkpoint.failedPages = checkpoint.failedPages || {};
      const prevFail = checkpoint.failedPages[pageNumber];
      checkpoint.failedPages[pageNumber] = {
        attempts: (prevFail?.attempts || 0) + 1,
        lastError: pageResult.abortedReason || `Hybrid V3 page ${pageNumber} failed.`,
        updatedAt: new Date().toISOString()
      };
      checkpoint.updatedAt = new Date().toISOString();
      fs.writeFileSync(progressFile, JSON.stringify(checkpoint, null, 2), 'utf8');
      persistStagedDraft();
      return {
        ok: false,
        cancelled: false,
        error: pageResult.abortedReason || `Hybrid V3 page ${pageNumber} failed.`,
        pagesProcessed: checkpoint.completedPages.length,
        completedPageNumbers: [...checkpoint.completedPages],
        reusedPageNumbers,
        offersCount: Array.from(itemsByPage.values()).reduce((sum, a) => sum + a.length, 0),
        estimatedCostUsd: Number(checkpoint.totalCostUsd.toFixed(6)),
        pageResults,
        ledgerEntries: collectedLedgerEntries,
        safetyViolationsCount
      };
    }

    if (checkpoint.failedPages && checkpoint.failedPages[pageNumber]) {
      delete checkpoint.failedPages[pageNumber];
    }

    const audit = auditHybridSafetyInvariants(pageResult);
    safetyViolationsCount += audit.violations.length;

    fs.writeFileSync(
      path.join(resultsDir, `page_${pageNumber}.v3.json`),
      JSON.stringify({ pageResult, safetyAudit: audit }, null, 2),
      'utf8'
    );

    const pageItems: StagedOfferItem[] = [];
    for (const reconciled of pageResult.reconciledCards) {
      const card = reconciled.reconciledCard;
      const cardDir = path.join(input.workspacePath, 'crops', `page_${pageNumber}`, reconciled.sourceOfferId);
      const conflictCodes = Array.from(new Set([...card.evidence_conflicts, ...reconciled.decomposition.conflict_codes]));
      const quarantineReasons = reconciled.publicationAssessment.quarantineReasons || [];

      const matchingAdapted = adaptV3DecompositionToOfflineMatching(reconciled.decomposition, {
        batchId: input.leafletId
      });

      const childrenCount = matchingAdapted.matchableChildren.length;
      const hasOwnBox = Boolean(pageResult.componentBoxesBySourceOfferId?.[reconciled.sourceOfferId]);
      const cardComponents =
        pageResult.componentBoxesBySourceOfferId?.[reconciled.sourceOfferId] ||
        (reconciled.parentSourceOfferId
          ? pageResult.componentBoxesBySourceOfferId?.[reconciled.parentSourceOfferId]
          : null) ||
        null;
      const fallbackCardBox = reconciled.cropLineage?.rawUnionNormalizedBox || null;
      const isSecondarySharedTier = /__tier_([2-9]|\d{2,})$/.test(reconciled.sourceOfferId) && !hasOwnBox;

      const cropPair = await generateOfferAndProductCrops({
        sourceOfferId: reconciled.sourceOfferId,
        pageImagePath,
        outputDir: cardDir,
        components: isSecondarySharedTier ? null : cardComponents,
        explicitCardBox: fallbackCardBox,
        assortmentStatus: card.assortment.status,
        conflictCodes,
        decomposedChildrenCount: childrenCount > 0 ? childrenCount : card.sub_items.length,
        hasSeparateChildProductBox: hasOwnBox
      });

      const offerSquarePath = cropPair.offerSquareCrop?.cropImagePath || reconciled.cropLineage?.cropImagePath || pageImagePath;
      const rawThumbPath = cropPair.productOnlyCrop?.cropImagePath || null;
      const cardBboxNorm = (
        reconciled.cropLineage?.rawUnionNormalizedBox &&
        Array.isArray(reconciled.cropLineage.rawUnionNormalizedBox) &&
        reconciled.cropLineage.rawUnionNormalizedBox.length === 4
          ? reconciled.cropLineage.rawUnionNormalizedBox
          : null
      ) as [number, number, number, number] | null;

      if (
        childrenCount > 0 &&
        reconciled.overallStatus !== 'quarantined_conflict' &&
        reconciled.overallStatus !== 'held_unverified_p0_budget_or_failure'
      ) {
        matchingAdapted.matchableChildren.forEach((child, idx) => {
          const off = child.offerInput;
          const imgGuard = canAttachProductImageToCatalogSku({
            assortmentStatus: childrenCount > 1 ? 'multiple_variants' : card.assortment.status,
            conflictCodes,
            decomposedChildrenCount: childrenCount,
            hasSeparateChildProductBox: false,
            hasValidProductGraphicBox: Boolean(rawThumbPath)
          });
          const childSingleDay = annotateSingleDayOfferException({
            promoNotes: off.promoNotes,
            card,
            conflictCodes
          });
          const childAnchor = computeOfferAnchorSignature({
            sourcePage: pageNumber,
            supermarketId: input.metadata.supermarketId,
            titleEn: off.titleEn,
            titleAr: off.titleAr,
            brand: off.brand,
            promoPrice: off.promoPrice,
            originalPrice: off.originalPrice,
            sizeOrWeight: off.sizeOrWeight,
            bboxNorm: cardBboxNorm,
            fallbackRawId: off.sourceOfferId
          });

          pageItems.push(
            createExtendedStagedItem({
              itemId: off.sourceOfferId,
              sourceOfferId: off.sourceOfferId,
              parentSourceOfferId: reconciled.sourceOfferId,
              sourceDocumentId: documentId,
              sourceOfferAnchor: childAnchor,
              sourceBboxNorm: cardBboxNorm,
              pageNumber,
              titleEn: off.titleEn || null,
              titleAr: off.titleAr || null,
              brand: off.brand || null,
              brandAr: off.brandAr || null,
              brandEn: off.brandEn || null,
              variantOrFlavor: off.variantOrFlavor || null,
              sizeOrWeight: off.sizeOrWeight || null,
              priceBefore: off.originalPrice,
              priceAfter: off.promoPrice,
              promoNotes: childSingleDay.promoNotes,
              innerPackCount: off.inner_pack_count,
              eachSizeValue: off.each_size_value,
              eachSizeUnit: off.each_size_unit,
              totalContentValue: off.total_content_value,
              totalContentUnit: off.total_content_unit,
              freeUnitsText: off.free_units_text,
              customerLimit: off.customer_limit,
              promoConditionQty: off.promo_condition_quantity ?? null,
              promotionMechanic: off.promotion_mechanic ?? null,
              quantitySemantics: off.quantity_semantics ?? null,
              saleUnitType: off.sale_unit_type,
              assortmentStatus: 'single_sku',
              category: card.non_grocery_specs.domain,
              confidence: card.extraction_confidence,
              offerCardCropPath: offerSquarePath,
              productThumbCropPath: rawThumbPath,
              originalPageImagePath: pageImagePath,
              imageSubjectScope: imgGuard.imageSubjectScope,
              canUseProductThumbForCatalogSku: imgGuard.canUseForCatalogSku,
              conflictCodes: childSingleDay.conflictCodes,
              quarantineReasons,
              v3RetentionMode: reconciled.decomposition.parent_offer_retention_mode,
              v3CropStatus: reconciled.cropStatus,
              decomposedChildIndex: idx + 1,
              decomposedChildrenCount: childrenCount,
              reconciled
            })
          );
        });
      } else {
        // Parent retained for operator review / quarantine visibility (never silently dropped)
        const primarySku = card.sub_items[0];
        const qty = card.quantity_and_promo;
        const packCount = qty.manufacturer_pack_count ?? 1;
        const sizeLabel =
          qty.each_size_value != null && qty.each_size_unit
            ? packCount > 1
              ? `${packCount}x${qty.each_size_value}${qty.each_size_unit}`
              : `${qty.each_size_value}${qty.each_size_unit}`
            : null;
        const totalContentVal =
          qty.each_size_value != null ? qty.each_size_value * packCount : null;
        const parentSingleDay = annotateSingleDayOfferException({
          promoNotes: card.pricing.promo_conditions,
          card,
          conflictCodes
        });
        const parentTitleEn = primarySku?.product_name_en || card.source_card.raw_text.title_en || null;
        const parentTitleAr = primarySku?.product_name_ar || card.source_card.raw_text.title_ar || null;
        const parentAnchor = computeOfferAnchorSignature({
          sourcePage: pageNumber,
          supermarketId: input.metadata.supermarketId,
          titleEn: parentTitleEn,
          titleAr: parentTitleAr,
          brand: primarySku?.brand_en || primarySku?.brand_ar || null,
          promoPrice: card.pricing.promo_price,
          originalPrice: card.pricing.original_price,
          sizeOrWeight: sizeLabel,
          bboxNorm: cardBboxNorm,
          fallbackRawId: reconciled.sourceOfferId
        });
        pageItems.push(
          createExtendedStagedItem({
            itemId: reconciled.sourceOfferId,
            sourceOfferId: reconciled.sourceOfferId,
            parentSourceOfferId: reconciled.sourceOfferId,
            sourceDocumentId: documentId,
            sourceOfferAnchor: parentAnchor,
            sourceBboxNorm: cardBboxNorm,
            pageNumber,
            titleEn: parentTitleEn,
            titleAr: parentTitleAr,
            brand: primarySku?.brand_en || primarySku?.brand_ar || null,
            brandAr: primarySku?.brand_ar || null,
            brandEn: primarySku?.brand_en || null,
            variantOrFlavor: primarySku?.variant_or_flavor || null,
            sizeOrWeight: sizeLabel,
            priceBefore: card.pricing.original_price,
            priceAfter: card.pricing.promo_price,
            promoNotes: parentSingleDay.promoNotes,
            innerPackCount: qty.manufacturer_pack_count,
            eachSizeValue: qty.each_size_value,
            eachSizeUnit: qty.each_size_unit,
            totalContentValue: totalContentVal,
            totalContentUnit: qty.each_size_unit || null,
            freeUnitsText:
              qty.factory_bonus_paid_qty && qty.factory_bonus_free_qty
                ? `${qty.factory_bonus_paid_qty}+${qty.factory_bonus_free_qty} Free`
                : null,
            customerLimit: qty.customer_limit_pcs,
            promoConditionQty: qty.retailer_checkout_multibuy_qty,
            promotionMechanic: qty.sale_basis,
            quantitySemantics:
              qty.sale_basis === 'sealed_multipack' || qty.sale_basis === 'factory_bonus_pack'
                ? 'manufacturer_multipack'
                : qty.sale_basis === 'multi_buy_checkout'
                  ? 'checkout_multibuy'
                  : 'retail_promo_quantity',
            saleUnitType: packCount > 1 ? 'pack' : 'piece',
            assortmentStatus: card.assortment.status,
            category: card.non_grocery_specs.domain,
            confidence: card.extraction_confidence,
            offerCardCropPath: offerSquarePath,
            productThumbCropPath: rawThumbPath,
            originalPageImagePath: pageImagePath,
            imageSubjectScope: cropPair.imageSubjectScope,
            canUseProductThumbForCatalogSku:
              cropPair.canUseProductThumbForCatalogSku &&
              quarantineReasons.length === 0 &&
              reconciled.overallStatus !== 'quarantined_conflict' &&
              reconciled.overallStatus !== 'held_unverified_p0_budget_or_failure',
            conflictCodes: parentSingleDay.conflictCodes,
            quarantineReasons:
              quarantineReasons.length > 0
                ? quarantineReasons
                : reconciled.overallStatus === 'quarantined_conflict' ||
                    reconciled.overallStatus === 'held_unverified_p0_budget_or_failure'
                  ? [`V3_STATUS:${reconciled.overallStatus}`]
                  : [],
            v3RetentionMode: reconciled.decomposition.parent_offer_retention_mode,
            v3CropStatus: reconciled.cropStatus,
            reconciled
          })
        );
      }
    }

    itemsByPage.set(pageNumber, pageItems);

    if (!checkpoint.completedPages.includes(pageNumber)) {
      checkpoint.completedPages.push(pageNumber);
      checkpoint.completedPages.sort((a, b) => a - b);
    }
    checkpoint.totalCostUsd += pageResult.telemetry?.totalEstimatedCostUsd || 0;
    checkpoint.updatedAt = new Date().toISOString();
    fs.writeFileSync(progressFile, JSON.stringify(checkpoint, null, 2), 'utf8');
    persistStagedDraft();

    // DUP-01F: Register completed page extraction in persistent document history index
    if (input.fileFingerprint && audit.violations.length === 0) {
      try {
        const cropPaths = Array.from(
          new Set(
            pageItems
              .flatMap((it) => [it.croppedEvidenceLocalPath, it.productThumbLocalPath])
              .filter((p): p is string => Boolean(p))
          )
        );
        historyService.recordExtractedPage({
          documentId,
          fileFingerprint: input.fileFingerprint,
          fileName: input.fileName,
          workspacePath: input.workspacePath,
          leafletId: input.leafletId,
          pageNumber,
          compatibilityProfile: {
            ...CURRENT_HYBRID_COMPATIBILITY_PROFILE,
            pipelineMode: 'hybrid_v3'
          },
          resultJsonPath: path.join(resultsDir, `page_${pageNumber}.v3.json`),
          stagedDraftPath: draftPath,
          cropPaths,
          supermarketId: input.metadata.supermarketId ?? null,
          offerStartDate: input.metadata.offerStartDate ?? null,
          offerEndDate: input.metadata.offerEndDate ?? null,
          locationScope: input.metadata.locationScope ?? null,
          offersCount: pageItems.length,
          quarantinedCount: pageItems.filter((it) => ((it as any).quarantineReasons || []).length > 0).length,
          corrupted: false,
          extractedAt: new Date().toISOString()
        });
      } catch {
        // Non-fatal history index write
      }
    }

    const totalOffersSoFar = Array.from(itemsByPage.values()).reduce((sum, a) => sum + a.length, 0);
    input.onPageProgress?.({
      pageNumber,
      completedPages: checkpoint.completedPages.length,
      totalPages: targetPages.length,
      offersSoFar: totalOffersSoFar,
      costUsdSoFar: Number(checkpoint.totalCostUsd.toFixed(6)),
      message: `Hybrid V3 page ${pageNumber} reconciled (${pageItems.length} offers, cost $${checkpoint.totalCostUsd.toFixed(4)})`
    });
  }

  // Write consolidated staged-draft.json preserving full page ordering
  const totalPersistedOffers = persistStagedDraft();

  return {
    ok: true,
    cancelled: false,
    pagesProcessed: checkpoint.completedPages.length,
    completedPageNumbers: [...checkpoint.completedPages],
    reusedPageNumbers,
    offersCount: totalPersistedOffers,
    estimatedCostUsd: Number(checkpoint.totalCostUsd.toFixed(6)),
    pageResults,
    ledgerEntries: collectedLedgerEntries,
    safetyViolationsCount
  };
}
