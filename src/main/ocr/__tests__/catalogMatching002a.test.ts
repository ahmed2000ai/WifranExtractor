import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import * as geminiClientModule from '../geminiClient'
import {
  GeminiMatchingService,
  canonicalizeMatchSourceId,
  GeminiMatchingBatchRequest
} from '../geminiMatchingService'
import { BrandGroupingService, DeduplicatedIdentityItem } from '../../db/brandGroupingService'
import { MatchingEvidenceOverlayService } from '../../db/matchingEvidenceOverlayService'
import {
  resolveQuantityAndPromoSemantics,
  evaluateIdentitySufficiency
} from '../../db/productIdentityPolicy'
import { TemporaryProductRegistry } from '../../db/temporaryProductRegistry'
import { VerifiedMatchCacheService } from '../../db/verifiedMatchCacheService'
import { CatalogPublicationService } from '../../db/catalogPublicationService'
import { CatalogMatchingOrchestrator } from '../../batch/catalogMatchingOrchestrator'
import { LiveCatalogMatchingBenchmarkRunner } from '../liveCatalogMatchingBenchmarkRunner'
import { UnifiedBatchOffer } from '../../../shared/types/batchExtraction'
import {
  CompactCatalogCandidate,
  MatchingRunManifest
} from '../../../shared/types/catalogMatching'

function makeOffer(overrides: Partial<UnifiedBatchOffer> = {}): UnifiedBatchOffer {
  const sourceOfferId = overrides.sourceOfferId || 'test_offer_1'
  const batchId = overrides.batchId || 'batch_002a'
  const leafletId = overrides.leafletId || 'leaflet_1'
  const sourcePage = overrides.sourcePage ?? 1
  const sizeOrWeight = overrides.sizeOrWeight !== undefined ? overrides.sizeOrWeight : '900g'
  let parsedSizeVal: number | null = null
  let parsedSizeUnit: string | null = null
  if (sizeOrWeight) {
    const m = /(?:^|[x×]\s*)([\d.]+)\s*(kg|g|ml|l)\b/i.exec(sizeOrWeight)
    if (m) {
      parsedSizeVal = Number(m[1])
      parsedSizeUnit = m[2].toLowerCase()
    }
  }
  return {
    batchOfferKey: overrides.batchOfferKey || `${batchId}:${leafletId}:${sourcePage}:${sourceOfferId}`,
    batchId,
    leafletId,
    sourceFileName: overrides.sourceFileName || 'leaflet.pdf',
    sourcePdfPath: overrides.sourcePdfPath || 'C:/tmp/leaflet.pdf',
    sourcePage,
    sourceOfferId,
    supermarketId: overrides.supermarketId ?? null,
    supermarketName: overrides.supermarketName ?? 'Panda',
    locationScope: overrides.locationScope ?? 'national',
    locationLabel: overrides.locationLabel ?? null,
    cityId: overrides.cityId ?? null,
    regionId: overrides.regionId ?? null,
    offerStartDate: overrides.offerStartDate ?? null,
    offerEndDate: overrides.offerEndDate ?? null,
    titleAr: overrides.titleAr ?? 'دجاج سيارا كامل 900 جم',
    titleEn: overrides.titleEn ?? 'Seara Whole Chicken 900g',
    brand: overrides.brand ?? 'Seara',
    brandAr: overrides.brandAr ?? 'سيارا',
    brandEn: overrides.brandEn ?? 'Seara',
    promoPrice: overrides.promoPrice ?? 14.95,
    originalPrice: overrides.originalPrice ?? 21.95,
    discountPercent: overrides.discountPercent ?? null,
    promoNotes: overrides.promoNotes ?? null,
    sizeOrWeight,
    each_size_value: overrides.each_size_value !== undefined ? overrides.each_size_value : parsedSizeVal,
    each_size_unit: overrides.each_size_unit !== undefined ? overrides.each_size_unit : parsedSizeUnit,
    inner_pack_count: overrides.inner_pack_count ?? 1,
    sale_unit_type: overrides.sale_unit_type ?? null,
    total_content_value: overrides.total_content_value ?? null,
    total_content_unit: overrides.total_content_unit ?? null,
    free_units_text: overrides.free_units_text ?? null,
    customer_limit: overrides.customer_limit ?? null,
    promo_condition_quantity: overrides.promo_condition_quantity ?? null,
    promotion_mechanic: overrides.promotion_mechanic ?? null,
    bundle_quantity: overrides.bundle_quantity ?? null,
    quantity_semantics: overrides.quantity_semantics,
    assortment_status: overrides.assortment_status ?? null,
    productThumbCropPath: overrides.productThumbCropPath ?? null,
    offerCardCropPath: overrides.offerCardCropPath ?? null,
    status: overrides.status ?? 'ready_for_matching',
    confidence: overrides.confidence ?? 'high',
    category: overrides.category ?? 'Poultry',
    ...overrides
  }
}

