/**
 * WIFRAN-EXTRACTOR-IDENTITY-005C-R1: WP2 Acceptance Corrections Regression Suite
 *
 * Verifies all R1 remediation items:
 * 1. Consumer Category Classification (Perinna bed sheet textile exclusion, consumables preserved, Galaxy chocolate vs TV, conflicting/missing evidence)
 * 2. Equivalent-Level Weight & Manufacturer-Pack Comparison (1000g vs 10x1000g carton-supported vs unsupported noori_p001_003, Alwafa_Test_p001_004 ml vs Ltr error)
 * 3. Provisional source evidence check for othaim-week24_006_004 (source PDF chunk exists; raw AED/missing-date OCR stays quarantined)
 * 4. Real BatchOrchestrationService metadata propagation & fail-closed behavior without fabricating dates
 * 5. Positive public image allowlist & multi-pass URL-decoding / nested contract_v2 asset scrubbing
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import {
  assessOfferQuantitySemanticsConflict,
  assessOfferPublicationOutcome,
  hasEnArWeightVolumeConflict,
  sanitizeConsumerContractV2Assets,
  sanitizePublicConsumerImageUrl
} from '../../../shared/utils/nonCatalogPublicationPolicy'
import { detectItemDomainFromTitle } from '../../../shared/utils/priceAndUnitNormalizer'
import { mapSqlConsumerViewRowToConsumerDto, toConsumerOfferProjection } from '../../../shared/utils/extractorContractV2Adapter'
import { mapPreparedPayloadToOffersInsert } from '../../../shared/utils/offerSyncMapper'
import { normalizeToCanonicalOffer } from '../../../shared/utils/canonicalOfferNormalizer'
import { BatchOrchestrationService } from '../batchOrchestrationService'
import { LeafletMetadataService } from '../../metadata/leafletMetadataService'
import { LeafletMetadataCacheService } from '../../metadata/leafletMetadataCacheService'
import { UnifiedBatchOffer } from '../../../shared/types/batchExtraction'
import type { BatchManifest } from '../../../shared/types/batchExtraction'

function makeOffer(overrides: Partial<UnifiedBatchOffer> & { batchOfferKey?: string; currency?: string | null }): UnifiedBatchOffer {
  const offer: any = {
    batchOfferKey: overrides.batchOfferKey || 'r1_test::offer_1',
    batchId: 'r1_test_batch',
    leafletId: overrides.leafletId || 'leaflet_r1',
    sourceFileName: 'r1.pdf',
    sourcePdfPath: '',
    sourcePage: 1,
    sourceOfferId: overrides.sourceOfferId || '001',
    supermarketId: overrides.supermarketId !== undefined ? overrides.supermarketId : 'c2cc16c2-0001-4444-b000-c00000000001',
    supermarketName: overrides.supermarketName || 'Al Othaim',
    locationScope: overrides.locationScope !== undefined ? overrides.locationScope : 'national',
    locationLabel: overrides.locationLabel ?? 'KSA',
    cityId: overrides.cityId ?? null,
    regionId: overrides.regionId ?? null,
    offerStartDate: overrides.offerStartDate !== undefined ? overrides.offerStartDate : '2026-11-10',
    offerEndDate: overrides.offerEndDate !== undefined ? overrides.offerEndDate : '2026-11-20',
    titleAr: overrides.titleAr ?? 'منتج',
    titleEn: overrides.titleEn ?? 'Product',
    brand: overrides.brand ?? null,
    brandAr: overrides.brandAr ?? null,
    brandEn: overrides.brandEn ?? null,
    promoPrice: overrides.promoPrice !== undefined ? overrides.promoPrice : 10,
    originalPrice: overrides.originalPrice !== undefined ? overrides.originalPrice : 15,
    discountPercent: null,
    currency: overrides.currency ?? null,
    promoNotes: overrides.promoNotes ?? null,
    promotion_mechanic: overrides.promotion_mechanic,
    sizeOrWeight: overrides.sizeOrWeight ?? '500g',
    each_size_value: overrides.each_size_value !== undefined ? overrides.each_size_value : 500,
    each_size_unit: overrides.each_size_unit !== undefined ? overrides.each_size_unit : 'g',
    inner_pack_count: overrides.inner_pack_count !== undefined ? overrides.inner_pack_count : 1,
    sale_unit_type: overrides.sale_unit_type ?? 'each',
    total_content_value: overrides.total_content_value ?? 500,
    total_content_unit: overrides.total_content_unit ?? 'g',
    free_units_text: null,
    customer_limit: null,
    productThumbCropPath: null,
    offerCardCropPath: null,
    status: 'extracted',
    confidence: 'high',
    warnings: [],
    blockingErrors: [],
    canonical: overrides.canonical
  }
  return offer as UnifiedBatchOffer
}

describe('WIFRAN-EXTRACTOR-IDENTITY-005C-R1: WP2 Acceptance Corrections', () => {
  let tempRoot: string

  beforeAll(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'wifran-005c-r1-'))
  })

  afterAll(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  describe('§1 Consumer Category Classification Safety', () => {
    it('Excludes Alwafa_Test_p003_014 (Perinna Bed Sheet 225X250Cm) even when item_domain="household"', () => {
      const canonicalPath = join(process.cwd(), 'Extracts/Alwafa_Test/json/page-003-014.canonical.json')
      const canonical = JSON.parse(readFileSync(canonicalPath, 'utf8'))

      expect(
        detectItemDomainFromTitle(
          canonical.product.title_en,
          canonical.product.title_ar,
          canonical.product.item_domain,
          {
            commodityTag: canonical.product.commodity_tag,
            categoryHint: canonical.product.category_hint
          }
        )
      ).toBe('other_non_grocery')

      // Even without structured tags, "Bed Sheet" / "شرشف سرير" must not default to household consumable/grocery
      expect(
        detectItemDomainFromTitle(canonical.product.title_en, canonical.product.title_ar, 'household')
      ).toBe('other_non_grocery')

      const assessment = assessOfferPublicationOutcome({
        offer: makeOffer({
          batchOfferKey: 'Alwafa_Test_p003_014',
          titleEn: canonical.product.title_en,
          titleAr: canonical.product.title_ar,
          each_size_value: 1,
          each_size_unit: 'piece',
          sale_unit_type: 'piece',
          promoPrice: 25,
          originalPrice: 49,
          canonical
        })
      })

      expect(assessment.itemDomain).toBe('other_non_grocery')
      expect(assessment.isEligibleForNonCatalogPublication).toBe(false)
      expect(assessment.outcome).toBe('quarantined')
      expect(assessment.quarantineReasons).toContain('NON_GROCERY_OUT_OF_DEFAULT_CONSUMER_SCOPE')
    })

    it('Preserves household consumables (tissues, detergent), personal care, produce, bakery, and Galaxy chocolate', () => {
      const consumableSamples = [
        {
          key: 'tissues',
          titleEn: 'Fine Facial Tissues 10 x 150 Sheets',
          titleAr: 'فاين مناديل وجه ١٠ × ١٥٠ منديل',
          domain: 'household',
          expectedDomain: 'household'
        },
        {
          key: 'detergent',
          titleEn: 'Tide Automatic Laundry Detergent 2.5kg',
          titleAr: 'تايد مسحوق غسيل أوتوماتيك ٢.٥ كجم',
          domain: 'household',
          expectedDomain: 'household'
        },
        {
          key: 'produce',
          titleEn: 'Fresh Red Tomatoes Per Kg',
          titleAr: 'طماطم حمراء طازجة بالكيلو',
          domain: 'grocery',
          expectedDomain: 'grocery'
        },
        {
          key: 'bakery',
          titleEn: 'In-House Fresh Butter Croissant 4 Pcs',
          titleAr: 'مخبز كرواسون زبدة طازج ٤ حبات',
          domain: 'grocery',
          expectedDomain: 'grocery'
        },
        {
          key: 'galaxy_choc',
          titleEn: 'Galaxy Best Of Our Mnis 710g',
          titleAr: 'جالكسي بيست أوف أور ميني ٧١٠ جرام',
          domain: 'grocery',
          expectedDomain: 'grocery'
        }
      ]

      for (const s of consumableSamples) {
        const res = assessOfferPublicationOutcome({
          offer: makeOffer({
            batchOfferKey: s.key,
            titleEn: s.titleEn,
            titleAr: s.titleAr,
            canonical: { product: { item_domain: s.domain } } as any
          })
        })
        expect(res.itemDomain).toBe(s.expectedDomain)
        expect(res.isEligibleForNonCatalogPublication).toBe(true)
        expect(res.quarantineReasons).toEqual([])
      }
    })

    it('Excludes TVs and electronics from default consumer scope', () => {
      const tvAssessment = assessOfferPublicationOutcome({
        offer: makeOffer({
          batchOfferKey: 'tv_test',
          titleEn: 'Samsung QLED 4K Smart TV 55 Inch',
          titleAr: 'تلفزيون سامسونج كيو لد ذكي ٥٥ بوصة',
          each_size_value: null,
          each_size_unit: null
        })
      })
      expect(tvAssessment.itemDomain).toBe('electronics')
      expect(tvAssessment.isEligibleForNonCatalogPublication).toBe(false)
      expect(tvAssessment.quarantineReasons).toContain('NON_GROCERY_OUT_OF_DEFAULT_CONSUMER_SCOPE')
    })

    it('Quarantines contradictory and missing-evidence category cases conservatively', () => {
      const conflicting = assessOfferPublicationOutcome({
        offer: makeOffer({
          batchOfferKey: 'conflict_cat',
          titleEn: 'Almarai Fresh Milk 1L',
          titleAr: 'حليب المراعي طازج ١ لتر',
          canonical: {
            product: {
              commodity_tag: 'non_grocery_item',
              category_hint: 'non-grocery',
              item_domain: 'grocery'
            }
          } as any
        })
      })
      expect(conflicting.isEligibleForNonCatalogPublication).toBe(false)
      expect(conflicting.quarantineReasons).toContain('CONFLICTING_CATEGORY_EVIDENCE')

      const missing = assessOfferPublicationOutcome({
        offer: makeOffer({
          batchOfferKey: 'missing_cat',
          titleEn: 'Alpha Model Z-400 Pro Item',
          titleAr: 'ألفا موديل زد ٤٠٠',
          canonical: { product: {} } as any
        })
      })
      expect(missing.isEligibleForNonCatalogPublication).toBe(false)
      expect(missing.quarantineReasons).toContain('MISSING_OR_UNVERIFIED_CATEGORY_EVIDENCE')
    })
  })

  describe('§2 Equivalent-Level Weight & Manufacturer-Pack Conflict Assessment', () => {
    it('Allows valid individual-size vs 10-unit carton specs (1000g vs 10x1000g) when carton evidence is present', () => {
      const conflict = assessOfferQuantitySemanticsConflict({
        titleEn: 'Fakieh Frozen Chicken 1000g',
        titleAr: 'دجاج فقيه مجمد 10 × 1000 جرام',
        inner_pack_count: 10,
        each_size_value: 1000,
        each_size_unit: 'gram',
        total_content_value: 10000,
        total_content_unit: 'gram'
      })
      expect(conflict.hasConflict).toBe(false)
      expect(conflict.conflictKind).toBe('none')

      const cartonOutcome = assessOfferPublicationOutcome({
        offer: makeOffer({
          batchOfferKey: 'carton_supported',
          titleEn: 'Fakieh Frozen Chicken 1000g',
          titleAr: 'دجاج فقيه مجمد 10 × 1000 جرام',
          promoPrice: 141,
          originalPrice: 202,
          inner_pack_count: 10,
          each_size_value: 1000,
          each_size_unit: 'g',
          total_content_value: 10000,
          total_content_unit: 'g'
        })
      })
      expect(cartonOutcome.isEligibleForNonCatalogPublication).toBe(true)
      expect(cartonOutcome.quarantineReasons).toEqual([])
    })

    it('Quarantines noori_p001_003 (1000g per-bird price 15.50 vs AR caption 10x1000g without carton evidence) as EN_AR_PACK_COUNT_CONFLICT', () => {
      const nooriPath = join(process.cwd(), 'Extracts/noori-supermarket-229798534-jeddah/json/page-001-003.canonical.json')
      const nooriJson = JSON.parse(readFileSync(nooriPath, 'utf8'))

      const assessment = assessOfferPublicationOutcome({
        offer: makeOffer({
          batchOfferKey: 'noori-supermarket-229798534-jeddah_p001_003',
          titleEn: nooriJson.product.title_en,
          titleAr: nooriJson.product.title_ar,
          promoPrice: nooriJson.prices.offer_price,
          originalPrice: null,
          each_size_value: nooriJson.content.each_size_value,
          each_size_unit: nooriJson.content.each_size_unit,
          inner_pack_count: nooriJson.content.pack_quantity,
          total_content_value: nooriJson.content.total_content_value,
          total_content_unit: nooriJson.content.total_content_unit,
          canonical: nooriJson
        })
      })

      expect(assessment.isEligibleForNonCatalogPublication).toBe(false)
      expect(assessment.quarantineReasons).toContain('EN_AR_PACK_COUNT_CONFLICT')
      expect(assessment.quarantineReasons).not.toContain('EN_AR_WEIGHT_VOLUME_CONFLICT')
    })

    it('Quarantines Alwafa_Test_p001_004 genuine unit error (6x1.5Ltr vs ٦ × ١.٥ مل) without rewriting ml to L', () => {
      const alwafaWaterPath = join(process.cwd(), 'Extracts/Alwafa_Test/json/page-001-004.canonical.json')
      const waterJson = JSON.parse(readFileSync(alwafaWaterPath, 'utf8'))

      const conflict = assessOfferQuantitySemanticsConflict({
        titleEn: waterJson.product.title_en,
        titleAr: waterJson.product.title_ar,
        inner_pack_count: waterJson.content.pack_quantity,
        each_size_value: waterJson.content.each_size_value,
        each_size_unit: waterJson.content.each_size_unit,
        total_content_value: waterJson.content.total_content_value,
        total_content_unit: waterJson.content.total_content_unit
      })
      expect(conflict.hasConflict).toBe(true)
      expect(conflict.conflictKind).toBe('unit_or_measure_conflict')

      const assessment = assessOfferPublicationOutcome({
        offer: makeOffer({
          batchOfferKey: 'Alwafa_Test_p001_004',
          titleEn: waterJson.product.title_en,
          titleAr: waterJson.product.title_ar,
          promoPrice: waterJson.prices.offer_price,
          originalPrice: waterJson.prices.original_price,
          each_size_value: waterJson.content.each_size_value,
          each_size_unit: waterJson.content.each_size_unit,
          inner_pack_count: waterJson.content.pack_quantity,
          total_content_value: waterJson.content.total_content_value,
          total_content_unit: waterJson.content.total_content_unit,
          canonical: waterJson
        })
      })

      expect(assessment.isEligibleForNonCatalogPublication).toBe(false)
      expect(assessment.quarantineReasons).toContain('EN_AR_WEIGHT_VOLUME_CONFLICT')
    })

    it('Handles single units, sealed multipacks, retailer multi-buy, and per-kg commodities accurately', () => {
      expect(hasEnArWeightVolumeConflict('Almarai Fresh Milk 1L', 'حليب المراعي ١ لتر')).toBe(false)
      expect(hasEnArWeightVolumeConflict('Nescafe 30 x 11.7g', 'نسكافيه ٣٠ × ١١.٧ جم')).toBe(false)
      expect(hasEnArWeightVolumeConflict('Sunwhite Rice 2 x 5kg', 'أرز صن وايت ١٠ كجم')).toBe(false)

      const multibuy = assessOfferPublicationOutcome({
        offer: makeOffer({
          batchOfferKey: 'multibuy_test',
          titleEn: 'Saudia Milk 500g Buy 3 For 15 SAR',
          titleAr: 'حليب السعودية ٥٠٠ جم اشتري ٣ بـ ١٥ ريال',
          promoPrice: 15,
          originalPrice: 24,
          promotion_mechanic: 'multi_buy',
          promo_condition_quantity: 3,
          each_size_value: 500,
          each_size_unit: 'g',
          inner_pack_count: 1
        })
      })
      expect(multibuy.isEligibleForNonCatalogPublication).toBe(true)

      const perKg = assessOfferPublicationOutcome({
        offer: makeOffer({
          batchOfferKey: 'per_kg_test',
          titleEn: 'Fresh Banana Per Kg',
          titleAr: 'موز طازج بالكيلو',
          sale_unit_type: 'kg',
          each_size_value: 1,
          each_size_unit: 'kg',
          inner_pack_count: null,
          promoPrice: 5.5,
          originalPrice: 7.95
        })
      })
      expect(perKg.isEligibleForNonCatalogPublication).toBe(true)
      expect(perKg.category).toBe('loose_produce')
    })
  })

  describe('§3 Provisional Item othaim-week24_006_004 Evidence Check', () => {
    it('Confirms source page PDF chunk exists locally while legacy AED/missing-metadata record stays quarantined', () => {
      const chunkPdfPath = join(process.cwd(), 'Extracts/Othaim_week24/chunks/chunk-006-pages-006-006.pdf')
      const rawJsonPath = join(process.cwd(), 'Extracts/Othaim_week24/json/page-006/othaim-week24_006_004.json')
      expect(existsSync(chunkPdfPath)).toBe(true)
      expect(existsSync(rawJsonPath)).toBe(true)

      const raw = JSON.parse(readFileSync(rawJsonPath, 'utf8'))
      const canonical = normalizeToCanonicalOffer({
        rawOcrJson: raw,
        source: {
          leafletId: 'Othaim_week24',
          sourcePageNumber: 6,
          sourceItemNumber: '004'
        }
      })

      const assessment = assessOfferPublicationOutcome({
        offer: makeOffer({
          batchOfferKey: 'othaim-week24_006_004',
          supermarketId: null,
          locationScope: null,
          offerStartDate: null,
          offerEndDate: null,
          titleEn: canonical.product.title_en,
          titleAr: canonical.product.title_ar,
          promoPrice: canonical.prices.offer_price,
          currency: raw.currency,
          each_size_value: canonical.content.each_size_value,
          each_size_unit: canonical.content.each_size_unit,
          inner_pack_count: canonical.content.pack_quantity,
          canonical
        } as any)
      })

      expect(assessment.isEligibleForNonCatalogPublication).toBe(false)
      expect(assessment.quarantineReasons).not.toContain('UNSUPPORTED_OR_UNVERIFIED_CURRENCY')
      expect(assessment.quarantineReasons).toContain('MISSING_CRITICAL_OFFER_DATES')
    })
  })

  describe('§4 Real BatchOrchestrationService Metadata Propagation & Fail-Closed Validation', () => {
    it('Propagates confirmed retailer, dates, and city scope into UnifiedBatchOffer[] and blocks missing/invalid metadata without now()', async () => {
      const wsDir = join(tempRoot, 'alwafa_ws_test')
      const jsonDir = join(wsDir, 'json')
      const metaDir = join(wsDir, 'metadata')
      mkdirSync(jsonDir, { recursive: true })
      mkdirSync(metaDir, { recursive: true })

      const sampleCanonical = JSON.parse(
        readFileSync(join(process.cwd(), 'Extracts/Alwafa_Test/json/page-001-004.canonical.json'), 'utf8')
      )
      // Remove trusted_context to prove confirmed_metadata.json propagates authoritative metadata
      delete sampleCanonical.trusted_context
      writeFileSync(join(jsonDir, 'page-001-004.canonical.json'), JSON.stringify(sampleCanonical, null, 2))

      writeFileSync(
        join(metaDir, 'confirmed_metadata.json'),
        JSON.stringify({
          operatorConfirmed: true,
          record: {
            operatorConfirmed: true,
            locationScope: 'city',
            cityId: 'a6f7b140-0002-4444-a000-000000000002',
            regionId: 'b144b6c8-2222-4444-b000-000000000002',
            locationSlug: 'jeddah',
            retailer: {
              resolvedRetailerId: 'c2cc16c2-0008-4444-b000-c00000000008',
              resolvedNameEn: 'Alwafa'
            },
            validity: {
              startDate: '2026-10-14',
              endDate: '2026-10-20'
            }
          }
        })
      )

      const batchesBaseDir = join(tempRoot, 'batches')
      const orch = new BatchOrchestrationService(batchesBaseDir)
      const manifest: BatchManifest = {
        schemaVersion: '1.0',
        batchId: 'batch_r1_meta',
        createdAt: '2026-11-13T00:00:00Z',
        updatedAt: '2026-11-13T00:00:00Z',
        status: 'completed',
        workspaceDir: join(batchesBaseDir, 'batch_r1_meta'),
        executionMode: 'flex',
        model: 'gemini-3.8-flash',
        totals: {
          totalPdfs: 1,
          completedPdfs: 1,
          failedPdfs: 0,
          cancelledPdfs: 0,
          totalPages: 1,
          pagesProcessed: 1,
          totalOffers: 1,
          totalCostUsd: 0
        },
        leaflets: [
          {
            leafletId: 'leaflet-001',
            fileName: 'Alwafa.pdf',
            filePath: '',
            fileSizeBytes: 100,
            fileFingerprint: 'fp_r1',
            pageCount: 1,
            pagesProcessed: 1,
            offersCount: 1,
            estimatedCostUsd: 0,
            status: 'completed',
            workspacePath: wsDir,
            provenance: 'cache',
            metadata: {} // Intentionally empty on manifest leaflet to verify confirmed_metadata propagation
          }
        ]
      }
      await orch.saveBatchManifestAtomic(manifest)

      const unified = await orch.getUnifiedBatchOffers('batch_r1_meta')
      expect(unified.length).toBe(1)
      expect(unified[0].supermarketId).toBe('c2cc16c2-0008-4444-b000-c00000000008')
      expect(unified[0].locationScope).toBe('city')
      expect(unified[0].cityId).toBe('a6f7b140-0002-4444-a000-000000000002')
      expect(unified[0].regionId).toBe('b144b6c8-2222-4444-b000-000000000002')
      expect(unified[0].offerStartDate).toBe('2026-10-14')
      expect(unified[0].offerEndDate).toBe('2026-10-20')

      // Missing / invalid calendar date & missing locationScope MUST block without synthesizing from now()
      const missingMetaAssessment = assessOfferPublicationOutcome({
        offer: makeOffer({
          batchOfferKey: 'missing_dates',
          offerStartDate: '2026-02-30',
          offerEndDate: null,
          locationScope: null
        })
      })
      expect(missingMetaAssessment.isEligibleForNonCatalogPublication).toBe(false)
      expect(missingMetaAssessment.quarantineReasons).toContain('MISSING_CRITICAL_OFFER_DATES')
      expect(missingMetaAssessment.quarantineReasons).toContain('INVALID_LOCATION_SCOPE')

      const metaCache = new LeafletMetadataCacheService(join(tempRoot, 'meta_cache'))
      const metaSvc = new LeafletMetadataService(metaCache)
      const unconfirmedReadiness = metaSvc.validatePublishReadiness({
        leafletFingerprint: 'a'.repeat(64)
      })
      expect(unconfirmedReadiness.ok).toBe(false)
      expect(unconfirmedReadiness.error).toContain('PUBLISH_BLOCKED')
    })
  })

  describe('§5 Positive Public Image Allowlist & Nested Scrubbing', () => {
    it('Accepts only approved public storage/CDN URLs and blocks encoded/signed/third-party bypasses', () => {
      const validUrls = [
        'https://gykrbpykjhpyrdrinkuk.supabase.co/storage/v1/object/public/product-images/almarai/milk-1l.webp',
        'https://gykrbpykjhpyrdrinkuk.supabase.co/storage/v1/object/public/offer-display-images/produce/tomato.webp',
        'https://storage.wifran.com/product-images/items/123.png',
        'https://cdn.wifran.com/leaflets/2026/dove.jpg'
      ]
      for (const u of validUrls) {
        expect(sanitizePublicConsumerImageUrl(u)).toBe(u)
      }

      const blockedUrls = [
        'https://gykrbpykjhpyrdrinkuk.supabase.co/storage/v1/object/public/%2Foffer-images%2Fbatch1%2Foffer_card_crop.webp',
        'https://gykrbpykjhpyrdrinkuk.supabase.co/storage/v1/object/public/offer%2Dimages/batch1/item%2Ewebp',
        'https://gykrbpykjhpyrdrinkuk.supabase.co/storage/v1/object/public/product-images/a.png?next=%2Foffer-images%2Fcrop.webp',
        'https://gykrbpykjhpyrdrinkuk.supabase.co/storage/v1/object/sign/product-images/milk.webp?token=abc',
        'https://gykrbpykjhpyrdrinkuk.supabase.co/storage/v1/object/public/private-crops/page1/offer.webp',
        'https://evil.example.com/product-images/fake.webp',
        'http://storage.wifran.com/product-images/insecure.webp',
        'F:\\Work\\AI Projects\\wifran-offers-extractor\\Extracts\\Alwafa_Test\\offer_card_crop.webp',
        'file:///C:/crops/thumb.webp',
        'data:image/png;base64,iVBORw0KGgo='
      ]
      for (const bad of blockedUrls) {
        expect(sanitizePublicConsumerImageUrl(bad)).toBeNull()
      }
    })

    it('Scrubs nested contract_v2.assets and upload_state across offerSyncMapper, projection, and v_consumer_offers mapper', () => {
      const dirtyUrl =
        'https://proj.supabase.co/storage/v1/object/public/%2Foffer-images%2Fbatch1%2Foffer_card_crop.webp'
      const dirtyContractV2 = {
        assets: {
          offer_card: {
            storage_bucket: 'offer-images',
            storage_object_path: 'batch1/offer_card_crop.webp',
            delivery_url: dirtyUrl,
            local_path_internal: 'F:\\Work\\Extracts\\crop.webp',
            upload_state: 'uploaded'
          },
          product_thumbnail: {
            storage_bucket: 'offer-images',
            storage_object_path: 'batch1/product_thumb_crop.webp',
            delivery_url: 'https://evil.example.com/thumb.webp',
            local_path_internal: 'C:\\temp\\thumb.webp',
            upload_state: 'uploaded'
          }
        }
      }

      const cleanedV2 = sanitizeConsumerContractV2Assets(dirtyContractV2)
      expect(cleanedV2.assets.offer_card.delivery_url).toBeNull()
      expect(cleanedV2.assets.offer_card.storage_bucket).toBeNull()
      expect(cleanedV2.assets.offer_card.storage_object_path).toBeNull()
      expect(cleanedV2.assets.offer_card.local_path_internal).toBeNull()
      expect(cleanedV2.assets.offer_card.upload_state).toBe('pending')

      const syncRes = mapPreparedPayloadToOffersInsert({
        preparedPayload: {
          supermarket_id: 'c2cc16c2-0001-4444-b000-c00000000001',
          location_scope: 'national',
          title_en: 'Tomatoes',
          offer_price: 5,
          offer_end_date: '2026-11-20',
          contract_v2: dirtyContractV2
        },
        imageUrl: dirtyUrl,
        storageBucket: 'offer-images',
        storagePath: 'batch1/%2Foffer-images%2Foffer_card_crop.webp',
        thumbnailUrl: dirtyUrl,
        thumbnailStoragePath: 'F:\\Work\\crop.webp',
        sourceId: null
      })

      expect(syncRes.payload?.image_url).toBeNull()
      expect(syncRes.payload?.image_path).toBeNull()
      expect(syncRes.payload?.image_bucket).toBeNull()
      expect(syncRes.payload?.contract_v2.assets.offer_card.delivery_url).toBeNull()
      expect(syncRes.payload?.contract_v2.assets.offer_card.local_path_internal).toBeNull()

      const dtoFromDirtyViewRow = mapSqlConsumerViewRowToConsumerDto({
        source_offer_id: 'l1:p001:i001:s01',
        offer_price: 5,
        image_url: dirtyUrl,
        thumbnail_url: 'https://evil.example.com/thumb.webp',
        card_image_upload_state: 'uploaded',
        consumer_contract_v2: dirtyContractV2
      })
      expect(dtoFromDirtyViewRow.image_url).toBeNull()
      expect(dtoFromDirtyViewRow.thumbnail_url).toBeNull()
      expect(dtoFromDirtyViewRow.card_image_upload_state).toBe('pending')
      expect(JSON.stringify(dtoFromDirtyViewRow)).not.toContain('offer-images')
      expect(JSON.stringify(dtoFromDirtyViewRow)).not.toContain('F:\\Work')

      const proj = toConsumerOfferProjection({
        product: { title_en: 'Tomatoes', title_ar: 'طماطم' },
        prices: { offer_price: 5, currency: 'SAR' },
        content: { each_size_value: 1, each_size_unit: 'kg' },
        image: {
          image_url: dirtyUrl,
          thumbnail_url: 'https://evil.example.com/bad.png'
        }
      } as any)
      expect(proj.image_url).toBeNull()
      expect(proj.thumbnail_url).toBeNull()
      expect(proj.card_image_upload_state).toBe('pending')
    })
  })
})

