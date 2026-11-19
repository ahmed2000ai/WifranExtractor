import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { sharedBatchOrchestrationService } from '../batchOrchestrationService';
import { CatalogMatchingOrchestrator } from '../catalogMatchingOrchestrator';
import { BrandGroupingService } from '../../db/brandGroupingService';
import { VerifiedMatchCacheService } from '../../db/verifiedMatchCacheService';
import { GeminiMatchingService } from '../../ocr/geminiMatchingService';
import { MatchingEvidenceOverlayService } from '../../db/matchingEvidenceOverlayService';
import type { BatchManifest } from '../../../shared/types/batchExtraction';

describe('WIFRAN-EXTRACTOR-CATALOG-MATCH-002B (§3): Batch Orchestration Attribute Pass-Through', () => {
  const prevOfflineUat = process.env.WIFRAN_OFFLINE_UAT;
  const createdBatchDirs: string[] = [];

  beforeEach(() => {
    process.env.WIFRAN_OFFLINE_UAT = '1';
  });

  afterEach(() => {
    for (const dir of createdBatchDirs) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
    createdBatchDirs.length = 0;
    if (prevOfflineUat === undefined) {
      delete process.env.WIFRAN_OFFLINE_UAT;
    } else {
      process.env.WIFRAN_OFFLINE_UAT = prevOfflineUat;
    }
    vi.restoreAllMocks();
  });

  function setupOfflineBatchDirs(batchId: string): { batchDir: string; leafletDraftDir: string; leafletCanonicalDir: string } {
    const batchDir = sharedBatchOrchestrationService.getBatchDir(batchId);
    const leafletDraftDir = path.join(batchDir, 'leaflets', 'leaflet-draft');
    const leafletCanonicalDir = path.join(batchDir, 'leaflets', 'leaflet-canonical');
    fs.mkdirSync(leafletDraftDir, { recursive: true });
    fs.mkdirSync(path.join(leafletCanonicalDir, 'json'), { recursive: true });
    createdBatchDirs.push(batchDir);

    const manifest: BatchManifest = {
      schemaVersion: '1.0',
      batchId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'completed',
      workspaceDir: batchDir,
      executionMode: 'flex',
      model: 'gemini-3.8-flash',
      totals: {
        totalPdfs: 2,
        completedPdfs: 2,
        failedPdfs: 0,
        cancelledPdfs: 0,
        totalPages: 2,
        pagesProcessed: 2,
        totalOffers: 3,
        totalCostUsd: 0
      },
      leaflets: [
        {
          leafletId: 'leaflet-draft',
          fileName: 'panda-draft.pdf',
          filePath: path.join(batchDir, 'panda-draft.pdf'),
          fileSizeBytes: 100,
          fileFingerprint: 'fp-draft',
          pageCount: 1,
          pagesProcessed: 1,
          offersCount: 2,
          estimatedCostUsd: 0,
          status: 'completed',
          workspacePath: leafletDraftDir,
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
        },
        {
          leafletId: 'leaflet-canonical',
          fileName: 'othaim-canonical.pdf',
          filePath: path.join(batchDir, 'othaim-canonical.pdf'),
          fileSizeBytes: 100,
          fileFingerprint: 'fp-canonical',
          pageCount: 1,
          pagesProcessed: 1,
          offersCount: 1,
          estimatedCostUsd: 0,
          status: 'completed',
          workspacePath: leafletCanonicalDir,
          provenance: 'cache',
          metadata: {
            supermarketId: 'othaim',
            supermarketName: 'Othaim',
            locationScope: 'national',
            locationLabel: null,
            cityId: null,
            regionId: null,
            offerStartDate: '2026-06-03',
            offerEndDate: '2026-06-09'
          }
        }
      ]
    };

    fs.writeFileSync(
      sharedBatchOrchestrationService.getBatchManifestPath(batchId),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );

    return { batchDir, leafletDraftDir, leafletCanonicalDir };
  }

  it('preserves canonicalSourceId, manufacturer pack, retail promo qty, customer limit, variant, assortment & overlay into CatalogMatchingOrchestrator', async () => {
    const batchId = `batch-uat-passthrough-${Date.now()}`;
    const { batchDir, leafletDraftDir, leafletCanonicalDir } = setupOfflineBatchDirs(batchId);

    // 1. Staged draft fixture (two offers: multi-buy single item + assortment ambiguity without overlay)
    const stagedDraft = {
      schemaVersion: '1.0',
      leafletId: 'leaflet-draft',
      status: 'extracted',
      header: {
        supermarketId: 'panda',
        validFrom: '2026-06-03',
        validTo: '2026-06-09'
      },
      items: [
        {
          id: 'draft_seara_p3',
          sourceOfferId: 'seara_p3_frozen_chicken_3x900g_promo',
          canonicalSourceId: 'PAND-NATL-030626_p003_o002',
          pageNumber: 3,
          titleAr: 'دجاج مجمد سيارا 3 × 900 جم',
          titleEn: 'Seara Frozen Chicken 3 x 900g Promo',
          brand: 'Seara',
          variantOrFlavor: 'Whole Chicken',
          priceAfter: 44.95,
          priceBefore: 59.95,
          discountPercent: 25,
          sizeOrWeight: '900g',
          each_size_value: 900,
          each_size_unit: 'g',
          inner_pack_count: 1,
          sale_unit_type: 'piece',
          customer_limit: 2,
          promotion_mechanic: 'multi_buy',
          promo_condition_quantity: 3,
          quantity_semantics: 'retail_promo_quantity',
          assortment_status: 'single_sku',
          promoNotes: '3 pcs for 44.95 SAR, limit 2 per customer'
        },
        {
          id: 'draft_fakieh_a1',
          sourceOfferId: 'fakieh_a1_carton_mix',
          canonicalSourceId: 'WF-NATL-100626_p002_o005',
          pageNumber: 2,
          titleAr: 'فروج فقيه طازج ٢ × ٩٠٠ جم',
          titleEn: 'Fakieh Fresh Chicken 2 x 900g Promo',
          brand: 'Fakieh',
          variant_or_flavor: 'Spicy Marinated',
          priceAfter: 33.9,
          priceBefore: 42.0,
          sizeOrWeight: '900g',
          each_size_value: 900,
          each_size_unit: 'g',
          inner_pack_count: 1,
          sale_unit_type: 'piece',
          customer_limit: 4,
          promotion_mechanic: 'multi_buy',
          promo_condition_quantity: 2,
          quantity_semantics: 'retail_promo_quantity',
          assortment_status: 'single_sku'
        }
      ]
    };
    fs.writeFileSync(path.join(leafletDraftDir, 'staged-draft.json'), JSON.stringify(stagedDraft, null, 2), 'utf8');

    // 2. Real-format canonical.json fixture (no staged-draft.json in leafletCanonicalDir)
    const canonicalJson = {
      schema_version: 'canonical_v1',
      source: {
        external_image_id: 'OTHM-NATL-040626_p001_o001',
        source_page_number: 1,
        source_item_number: 'sadia_o1_nuggets_270g_pack'
      },
      product: {
        title_ar: 'ناجتس دجاج ساديا ٢٧٠ جم',
        title_en: 'Sadia Chicken Nuggets 270g Assorted',
        brand_text: 'Sadia',
        variant_or_flavor: 'Classic / Crispy'
      },
      prices: {
        offer_price: 29.95,
        original_price: 49.95,
        discount_percent: 40
      },
      content: {
        size_text: '270g',
        each_size_value: 270,
        each_size_unit: 'g',
        pack_quantity: 1,
        sale_unit_type: 'pack',
        quantity_semantics: 'retail_promo_quantity'
      },
      promotion: {
        mechanic: 'multi_buy',
        bundle_quantity: 5,
        condition_text: '5 packs for 29.95',
        customer_limit: 1
      },
      raw: {
        raw_attributes: {
          raw_extraction_json: [
            {
              quantity_limit_per_customer: 1,
              is_multi_brand_or_variant: true,
              variant_or_flavor: 'Classic / Crispy'
            }
          ]
        }
      }
    };
    fs.writeFileSync(
      path.join(leafletCanonicalDir, 'json', 'page-001-001.canonical.json'),
      JSON.stringify(canonicalJson, null, 2),
      'utf8'
    );

    // 3. Batch-scoped evidence overlay annotation on canonicalSourceId (testing key resolution & assortment override)
    const batchOverlayPath = path.join(batchDir, 'catalog-matching', 'evidence-annotations.json');
    const overlay = new MatchingEvidenceOverlayService(batchOverlayPath, `batch:${batchId}`);
    overlay.setAnnotation({
      source_id: 'OTHM-NATL-040626_p001_o001',
      assortment_status: 'multiple_variants',
      evidence_source: 'operator_verified_card',
      identity_resolution: 'requires_review',
      sub_product_refs: ['Nuggets Regular 270g', 'Nuggets Mini Chef 270g'],
      notes: 'Offline integration test assortment evidence',
      reversible: true
    });

    // Execute real BatchOrchestrationService pass-through
    const offers = await sharedBatchOrchestrationService.getUnifiedBatchOffers(batchId);
    expect(offers).toHaveLength(3);

    const searaOffer = offers.find((o) => o.sourceOfferId === 'seara_p3_frozen_chicken_3x900g_promo')!;
    const fakiehOffer = offers.find((o) => o.sourceOfferId === 'fakieh_a1_carton_mix')!;
    const sadiaOffer = offers.find((o) => o.sourceOfferId === 'sadia_o1_nuggets_270g_pack')!;

    expect(searaOffer).toBeDefined();
    expect(searaOffer.canonicalSourceId).toBe('PAND-NATL-030626_p003_o002');
    expect(searaOffer.inner_pack_count).toBe(1);
    expect(searaOffer.promo_condition_quantity).toBe(3);
    expect(searaOffer.promotion_mechanic).toBe('multi_buy');
    expect(searaOffer.customer_limit).toBe(2);
    expect(searaOffer.variantOrFlavor).toBe('Whole Chicken');
    expect(searaOffer.assortment_status).toBe('single_sku');
    expect(searaOffer.quantity_semantics).toBe('retail_promo_quantity');

    expect(fakiehOffer).toBeDefined();
    expect(fakiehOffer.canonicalSourceId).toBe('WF-NATL-100626_p002_o005');
    expect(fakiehOffer.inner_pack_count).toBe(1);
    expect(fakiehOffer.promo_condition_quantity).toBe(2);
    expect(fakiehOffer.customer_limit).toBe(4);
    expect(fakiehOffer.variantOrFlavor).toBe('Spicy Marinated');

    expect(sadiaOffer).toBeDefined();
    expect(sadiaOffer.canonicalSourceId).toBe('OTHM-NATL-040626_p001_o001');
    expect(sadiaOffer.titleEn).toBe('Sadia Chicken Nuggets 270g Assorted');
    expect(sadiaOffer.promoPrice).toBe(29.95);
    expect(sadiaOffer.originalPrice).toBe(49.95);
    expect(sadiaOffer.inner_pack_count).toBe(1);
    expect(sadiaOffer.promo_condition_quantity).toBe(5);
    expect(sadiaOffer.promotion_mechanic).toBe('multi_buy');
    expect(sadiaOffer.customer_limit).toBe(1);
    expect(sadiaOffer.variantOrFlavor).toBe('Classic / Crispy');
    expect(sadiaOffer.assortment_status).toBe('multiple_variants');
    expect(sadiaOffer.matchingEvidence?.assortment_status).toBe('multiple_variants');
    expect(sadiaOffer.matchingEvidence?.sub_product_refs).toEqual([
      'Nuggets Regular 270g',
      'Nuggets Mini Chef 270g'
    ]);

    // Verify BrandGroupingService consumes every passed-through attribute cleanly
    const grouping = new BrandGroupingService();
    const groups = grouping.groupOffersByBrand(offers);
    const searaIdentity = groups.find((g) => g.brandKey === 'seara')?.uniqueIdentities[0];
    const sadiaIdentity = groups.find((g) => g.brandKey === 'sadia')?.uniqueIdentities[0];

    expect(searaIdentity?.normalizedAttrs.manufacturerPackCount).toBe(1);
    expect(searaIdentity?.normalizedAttrs.promoPurchaseQuantity).toBe(3);
    expect(searaIdentity?.normalizedAttrs.promotionMechanic).toBe('multi_buy');
    expect(searaIdentity?.normalizedAttrs.variantOrFlavor).toBe('Whole Chicken');
    expect(searaIdentity?.normalizedAttrs.packagingSemantics).toBe('single_unit_with_retail_promo');
    expect(searaIdentity?.normalizedAttrs.isIdentitySufficient).toBe(true);

    expect(sadiaIdentity?.normalizedAttrs.assortmentStatus).toBe('multiple_variants');
    expect(sadiaIdentity?.normalizedAttrs.evidenceAnnotation?.source_id).toBe('OTHM-NATL-040626_p001_o001');
    expect(sadiaIdentity?.normalizedAttrs.isIdentitySufficient).toBe(false);

    // Verify CatalogMatchingOrchestrator consumes passed-through offers offline without paid Gemini calls
    const cacheService = new VerifiedMatchCacheService(path.join(batchDir, 'empty-cache.json'));
    const geminiMock = new GeminiMatchingService();
    const evaluateSpy = vi.spyOn(geminiMock, 'evaluateBatch').mockImplementation(async (req) => ({
      matches: req.items.map((it) => ({
        item: it,
        decision: 'existing' as const,
        matchedProductId: '101',
        temporaryRef: null,
        confidence: 'high' as const,
        validationIssues: [],
        rawModelSourceId: it.memberOffers[0]?.canonicalSourceId || it.memberOffers[0]?.sourceOfferId || null
      })),
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        cachedTokens: 0,
        totalTokens: 0,
        actualCostUsd: 0
      },
      rawResponseText: '{"matches":[]}',
      parsedResponse: { matches: [] },
      promptPayload: {},
      requestConfigSnapshot: { thinkingLevel: 'MEDIUM' },
      validationDiagnostics: {
        rawMatchCount: req.items.length,
        normalizedIdsCount: 0,
        droppedMatchesCount: 0,
        unrecognizedEntries: []
      }
    }) as any);

    vi.spyOn(grouping, 'retrieveBrandCandidates').mockImplementation(async (_supabase, group) => {
      if (group.brandKey === 'seara') {
        return {
          candidates: [
            {
              id: '101',
              brand: 'Seara',
              nameAr: 'دجاج مجمد سيارا 900 جم',
              nameEn: 'Seara Frozen Chicken 900g',
              sizeValue: 900,
              sizeUnit: 'g',
              packCount: 1,
              variant: 'Whole Chicken'
            }
          ],
          totalBrandProducts: 1,
          retrievalCompleteness: 'complete',
          fallbackActions: []
        };
      }
      if (group.brandKey === 'fakieh') {
        return {
          candidates: [
            {
              id: '202',
              brand: 'Fakieh',
              nameAr: 'فروج فقيه طازج 900 جم',
              nameEn: 'Fakieh Fresh Chicken 900g',
              sizeValue: 900,
              sizeUnit: 'g',
              packCount: 1,
              variant: 'Original'
            }
          ],
          totalBrandProducts: 1,
          retrievalCompleteness: 'complete',
          fallbackActions: []
        };
      }
      return {
        candidates: [],
        totalBrandProducts: 0,
        retrievalCompleteness: 'complete',
        fallbackActions: []
      };
    });

    const orchestrator = new CatalogMatchingOrchestrator(cacheService, geminiMock, grouping);
    vi.spyOn(orchestrator, 'getMatchingDir').mockReturnValue(path.join(batchDir, 'catalog-matching'));

    const runManifest = await orchestrator.executeMatchingRun({
      batchId,
      offers,
      supabase: {} as any
    });

    // Sadia must abstain at the pre-Gemini sufficiency gate because assortment + overlay carried through
    expect(runManifest.proposals[sadiaOffer.batchOfferKey].decision).toBe('unresolved');
    expect(runManifest.proposals[sadiaOffer.batchOfferKey].evidenceAnnotation?.source_id).toBe(
      'OTHM-NATL-040626_p001_o001'
    );
    // Seara and Fakieh both reach mocked Gemini (since titles/variants differ slightly from candidate names)
    // while Sadia abstained before Gemini. Verify all attributes + canonicalSourceId reached evaluateBatch.
    expect(runManifest.proposals[searaOffer.batchOfferKey].decision).toBe('existing');
    expect(runManifest.proposals[searaOffer.batchOfferKey].matchedProductId).toBe('101');
    expect(runManifest.proposals[fakiehOffer.batchOfferKey]).toBeDefined();
    expect(evaluateSpy).toHaveBeenCalledTimes(2);
    const searaCall = evaluateSpy.mock.calls.find((c) => c[0].brandKey === 'seara')!;
    const fakiehCall = evaluateSpy.mock.calls.find((c) => c[0].brandKey === 'fakieh')!;
    expect(searaCall[0].items[0].normalizedAttrs.manufacturerPackCount).toBe(1);
    expect(searaCall[0].items[0].normalizedAttrs.promoPurchaseQuantity).toBe(3);
    expect(searaCall[0].items[0].normalizedAttrs.promotionMechanic).toBe('multi_buy');
    expect(searaCall[0].items[0].normalizedAttrs.variantOrFlavor).toBe('Whole Chicken');
    expect(searaCall[0].items[0].memberOffers[0].canonicalSourceId).toBe('PAND-NATL-030626_p003_o002');
    expect(searaCall[0].items[0].memberOffers[0].customer_limit).toBe(2);

    const fakiehEvalItem = fakiehCall[0].items[0];
    expect(fakiehEvalItem.normalizedAttrs.manufacturerPackCount).toBe(1);
    expect(fakiehEvalItem.normalizedAttrs.promoPurchaseQuantity).toBe(2);
    expect(fakiehEvalItem.normalizedAttrs.promotionMechanic).toBe('multi_buy');
    expect(fakiehEvalItem.normalizedAttrs.variantOrFlavor).toBe('Spicy Marinated');
    expect(fakiehEvalItem.memberOffers[0].customer_limit).toBe(4);
  });
});