describe('WIFRAN-EXTRACTOR-CATALOG-MATCH-002A Regression & Contract Tests', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    vi.restoreAllMocks()
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // ignore cleanup errors
      }
    }
  })

  function createTempOverlay(): MatchingEvidenceOverlayService {
    const dir = mkdtempSync(join(tmpdir(), 'wifran-002a-overlay-'))
    tempDirs.push(dir)
    return new MatchingEvidenceOverlayService(join(dir, 'evidence.json'), 'unit-test')
  }

  function createTempCacheDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'wifran-002a-cache-'))
    tempDirs.push(dir)
    return dir
  }

  // =========================================================================
  // 1. SOURCE-ID CONTRACT & CANONICALIZATION (§3.5)
  // =========================================================================
  describe('Source-ID Contract, Canonicalization & Reconciliation (§3.5)', () => {
    const service = new GeminiMatchingService()

    it('canonicalizes valid bare digits and Item/item prefixes while rejecting leading zeroes, out-of-range, and arbitrary strings', () => {
      const valid = new Set(['1', '2', '3', '4'])

      expect(canonicalizeMatchSourceId('1', valid)).toEqual({
        rawSourceId: '1',
        normalizedId: '1',
        wasNormalized: false
      })
      expect(canonicalizeMatchSourceId('Item 1', valid)).toEqual({
        rawSourceId: 'Item 1',
        normalizedId: '1',
        wasNormalized: true
      })
      expect(canonicalizeMatchSourceId('item_2', valid)).toEqual({
        rawSourceId: 'item_2',
        normalizedId: '2',
        wasNormalized: true
      })
      expect(canonicalizeMatchSourceId('item-3', valid)).toEqual({
        rawSourceId: 'item-3',
        normalizedId: '3',
        wasNormalized: true
      })

      expect(canonicalizeMatchSourceId('01', valid).normalizedId).toBeNull()
      expect(canonicalizeMatchSourceId('Item 01', valid).normalizedId).toBeNull()
      expect(canonicalizeMatchSourceId('Item 99', valid).normalizedId).toBeNull()
      expect(canonicalizeMatchSourceId('5', valid).normalizedId).toBeNull()
      expect(canonicalizeMatchSourceId('product_1', valid).normalizedId).toBeNull()
      expect(canonicalizeMatchSourceId('offer 1', valid).normalizedId).toBeNull()
      expect(canonicalizeMatchSourceId(null, valid).normalizedId).toBeNull()
    })

    it('replays exact historical raw Gemini JSON from live_benchmark_execution_result.json without any false OMITTED_BY_MODEL errors', () => {
      const execResult = JSON.parse(
        readFileSync(join(process.cwd(), 'Extracts', 'live_benchmark_execution_result.json'), 'utf8')
      )
      expect(execResult.actualRequests).toHaveLength(2)

      const runner = new LiveCatalogMatchingBenchmarkRunner({
        evidenceOverlayPath: join(
          process.cwd(),
          'test-fixtures',
          'matching-benchmarks',
          'verified_evidence_annotations_v1.json'
        )
      })
      const replay = runner.replayHistoricalBenchmarkOffline()

      expect(replay.paidApiCallsExecuted).toBe(0)
      expect((replay.preservedHistoricalMetrics as any).geminiEvaluatedSubset.correctCount).toBe(3)
      expect((replay.preservedHistoricalMetrics as any).locallyHandledSubset.correctCount).toBe(6)
      expect((replay.preservedHistoricalMetrics as any).overallPipeline.correctCount).toBe(9)

      // Post-002A reconciliation: zero false OMITTED_BY_MODEL rejections!
      expect(replay.replayMetrics.geminiSubsetPostValidation.falseOmittedByModelCount).toBe(0)

      const searaP1 = replay.perItemReplayResults.find((r) => r.sourceOfferId === 'seara_p1_tender_breast_1800g')
      const searaP2 = replay.perItemReplayResults.find((r) => r.sourceOfferId === 'seara_p2_frozen_chicken_10x900g')
      const searaP3 = replay.perItemReplayResults.find((r) => r.sourceOfferId === 'seara_p3_frozen_chicken_3x900g_promo')
      const searaP4 = replay.perItemReplayResults.find((r) => r.sourceOfferId === 'seara_p4_mushab_burger_assortment')
      const sadiaO1 = replay.perItemReplayResults.find((r) => r.sourceOfferId === 'sadia_o1_nuggets_270g_pack')

      expect(searaP1.rawModelSourceId).toBe('Item 1')
      expect(searaP1.wasSourceIdNormalized).toBe(true)
      expect(searaP1.actualDecision).toBe('existing')
      expect(searaP1.actualCatalogId).toBe('4223')

      expect(searaP2.rawModelSourceId).toBe('Item 2')
      expect(searaP2.actualDecision).toBe('existing')
      expect(searaP2.actualCatalogId).toBe('4226')

      // Historical raw Seara Item 3 -> t1 semantic defect preserved visibly in replay
      expect(searaP3.rawModelSourceId).toBe('Item 3')
      expect(searaP3.actualDecision).toBe('temporary')
      expect(searaP3.actualTemporaryRef).toBe('t1')
      expect(searaP3.isCorrect).toBe(false)

      // Genuine null abstention preserved, not misclassified as omission
      expect(searaP4.rawModelSourceId).toBe('Item 4')
      expect(searaP4.actualDecision).toBe('unresolved')
      expect(searaP4.isCorrect).toBe(true)

      // Verified overlay blocks raw Sadia "4231"
      expect(sadiaO1.actualDecision).toBe('unresolved')
      expect(sadiaO1.actualCatalogId).toBeNull()
      expect(sadiaO1.isCorrect).toBe(true)

      // Gemini replay: 6/7 (5 existing/abstention + 1 Sadia assortment safely blocked)
      expect(replay.replayMetrics.geminiSubsetPostValidation.correctCount).toBe(6)
    })

    it('detects normalization collisions, duplicate normalized source_ids, unrecognized IDs, and unauthorized candidates cleanly', () => {
      const grouping = new BrandGroupingService(createTempOverlay())
      const g1 = grouping.groupOffersByBrand([
        makeOffer({ sourceOfferId: 'o1', titleEn: 'Seara Tender Breast 1800g', sizeOrWeight: '1800g' }),
        makeOffer({ sourceOfferId: 'o2', titleEn: 'Seara Chicken Breast 450g', sizeOrWeight: '450g' })
      ])[0]

      const sourceMap = new Map<string, DeduplicatedIdentityItem>([
        ['1', g1.uniqueIdentities[0]],
        ['2', g1.uniqueIdentities[1]]
      ])
      const candidates: CompactCatalogCandidate[] = [
        { id: '101', brand: 'Seara', nameEn: 'Seara Tender Breast 1800g', nameAr: '', variant: null, sizeValue: 1800, sizeUnit: 'g', packCount: 1 },
        { id: '102', brand: 'Seara', nameEn: 'Seara Chicken Breast 450g', nameAr: '', variant: null, sizeValue: 450, sizeUnit: 'g', packCount: 1 }
      ]
      const authorized = new Set(['101', '102'])

      const collisionRes = service.validateAndReconcileResponseDetailed(
        {
          matches: [
            { source_id: '1', product_id: '101' },
            { source_id: 'Item 1', product_id: '102' },
            { source_id: 'Item 99', product_id: '102' }
          ]
        },
        sourceMap,
        candidates,
        authorized
      )
      expect(collisionRes.unrecognizedEntries).toHaveLength(1)
      expect(collisionRes.unrecognizedEntries[0].rawSourceId).toBe('Item 99')
      expect(collisionRes.requestDiagnostics.some((d) => /UNRECOGNIZED_SOURCE_ID/.test(d))).toBe(true)

      const item1Outcome = collisionRes.matches.find((m) => m.sourceId === '1')!
      expect(item1Outcome.matchedProductId).toBeNull()
      expect(item1Outcome.validationIssues.some((v) => /SOURCE_ID_NORMALIZATION_COLLISION/.test(v))).toBe(true)

      const item2Outcome = collisionRes.matches.find((m) => m.sourceId === '2')!
      expect(item2Outcome.matchedProductId).toBeNull()
      expect(item2Outcome.validationIssues.some((v) => /MISSING_SOURCE_ID/.test(v))).toBe(true)
      expect(item2Outcome.validationIssues.some((v) => /OMITTED_BY_MODEL/.test(v))).toBe(false)

      const dupAndHallucinated = service.validateAndReconcileResponseDetailed(
        {
          matches: [
            { source_id: '1', product_id: '101' },
            { source_id: '1', product_id: '102' },
            { source_id: '2', product_id: '9999' }
          ]
        },
        sourceMap,
        candidates,
        authorized
      )
      expect(
        dupAndHallucinated.matches.find((m) => m.sourceId === '1')!.validationIssues.some((v) =>
          /DUPLICATE_SOURCE_ID/.test(v)
        )
      ).toBe(true)
      expect(
        dupAndHallucinated.matches.find((m) => m.sourceId === '2')!.validationIssues.some((v) =>
          /UNAUTHORIZED_CANDIDATE_ID/.test(v)
        )
      ).toBe(true)

      const mixedValid = service.validateAndReconcileResponseDetailed(
        {
          matches: [
            { source_id: 'item-1', product_id: '101' },
            { source_id: 'item_2', product_id: '102' }
          ]
        },
        sourceMap,
        candidates,
        authorized
      )
      expect(mixedValid.matches.find((m) => m.sourceId === '1')!.matchedProductId).toBe('101')
      expect(mixedValid.matches.find((m) => m.sourceId === '2')!.matchedProductId).toBe('102')
    })

    it('emits structured JSON prompt items with explicit source_id and enum schema constraint (no "Item 1:" line prefixes)', () => {
      const grouping = new BrandGroupingService(createTempOverlay())
      const group = grouping.groupOffersByBrand([
        makeOffer({ sourceOfferId: 's1', titleEn: 'Seara Tender Breast 1800g', sizeOrWeight: '1800g' }),
        makeOffer({
          sourceOfferId: 's2',
          titleEn: 'Seara Frozen Whole Chicken 10x900g',
          sizeOrWeight: '3x900g',
          inner_pack_count: 3,
          promo_condition_quantity: 3,
          promotion_mechanic: 'multi_buy',
          promoNotes: 'Promo 3 pieces'
        })
      ])[0]

      const req: GeminiMatchingBatchRequest = {
        brandKey: 'seara',
        brandName: 'Seara',
        candidates: [
          { id: '4223', brand: 'Seara', nameEn: 'Seara Tender Breast 1800g', nameAr: '', variant: null, sizeValue: 1800, sizeUnit: 'g', packCount: 1 },
          { id: '4225', brand: 'Seara', nameEn: 'Seara Frozen Whole Chicken 900g', nameAr: '', variant: null, sizeValue: 900, sizeUnit: 'g', packCount: 1 }
        ],
        items: group.uniqueIdentities
      }

      const payload = service.buildPromptPayload(req)
      expect(payload.userContent).not.toContain('Item 1:')
      expect(payload.userContent).toContain('"source_id":"1"')
      expect(payload.userContent).toContain('"retail_promo_qty":3')
      expect(payload.userContent).toContain('"mfg_pack":1')

      const config = service.buildRequestConfig({ validSourceIds: payload.validSourceIds })
      const sourceIdSchema = (config.responseSchema as any).properties.matches.items.properties.source_id
      expect(sourceIdSchema.type).toBe('STRING')
      expect(sourceIdSchema.format).toBeUndefined()
      expect(sourceIdSchema.enum).toEqual(['1', '2'])
    })
  })

  // =========================================================================
  // 2. MANUFACTURER PACKAGING VS RETAIL PROMO (§4.6)
  // =========================================================================
  describe('Manufacturer Packaging vs Retail Promotional Quantities (§4.6)', () => {
    it('separates retail multi-buy promo quantities and customer limits from single-unit manufacturer pack', () => {
      const single = resolveQuantityAndPromoSemantics(
        makeOffer({ titleEn: 'Seara Frozen Chicken 900g', sizeOrWeight: '900g', inner_pack_count: 1 })
      )
      expect(single.manufacturerPackCount).toBe(1)
      expect(single.promoPurchaseQuantity).toBeNull()
      expect(single.packagingSemantics).toBe('single_unit_retail')

      const promo3 = resolveQuantityAndPromoSemantics(
        makeOffer({
          titleEn: 'Seara Frozen Whole Chicken 10x900g',
          sizeOrWeight: '3x900g',
          inner_pack_count: 3,
          promo_condition_quantity: 3,
          promotion_mechanic: 'multi_buy',
          promoNotes: 'Promo 3 pieces'
        })
      )
      expect(promo3.manufacturerPackCount).toBe(1)
      expect(promo3.promoPurchaseQuantity).toBe(3)
      expect(promo3.packagingSemantics).toBe('single_unit_with_retail_promo')
      expect(promo3.isPackagingAmbiguous).toBe(false)

      const fakiehAlwafa = resolveQuantityAndPromoSemantics(
        makeOffer({
          brand: 'Fakieh',
          brandEn: 'Fakieh',
          brandAr: 'فقيه',
          titleEn: 'Fakieh Chilled Whole Chicken 600g',
          sizeOrWeight: '600g',
          inner_pack_count: 1,
          promo_condition_quantity: 2,
          promotion_mechanic: 'multi_buy',
          customer_limit: 2,
          promoNotes: 'BUY 2 PCS | 2 Pc Per Customer'
        })
      )
      expect(fakiehAlwafa.manufacturerPackCount).toBe(1)
      expect(fakiehAlwafa.promoPurchaseQuantity).toBe(2)

      const limit5 = resolveQuantityAndPromoSemantics(
        makeOffer({
          brand: 'Sadia',
          brandEn: 'Sadia',
          brandAr: 'ساديا',
          titleEn: 'Sadia Tempura Chicken Nuggets 270g',
          sizeOrWeight: '270g',
          inner_pack_count: 1,
          customer_limit: 5,
          promoNotes: '5 pieces per customer limit'
        })
      )
      expect(limit5.manufacturerPackCount).toBe(1)
      expect(limit5.isPackagingAmbiguous).toBe(false)

      const carton = resolveQuantityAndPromoSemantics(
        makeOffer({
          titleEn: 'Seara Whole Frozen Chicken Carton 10 x 900g',
          sizeOrWeight: '10x900g',
          inner_pack_count: 10
        })
      )
      expect(carton.manufacturerPackCount).toBe(10)
      expect(carton.packagingSemantics).toBe('manufacturer_multipack')
      expect(carton.isPackagingAmbiguous).toBe(false)

      const pack4x250 = resolveQuantityAndPromoSemantics(
        makeOffer({
          brand: 'Almarai',
          brandEn: 'Almarai',
          titleEn: 'Almarai Juice 4 x 250ml',
          sizeOrWeight: '4x250ml',
          inner_pack_count: 4
        })
      )
      expect(pack4x250.manufacturerPackCount).toBe(4)
      expect(pack4x250.packagingSemantics).toBe('manufacturer_multipack')

      const ambiguousOffer = makeOffer({
        titleEn: 'Seara Chicken Nuggets 270g',
        sizeOrWeight: '270g',
        inner_pack_count: 2
      })
      const ambiguous = resolveQuantityAndPromoSemantics(ambiguousOffer)
      expect(ambiguous.isPackagingAmbiguous).toBe(true)
      expect(ambiguous.packagingSemantics).toBe('ambiguous')

      const grouping = new BrandGroupingService(createTempOverlay())
      const groupedAmbiguous = grouping.groupOffersByBrand([ambiguousOffer])[0].uniqueIdentities[0]
      expect(groupedAmbiguous.normalizedAttrs.isIdentitySufficient).toBe(false)
    })

    it('keeps verified cache fingerprint & temporary grouping invariant across promotional quantity differences for same SKU', () => {
      const grouping = new BrandGroupingService(createTempOverlay())
      const single = grouping.groupOffersByBrand([
        makeOffer({ sourceOfferId: 'a', titleEn: 'Seara Frozen Chicken 900g', sizeOrWeight: '900g', inner_pack_count: 1 })
      ])[0].uniqueIdentities[0]

      const promo3 = grouping.groupOffersByBrand([
        makeOffer({
          sourceOfferId: 'b',
          titleEn: 'Seara Frozen Chicken 900g',
          sizeOrWeight: '3x900g',
          inner_pack_count: 3,
          promo_condition_quantity: 3,
          promotion_mechanic: 'multi_buy',
          promoNotes: 'Promo 3 pieces'
        })
      ])[0].uniqueIdentities[0]

      const cache = new VerifiedMatchCacheService(createTempCacheDir(), 'development')
      expect(cache.computeFingerprint(single.normalizedAttrs)).toBe(cache.computeFingerprint(promo3.normalizedAttrs))

      const registry = new TemporaryProductRegistry('batch_promo_test')
      const reqMap = new Map<string, string>()
      const t1 = registry.reconcileTemporaryOffer({
        requestTempRef: 't1',
        requestScopedMap: reqMap,
        attrs: single.normalizedAttrs,
        sourceOffer: single.memberOffers[0]
      })
      const t2 = registry.reconcileTemporaryOffer({
        requestTempRef: 't2',
        requestScopedMap: new Map<string, string>(),
        attrs: promo3.normalizedAttrs,
        sourceOffer: promo3.memberOffers[0]
      })
      expect(t1.temporaryId).toBe(t2.temporaryId)
      expect(t2.mergedWithExisting).toBe(true)
    })
  })

  // =========================================================================
  // 3. ASSORTMENT SAFETY & EVIDENCE OVERLAY (§5.6)
  // =========================================================================
  describe('Assortment Safety, Evidence Overlay & Upstream Extraction Limitation (§5.6)', () => {
    it('blocks automatic single-SKU matching for sadia_o1_nuggets_270g_pack when verified overlay is present', async () => {
      const overlay = new MatchingEvidenceOverlayService(
        join(process.cwd(), 'test-fixtures', 'matching-benchmarks', 'verified_evidence_annotations_v1.json'),
        'fixture'
      )
      const grouping = new BrandGroupingService(overlay)

      const sadiaAmbiguous = makeOffer({
        sourceOfferId: 'sadia_o1_nuggets_270g_pack',
        leafletId: 'othaim_week24',
        sourceFileName: 'Othaim Week 24.pdf',
        sourcePage: 1,
        supermarketName: 'Othaim',
        brand: 'Sadia',
        brandEn: 'Sadia',
        brandAr: 'ساديا',
        titleEn: 'Sadia Tempura Chicken Nuggets 270g',
        titleAr: 'ساديا ناغتس الدجاج تمبورا 270 جرام',
        sizeOrWeight: '270g',
        inner_pack_count: 1,
        customer_limit: 5
      })

      const group = grouping.groupOffersByBrand([sadiaAmbiguous])[0]
      const identity = group.uniqueIdentities[0]
      expect(identity.normalizedAttrs.isIdentitySufficient).toBe(false)
      expect(identity.normalizedAttrs.evidenceAnnotation?.assortment_status).toBe('multiple_variants')

      vi.spyOn(grouping, 'retrieveBrandCandidates').mockResolvedValue({
        candidates: [
          { id: '4231', brand: 'Sadia', nameEn: 'Sadia Chicken Nuggets Tempura 270g', nameAr: '', variant: null, sizeValue: 270, sizeUnit: 'g', packCount: 1 }
        ],
        totalBrandProducts: 1,
        retrievalCompleteness: 'complete',
        fallbackActions: []
      })

      const gemini = new GeminiMatchingService()
      const evalSpy = vi.spyOn(gemini, 'evaluateBatch')
      const cache = new VerifiedMatchCacheService(createTempCacheDir(), 'development')
      const orchestrator = new CatalogMatchingOrchestrator(cache, gemini, grouping, overlay)
      vi.spyOn(orchestrator, 'saveManifestAtomic').mockImplementation(() => {})

      const manifest = await orchestrator.executeMatchingRun({
        batchId: 'batch_sadia_overlay_test',
        offers: [sadiaAmbiguous],
        supabase: {} as any
      })

      expect(evalSpy).not.toHaveBeenCalled()
      expect(manifest.totals.geminiRequestsCount).toBe(0)
      const prop = manifest.proposals[sadiaAmbiguous.batchOfferKey]
      expect(prop.decision).toBe('unresolved')
      expect(prop.operatorDecision).toBe('proposed')
    })

    it('explicitly exposes upstream evidence gap when sadia_o1 has NO annotation and NO upstream assortment signal', () => {
      const groupingWithoutOverlay = new BrandGroupingService(createTempOverlay())
      const sadiaNoSignal = makeOffer({
        sourceOfferId: 'sadia_o1_nuggets_270g_pack',
        brand: 'Sadia',
        brandEn: 'Sadia',
        titleEn: 'Sadia Tempura Chicken Nuggets 270g',
        sizeOrWeight: '270g',
        each_size_value: 270,
        each_size_unit: 'g',
        inner_pack_count: 1,
        customer_limit: 5
      })
      const attrs = groupingWithoutOverlay.groupOffersByBrand([sadiaNoSignal])[0].uniqueIdentities[0].normalizedAttrs
      const evaluation = evaluateIdentitySufficiency(attrs, sadiaNoSignal, null)
      expect(evaluation.isAssortment).toBe(false)
      expect(evaluation.isSufficient).toBe(true)
      expect(evaluation.evidenceGapDetected).toBe(true)
    })

    it('blocks explicit upstream assortment_status / "Asstd" text without auto-linking', () => {
      const gemini = new GeminiMatchingService()
      const grouping = new BrandGroupingService(createTempOverlay())
      const assortmentOffer = makeOffer({
        sourceOfferId: 'sadia_assorted_1',
        brand: 'Sadia',
        brandEn: 'Sadia',
        titleEn: 'Sadia Chicken Nuggets Asstd 270g',
        sizeOrWeight: '270g',
        assortment_status: 'assortment_indicated'
      })
      const group = grouping.groupOffersByBrand([assortmentOffer])[0]
      expect(group.uniqueIdentities[0].normalizedAttrs.isAssortment).toBe(true)
      expect(group.uniqueIdentities[0].normalizedAttrs.isIdentitySufficient).toBe(false)

      const reconciled = gemini.validateAndReconcileResponseDetailed(
        { matches: [{ source_id: '1', product_id: '4231' }] },
        new Map([['1', group.uniqueIdentities[0]]]),
        [{ id: '4231', brand: 'Sadia', nameEn: 'Sadia Chicken Nuggets Tempura 270g', nameAr: '', variant: null, sizeValue: 270, sizeUnit: 'g', packCount: 1 }],
        new Set(['4231'])
      )
      expect(reconciled.matches[0].matchedProductId).toBeNull()
      expect(reconciled.matches[0].validationIssues.some((v) => /REJECTED_ASSORTMENT_AMBIGUITY/.test(v))).toBe(true)
    })

    it('keeps multi-SKU shared parent crop offers distinct rather than collapsing by shared crop', () => {
      const grouping = new BrandGroupingService(createTempOverlay())
      const b1 = makeOffer({
        sourceOfferId: 'sadia_b1_whole_chicken_1000g_single',
        leafletId: 'bindawood',
        sourcePage: 1,
        offerCardCropPath: 'C:/tmp/offer-001.webp',
        titleEn: 'Sadia Frozen Chicken 1000g',
        brand: 'Sadia',
        brandEn: 'Sadia',
        sizeOrWeight: '1000g',
        inner_pack_count: 1
      })
      const b2 = makeOffer({
        sourceOfferId: 'sadia_b2_whole_chicken_10x1000g_carton',
        leafletId: 'bindawood',
        sourcePage: 1,
        offerCardCropPath: 'C:/tmp/offer-001.webp',
        titleEn: 'Sadia Frozen Chicken Carton 10x1000g',
        brand: 'Sadia',
        brandEn: 'Sadia',
        sizeOrWeight: '10x1000g',
        inner_pack_count: 10
      })

      const group = grouping.groupOffersByBrand([b1, b2])[0]
      expect(group.uniqueIdentities).toHaveLength(2)
    })
  })

  // =========================================================================
  // 4. IDENTITY SUFFICIENCY VS CATALOG ABSENCE (§6.5)
  // =========================================================================
  describe('Identity Sufficiency vs Catalog Absence Enforcement (§6.5)', () => {
    it('allows complete absent SKU (Tanmiah Fresh 1100g) to become temporary, while blocking incomplete Tanmiah Marinated 700g everywhere', async () => {
      const completeAbsent = makeOffer({
        sourceOfferId: 'tanmiah_fresh_1100g',
        brand: 'Tanmiah',
        brandEn: 'Tanmiah',
        brandAr: 'تنمية',
        titleEn: 'Tanmiah Fresh Whole Chicken 1100g',
        sizeOrWeight: '1100g',
        inner_pack_count: 1
      })
      const incompleteMarinated = makeOffer({
        sourceOfferId: 'tanmiah_p2_marinated_chicken_700g',
        brand: 'Tanmiah',
        brandEn: 'Tanmiah',
        brandAr: 'تنمية',
        titleEn: 'Tanmiah Marinated Chicken 700g',
        titleAr: 'تنمية دجاج متبل 700 جم',
        sizeOrWeight: '700g',
        inner_pack_count: 1
      })
      const uniquelyNamedMarinade = makeOffer({
        sourceOfferId: 'tanmiah_garlic_lemon_700g',
        brand: 'Tanmiah',
        brandEn: 'Tanmiah',
        brandAr: 'تنمية',
        titleEn: 'Tanmiah Garlic Lemon Marinated Chicken 700g',
        sizeOrWeight: '700g',
        inner_pack_count: 1
      })

      const grouping = new BrandGroupingService(createTempOverlay())
      const identities = grouping.groupOffersByBrand([
        completeAbsent,
        incompleteMarinated,
        uniquelyNamedMarinade
      ])[0].uniqueIdentities

      const idComplete = identities.find((i) => i.memberOffers[0].sourceOfferId === 'tanmiah_fresh_1100g')!
      const idIncomplete = identities.find((i) => i.memberOffers[0].sourceOfferId === 'tanmiah_p2_marinated_chicken_700g')!
      const idGarlic = identities.find((i) => i.memberOffers[0].sourceOfferId === 'tanmiah_garlic_lemon_700g')!

      expect(idComplete.normalizedAttrs.isIdentitySufficient).toBe(true)
      expect(idIncomplete.normalizedAttrs.isIdentitySufficient).toBe(false)
      expect(idIncomplete.normalizedAttrs.insufficiencyCodes).toContain('AMBIGUOUS_UNSPECIFIED_MARINADE_OR_FLAVOR')
      expect(idGarlic.normalizedAttrs.isIdentitySufficient).toBe(true)

      // 1. TemporaryProductRegistry fail-closed guard
      const registry = new TemporaryProductRegistry('batch_tanmiah_test')
      expect(() =>
        registry.reconcileTemporaryOffer({
          requestTempRef: 't1',
          requestScopedMap: new Map(),
          attrs: idIncomplete.normalizedAttrs,
          sourceOffer: incompleteMarinated
        })
      ).toThrow(/INSUFFICIENT_IDENTITY_FOR_TEMPORARY_PRODUCT/)

      const assignedComplete = registry.reconcileTemporaryOffer({
        requestTempRef: 't2',
        requestScopedMap: new Map(),
        attrs: idComplete.normalizedAttrs,
        sourceOffer: completeAbsent
      })
      expect(assignedComplete.isNewGroup).toBe(true)

      // 2. VerifiedMatchCacheService fail-closed guard
      const cache = new VerifiedMatchCacheService(createTempCacheDir(), 'development')
      expect(cache.lookupVerifiedMatch(idIncomplete.normalizedAttrs)).toBeNull()
      expect(() =>
        cache.recordVerifiedMatch({
          attrs: idIncomplete.normalizedAttrs,
          approvedProductId: '9999',
          verifiedBy: 'operator'
        })
      ).toThrow(/UNSAFE_VERIFIED_CACHE_WRITE/)

      // 3. CatalogPublicationService.assessPublicationPreflight fail-closed guard
      const pubService = new CatalogPublicationService(cache)
      const manifestWithBadTemp: MatchingRunManifest = {
        schemaVersion: '1.0',
        batchId: 'batch_preflight_test',
        runId: 'run_1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'completed',
        model: 'gemini-3.8-flash',
        thinkingLevel: 'MEDIUM',
        executionMode: 'flex',
        totals: {
          totalExtractedOffers: 1,
          uniqueIdentitiesCount: 1,
          cacheMatchesCount: 0,
          deterministicMatchesCount: 0,
          geminiEvaluatedCount: 0,
          proposedExistingCount: 0,
          proposedTemporaryCount: 1,
          unresolvedCount: 0,
          validationWarningsCount: 0,
          actualCostUsd: 0,
          estimatedCostUsd: 0,
          geminiRequestsCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          thinkingTokens: 0
        },
        proposals: {
          [incompleteMarinated.batchOfferKey]: {
            batchOfferKey: incompleteMarinated.batchOfferKey,
            sourceOfferId: incompleteMarinated.sourceOfferId,
            sourcePage: 1,
            leafletId: incompleteMarinated.leafletId,
            supermarketName: 'Panda',
            decision: 'temporary',
            matchedProductId: null,
            temporaryId: 't_bad',
            confidence: 'low',
            matchMethod: 'gemini_medium',
            validationIssues: [],
            operatorDecision: 'approved',
            updatedAt: new Date().toISOString()
          }
        },
        temporaryProducts: {
          t_bad: {
            temporaryId: 't_bad',
            brandKey: 'tanmiah',
            brandNameAr: 'تنمية',
            brandNameEn: 'Tanmiah',
            productNameAr: incompleteMarinated.titleAr,
            productNameEn: incompleteMarinated.titleEn,
            variantOrFlavor: idIncomplete.normalizedAttrs.variantOrFlavor,
            fatContent: null,
            eachSizeValue: 700,
            eachSizeUnit: 'g',
            innerPackCount: 1,
            saleUnitType: null,
            productForm: null,
            sourceOfferKeys: [incompleteMarinated.batchOfferKey],
            retailers: ['Panda'],
            sampleThumbCropPath: null,
            operatorDecision: 'approved',
            validationWarnings: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        },
        brandSummaries: {}
      }

      const preflight = await pubService.assessPublicationPreflight({
        manifest: manifestWithBadTemp,
        offers: [incompleteMarinated],
        context: 'DEVELOPMENT_TEST'
      })
      expect(preflight.ready).toBe(false)
      expect(preflight.blockingReasons.some((b) => /failed identity sufficiency preflight/i.test(b))).toBe(true)

      // 4. CatalogMatchingOrchestrator zero-candidate branch keeps insufficient absent product unresolved!
      vi.spyOn(grouping, 'retrieveBrandCandidates').mockResolvedValue({
        candidates: [],
        totalBrandProducts: 0,
        retrievalCompleteness: 'complete',
        fallbackActions: []
      })
      vi.spyOn(grouping, 'verifyAbsenceInBrandCatalog').mockResolvedValue({
        isExhaustivelyAbsent: true,
        foundCandidate: null,
        coverage: 'complete',
        searchDiagnostics: ['Verified 0 Tanmiah products in dev catalog']
      })

      const gemini = new GeminiMatchingService()
      const evalSpy = vi.spyOn(gemini, 'evaluateBatch')
      const orchestrator = new CatalogMatchingOrchestrator(cache, gemini, grouping)
      vi.spyOn(orchestrator, 'saveManifestAtomic').mockImplementation(() => {})

      const manifest = await orchestrator.executeMatchingRun({
        batchId: 'batch_zero_cand_test',
        offers: [completeAbsent, incompleteMarinated],
        supabase: {} as any
      })

      expect(evalSpy).not.toHaveBeenCalled()
      expect(manifest.totals.geminiRequestsCount).toBe(0)

      const completeProp = manifest.proposals[completeAbsent.batchOfferKey]
      const incompleteProp = manifest.proposals[incompleteMarinated.batchOfferKey]
      expect(completeProp.decision).toBe('temporary')
      expect(completeProp.operatorDecision).toBe('proposed')
      expect(incompleteProp.decision).toBe('unresolved')
      expect(incompleteProp.temporaryId).toBeNull()
    })
  })

  // =========================================================================
  // 5. FLEX TIMEOUT & NO SILENT STANDARD FALLBACK / NO DOUBLE BILLING (§10)
  // =========================================================================
  describe('Flex PayGo Timeout Fail-Closed & No Silent Fallback (§10)', () => {
    it('fails explicitly with FLEX_MATCHING_TIMEOUT without retrying or downgrading to Standard PayGo', async () => {
      const gemini = new GeminiMatchingService()
      const prevOffline = process.env.WIFRAN_OFFLINE_UAT
      process.env.WIFRAN_OFFLINE_UAT = '0'

      const generateSpy = vi.fn().mockImplementation(async ({ config }: any) => {
        return await new Promise((_, reject) => {
          const sig: AbortSignal | undefined = config?.abortSignal
          if (sig?.aborted) {
            reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
            return
          }
          sig?.addEventListener('abort', () => {
            reject(Object.assign(new Error('Aborted due to Flex timeout'), { name: 'AbortError' }))
          })
        })
      })

      vi.spyOn(geminiClientModule, 'getGeminiClient').mockReturnValue({
        models: { generateContent: generateSpy }
      } as any)

      const grouping = new BrandGroupingService(createTempOverlay())
      const group = grouping.groupOffersByBrand([makeOffer()])[0]

      try {
        await expect(
          gemini.evaluateBatch({
            brandKey: 'seara',
            brandName: 'Seara',
            candidates: [],
            items: group.uniqueIdentities,
            flexTimeoutMs: 50
          })
        ).rejects.toThrow(/FLEX_MATCHING_TIMEOUT/)

        expect(generateSpy).toHaveBeenCalledTimes(1)
      } finally {
        if (prevOffline === undefined) delete process.env.WIFRAN_OFFLINE_UAT
        else process.env.WIFRAN_OFFLINE_UAT = prevOffline
      }
    })
  })
})
