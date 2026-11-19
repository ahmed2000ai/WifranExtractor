import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { BrandGroupingService } from '../../db/brandGroupingService'
import { TemporaryProductRegistry } from '../../db/temporaryProductRegistry'
import { VerifiedMatchCacheService } from '../../db/verifiedMatchCacheService'
import { MatchingEvidenceOverlayService } from '../../db/matchingEvidenceOverlayService'
import { CatalogPublicationService } from '../../db/catalogPublicationService'
import { GeminiMatchingService } from '../geminiMatchingService'
import { CatalogMatchingOrchestrator } from '../../batch/catalogMatchingOrchestrator'
import { sharedBatchOrchestrationService } from '../../batch/batchOrchestrationService'
import { LiveCatalogMatchingBenchmarkRunner } from '../liveCatalogMatchingBenchmarkRunner'
import { evaluateIdentitySufficiency } from '../../db/productIdentityPolicy'
import { UnifiedBatchOffer, BatchManifest } from '../../../shared/types/batchExtraction'
import { MatchingRunManifest } from '../../../shared/types/catalogMatching'

function makeOffer(overrides: Partial<UnifiedBatchOffer> = {}): UnifiedBatchOffer {
  const id = overrides.sourceOfferId || `offer_${Math.random().toString(36).slice(2, 8)}`
  const retailer = overrides.supermarketName || 'Panda'
  return {
    batchId: 'batch_003_test',
    leafletId: overrides.leafletId || `leaflet_${retailer.toLowerCase()}`,
    sourceFileName: `${retailer.toLowerCase()}.pdf`,
    sourcePdfPath: `/tmp/${retailer.toLowerCase()}.pdf`,
    supermarketId: retailer.toLowerCase(),
    supermarketName: retailer,
    offerStartDate: '2026-06-03',
    offerEndDate: '2026-06-09',
    locationScope: 'national',
    locationLabel: null,
    cityId: null,
    regionId: null,
    sourceOfferId: id,
    canonicalSourceId: id,
    batchOfferKey: `${overrides.leafletId || retailer.toLowerCase()}::${id}`,
    sourcePage: 1,
    brand: 'Fakieh',
    brandEn: 'Fakieh',
    brandAr: 'فقيه',
    titleEn: 'Fakieh Frozen Whole Chicken 1000g',
    titleAr: 'دجاج فقيه مجمد كامل 1000 جم',
    variantOrFlavor: null,
    sale_unit_type: 'piece',
    sizeOrWeight: '1000g',
    each_size_value: 1000,
    each_size_unit: 'g',
    inner_pack_count: 1,
    total_content_value: null,
    total_content_unit: null,
    free_units_text: null,
    customer_limit: null,
    promo_condition_quantity: null,
    promotion_mechanic: null,
    bundle_quantity: null,
    promoPrice: 16.95,
    originalPrice: 22.95,
    discountPercent: 26,
    promoNotes: null,
    productThumbCropPath: null,
    offerCardCropPath: null,
    status: 'extracted',
    confidence: 'high',
    assortment_status: 'single_sku',
    matchingEvidence: null,
    ...overrides
  }
}

