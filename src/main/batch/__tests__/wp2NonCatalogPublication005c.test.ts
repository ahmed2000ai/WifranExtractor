/**
 * WIFRAN-EXTRACTOR-IDENTITY-005C: WP2 Safe Non-Catalog Publication & Consumer Contract Suite
 *
 * Tests all 16 WP2 offline + DEVELOPMENT_TEST (gykrbpykjhpyrdrinkuk) requirements:
 * - Loose produce & unsplit assortment publication with product_id = null
 * - Fact-conflict / missing-dates / non-grocery quarantine
 * - Shared promo pricing, per-unit basis, location/retailer metadata, & comparison disabled
 * - Mandatory operator approval & WP3 INCOMPLETE_MATCHING_EXECUTION preservation
 * - Private crop URL sanitization across all public projections & v_consumer_offers
 * - Idempotency & non-duplicating future catalog linking upgrade
 * - Legacy Coca-Cola size_unit = L, unit = PCS mapping regression check
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import dotenv from 'dotenv'

dotenv.config({ path: join(process.cwd(), '.env.local') })

import { assessOfferPublicationOutcome, sanitizePublicConsumerImageUrl, computeStableSourceOfferId } from '../../../shared/utils/nonCatalogPublicationPolicy'
import { mapSqlConsumerViewRowToConsumerDto, toConsumerOfferProjection } from '../../../shared/utils/extractorContractV2Adapter'
import { mapPreparedPayloadToOffersInsert } from '../../../shared/utils/offerSyncMapper'
import { extractLegacyQuantityAndSize } from '../../../shared/utils/legacyOcrFieldMapper'
import { normalizeToCanonicalOffer } from '../../../shared/utils/canonicalOfferNormalizer'
import { CatalogPublicationService } from '../../db/catalogPublicationService'
import { VerifiedMatchCacheService } from '../../db/verifiedMatchCacheService'
import { CatalogMatchingOrchestrator } from '../catalogMatchingOrchestrator'
import { createIsolatedWifranPostgres } from '../../db/__tests__/isolatedPostgresHarness008'
import type { SqlQueryable } from '../../db/schemaCompatibilityService'
import { UnifiedBatchOffer } from '../../../shared/types/batchExtraction'
import { MatchingProposal, MatchingRunManifest } from '../../../shared/types/catalogMatching'

function makeTestOffer(overrides: Partial<UnifiedBatchOffer> & { keySuffix: string }): UnifiedBatchOffer {
  return {
    batchOfferKey: `wp2_test:${overrides.leafletId || 'leaflet_wp2'}:${overrides.sourcePage || 1}:${overrides.keySuffix}`,
    batchId: 'wp2_test',
    leafletId: overrides.leafletId || 'leaflet_wp2',
    sourceFileName: 'wp2_test.pdf',
    sourcePdfPath: 'C:\\Work\\fake\\wp2_test.pdf',
    sourcePage: overrides.sourcePage ?? 1,
    sourceOfferId: overrides.sourceOfferId || overrides.keySuffix,
    supermarketId: overrides.supermarketId || 'c2cc16c2-0001-4444-b000-c00000000001',
    supermarketName: overrides.supermarketName || 'Al Othaim',
    locationScope: overrides.locationScope ?? 'national',
    locationLabel: overrides.locationLabel ?? 'KSA',
    cityId: overrides.cityId ?? null,
    regionId: overrides.regionId ?? null,
    offerStartDate: overrides.offerStartDate !== undefined ? overrides.offerStartDate : '2026-11-10',
    offerEndDate: overrides.offerEndDate !== undefined ? overrides.offerEndDate : '2026-11-20',
    titleAr: overrides.titleAr !== undefined ? overrides.titleAr : 'طماطم طازجة بالكيلو',
    titleEn: overrides.titleEn !== undefined ? overrides.titleEn : 'Fresh Tomatoes Per Kg',
    brand: overrides.brand ?? null,
    brandAr: overrides.brandAr ?? null,
    brandEn: overrides.brandEn ?? null,
    promoPrice: overrides.promoPrice !== undefined ? overrides.promoPrice : 4.95,
    originalPrice: overrides.originalPrice !== undefined ? overrides.originalPrice : 7.5,
    discountPercent: 34,
    promoNotes: overrides.promoNotes ?? null,
    promotion_mechanic: overrides.promotion_mechanic,
    sizeOrWeight: overrides.sizeOrWeight ?? '1kg',
    each_size_value: overrides.each_size_value !== undefined ? overrides.each_size_value : 1,
    each_size_unit: overrides.each_size_unit !== undefined ? overrides.each_size_unit : 'kg',
    inner_pack_count: overrides.inner_pack_count !== undefined ? overrides.inner_pack_count : null,
    sale_unit_type: overrides.sale_unit_type || 'kg',
    total_content_value: overrides.total_content_value ?? 1,
    total_content_unit: overrides.total_content_unit ?? 'kg',
    free_units_text: overrides.free_units_text ?? null,
    customer_limit: overrides.customer_limit ?? null,
    productThumbCropPath: overrides.productThumbCropPath ?? 'C:\\Work\\crops\\product_thumb_crop.webp',
    offerCardCropPath: overrides.offerCardCropPath ?? 'C:\\Work\\crops\\offer_card_crop.webp',
    status: 'extracted',
    confidence: 'high',
    warnings: overrides.warnings ?? [],
    blockingErrors: overrides.blockingErrors ?? [],
    canonical: overrides.canonical
  }
}

function makeProposal(offer: UnifiedBatchOffer, extra?: Partial<MatchingProposal>): MatchingProposal {
  return {
    batchOfferKey: offer.batchOfferKey,
    sourceOfferId: offer.sourceOfferId,
    sourcePage: offer.sourcePage,
    leafletId: offer.leafletId,
    supermarketName: offer.supermarketName,
    decision: 'unresolved',
    matchedProductId: null,
    temporaryId: null,
    matchMethod: 'manual_operator',
    confidence: 'high',
    validationIssues: [],
    operatorDecision: 'proposed',
    updatedAt: new Date().toISOString(),
    ...extra
  }
}

function makeBaseManifest(batchId: string, offers: UnifiedBatchOffer[], overrides?: Partial<MatchingRunManifest>): MatchingRunManifest {
  const proposals: MatchingRunManifest['proposals'] = {}
  for (const offer of offers) {
    proposals[offer.batchOfferKey] = makeProposal(offer)
  }
  return {
    schemaVersion: '1.0',
    batchId,
    runId: `run_${batchId}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'completed',
    model: 'gemini-3.8-flash',
    thinkingLevel: 'MEDIUM',
    executionMode: 'flex',
    totals: {
      totalExtractedOffers: offers.length,
      uniqueIdentitiesCount: offers.length,
      cacheMatchesCount: 0,
      deterministicMatchesCount: 0,
      geminiEvaluatedCount: 0,
      proposedExistingCount: 0,
      proposedTemporaryCount: 0,
      unresolvedCount: offers.length,
      validationWarningsCount: 0,
      actualCostUsd: 0,
      estimatedCostUsd: 0,
      geminiRequestsCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0
    },
    proposals,
    temporaryProducts: {},
    brandSummaries: {},
    ...overrides
  }
}

describe('WIFRAN-EXTRACTOR-IDENTITY-005C: WP2 Non-Catalog Publication & Consumer Contract', () => {
  let tempRoot: string
  let cacheDir: string
  let pubService: CatalogPublicationService
  let isolatedClient: SqlQueryable
  let devSupermarketId = 'c2cc16c2-0001-4444-b000-c00000000001'
  let devCityId: string | null = null
  const createdOfferIds: string[] = []
  const createdProductIds: string[] = []

  beforeAll(async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'wifran-wp2-'))
    cacheDir = join(tempRoot, 'cache')
    pubService = new CatalogPublicationService(new VerifiedMatchCacheService(cacheDir, 'development'))

    const isolated = await createIsolatedWifranPostgres()
    isolatedClient = isolated.client
    const supRes = await isolatedClient.query(`SELECT id FROM public.supermarkets ORDER BY id LIMIT 1`)
    if (supRes.rows.length > 0) {
      devSupermarketId = String(supRes.rows[0].id)
    }
    const cityRes = await isolatedClient.query(`SELECT id FROM public.cities ORDER BY id LIMIT 1`)
    if (cityRes.rows.length > 0) {
      devCityId = String(cityRes.rows[0].id)
    }
  }, 30000)

  afterAll(async () => {
    try {
      if (isolatedClient?.end) {
        await isolatedClient.end()
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  }, 30000)

  it('T1 & T13 & T7 & T11: Valid loose tomatoes per kg publish to DEVELOPMENT_TEST with product_id=null and appear safely in v_consumer_offers', async () => {
    const offer = makeTestOffer({
      keySuffix: `t1_tomato_${Date.now()}`,
      supermarketId: devSupermarketId,
      titleEn: 'Fresh Tomatoes Per Kg',
      titleAr: 'طماطم طازجة بالكيلو',
      promoPrice: 4.95,
      originalPrice: 7.5,
      sale_unit_type: 'kg',
      each_size_value: 1,
      each_size_unit: 'kg',
      inner_pack_count: null
    })

    const manifest = makeBaseManifest('b_t1', [offer], {
      nonCatalogApprovals: {
        [offer.batchOfferKey]: {
          batchOfferKey: offer.batchOfferKey,
          decision: 'approved',
          category: 'loose_produce',
          updatedAt: new Date().toISOString()
        }
      }
    })

    const res = await pubService.publishApprovedCatalogBatch({
      manifest,
      offers: [offer],
      context: 'DEVELOPMENT_TEST',
      pgClient: isolatedClient,
      allowIsolatedTestDb: true,
      enableImageUpload: false,
      operatorId: 'vitest_wp2_t1'
    })

    expect(res.success).toBe(true)
    expect(res.createdProductsCount).toBe(0)
    expect(res.publishedOffersCount).toBe(1)
    expect(res.publishedNonCatalogOffersCount).toBe(1)
    createdOfferIds.push(...res.publishedOfferIds)

    const dbRow = await isolatedClient.query(`SELECT * FROM public.offers WHERE id = $1`, [res.publishedOfferIds[0]])
    expect(dbRow.rows.length).toBe(1)
    expect(dbRow.rows[0].product_id).toBeNull()
    expect(dbRow.rows[0].status).toBe('published')
    expect(dbRow.rows[0].catalog_match_status).toBe('unresolved')
    expect(dbRow.rows[0].exact_identity_status).toBe('unresolved')
    expect(dbRow.rows[0].image_url).toBeNull()
    expect(dbRow.rows[0].thumbnail_url).toBeNull()
    expect(Number(dbRow.rows[0].unit_price)).toBeCloseTo(4.95, 2)
    expect(dbRow.rows[0].unit_price_unit).toBe('kg')

    // T13: Verify real v_consumer_offers view query includes null-product offer & masks comparison/images
    const viewRes = await isolatedClient.query(`SELECT * FROM public.v_consumer_offers WHERE id = $1`, [res.publishedOfferIds[0]])
    expect(viewRes.rows.length).toBe(1)
    const viewRow = viewRes.rows[0]
    expect(viewRow.product_id).toBeNull()
    expect(viewRow.image_url).toBeNull()
    expect(viewRow.thumbnail_url).toBeNull()
    expect(viewRow.display_image_url).toBeNull()

    const dto = mapSqlConsumerViewRowToConsumerDto(viewRow, '2026-11-15')
    expect(dto.product_id).toBeNull()
    expect(dto.exact_identity_status).toBe('unresolved')
    expect(dto.capabilities.exact_product_comparison).toBe('blocked')
    expect(dto.image_url).toBeNull()
    expect(dto.thumbnail_url).toBeNull()
    expect(dto.reason_codes).toContain('COMPARISON_DISABLED_NO_VERIFIED_SKU')
  }, 30000)

  it('T2 & T6: Valid unsplit multi-flavor assortment publishes without invented child SKUs and preserves shared promo pricing', async () => {
    const offer = makeTestOffer({
      keySuffix: `t2_assort_${Date.now()}`,
      supermarketId: devSupermarketId,
      titleEn: 'Suntop Juice Assorted Flavors 18 x 125ml',
      titleAr: 'عصير سنتوب نكهات متنوعة 18 × 125 مل',
      brand: 'Suntop',
      promoPrice: 15.95,
      originalPrice: 22.0,
      sale_unit_type: 'carton',
      each_size_value: 125,
      each_size_unit: 'ml',
      inner_pack_count: 18,
      promotion_mechanic: 'buy_n_get_m',
      promoNotes: 'Buy 2 Cartons for 30 SAR • Member Price • Limit 2',
      customer_limit: 2,
      canonical: {
        assortment: { status: 'multiple_variants', composition_type: 'multiple_variants' },
        promotion: { mechanic: 'bundle_price', special_offer: 'Buy 2 Cartons' },
        eligibility: { loyalty: { requirement: 'required' } },
        price_terms: { source_reported_price_basis: 'per_package' }
      }
    })

    const manifest = makeBaseManifest('b_t2', [offer], {
      nonCatalogApprovals: {
        [offer.batchOfferKey]: {
          batchOfferKey: offer.batchOfferKey,
          decision: 'approved',
          category: 'unsplit_assortment',
          updatedAt: new Date().toISOString()
        }
      }
    })

    const res = await pubService.publishApprovedCatalogBatch({
      manifest,
      offers: [offer],
      context: 'DEVELOPMENT_TEST',
      pgClient: isolatedClient,
      allowIsolatedTestDb: true,
      enableImageUpload: false,
      operatorId: 'vitest_wp2_t2'
    })

    expect(res.success).toBe(true)
    expect(res.createdProductsCount).toBe(0) // Zero child SKUs created
    expect(res.publishedOffersCount).toBe(1)
    createdOfferIds.push(...res.publishedOfferIds)

    const viewRes = await isolatedClient.query(`SELECT * FROM public.v_consumer_offers WHERE id = $1`, [res.publishedOfferIds[0]])
    expect(viewRes.rows.length).toBe(1)
    const row = viewRes.rows[0]
    expect(row.product_id).toBeNull()
    expect(row.assortment_status).toBe('multiple_variants')
    expect(Number(row.offer_price)).toBeCloseTo(15.95, 2)
    expect(Number(row.source_reported_original_price)).toBeCloseTo(22.0, 2)
    expect(row.unit_price).toBeNull() // Did NOT invent per-SKU unit price from shared assortment
    expect(row.is_loyalty_required).toBe(true)
    expect(row.quantity_limit_value).toBe(2)
    expect(row.price_basis).toBe('per_package')
  }, 30000)

  it('T3: Missing manufacturer identity does not automatically block an otherwise valid grocery offer', () => {
    const offer = makeTestOffer({
      keySuffix: 't3_bakery',
      supermarketId: devSupermarketId,
      titleEn: 'In-House Fresh Croissant Tray 6 Pcs',
      titleAr: 'صينية كرواسون طازج من المخبز 6 حبات',
      brand: null,
      promoPrice: 12.5,
      originalPrice: 16.0,
      sale_unit_type: 'pack',
      each_size_value: null,
      each_size_unit: null,
      inner_pack_count: 6
    })

    const unapprovedAssessment = assessOfferPublicationOutcome({ offer })
    expect(unapprovedAssessment.isEligibleForNonCatalogPublication).toBe(true)
    expect(unapprovedAssessment.category).toBe('in_house_bakery')
    expect(unapprovedAssessment.quarantineReasons).toEqual([])
    expect(unapprovedAssessment.comparisonDisabled).toBe(true)

    const approvedAssessment = assessOfferPublicationOutcome({
      offer,
      approval: {
        batchOfferKey: offer.batchOfferKey,
        decision: 'approved',
        category: 'in_house_bakery',
        updatedAt: new Date().toISOString()
      }
    })
    expect(approvedAssessment.outcome).toBe('approved_non_catalog')
  })

  it('T4: Incorrect weight, invalid price, fragmented title, or EN/AR weight conflict triggers quarantine & excludes non-grocery default feed', async () => {
    const conflictWeightOffer = makeTestOffer({
      keySuffix: 't4_weight_conflict',
      supermarketId: devSupermarketId,
      titleEn: 'Fresh Feta Cheese 500g',
      titleAr: 'جبنة فيتا طازجة 250 جم',
      promoPrice: 9.95,
      originalPrice: 14.0
    })
    const wAssessment = assessOfferPublicationOutcome({ offer: conflictWeightOffer })
    expect(wAssessment.outcome).toBe('quarantined')
    expect(wAssessment.isSafeForNonCatalogPublication).toBe(false)
    expect(wAssessment.quarantineReasons).toContain('EN_AR_WEIGHT_VOLUME_CONFLICT')

    const badPriceOffer = makeTestOffer({
      keySuffix: 't4_price_bad',
      supermarketId: devSupermarketId,
      titleEn: 'Olive Oil 1L',
      titleAr: 'زيت زيتون 1 لتر',
      promoPrice: 25,
      originalPrice: 19
    })
    const pAssessment = assessOfferPublicationOutcome({ offer: badPriceOffer })
    expect(pAssessment.outcome).toBe('quarantined')
    expect(pAssessment.quarantineReasons).toContain('ORIGINAL_PRICE_LESS_THAN_OFFER_PRICE')

    const fragmentedOffer = makeTestOffer({
      keySuffix: 't4_fragment',
      supermarketId: devSupermarketId,
      titleEn: 'Selected Branches',
      titleAr: ''
    })
    const fAssessment = assessOfferPublicationOutcome({ offer: fragmentedOffer })
    expect(fAssessment.outcome).toBe('quarantined')
    expect(fAssessment.quarantineReasons).toContain('FRAGMENTED_OR_MISSING_TITLE')

    const nonGroceryOffer = makeTestOffer({
      keySuffix: 't4_tv',
      supermarketId: devSupermarketId,
      titleEn: 'Samsung 65 Inch 4K Smart QLED TV',
      titleAr: 'تلفزيون سامسونج سمارت 65 بوصة 4K',
      promoPrice: 2499,
      originalPrice: 3299,
      sale_unit_type: 'piece',
      each_size_value: null,
      each_size_unit: null
    })
    const ngAssessment = assessOfferPublicationOutcome({ offer: nonGroceryOffer })
    expect(ngAssessment.outcome).toBe('quarantined')
    expect(ngAssessment.isEligibleForNonCatalogPublication).toBe(false)
    expect(ngAssessment.quarantineReasons).toContain('NON_GROCERY_OUT_OF_DEFAULT_CONSUMER_SCOPE')
  })

  it('T5: Offer with missing critical dates fails publication preflight and blocks DB insertion', async () => {
    const missingDatesOffer = makeTestOffer({
      keySuffix: `t5_nodate_${Date.now()}`,
      supermarketId: devSupermarketId,
      offerStartDate: null,
      offerEndDate: null
    })

    const manifest = makeBaseManifest('b_t5', [missingDatesOffer], {
      nonCatalogApprovals: {
        [missingDatesOffer.batchOfferKey]: {
          batchOfferKey: missingDatesOffer.batchOfferKey,
          decision: 'approved',
          category: 'loose_produce',
          updatedAt: new Date().toISOString()
        }
      }
    })

    const preflight = await pubService.assessPublicationPreflight({
      manifest,
      offers: [missingDatesOffer],
      context: 'DEVELOPMENT_TEST',
      pgClient: isolatedClient,
      allowIsolatedTestDb: true
    })
    expect(preflight.ready).toBe(false)
    expect(preflight.blockingReasons.some((r) => r.includes('MISSING_CRITICAL_OFFER_DATES'))).toBe(true)

    const pubRes = await pubService.publishApprovedCatalogBatch({
      manifest,
      offers: [missingDatesOffer],
      context: 'DEVELOPMENT_TEST',
      pgClient: isolatedClient,
      allowIsolatedTestDb: true,
      enableImageUpload: false,
      operatorId: 'vitest_wp2_t5'
    })
    expect(pubRes.success).toBe(false)
    expect(pubRes.publishedOffersCount).toBe(0)
  })

  it('T8: Verified catalog offers retain their previous verified_linked behavior and enabled exact-SKU comparison', async () => {
    const uniqueName = `WP2 Test Verified Milk ${Date.now()}`
    const ins = await isolatedClient.query(
      `INSERT INTO public.products (name_en, name_ar, brand_name, each_size_value, each_size_unit, inner_pack_count, verification_status, is_active)
       VALUES ($1, 'حليب اختبار موثق', 'Almarai', 1, 'L', 1, 'verified', true)
       RETURNING id`,
      [uniqueName]
    )
    const prodId = String(ins.rows[0].id)
    createdProductIds.push(prodId)

    const offer = makeTestOffer({
      keySuffix: `t8_cat_${Date.now()}`,
      supermarketId: devSupermarketId,
      titleEn: uniqueName,
      titleAr: 'حليب اختبار موثق 1 لتر',
      brand: 'Almarai',
      promoPrice: 6.5,
      originalPrice: 8.0,
      sale_unit_type: 'piece',
      each_size_value: 1,
      each_size_unit: 'L',
      inner_pack_count: 1
    })

    const manifest = makeBaseManifest('b_t8', [offer], {
      proposals: {
        [offer.batchOfferKey]: makeProposal(offer, {
          decision: 'existing',
          matchedProductId: prodId,
          operatorDecision: 'approved'
        })
      }
    })

    const res = await pubService.publishApprovedCatalogBatch({
      manifest,
      offers: [offer],
      context: 'DEVELOPMENT_TEST',
      pgClient: isolatedClient,
      allowIsolatedTestDb: true,
      enableImageUpload: false,
      operatorId: 'vitest_wp2_t8'
    })
    expect(res.success).toBe(true)
    expect(res.publishedOffersCount).toBe(1)
    createdOfferIds.push(...res.publishedOfferIds)

    const viewRes = await isolatedClient.query(`SELECT * FROM public.v_consumer_offers WHERE id = $1`, [res.publishedOfferIds[0]])
    expect(String(viewRes.rows[0].product_id)).toBe(prodId)
    expect(viewRes.rows[0].exact_identity_status).toBe('verified_sku')
    expect(viewRes.rows[0].scoped_assessments.exact_product_comparison).toBe('supported')
  }, 30000)

  it('T9: Operator approval remains mandatory before publishing valid unresolved non-catalog offers', async () => {
    const orch = new CatalogMatchingOrchestrator(new VerifiedMatchCacheService(cacheDir, 'development'))

    const offer = makeTestOffer({
      keySuffix: `t9_need_approval_${Date.now()}`,
      supermarketId: devSupermarketId,
      titleEn: 'Fresh Lamb Chops Per Kg',
      titleAr: 'ريش غنم طازجة بالكيلو'
    })
    const batchId = `batch_t9_${Date.now()}`
    const initialManifest = makeBaseManifest(batchId, [offer])
    const batchRootDir = join(process.cwd(), 'Extracts', 'batches', batchId)
    ;(orch as any).saveManifestAtomic(initialManifest)

    try {
      // Attempt publish WITHOUT operator non-catalog approval -> skips offer
      const unapprovedPub = await pubService.publishApprovedCatalogBatch({
        manifest: initialManifest,
        offers: [offer],
        context: 'DEVELOPMENT_TEST',
        pgClient: isolatedClient,
        allowIsolatedTestDb: true,
        enableImageUpload: false,
        operatorId: 'vitest_wp2_t9'
      })
      expect(unapprovedPub.success).toBe(true)
      expect(unapprovedPub.publishedOffersCount).toBe(0)
      expect(unapprovedPub.publishedNonCatalogOffersCount).toBe(0)
      expect(unapprovedPub.skippedUnapprovedNonCatalogCount).toBe(1)

      // Operator clicks Approve Non-Catalog -> does not touch catalog proposal product link
      const updatedManifest = orch.applyOperatorDecision({
        batchId,
        batchOfferKey: offer.batchOfferKey,
        decision: 'approved',
        targetType: 'non_catalog',
        nonCatalogCategory: 'meat_seafood_by_weight',
        operatorNotes: 'Confirmed per-kg butchery price'
      })
      expect(updatedManifest.proposals[offer.batchOfferKey].matchedProductId).toBeNull()
      expect(updatedManifest.nonCatalogApprovals?.[offer.batchOfferKey]?.decision).toBe('approved')

      const approvedPub = await pubService.publishApprovedCatalogBatch({
        manifest: updatedManifest,
        offers: [offer],
        context: 'DEVELOPMENT_TEST',
        pgClient: isolatedClient,
        allowIsolatedTestDb: true,
        enableImageUpload: false,
        operatorId: 'vitest_wp2_t9'
      })
      expect(approvedPub.success).toBe(true)
      expect(approvedPub.publishedOffersCount).toBe(1)
      expect(approvedPub.publishedNonCatalogOffersCount).toBe(1)
      createdOfferIds.push(...approvedPub.publishedOfferIds)
    } finally {
      rmSync(batchRootDir, { recursive: true, force: true })
    }
  }, 30000)

  it('T10: Failed or uncertain Gemini requests cannot bypass WP3 INCOMPLETE_MATCHING_EXECUTION protections even with non-catalog approvals', async () => {
    const offer = makeTestOffer({
      keySuffix: `t10_wp3_block_${Date.now()}`,
      supermarketId: devSupermarketId
    })

    const manifest = makeBaseManifest('b_t10', [offer], {
      status: 'failed',
      nonCatalogApprovals: {
        [offer.batchOfferKey]: {
          batchOfferKey: offer.batchOfferKey,
          decision: 'approved',
          category: 'loose_produce',
          updatedAt: new Date().toISOString()
        }
      },
      requests: {
        req_01: {
          requestKey: 'req_01',
          batchId: 'b_t10',
          runId: 'run_b_t10',
          brandKey: 'almarai',
          brandName: 'Almarai',
          chunkIndex: 0,
          totalChunksInBrand: 1,
          chunkSize: 1,
          identityKeys: ['id_1'],
          sourceOfferKeys: [offer.batchOfferKey],
          sourceIds: [offer.sourceOfferId],
          requestConfig: {
            model: 'gemini-3.8-flash',
            thinkingLevel: 'MEDIUM',
            executionTier: 'flex',
            location: 'global',
            timeoutMs: 60000
          },
          attemptCount: 1,
          attempts: [],
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          error: null,
          usageMetadata: null,
          executionStatus: 'outcome_unknown',
          validated: false,
          estimatedCostUsd: 0.001,
          responseArtifactRef: null
        }
      }
    })

    const preflight = await pubService.assessPublicationPreflight({
      manifest,
      offers: [offer],
      context: 'DEVELOPMENT_TEST'
    })
    expect(preflight.ready).toBe(false)
    expect(preflight.blockingReasons.some((r) => r.includes('INCOMPLETE_MATCHING_EXECUTION'))).toBe(true)

    const res = await pubService.publishApprovedCatalogBatch({
      manifest,
      offers: [offer],
      context: 'DEVELOPMENT_TEST',
      operatorId: 'vitest_wp2_t10'
    })
    expect(res.success).toBe(false)
    expect(res.publishedOffersCount).toBe(0)
  })

  it('T11: Private crop URLs and internal paths never appear in any consumer-facing projection or DTO', () => {
    const leakyUrls = [
      'https://proj.supabase.co/storage/v1/object/public/offer-images/batch1/offer_card_crop.webp',
      'https://proj.supabase.co/storage/v1/object/sign/offer-images/p1/product_thumb_crop.webp?token=secret123',
      'F:\\Work\\AI Projects\\wifran-offers-extractor\\Extracts\\p1\\offer_card_crop.webp',
      '/crops/thumb.jpg',
      'file:///C:/temp/item_crop.png'
    ]
    for (const url of leakyUrls) {
      expect(sanitizePublicConsumerImageUrl(url)).toBeNull()
    }
    expect(
      sanitizePublicConsumerImageUrl(
        'https://proj.supabase.co/storage/v1/object/public/offer-display-images/produce/tomatoes.webp',
      ),
    ).toBeNull()
    expect(
      sanitizePublicConsumerImageUrl(
        'https://evil-external.supabase.co/storage/v1/object/public/product-images/fake.webp',
      ),
    ).toBeNull()
    expect(
      sanitizePublicConsumerImageUrl(
        'https://gykrbpykjhpyrdrinkuk.supabase.co/storage/v1/object/public/offer-display-images/produce/tomatoes.webp',
      ),
    ).toContain('offer-display-images')

    // Projection sanitization
    const projection = toConsumerOfferProjection(
      {
        canonical_version: '2.0',
        product: { title_ar: 'طماطم', title_en: 'Tomatoes', normalized_title_ar: 'طماطم', normalized_title_en: 'tomatoes', category_hint: null },
        brand: { name: null, normalized_brand: null, confidence: 'low' },
        prices: { offer_price: 5, original_price: 7, discount_percent: 28, currency: 'SAR', price_basis: 'per_kg' },
        quantity: { sale_unit_type: 'kg', inner_pack_count: 1, each_size_value: 1, each_size_unit: 'kg', total_content_value: 1, total_content_unit: 'kg' },
        promotion: { special_offer: null, mechanic: 'price_cut', free_units_text: null, bundle_quantity: null },
        image: {
          image_url: leakyUrls[0],
          thumbnail_url: leakyUrls[1],
          local_crop_path: 'C:\\Work\\offer_card_crop.webp'
        },
        source: { leaflet_id: 'l1', supermarket_id: 's1', supermarket_name: 'S', source_page_number: 1, source_item_number: '1', location_scope: 'national' },
        quality: { status: 'extracted', confidence: 'high', warnings: [], blocking_errors: [] },
        raw: {}
      } as any,
      'l1:p001:i001:s01'
    )
    expect(projection.image_url).toBeNull()
    expect(projection.thumbnail_url).toBeNull()

    // Offer sync mapper sanitization
    const synced = mapPreparedPayloadToOffersInsert({
      preparedPayload: {
        supermarket_id: devSupermarketId,
        title_en: 'Tomatoes',
        offer_price: 5,
        offer_end_date: '2026-11-20',
        scoped_assessments: { exact_product_comparison: 'supported' }
      },
      imageUrl: leakyUrls[0],
      storageBucket: 'offer-images',
      storagePath: 'batch1/offer_card_crop.webp',
      thumbnailUrl: leakyUrls[1],
      thumbnailStoragePath: 'batch1/product_thumb_crop.webp',
      sourceId: null
    })
    expect(synced.payload?.image_url).toBeNull()
    expect(synced.payload?.thumbnail_url).toBeNull()
    expect(synced.payload?.scoped_assessments?.exact_product_comparison).toBe('blocked')
  })

  it('T12: Location scope (city/national) and retailer/leaflet provenance survive publication and v_consumer_offers intact', async () => {
    if (!devCityId) return // Safe skip only if dev DB cities empty (verified populated in schema check)
    const offer = makeTestOffer({
      keySuffix: `t12_city_${Date.now()}`,
      supermarketId: devSupermarketId,
      locationScope: 'city',
      cityId: devCityId,
      regionId: null,
      leafletId: 'leaflet_wp2_city',
      sourcePage: 4,
      sourceOfferId: '019'
    })

    const manifest = makeBaseManifest('b_t12', [offer], {
      nonCatalogApprovals: {
        [offer.batchOfferKey]: {
          batchOfferKey: offer.batchOfferKey,
          decision: 'approved',
          category: 'loose_produce',
          updatedAt: new Date().toISOString()
        }
      }
    })

    const res = await pubService.publishApprovedCatalogBatch({
      manifest,
      offers: [offer],
      context: 'DEVELOPMENT_TEST',
      pgClient: isolatedClient,
      allowIsolatedTestDb: true,
      enableImageUpload: false,
      operatorId: 'vitest_wp2_t12'
    })
    expect(res.success).toBe(true)
    createdOfferIds.push(...res.publishedOfferIds)

    const viewRes = await isolatedClient.query(`SELECT * FROM public.v_consumer_offers WHERE id = $1`, [res.publishedOfferIds[0]])
    const row = viewRes.rows[0]
    expect(row.supermarket_id).toBe(devSupermarketId)
    expect(row.location_scope).toBe('city')
    expect(row.city_id).toBe(devCityId)
    expect(row.city_name_en).toBeTruthy()
    expect(row.supermarket_name_en).toBeTruthy()
    expect(row.source_offer_id).toBe('leaflet_wp2_city:p004:i019:s01')
  }, 30000)

  it('T14 & T15: Repeated publication is idempotent and future catalog linking upgrades product_id=null in-place without duplicating offers', async () => {
    const suffix = `t14_15_${Date.now()}`
    const offer = makeTestOffer({
      keySuffix: suffix,
      supermarketId: devSupermarketId,
      leafletId: 'leaflet_wp2_idemp',
      sourcePage: 2,
      sourceOfferId: `item_${suffix}`,
      titleEn: 'Nadec Fresh Juice 1L',
      titleAr: 'عصير نادك طازج 1 لتر',
      brand: 'Nadec',
      promoPrice: 8.5,
      originalPrice: 11.0,
      sale_unit_type: 'piece',
      each_size_value: 1,
      each_size_unit: 'L',
      inner_pack_count: 1
    })

    const expectedSourceOfferId = computeStableSourceOfferId(offer)
    const manifestNonCatalog = makeBaseManifest('b_t14_15', [offer], {
      nonCatalogApprovals: {
        [offer.batchOfferKey]: {
          batchOfferKey: offer.batchOfferKey,
          decision: 'approved',
          category: 'valid_grocery_unresolved_sku',
          updatedAt: new Date().toISOString()
        }
      }
    })

    // First non-catalog publish
    const pub1 = await pubService.publishApprovedCatalogBatch({
      manifest: manifestNonCatalog,
      offers: [offer],
      context: 'DEVELOPMENT_TEST',
      pgClient: isolatedClient,
      allowIsolatedTestDb: true,
      enableImageUpload: false,
      operatorId: 'vitest_wp2_t14'
    })
    expect(pub1.success).toBe(true)
    expect(pub1.publishedOfferIds.length).toBe(1)
    createdOfferIds.push(...pub1.publishedOfferIds)
    const offerId = pub1.publishedOfferIds[0]

    // Second retry publish (same idempotency key) -> idempotent replay returning original offerId, zero duplicates
    const pub2 = await pubService.publishApprovedCatalogBatch({
      manifest: manifestNonCatalog,
      offers: [offer],
      context: 'DEVELOPMENT_TEST',
      pgClient: isolatedClient,
      allowIsolatedTestDb: true,
      enableImageUpload: false,
      operatorId: 'vitest_wp2_t14'
    })
    expect(pub2.success).toBe(true)
    expect(pub2.idempotentReplay).toBe(true)
    expect(pub2.publishedOfferIds).toEqual([offerId])

    // Fresh idempotency key with identical unchanged offer -> no-op with zero DB writes & zero duplicate rows
    const pub2Noop = await pubService.publishApprovedCatalogBatch({
      manifest: manifestNonCatalog,
      offers: [offer],
      context: 'DEVELOPMENT_TEST',
      pgClient: isolatedClient,
      allowIsolatedTestDb: true,
      enableImageUpload: false,
      idempotencyKey: `wp2_t14_noop_${suffix}`,
      operatorId: 'vitest_wp2_t14'
    })
    expect(pub2Noop.success).toBe(true)
    expect(pub2Noop.noop).toBe(true)
    expect(pub2Noop.unchangedNoopCount).toBe(1)
    expect(pub2Noop.publishedOfferIds).toEqual([])

    // Insert verified catalog product and re-publish linked -> upgrades existing offer row in-place!
    const countBefore = await isolatedClient.query(`SELECT count(*) FROM public.offers WHERE source_offer_id = $1`, [expectedSourceOfferId])
    expect(Number(countBefore.rows[0].count)).toBe(1)

    const prodRes = await isolatedClient.query(
      `INSERT INTO public.products (name_en, name_ar, brand_name, each_size_value, each_size_unit, inner_pack_count, verification_status, is_active)
       VALUES ($1, 'عصير نادك طازج 1 لتر', 'Nadec', 1, 'L', 1, 'verified', true)
       RETURNING id`,
      [`WP2 Test Upgrade Juice ${suffix}`]
    )
    const permProdId = String(prodRes.rows[0].id)
    createdProductIds.push(permProdId)

    const manifestUpgraded = makeBaseManifest('b_t14_15_up', [offer], {
      proposals: {
        [offer.batchOfferKey]: makeProposal(offer, {
          decision: 'existing',
          matchedProductId: permProdId,
          operatorDecision: 'approved'
        })
      }
    })

    const pub3 = await pubService.publishApprovedCatalogBatch({
      manifest: manifestUpgraded,
      offers: [offer],
      context: 'DEVELOPMENT_TEST',
      pgClient: isolatedClient,
      allowIsolatedTestDb: true,
      enableImageUpload: false,
      operatorId: 'vitest_wp2_t15'
    })
    expect(pub3.success).toBe(true)
    expect(pub3.publishedOfferIds).toEqual([offerId])
    expect(pub3.upgradedFromNonCatalogCount).toBe(1)

    const afterRes = await isolatedClient.query(`SELECT id, product_id, catalog_match_status, exact_identity_status FROM public.offers WHERE source_offer_id = $1`, [expectedSourceOfferId])
    expect(afterRes.rows.length).toBe(1)
    expect(String(afterRes.rows[0].id)).toBe(offerId)
    expect(String(afterRes.rows[0].product_id)).toBe(permProdId)
    expect(afterRes.rows[0].catalog_match_status).toBe('verified_linked')
    expect(afterRes.rows[0].exact_identity_status).toBe('verified_sku')

    // Safety invariant §8: re-running non-catalog pass NEVER overwrites an already verified_linked offer!
    const pub4 = await pubService.publishApprovedCatalogBatch({
      manifest: manifestNonCatalog,
      offers: [offer],
      context: 'DEVELOPMENT_TEST',
      pgClient: isolatedClient,
      allowIsolatedTestDb: true,
      enableImageUpload: false,
      operatorId: 'vitest_wp2_t15_guard'
    })
    expect(pub4.success).toBe(true)
    const guardRes = await isolatedClient.query(`SELECT product_id, catalog_match_status FROM public.offers WHERE id = $1`, [offerId])
    expect(String(guardRes.rows[0].product_id)).toBe(permProdId)
    expect(guardRes.rows[0].catalog_match_status).toBe('verified_linked')
  }, 30000)

  it('T16: Legacy othaim-week24_002_004 size_unit=L unit=PCS maps cleanly without unsafe 4x1L inference', () => {
    const rawJsonPath = join(process.cwd(), 'Extracts', 'Othaim_week24', 'json', 'page-002', 'othaim-week24_002_004.json')
    const raw = JSON.parse(readFileSync(rawJsonPath, 'utf8'))
    const extracted = extractLegacyQuantityAndSize(raw)
    expect(extracted.each_size_value).toBe(1)
    expect(extracted.each_size_unit).toBe('l')
    expect(extracted.sale_unit_raw).toBe('PCS')
    expect(extracted.pack_quantity).toBe(4)

    const canonical = normalizeToCanonicalOffer({
      rawOcrJson: raw,
      source: {
        leafletId: 'Othaim_week24',
        sourcePageNumber: 2,
        sourceItemNumber: '004'
      }
    })
    expect(canonical.content.each_size_value).toBe(1)
    expect(canonical.content.each_size_unit).toBe('l')
    expect(canonical.content.pack_quantity).toBe(4)
    expect(canonical.raw.raw_attributes?.sale_unit).toBe('PCS')
    expect(canonical.raw.raw_attributes?.variant).toBe('Original Taste')
  })
})