describe('WIFRAN-EXTRACTOR-CATALOG-MATCH-003: Product Identity Integrity, Temp Reconciliation & Application Pipeline', () => {
  const prevOfflineUat = process.env.WIFRAN_OFFLINE_UAT
  const tempDirs: string[] = []
  const createdBatchDirs: string[] = []

  beforeEach(() => {
    process.env.WIFRAN_OFFLINE_UAT = '1'
  })

  afterEach(() => {
    for (const d of tempDirs) {
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true })
    }
    tempDirs.length = 0
    for (const d of createdBatchDirs) {
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true })
    }
    createdBatchDirs.length = 0

    if (prevOfflineUat === undefined) {
      delete process.env.WIFRAN_OFFLINE_UAT
    } else {
      process.env.WIFRAN_OFFLINE_UAT = prevOfflineUat
    }
    vi.restoreAllMocks()
  })

  function createTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
  }

  function createTempOverlayPath(prefix: string): string {
    return path.join(createTempDir(prefix), 'overlay.json')
  }

  // =========================================================================
  // 1. §2 Required Temporary Grouping Scenarios via Real Orchestrator & Registry
  // =========================================================================
  describe('§2 Exact Temporary Product Identity Grouping (No Brand-Only Placeholder)', () => {
    it('assigns distinct batch-scoped temp IDs for distinct SKUs and merges identical SKUs across promo & retailer variants', async () => {
      const fakieh10x1000gCarton = makeOffer({
        sourceOfferId: 'fakieh_carton_10x1000',
        leafletId: 'noori_w1',
        supermarketName: 'Noori',
        brand: 'Fakieh',
        brandEn: 'Fakieh',
        brandAr: 'فقيه',
        titleEn: 'Fakieh Frozen Chicken 10 x 1000g Carton',
        titleAr: 'دجاج فقيه مجمد كرتون 10 × 1000 جم',
        each_size_value: 1000,
        each_size_unit: 'g',
        inner_pack_count: 10,
        sale_unit_type: 'carton',
        quantity_semantics: 'manufacturer_multipack'
      })

      const fakieh1000gSingleR1 = makeOffer({
        sourceOfferId: 'fakieh_single_1000_r1',
        leafletId: 'noori_w1',
        supermarketName: 'Noori',
        brand: 'Fakieh',
        brandEn: 'Fakieh',
        brandAr: 'فقيه',
        titleEn: 'Fakieh Frozen Whole Chicken 1000g',
        titleAr: 'دجاج فقيه مجمد 1000 جم',
        each_size_value: 1000,
        each_size_unit: 'g',
        inner_pack_count: 1
      })

      const fakieh600gSingle = makeOffer({
        sourceOfferId: 'fakieh_single_600',
        leafletId: 'panda_w1',
        supermarketName: 'Panda',
        brand: 'Fakieh',
        brandEn: 'Fakieh',
        brandAr: 'فقيه',
        titleEn: 'Fakieh Frozen Chicken 600g',
        titleAr: 'دجاج فقيه مجمد 600 جم',
        each_size_value: 600,
        each_size_unit: 'g',
        inner_pack_count: 1
      })

      const fakieh600gBuy2Promo = makeOffer({
        sourceOfferId: 'fakieh_promo_2x600',
        leafletId: 'bndw_w1',
        supermarketName: 'BinDawood',
        brand: 'Fakieh',
        brandEn: 'Fakieh',
        brandAr: 'فقيه',
        titleEn: 'Fakieh Frozen Chicken 600g (2 Pcs Offer)',
        titleAr: 'دجاج فقيه مجمد 600 جم (عرض حبتين)',
        each_size_value: 600,
        each_size_unit: 'g',
        inner_pack_count: 1,
        promo_condition_quantity: 2,
        promotion_mechanic: '2 Pieces For 21.95 SAR'
      })

      const fakieh1000gSingleR2Bilingual = makeOffer({
        sourceOfferId: 'fakieh_single_1000_r2_ar',
        leafletId: 'lulu_w1',
        supermarketName: 'LuLu',
        brand: 'Fakieh',
        brandEn: 'Fakieh',
        brandAr: 'فقيه',
        titleEn: 'Fakieh 1000g',
        titleAr: 'فقيه دجاج مجمد ١٠٠٠ جم',
        each_size_value: 1000,
        each_size_unit: 'g',
        inner_pack_count: 1
      })

      const sadia1000gSingle = makeOffer({
        sourceOfferId: 'sadia_single_1000',
        leafletId: 'bndw_w1',
        supermarketName: 'BinDawood',
        brand: 'Sadia',
        brandEn: 'Sadia',
        brandAr: 'ساديا',
        titleEn: 'Sadia Whole Chicken 1000g',
        titleAr: 'دجاج ساديا كامل 1000 جم',
        each_size_value: 1000,
        each_size_unit: 'g',
        inner_pack_count: 1
      })

      const sadia10x1000gCarton = makeOffer({
        sourceOfferId: 'sadia_carton_10x1000',
        leafletId: 'bndw_w1',
        supermarketName: 'BinDawood',
        brand: 'Sadia',
        brandEn: 'Sadia',
        brandAr: 'ساديا',
        titleEn: 'Sadia Whole Chicken 10 x 1000g Carton',
        titleAr: 'دجاج ساديا كامل كرتون 10 × 1000 جم',
        each_size_value: 1000,
        each_size_unit: 'g',
        inner_pack_count: 10,
        sale_unit_type: 'carton',
        quantity_semantics: 'manufacturer_multipack'
      })

      const sadiaNuggetsClassic = makeOffer({
        sourceOfferId: 'sadia_nuggets_classic_270',
        leafletId: 'panda_w1',
        supermarketName: 'Panda',
        brand: 'Sadia',
        brandEn: 'Sadia',
        brandAr: 'ساديا',
        titleEn: 'Sadia Chicken Nuggets 270g',
        titleAr: 'ناجتس دجاج ساديا كلاسيك 270 جم',
        variantOrFlavor: 'Classic',
        each_size_value: 270,
        each_size_unit: 'g',
        inner_pack_count: 1
      })

      const sadiaNuggetsSpicy = makeOffer({
        sourceOfferId: 'sadia_nuggets_spicy_270',
        leafletId: 'panda_w1',
        supermarketName: 'Panda',
        brand: 'Sadia',
        brandEn: 'Sadia',
        brandAr: 'ساديا',
        titleEn: 'Sadia Chicken Nuggets Spicy 270g',
        titleAr: 'ناجتس دجاج ساديا حار 270 جم',
        variantOrFlavor: 'Spicy',
        each_size_value: 270,
        each_size_unit: 'g',
        inner_pack_count: 1
      })

      const allOffers = [
        fakieh10x1000gCarton,
        fakieh1000gSingleR1,
        fakieh600gSingle,
        fakieh600gBuy2Promo,
        fakieh1000gSingleR2Bilingual,
        sadia1000gSingle,
        sadia10x1000gCarton,
        sadiaNuggetsClassic,
        sadiaNuggetsSpicy
      ]

      const grouping = new BrandGroupingService(new MatchingEvidenceOverlayService(createTempOverlayPath('ov-')))
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
        searchDiagnostics: ['Verified 0 candidates in dev catalog']
      })

      const cache = new VerifiedMatchCacheService(createTempDir('cache-'), 'development')
      const gemini = new GeminiMatchingService()
      const evalSpy = vi.spyOn(gemini, 'evaluateBatch')
      const orchestrator = new CatalogMatchingOrchestrator(cache, gemini, grouping)
      vi.spyOn(orchestrator, 'saveManifestAtomic').mockImplementation(() => {})

      const manifest = await orchestrator.executeMatchingRun({
        batchId: 'batch_003_scenario2',
        offers: allOffers,
        supabase: {} as any
      })

      expect(evalSpy).not.toHaveBeenCalled()

      // Verify zero placeholder "local_temp_*" IDs exist
      for (const prop of Object.values(manifest.proposals)) {
        expect(prop.decision).toBe('temporary')
        expect(prop.temporaryId).toBeTruthy()
        expect(prop.temporaryId).not.toContain('local_temp_')
      }

      const idCarton = manifest.proposals[fakieh10x1000gCarton.batchOfferKey].temporaryId!
      const idSingle1000R1 = manifest.proposals[fakieh1000gSingleR1.batchOfferKey].temporaryId!
      const idSingle1000R2 = manifest.proposals[fakieh1000gSingleR2Bilingual.batchOfferKey].temporaryId!
      const id600Single = manifest.proposals[fakieh600gSingle.batchOfferKey].temporaryId!
      const id600Promo = manifest.proposals[fakieh600gBuy2Promo.batchOfferKey].temporaryId!
      const idSadiaSingle = manifest.proposals[sadia1000gSingle.batchOfferKey].temporaryId!
      const idSadiaCarton = manifest.proposals[sadia10x1000gCarton.batchOfferKey].temporaryId!
      const idSadiaClassic = manifest.proposals[sadiaNuggetsClassic.batchOfferKey].temporaryId!
      const idSadiaSpicy = manifest.proposals[sadiaNuggetsSpicy.batchOfferKey].temporaryId!

      // Fakieh 3 distinct SKUs: carton A != single B != 600g C
      expect(idCarton).not.toBe(idSingle1000R1)
      expect(idSingle1000R1).not.toBe(id600Single)
      expect(idCarton).not.toBe(id600Single)

      // Identical SKU across retailer/Arabic-English & retail promo merges to same temp ID
      expect(idSingle1000R2).toBe(idSingle1000R1)
      expect(id600Promo).toBe(id600Single)

      // Sadia 1000g single != 10x1000g carton
      expect(idSadiaSingle).not.toBe(idSadiaCarton)

      // Sadia Nuggets Classic != Sadia Nuggets Spicy
      expect(idSadiaClassic).not.toBe(idSadiaSpicy)

      // Exactly 7 temporary groups total (3 Fakieh + 4 Sadia)
      expect(Object.keys(manifest.temporaryProducts)).toHaveLength(7)

      // Merged groups preserve all member sourceOfferKeys & retailers
      expect(manifest.temporaryProducts[idSingle1000R1].sourceOfferKeys).toHaveLength(2)
      expect(manifest.temporaryProducts[idSingle1000R1].retailers).toEqual(expect.arrayContaining(['Noori', 'LuLu']))
      expect(manifest.temporaryProducts[id600Single].sourceOfferKeys).toHaveLength(2)
      expect(manifest.temporaryProducts[id600Single].retailers).toEqual(expect.arrayContaining(['Panda', 'BinDawood']))
    })

    it('runner replayHistoricalBenchmarkOffline assigns distinct TemporaryProductRegistry IDs for offline Fakieh SKUs (never local_temp_fakieh)', () => {
      const runner = new LiveCatalogMatchingBenchmarkRunner()
      const replay = runner.replayHistoricalBenchmarkOffline()
      const fakiehRows = replay.perItemReplayResults.filter((r) => r.brand === 'Fakieh')
      expect(fakiehRows).toHaveLength(3)
      const tempIds = fakiehRows.map((r) => r.reconciledTemporaryId)
      for (const r of fakiehRows) {
        expect(r.actualDecision).toBe('temporary')
        expect(r.actualTemporaryRef).toBeTruthy()
        expect(r.actualTemporaryRef).not.toContain('local_temp_')
      }
      // Three genuinely distinct Fakieh SKUs -> 3 distinct batch temp IDs
      expect(new Set(tempIds).size).toBe(3)
      // Directly verify TemporaryProductRegistry refuses substring false-merge ("Sadia Nuggets" vs "Sadia Nuggets Spicy")
      const regDirect = new TemporaryProductRegistry('direct_003')
      const directGrouping = new BrandGroupingService(new MatchingEvidenceOverlayService(createTempOverlayPath('ov-dir-')))
      const nuggetBase = makeOffer({
        sourceOfferId: 'nug_base',
        brand: 'Sadia',
        brandEn: 'Sadia',
        titleEn: 'Sadia Chicken Nuggets 270g',
        titleAr: 'ناجتس دجاج ساديا 270 جم',
        each_size_value: 270,
        each_size_unit: 'g'
      })
      const nuggetSpicy = makeOffer({
        sourceOfferId: 'nug_spicy',
        brand: 'Sadia',
        brandEn: 'Sadia',
        titleEn: 'Sadia Chicken Nuggets Spicy 270g',
        titleAr: 'ناجتس دجاج ساديا حار 270 جم',
        variantOrFlavor: 'Spicy',
        each_size_value: 270,
        each_size_unit: 'g'
      })
      const grpBase = directGrouping.extractNormalizedAttributes(nuggetBase)
      const grpSpicy = directGrouping.extractNormalizedAttributes(nuggetSpicy)
      const directMap = new Map<string, string>()
      const r1 = regDirect.reconcileTemporaryOffer({ requestTempRef: 't1', requestScopedMap: directMap, attrs: grpBase, sourceOffer: nuggetBase })
      const r2 = regDirect.reconcileTemporaryOffer({ requestTempRef: 't2', requestScopedMap: directMap, attrs: grpSpicy, sourceOffer: nuggetSpicy })
      expect(r1.temporaryId).not.toBe(r2.temporaryId)
    })
  })

  // =========================================================================
  // 2. §3 Cross-Request Reconciliation, Collision Prevention & Checkpoint Resume
  // =========================================================================
  describe('§3 Cross-Request Temporary Reconciliation, Collision Guard & Resume', () => {
    it('reconciles identical new SKUs across separate Gemini chunks, prevents "t1" collisions, and blocks variant merges', async () => {
      // Force multiple Gemini chunks within ONE brand ("Sadia") by setting chunkSize = 2
      const offers: UnifiedBatchOffer[] = [
        // Chunk 1: item 1 (t1) = Nuggets Crispy 750g; item 2 (t2) = Whole Chicken 1200g
        makeOffer({
          sourceOfferId: 'chk1_nuggets_crispy_en',
          leafletId: 'panda_chk',
          supermarketName: 'Panda',
          brand: 'Sadia',
          brandEn: 'Sadia',
          brandAr: 'ساديا',
          titleEn: 'Sadia Crispy Chicken Nuggets 750g',
          titleAr: 'ناجتس دجاج مقرمش ساديا 750 جم',
          variantOrFlavor: 'Crispy',
          each_size_value: 750,
          each_size_unit: 'g'
        }),
        makeOffer({
          sourceOfferId: 'chk1_whole_1200',
          leafletId: 'panda_chk',
          supermarketName: 'Panda',
          brand: 'Sadia',
          brandEn: 'Sadia',
          brandAr: 'ساديا',
          titleEn: 'Sadia Frozen Whole Chicken 1200g',
          titleAr: 'دجاج ساديا مجمد 1200 جم',
          each_size_value: 1200,
          each_size_unit: 'g'
        }),
        // Chunk 2: item 1 (also t1!) = Spicy Nuggets 750g (VARIANT CONFLICT with Crispy, AND reuses "t1"!);
        // item 2 (t2!) = Crispy Nuggets 750g with Arabic title variation (SHOULD MERGE with Chunk 1 t1!)
        makeOffer({
          sourceOfferId: 'chk2_nuggets_spicy_reuses_t1',
          leafletId: 'lulu_chk',
          supermarketName: 'LuLu',
          brand: 'Sadia',
          brandEn: 'Sadia',
          brandAr: 'ساديا',
          titleEn: 'Sadia Spicy Chicken Nuggets 750g',
          titleAr: 'ناجتس دجاج حار ساديا 750 جم',
          variantOrFlavor: 'Spicy',
          each_size_value: 750,
          each_size_unit: 'g'
        }),
        makeOffer({
          sourceOfferId: 'chk2_nuggets_crispy_ar_bilingual',
          leafletId: 'lulu_chk',
          supermarketName: 'LuLu',
          brand: 'Sadia',
          brandEn: 'Sadia',
          brandAr: 'ساديا',
          titleEn: 'Sadia Crispy Nuggets 750gm',
          titleAr: 'ساديا ناجتس دجاج مقرمش ٧٥٠ جم',
          variantOrFlavor: 'Crispy',
          each_size_value: 750,
          each_size_unit: 'g'
        }),
        // Chunk 3: item 1 (t1!) = Sadia Whole Chicken 1200g Buy 2 promo (SHOULD MERGE with Chunk 1 Whole 1200g!)
        // item 2 (also erroneously labeled t1 by model!) = Sadia Chicken Strips 350g (SAME-REQUEST t1 COLLISION!)
        makeOffer({
          sourceOfferId: 'chk3_whole_1200_buy2_promo',
          leafletId: 'bndw_chk',
          supermarketName: 'BinDawood',
          brand: 'Sadia',
          brandEn: 'Sadia',
          brandAr: 'ساديا',
          titleEn: 'Sadia Frozen Chicken 1200g (Buy 2)',
          titleAr: 'دجاج ساديا مجمد ١٢٠٠ جم حبتين',
          each_size_value: 1200,
          each_size_unit: 'g',
          promo_condition_quantity: 2,
          promotion_mechanic: '2 For 29.95 SAR'
        }),
        makeOffer({
          sourceOfferId: 'chk3_strips_350_collides_t1',
          leafletId: 'bndw_chk',
          supermarketName: 'BinDawood',
          brand: 'Sadia',
          brandEn: 'Sadia',
          brandAr: 'ساديا',
          titleEn: 'Sadia Chicken Strips Original 350g',
          titleAr: 'ستربس دجاج ساديا عادي 350 جم',
          variantOrFlavor: 'Original',
          each_size_value: 350,
          each_size_unit: 'g'
        })
      ]

      const grouping = new BrandGroupingService(new MatchingEvidenceOverlayService(createTempOverlayPath('ov2-')))
      vi.spyOn(grouping, 'retrieveBrandCandidates').mockResolvedValue({
        candidates: [
          {
            id: '99901',
            brand: 'Sadia',
            nameEn: 'Sadia Tempura Chicken Nuggets 270g',
            nameAr: 'ناجتس تمبورا ساديا 270 جم',
            variant: null,
            sizeValue: 270,
            sizeUnit: 'g',
            packCount: 1
          }
        ],
        totalBrandProducts: 1,
        retrievalCompleteness: 'complete',
        fallbackActions: []
      })

      const cache = new VerifiedMatchCacheService(createTempDir('cache2-'), 'development')
      const gemini = new GeminiMatchingService()
      const orchestrator = new CatalogMatchingOrchestrator(cache, gemini, grouping)
      vi.spyOn(orchestrator, 'determineChunkSize').mockReturnValue(2)
      vi.spyOn(orchestrator, 'saveManifestAtomic').mockImplementation(() => {})

      let chunkCallCount = 0
      vi.spyOn(gemini, 'evaluateBatch').mockImplementation(async (req) => {
        chunkCallCount++
        const matches = req.items.map((item, idx) => {
          // Force Chunk 3 to assign "t1" to BOTH items to exercise same-request t1 collision guard!
          const tempRef = chunkCallCount === 3 ? 't1' : `t${idx + 1}`
          return {
            item,
            matchedProductId: null,
            temporaryRef: tempRef,
            confidence: 'high' as const,
            validationIssues: []
          }
        })
        return {
          brandKey: req.brandKey,
          matches,
          usage: {
            inputTokens: 100,
            outputTokens: 20,
            thinkingTokens: 50,
            totalTokens: 170,
            actualCostUsd: 0,
            executionTier: 'flex' as const
          },
          latencyMs: 10
        }
      })

      const manifest = await orchestrator.executeMatchingRun({
        batchId: 'batch_003_chunks',
        offers,
        supabase: {} as any
      })

      expect(chunkCallCount).toBe(3)
      expect(manifest.totals.geminiRequestsCount).toBe(3)

      const idCrispyEn = manifest.proposals[offers[0].batchOfferKey].temporaryId!
      const idWhole1200 = manifest.proposals[offers[1].batchOfferKey].temporaryId!
      const idSpicy750 = manifest.proposals[offers[2].batchOfferKey].temporaryId!
      const idCrispyAr = manifest.proposals[offers[3].batchOfferKey].temporaryId!
      const idWholePromo = manifest.proposals[offers[4].batchOfferKey].temporaryId!
      const idStrips350 = manifest.proposals[offers[5].batchOfferKey].temporaryId!

      // Cross-request identical SKU merge (Chunk 1 t1 == Chunk 2 t2)
      expect(idCrispyAr).toBe(idCrispyEn)
      // Cross-request promo merge (Chunk 1 t2 == Chunk 3 t1)
      expect(idWholePromo).toBe(idWhole1200)
      // Cross-request "t1" non-collision (Chunk 2 t1 = Spicy != Chunk 1 t1 = Crispy; Chunk 3 t1 = Whole != Crispy)
      expect(idSpicy750).not.toBe(idCrispyEn)
      expect(idWholePromo).not.toBe(idCrispyEn)
      // Variant conflict blocked
      expect(idSpicy750).not.toBe(idCrispyAr)
      // Same-request "t1" collision routed safely to separate group with warning
      expect(idStrips350).not.toBe(idWholePromo)
      expect(manifest.temporaryProducts[idStrips350].validationWarnings.some((w) => w.includes('MODEL_LOCAL_TEMP_REF_COLLISION'))).toBe(true)

      // Exactly 4 distinct temporary SKUs overall
      expect(Object.keys(manifest.temporaryProducts)).toHaveLength(4)
    })

    it('preserves assigned temporary IDs cleanly across interrupted run & resume from saved checkpoint', async () => {
      const offerA = makeOffer({
        sourceOfferId: 'resume_a1',
        leafletId: 'panda_res',
        supermarketName: 'Panda',
        brand: 'Tanmiah',
        brandEn: 'Tanmiah',
        brandAr: 'التنمية',
        titleEn: 'Tanmiah Fresh Chicken Breast 450g',
        titleAr: 'صدور دجاج التنمية طازجة 450 جم',
        each_size_value: 450,
        each_size_unit: 'g'
      })
      const offerB = makeOffer({
        sourceOfferId: 'resume_a2',
        leafletId: 'lulu_res',
        supermarketName: 'LuLu',
        brand: 'Tanmiah',
        brandEn: 'Tanmiah',
        brandAr: 'التنمية',
        titleEn: 'Tanmiah Chicken Breast 450gm Fresh',
        titleAr: 'تنمية صدور دجاج طازجة 450 جرام',
        each_size_value: 450,
        each_size_unit: 'g'
      })

      const grouping = new BrandGroupingService(new MatchingEvidenceOverlayService(createTempOverlayPath('ov-res-')))
      vi.spyOn(grouping, 'retrieveBrandCandidates').mockResolvedValue({
        candidates: [
          {
            id: '88801',
            brand: 'Tanmiah',
            nameEn: 'Tanmiah Fresh Whole Chicken 1000g',
            nameAr: 'دجاج التنمية طازج 1000 جم',
            variant: null,
            sizeValue: 1000,
            sizeUnit: 'g',
            packCount: 1
          }
        ],
        totalBrandProducts: 1,
        retrievalCompleteness: 'complete',
        fallbackActions: []
      })

      const cache = new VerifiedMatchCacheService(createTempDir('cache-res-'), 'development')
      const gemini = new GeminiMatchingService()
      const orchestrator = new CatalogMatchingOrchestrator(cache, gemini, grouping)
      vi.spyOn(orchestrator, 'determineChunkSize').mockReturnValue(1)

      let savedManifestSnapshot: MatchingRunManifest | null = null
      vi.spyOn(orchestrator, 'saveManifestAtomic').mockImplementation((m) => {
        savedManifestSnapshot = JSON.parse(JSON.stringify(m))
      })
      vi.spyOn(orchestrator, 'loadManifest').mockImplementation(() => {
        return savedManifestSnapshot ? JSON.parse(JSON.stringify(savedManifestSnapshot)) : null
      })

      createdBatchDirs.push(path.join(process.cwd(), 'Extracts', 'batches', 'batch_003_resume'))

      // First run: fail intentionally on 2nd Gemini chunk AFTER Chunk 1 checkpoint was saved
      let firstRunCalls = 0
      vi.spyOn(gemini, 'evaluateBatch').mockImplementation(async (req) => {
        firstRunCalls++
        if (firstRunCalls === 2) {
          throw new Error('SIMULATED_FLEX_TIMEOUT_ON_CHUNK_2')
        }
        return {
          brandKey: req.brandKey,
          matches: req.items.map((item) => ({
            item,
            matchedProductId: null,
            temporaryRef: 't1',
            confidence: 'high' as const,
            validationIssues: []
          })),
          usage: { inputTokens: 80, outputTokens: 15, thinkingTokens: 40, totalTokens: 135, actualCostUsd: 0, executionTier: 'flex' as const },
          latencyMs: 5
        }
      })

      const partialRun = await orchestrator.executeMatchingRun({
        batchId: 'batch_003_resume',
        offers: [offerA, offerB],
        supabase: {} as any
      })
      expect(partialRun.status).toBe('completed_with_failures')
      expect(partialRun.totals.failedRequestsCount).toBe(1)
      expect(partialRun.totals.completedRequestsCount).toBe(1)

      expect(savedManifestSnapshot).not.toBeNull()
      const chunk1TempId = savedManifestSnapshot!.proposals[offerA.batchOfferKey].temporaryId!
      expect(chunk1TempId).toMatch(/^t_batch003resu_001$/)

      // Retry Failed Only with explicit authorization: Chunk 1 MUST NOT re-execute Gemini; Chunk 2 MUST execute & reconcile into Chunk 1's temp ID!
      let resumeCalls = 0
      vi.spyOn(gemini, 'evaluateBatch').mockImplementation(async (req) => {
        resumeCalls++
        return {
          brandKey: req.brandKey,
          matches: req.items.map((item) => ({
            item,
            matchedProductId: null,
            temporaryRef: 't1',
            confidence: 'high' as const,
            validationIssues: []
          })),
          usage: { inputTokens: 80, outputTokens: 15, thinkingTokens: 40, totalTokens: 135, actualCostUsd: 0, executionTier: 'flex' as const },
          latencyMs: 5
        }
      })

      const resumed = await orchestrator.retryFailedOnly({
        batchId: 'batch_003_resume',
        offers: [offerA, offerB],
        supabase: {} as any,
        approvedByOperator: true,
        approvedMaxBudgetUsd: 0.05
      })

      expect(resumeCalls).toBe(1)
      expect(resumed.proposals[offerA.batchOfferKey].temporaryId).toBe(chunk1TempId)
      expect(resumed.proposals[offerB.batchOfferKey].temporaryId).toBe(chunk1TempId)
      expect(Object.keys(resumed.temporaryProducts)).toHaveLength(1)
      expect(resumed.temporaryProducts[chunk1TempId].sourceOfferKeys).toHaveLength(2)
    })
  })

  // =========================================================================
  // 3. §8 Full Application Pipeline End-to-End Validation
  // =========================================================================
  describe('§8 End-to-End Application Pipeline (Batch -> Grouping -> Cache -> Overlay -> Publication Preflight)', () => {
    it('prevents page-level raw_extraction_json cross-item bleeding and validates full cache/overlay/preflight chain', async () => {
      const batchId = `uat_003_pipeline_${Date.now()}`
      const batchDir = sharedBatchOrchestrationService.getBatchDir(batchId)
      const leafletDir = path.join(batchDir, 'leaflets', 'l_panda')
      fs.mkdirSync(path.join(leafletDir, 'json'), { recursive: true })
      createdBatchDirs.push(batchDir)

      // Two canonical_v1 files sharing the same page-wide raw_extraction_json array (matching Panda_Test/Lulu_Test)!
      // Item 1 on page is Assorted; Item 2 on page is Single SKU (must NOT inherit Item 1's assortment flag!)
      const sharedPageRawArray = [
        {
          offer_number: 1,
          english_title: 'Sun Top Drink 18 x 125ml',
          arabic_title: 'شراب سن توب ١٨ × ١٢٥ مل',
          is_multi_brand_or_variant: true
        },
        {
          offer_number: 2,
          english_title: 'Puck Cream Cheese Spread 2 x 500g',
          arabic_title: 'جبنة كريم بوك ٢ × ٥٠٠ جم',
          is_multi_brand_or_variant: false
        }
      ]
      const canonical1 = {
        schema_version: 'canonical_v1',
        source: {
          external_image_id: 'panda_p1_001',
          source_page_number: 1,
          source_item_number: '1'
        },
        product: {
          title_ar: 'شراب سن توب ١٨ × ١٢٥ مل',
          title_en: 'Sun Top Drink 18 x 125ml',
          brand_text: 'Sun Top',
          brand_en: 'Sun Top',
          brand_ar: 'سن توب'
        },
        prices: { offer_price: 15.99 },
        content: {
          size_text: '18 x 125ml',
          each_size_value: 125,
          each_size_unit: 'ml',
          pack_quantity: 18,
          sale_unit_type: 'pack',
          quantity_semantics: 'manufacturer_multipack'
        },
        raw: { raw_attributes: { raw_extraction_json: sharedPageRawArray } }
      }
      const canonical2 = {
        schema_version: 'canonical_v1',
        source: {
          external_image_id: 'panda_p1_002',
          source_page_number: 1,
          source_item_number: '2'
        },
        product: {
          title_ar: 'جبنة كريم بوك ٢ × ٥٠٠ جم',
          title_en: 'Puck Cream Cheese Spread 2 x 500g',
          brand_text: 'Puck',
          brand_en: 'Puck',
          brand_ar: 'بوك'
        },
        prices: { offer_price: 24.95 },
        content: {
          size_text: '2x500g',
          each_size_value: 500,
          each_size_unit: 'g',
          pack_quantity: 2,
          sale_unit_type: 'pack',
          quantity_semantics: 'manufacturer_multipack'
        },
        raw: { raw_attributes: { raw_extraction_json: sharedPageRawArray } }
      }
      fs.writeFileSync(path.join(leafletDir, 'json', 'page-001-001.canonical.json'), JSON.stringify(canonical1, null, 2), 'utf8')
      fs.writeFileSync(path.join(leafletDir, 'json', 'page-001-002.canonical.json'), JSON.stringify(canonical2, null, 2), 'utf8')

      const batchManifest: BatchManifest = {
        schemaVersion: '1.0',
        batchId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'completed',
        workspaceDir: batchDir,
        executionMode: 'flex',
        model: 'gemini-3.8-flash',
        totals: { totalPdfs: 1, completedPdfs: 1, failedPdfs: 0, cancelledPdfs: 0, totalPages: 1, pagesProcessed: 1, totalOffers: 2, totalCostUsd: 0 },
        leaflets: [
          {
            leafletId: 'l_panda',
            fileName: 'panda.pdf',
            filePath: path.join(batchDir, 'panda.pdf'),
            fileSizeBytes: 10,
            fileFingerprint: 'fp-p1',
            pageCount: 1,
            pagesProcessed: 1,
            offersCount: 2,
            estimatedCostUsd: 0,
            status: 'completed',
            workspacePath: leafletDir,
            provenance: 'cache',
            metadata: {
              supermarketId: 'panda',
              supermarketName: 'Panda',
              locationScope: 'national',
              locationLabel: null,
              cityId: null,
              regionId: null,
              offerStartDate: '2026-06-03',
              offerEndDate: '2026-06-09'
            }
          }
        ]
      }
      fs.writeFileSync(sharedBatchOrchestrationService.getBatchManifestPath(batchId), JSON.stringify(batchManifest, null, 2), 'utf8')

      const offers = await sharedBatchOrchestrationService.getUnifiedBatchOffers(batchId)
      expect(offers).toHaveLength(2)

      // Item 1 keeps raw assortment flag; Item 2 does NOT bleed Item 1's true flag
      const sunTop = offers.find((o) => o.canonicalSourceId === 'panda_p1_001' || o.sourceOfferId === 'panda_p1_001' || o.titleEn.includes('Sun Top'))!
      const puck = offers.find((o) => o.canonicalSourceId === 'panda_p1_002' || o.sourceOfferId === 'panda_p1_002' || o.titleEn.includes('Puck'))!
      const grouping = new BrandGroupingService(new MatchingEvidenceOverlayService(createTempOverlayPath('ov-e2e-')))
      const sunTopAttrs = grouping.extractNormalizedAttributes(sunTop)
      const puckAttrs = grouping.extractNormalizedAttributes(puck)
      expect(evaluateIdentitySufficiency(sunTopAttrs, sunTop).isAssortment).toBe(true)
      expect(evaluateIdentitySufficiency(puckAttrs, puck).isAssortment).toBe(false)

      // VerifiedMatchCache variant isolation + hit behavior
      const cache = new VerifiedMatchCacheService(createTempDir('cache-e2e-'), 'development')
      const puckGroup = grouping.groupOffersByBrand([puck])[0]
      cache.recordVerifiedMatch({
        attrs: puckGroup.uniqueIdentities[0].normalizedAttrs,
        approvedProductId: '70001',
        verifiedBy: 'uat_reviewer',
        catalogVersion: 'dev'
      })

      // Variant/flavor difference must NEVER hit cached match
      const puckSpicy = makeOffer({
        sourceOfferId: 'puck_chilli',
        brand: 'Puck',
        brandEn: 'Puck',
        titleEn: 'Puck Cream Cheese Spread Chilli 2 x 500g',
        variantOrFlavor: 'Chilli',
        each_size_value: 500,
        each_size_unit: 'g',
        inner_pack_count: 2
      })
      const spicyAttrs = grouping.groupOffersByBrand([puckSpicy])[0].uniqueIdentities[0].normalizedAttrs
      expect(cache.lookupVerifiedMatch(spicyAttrs)).toBeNull()

      // Full orchestrator run: Sun Top stays unresolved (assortment), Puck hits cache at $0 cost!
      vi.spyOn(grouping, 'retrieveBrandCandidates').mockResolvedValue({
        candidates: [],
        totalBrandProducts: 0,
        retrievalCompleteness: 'complete',
        fallbackActions: []
      })
      const gemini = new GeminiMatchingService()
      const evalSpy = vi.spyOn(gemini, 'evaluateBatch')
      const orchestrator = new CatalogMatchingOrchestrator(cache, gemini, grouping)
      vi.spyOn(orchestrator, 'saveManifestAtomic').mockImplementation(() => {})

      const manifest = await orchestrator.executeMatchingRun({
        batchId,
        offers,
        supabase: {} as any
      })

      expect(evalSpy).not.toHaveBeenCalled()
      expect(manifest.proposals[sunTop.batchOfferKey].decision).toBe('unresolved')
      expect(manifest.proposals[puck.batchOfferKey].decision).toBe('existing')
      expect(manifest.proposals[puck.batchOfferKey].matchedProductId).toBe('70001')

      // Publication preflight check (blocked in production OR unresolved items remain safe)
      const pub = new CatalogPublicationService(cache)
      const preflight = await pub.assessPublicationPreflight({
        manifest,
        offers,
        context: 'DEVELOPMENT_TEST'
      })
      expect(preflight.existingProductMatchesCount).toBe(1)
      expect(preflight.unresolvedOffersCount).toBe(1)
      expect(preflight.blockingReasons).toHaveLength(0)
    })
  })
})
