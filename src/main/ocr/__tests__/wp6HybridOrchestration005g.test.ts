/**
 * WIFRAN-EXTRACTOR-IDENTITY-005G (WP6)
 * Offline Adversarial & Failure-Mode Verification Suite (§13 + §14).
 *
 * Strictly offline: zero live Gemini/Vertex API calls, zero Supabase writes.
 * Preserves frozen `pilot_005e_frozen_ground_truth.json` and legacy contracts untouched.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import type { OfferContractV3Record } from '../../../shared/types/extractorContractV3';
import {
  HYBRID_EXTRACTION_DEFAULT_FLAGS,
  type HybridExtractionProvider,
  type PageContextVerificationEvidence
} from '../../../shared/types/hybridExtractionV3';
import {
  decodeV3PageExtractionToOfferCards,
  parseOfferContractV3Record
} from '../../../shared/schemas/leafletPageExtractionV3Schema';
import { decomposeV3OfferCard } from '../offerV3DecompositionEngine';
import { adaptV3DecompositionToOfflineMatching } from '../../db/v3MatchingInputAdapter';
import { evaluateCardForCropVerification } from '../hybrid/hybridCropSelector';
import {
  computeCardUnionNormalizedBox,
  generateHybridRegionCrop
} from '../hybrid/hybridCropGenerator';
import { applyScopedPageContextToCards } from '../hybrid/hybridPageContextVerifier';
import { reconcilePageAndCropCards } from '../hybrid/hybridEvidenceReconciler';
import {
  InMemoryHybridCacheStore,
  createOffline005eReplayProvider,
  runHybridPageWorkflow
} from '../hybrid/hybridWorkflowOrchestrator';

const REPO_ROOT = resolve(__dirname, '../../../..');
const RESPONSES_DIR = join(REPO_ROOT, 'Extracts/pilot_v3_005e/responses');

function loadRawJson(slotId: string): any {
  const raw = JSON.parse(readFileSync(join(RESPONSES_DIR, `${slotId}.raw.json`), 'utf8'));
  return raw.parsedResponse || JSON.parse(raw.rawResponseText);
}

function makeCleanSingleSkuCard(overrides?: Partial<OfferContractV3Record>): OfferContractV3Record {
  const base = parseOfferContractV3Record({
    schema_version: 'wifran.extractor.card/3.0',
    source_card: {
      leaflet_id: 'test-leaflet',
      page_number: 1,
      source_offer_id: 'test-leaflet_p001_001',
      source_evidence_ref_internal: 'private/internal/path/page1.png',
      retailer_id: 'sm-test',
      retailer_name: 'TestMart',
      offer_start_date: '2026-11-01',
      offer_end_date: '2026-11-10',
      location_scope: 'national',
      city_id: null,
      region_id: null,
      raw_text: {
        title_ar: 'جبنة موزاريلا بريزيدن 900 جم',
        title_en: 'President Mozzarella Cheese 900g',
        size_text: '900g',
        promo_badge_text: null,
        price_text_candidates: ['29.99', '54.99']
      }
    },
    pricing: {
      promo_price: 29.99,
      original_price: 54.99,
      currency: 'SAR',
      currency_evidence: 'SAR',
      price_basis: 'each',
      price_role_confidence: 'high',
      promo_conditions: null,
      price_conflict_flags: []
    },
    assortment: {
      status: 'confirmed_single_sku',
      visible_variant_count: 1,
      identifiable_sub_item_count: 1,
      assortment_evidence: ['printed_leaflet_text'],
      is_enumerated_list_complete: true,
      all_options_linkable: true
    },
    sub_items: [
      {
        sub_item_ref: 's01',
        brand_en: 'President',
        brand_ar: 'بريزيدن',
        product_name_en: 'Mozzarella Cheese',
        product_name_ar: 'جبنة موزاريلا',
        variant_or_flavor: null,
        product_form: null,
        each_size_value: 900,
        each_size_unit: 'g',
        manufacturer_pack_count: 1,
        printed_retailer_sku_code: null,
        is_retailer_sku_only_not_gtin: true,
        evidence_refs: ['ev_01'],
        unknown_attributes: [],
        conflict_attributes: [],
        safe_for_catalog_matching: true
      }
    ],
    quantity_and_promo: {
      sale_basis: 'single_unit',
      each_size_value: 900,
      each_size_unit: 'g',
      manufacturer_pack_count: 1,
      retailer_checkout_multibuy_qty: null,
      factory_bonus_paid_qty: null,
      factory_bonus_free_qty: null,
      customer_limit_pcs: null,
      shared_promotional_price: 29.99,
      quantity_price_tiers: [],
      is_per_weight_pricing: false,
      loyalty_required: false,
      loyalty_program_name: null
    },
    non_grocery_specs: {
      domain: 'grocery',
      excluded_from_default_grocery_feed: false
    },
    extraction_confidence: 'high',
    evidence_conflicts: [],
    evidence_ledger: [],
    printed_retailer_sku_codes: []
  });
  return { ...base, ...(overrides || {}) };
}

describe('WIFRAN-EXTRACTOR-IDENTITY-005G (WP6) Hybrid Orchestration & Adversarial Safety', () => {
  it('Test 17: enforces disabled-by-default feature gate and blocks normal workflow', async () => {
    expect(HYBRID_EXTRACTION_DEFAULT_FLAGS.enabledByDefault).toBe(false);
    expect(HYBRID_EXTRACTION_DEFAULT_FLAGS.allowDatabaseWrites).toBe(false);

    const dummyProvider: HybridExtractionProvider = {
      providerId: 'dummy',
      isOfflineOrMock: true,
      async extractPage() {
        throw new Error('Should never dispatch when gated off');
      },
      async extractCardCrop() {
        throw new Error('Should never dispatch when gated off');
      }
    };

    const blockedNormal = await runHybridPageWorkflow({
      executionContext: 'normal_app',
      explicitAuthorization: true,
      featureEnabled: true,
      runId: 't-normal',
      leafletId: 'l1',
      pageNumber: 1,
      retailer: 'Panda',
      pageAssetPath: 'nonexistent.pdf',
      pageImagePath: 'nonexistent.png',
      cropOutputDir: tmpdir(),
      provider: dummyProvider
    });
    expect(blockedNormal.ok).toBe(false);
    expect(blockedNormal.featureEnabled).toBe(false);
    expect(blockedNormal.databaseWritesEnabled).toBe(false);
    expect(blockedNormal.abortedReason).toContain('HYBRID_NORMAL_WORKFLOW_BLOCKED');

    const blockedDefault = await runHybridPageWorkflow({
      executionContext: 'isolated_hybrid_workflow',
      explicitAuthorization: false,
      runId: 't-unauth',
      leafletId: 'l1',
      pageNumber: 1,
      retailer: 'Panda',
      pageAssetPath: 'nonexistent.pdf',
      pageImagePath: 'nonexistent.png',
      cropOutputDir: tmpdir(),
      provider: dummyProvider
    });
    expect(blockedDefault.ok).toBe(false);
    expect(blockedDefault.abortedReason).toContain('HYBRID_FEATURE_DISABLED');
  });

  it('WP6-B selector does not trigger on benign optional fields (optional variant/original_price/limit) while flagging §14 price inversion as P0', () => {
    const cleanCard = makeCleanSingleSkuCard({
      pricing: {
        promo_price: 29.99,
        original_price: null,
        currency: 'SAR',
        currency_evidence: 'SAR',
        price_basis: 'each',
        price_role_confidence: 'high',
        promo_conditions: null,
        price_conflict_flags: []
      }
    });
    const cleanDecision = evaluateCardForCropVerification(cleanCard, {
      components: {
        product_graphic_box: [100, 100, 300, 300],
        promo_price_box: [200, 300, 300, 400],
        original_price_box: null,
        title_text_box: [300, 100, 360, 380],
        unit_and_size_badge_box: null
      },
      pageHasPerCardLimits: false
    });
    expect(cleanDecision.priority).toBe('P2');
    expect(cleanDecision.needsCrop).toBe(false);

    // §14 price role inversion guard: promo_price >= original_price must trigger P0 + quarantine
    const invertedPriceCard = makeCleanSingleSkuCard({
      pricing: {
        promo_price: 54.99,
        original_price: 29.99,
        currency: 'SAR',
        currency_evidence: 'SAR',
        price_basis: 'each',
        price_role_confidence: 'high',
        promo_conditions: null,
        price_conflict_flags: []
      }
    });
    const invertedDecision = evaluateCardForCropVerification(invertedPriceCard);
    expect(invertedDecision.priority).toBe('P0');
    expect(invertedDecision.triggerCodes).toContain('PRICE_ROLE_OR_PROMO_ANOMALY');

    const reconciledInverted = reconcilePageAndCropCards({
      pageCard: invertedPriceCard,
      selectionDecision: invertedDecision,
      cropCards: [invertedPriceCard],
      cropExecuted: true,
      cropStatus: 'executed',
      cropLineage: null,
      failClosedOnUnverifiedP0: true
    });
    expect(reconciledInverted[0].overallStatus).toBe('quarantined_conflict');
    expect(reconciledInverted[0].publicationAssessment.isEligibleForNonCatalogPublication).toBe(false);
  });

  it('Test 1: recovers explicit variants missed on full page (Panda #8 Moussy -> Classic + Pomegranate)', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'wp6-t1-'));
    try {
      const provider = createOffline005eReplayProvider({
        'panda-national-national-2026-10-20::p2': {
          pageSlotId: 'pilot_page_01_panda_p002',
          rawPageFile: join(RESPONSES_DIR, 'pilot_page_01_panda_p002.raw.json'),
          savedCropFilesByOfferNumber: {
            5: join(RESPONSES_DIR, 'pilot_crop_01_baskin_robbins.raw.json'),
            8: join(RESPONSES_DIR, 'pilot_crop_02_moussy.raw.json')
          }
        }
      });

      const res = await runHybridPageWorkflow({
        executionContext: 'isolated_hybrid_workflow',
        explicitAuthorization: true,
        featureEnabled: true,
        runId: 'wp6-test-panda',
        leafletId: 'panda-national-national-2026-10-20',
        pageNumber: 2,
        retailer: 'Panda',
        retailerId: 'sm-panda',
        locationScope: 'national',
        offerStartDate: '2026-10-14',
        offerEndDate: '2026-10-20',
        pageAssetPath: join(REPO_ROOT, 'Extracts/Panda_Test/chunks/chunk-002-pages-002-002.pdf'),
        pageImagePath: join(REPO_ROOT, 'Extracts/Panda_Test/pages/page.2.png'),
        cropOutputDir: workDir,
        provider
      });

      expect(res.ok).toBe(true);
      const moussy = res.reconciledCards.find((c) => c.offerNumber === 8)!;
      expect(moussy.cropExecuted).toBe(true);
      expect(existsSync(moussy.cropLineage!.cropImagePath!)).toBe(true);
      expect(moussy.overallStatus).toBe('evidence_confirmed_multi_sku');
      expect(moussy.legacyOverallStatusAlias).toBe('verified_decomposed_multi_sku');
      expect(moussy.decomposition.children.length).toBe(2);
      expect(moussy.matchingAdapterSummary.matchableChildrenCount).toBe(2);
      expect(moussy.fieldDecisions.some((f) => f.field === 'assortment.sub_items' && f.outcome === 'enriched')).toBe(true);

      // Test 9 check on Baskin Robbins (#5): partial assortment warning preserved
      const br = res.reconciledCards.find((c) => c.offerNumber === 5)!;
      expect(br.cropExecuted).toBe(true);
      expect(br.overallStatus).toBe('retained_non_catalog_review');
      expect(br.decomposition.children.length).toBe(0);
      expect(br.publicationAssessment.isEligibleForNonCatalogPublication).toBe(true);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('Test 2: full-page splits bottle icons on BinDawood Tide -> crop enforces conservative non-catalog retention while Abu Kass stays verified', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'wp6-t2-'));
    try {
      const provider = createOffline005eReplayProvider({
        'bin-dawood-national-national-2026-10-20::p4': {
          pageSlotId: 'pilot_page_02_bndw_p004',
          rawPageFile: join(RESPONSES_DIR, 'pilot_page_02_bndw_p004.raw.json'),
          savedCropFilesByOfferNumber: {
            1: join(RESPONSES_DIR, 'pilot_crop_05_abu_kass.raw.json'),
            11: join(RESPONSES_DIR, 'pilot_crop_06_tide_partial_negative.raw.json'),
            12: join(RESPONSES_DIR, 'pilot_crop_07_persil_sku_negative.raw.json')
          }
        }
      });

      const res = await runHybridPageWorkflow({
        executionContext: 'isolated_hybrid_workflow',
        explicitAuthorization: true,
        featureEnabled: true,
        runId: 'wp6-test-bndw',
        leafletId: 'bin-dawood-national-national-2026-10-20',
        pageNumber: 4,
        retailer: 'BinDawood',
        retailerId: 'sm-bndw',
        locationScope: 'national',
        offerStartDate: '2026-07-15',
        offerEndDate: '2026-07-21',
        pageAssetPath: join(REPO_ROOT, 'Extracts/BNDW_Test/chunks/chunk-004-pages-004-004.pdf'),
        pageImagePath: join(REPO_ROOT, 'Extracts/BNDW_Test/pages/page.4.png'),
        cropOutputDir: workDir,
        provider
      });

      expect(res.ok).toBe(true);
      const tide = res.reconciledCards.find((c) => c.offerNumber === 11)!;
      expect(tide.cropExecuted).toBe(true);
      expect(tide.overallStatus).toBe('retained_non_catalog_review');
      expect(tide.decomposition.children.length).toBe(0);
      expect(tide.publicationAssessment.isEligibleForNonCatalogPublication).toBe(true);

      const abuKass = res.reconciledCards.find((c) => c.offerNumber === 1)!;
      expect(abuKass.cropExecuted).toBe(true);
      expect(abuKass.overallStatus).toBe('evidence_confirmed_multi_sku');
      expect(abuKass.legacyOverallStatusAlias).toBe('verified_decomposed_multi_sku');
      expect(abuKass.decomposition.children.length).toBe(2);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('Tests 3 & 6: full-page misses loyalty, customer limit & EN/AR conflict on AlWafa Fakieh #4 -> crop recovers & quarantines', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'wp6-t3-6-'));
    try {
      const provider = createOffline005eReplayProvider({
        'alwafa-city-jeddah-2026-10-20::p1': {
          pageSlotId: 'pilot_page_04_alwafa_p001',
          rawPageFile: join(RESPONSES_DIR, 'pilot_page_04_alwafa_p001.raw.json'),
          savedCropFilesByOfferNumber: {
            4: join(RESPONSES_DIR, 'pilot_crop_11_fakieh_multibuy_en_ar_conflict.raw.json')
          }
        }
      });

      const res = await runHybridPageWorkflow({
        executionContext: 'isolated_hybrid_workflow',
        explicitAuthorization: true,
        featureEnabled: true,
        runId: 'wp6-test-alwafa',
        leafletId: 'alwafa-city-jeddah-2026-10-20',
        pageNumber: 1,
        retailer: 'AlWafa',
        retailerId: 'sm-alwafa',
        offerStartDate: '2026-10-14',
        offerEndDate: '2026-10-20',
        pageAssetPath: join(REPO_ROOT, 'Extracts/Alwafa_Test/chunks/chunk-001-pages-001-001.pdf'),
        pageImagePath: join(REPO_ROOT, 'Extracts/Alwafa_Test/pages/page.1.png'),
        cropOutputDir: workDir,
        provider
      });

      const fakieh = res.reconciledCards.find((c) => c.offerNumber === 4)!;
      expect(fakieh.cropExecuted).toBe(true);
      expect(fakieh.reconciledCard.quantity_and_promo.loyalty_required).toBe(false);
      expect(fakieh.reconciledCard.quantity_and_promo.customer_limit_pcs).toBeNull();
      expect(fakieh.reconciledCard.evidence_conflicts).toContain('EN_AR_WEIGHT_VOLUME_CONFLICT');
      expect(fakieh.overallStatus).toBe('quarantined_conflict');
      expect(fakieh.publicationAssessment.isEligibleForNonCatalogPublication).toBe(false);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('Tests 4 & 5: page-wide loyalty banner propagates with explicit scope evidence AND refuses to override explicit non-member exception or missing scope proof', () => {
    const p4Raw = loadRawJson('pilot_page_04_alwafa_p001');
    const decoded = decodeV3PageExtractionToOfferCards(p4Raw, {
      leafletId: 'alwafa-city-jeddah-2026-10-20',
      pageNumber: 1,
      sourceOfferIdPrefix: 'alwafa_p001',
      retailerId: 'sm-alwafa',
      retailerName: 'AlWafa',
      locationScope: 'national',
      tolerateOmittedNullableFields: true
    });
    expect(decoded.cards.filter((c) => c.quantity_and_promo.loyalty_required).length).toBe(0);

    // Without explicit_scope_evidence, propagation must refuse
    const ungroundedCtx: PageContextVerificationEvidence = {
      verified: true,
      is_loyalty_page: true,
      loyalty_program_name: 'Rewards',
      applies_to_all_page_offers: true,
      explicit_scope_evidence: null,
      validity_start_date: '2026-10-14',
      validity_end_date: '2026-10-20',
      page_currency: 'SAR',
      page_wide_customer_limit_pcs: null,
      exception_offer_numbers: [],
      sourceRegionKind: 'page_header'
    };
    const rejected = applyScopedPageContextToCards({
      cards: decoded.cards,
      offerNumbers: decoded.rawExtraction.offers.map((o) => o.offer_number),
      pageContext: ungroundedCtx
    });
    expect(rejected.loyaltyPropagatedCount).toBe(0);

    // With explicit_scope_evidence & exception offer #7 (non-member tier), #7 must stay non-loyalty
    const scopedCtx: PageContextVerificationEvidence = {
      ...ungroundedCtx,
      explicit_scope_evidence: 'Top header strip reads: Exclusive Rewards Members Only',
      exception_offer_numbers: [7]
    };
    const applied = applyScopedPageContextToCards({
      cards: decoded.cards,
      offerNumbers: decoded.rawExtraction.offers.map((o) => o.offer_number),
      pageContext: scopedCtx
    });
    expect(applied.loyaltyPropagatedCount).toBe(12);
    expect(applied.updatedCards[6].quantity_and_promo.loyalty_required).toBe(false);
    expect(applied.updatedCards[0].quantity_and_promo.loyalty_required).toBe(true);
  });

  it('Tests 7 & 8: preserves conflict when page catches conflict missed by crop OR when page & crop disagree on price/pack/size', () => {
    const pageWithConflict = makeCleanSingleSkuCard({
      evidence_conflicts: ['EN_AR_WEIGHT_VOLUME_CONFLICT']
    });
    const cleanCrop = makeCleanSingleSkuCard();
    const sel = evaluateCardForCropVerification(pageWithConflict);

    const t7 = reconcilePageAndCropCards({
      pageCard: pageWithConflict,
      selectionDecision: sel,
      cropCards: [cleanCrop],
      cropExecuted: true,
      cropStatus: 'executed',
      cropLineage: null,
      failClosedOnUnverifiedP0: true
    });
    expect(t7[0].reconciledCard.evidence_conflicts).toContain('EN_AR_WEIGHT_VOLUME_CONFLICT');
    expect(t7[0].overallStatus).toBe('quarantined_conflict');
    expect(t7[0].publicationAssessment.isEligibleForNonCatalogPublication).toBe(false);

    // Test 8: page says 19.99 SAR / 500g / 1 pack vs crop says 24.99 SAR / 1000g / 6 pack
    const cleanPage = makeCleanSingleSkuCard();
    const disagreeCrop = makeCleanSingleSkuCard({
      pricing: {
        ...cleanPage.pricing,
        promo_price: 24.99
      },
      quantity_and_promo: {
        ...cleanPage.quantity_and_promo,
        each_size_value: 1000,
        manufacturer_pack_count: 6
      }
    });
    const t8 = reconcilePageAndCropCards({
      pageCard: cleanPage,
      selectionDecision: evaluateCardForCropVerification(cleanPage),
      cropCards: [disagreeCrop],
      cropExecuted: true,
      cropStatus: 'executed',
      cropLineage: null,
      failClosedOnUnverifiedP0: true
    });
    expect(t8[0].overallStatus).toBe('quarantined_conflict');
    expect(t8[0].reconciledCard.evidence_conflicts).toContain('PRICE_ROLE_AMBIGUOUS');
    expect(t8[0].reconciledCard.evidence_conflicts).toContain('TEXT_VS_IMAGE_CONFLICT');
    expect(t8[0].reconciledCard.evidence_conflicts).toContain('EN_AR_PACK_COUNT_CONFLICT');
  });

  it('Test 10: compound multi-tier crop splits cleanly into independent tiers (Noori Fakieh) without cross-tier contamination', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'wp6-t10-'));
    try {
      const provider = createOffline005eReplayProvider({
        'noori-jeddah-2026-11-15::p1': {
          pageSlotId: 'pilot_page_03_noori_p001',
          rawPageFile: join(RESPONSES_DIR, 'pilot_page_03_noori_p001.raw.json'),
          savedCropFilesByOfferNumber: {
            2: join(RESPONSES_DIR, 'pilot_crop_08_fakieh_compound.raw.json')
          }
        }
      });

      const res = await runHybridPageWorkflow({
        executionContext: 'isolated_hybrid_workflow',
        explicitAuthorization: true,
        featureEnabled: true,
        runId: 'wp6-test-noori',
        leafletId: 'noori-jeddah-2026-11-15',
        pageNumber: 1,
        retailer: 'Noori',
        retailerId: 'sm-noori',
        locationScope: 'national',
        offerStartDate: '2026-11-05',
        offerEndDate: '2026-11-15',
        pageAssetPath: join(
          REPO_ROOT,
          'Extracts/noori-supermarket-229798534-jeddah/chunks/chunk-001-pages-001-001.pdf'
        ),
        pageImagePath: join(
          REPO_ROOT,
          'Extracts/noori-supermarket-229798534-jeddah/pages/page.1.png'
        ),
        cropOutputDir: workDir,
        provider
      });

      const fakiehTiers = res.reconciledCards.filter(
        (c) => c.offerNumber === 2 && c.overallStatus === 'evidence_confirmed_compound_tiers'
      );
      expect(fakiehTiers.length).toBe(2);
      expect(fakiehTiers[0].legacyOverallStatusAlias).toBe('verified_compound_tiers');
      const prices = fakiehTiers.map((t) => t.reconciledCard.pricing.promo_price).sort((a, b) => (a ?? 0) - (b ?? 0));
      const packs = fakiehTiers
        .map((t) => t.reconciledCard.quantity_and_promo.manufacturer_pack_count)
        .sort((a, b) => (a ?? 0) - (b ?? 0));
      expect(prices).toEqual([15.5, 141]);
      expect(packs).toEqual([1, 10]);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('Test 11: rejects inverted, out-of-bounds, and missing crop boxes safely', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'wp6-t11-'));
    try {
      const inverted = computeCardUnionNormalizedBox({
        product_graphic_box: [700, 100, 300, 400]
      });
      expect(inverted.ok).toBe(false);
      expect(inverted.issues[0]).toContain('INVERTED_OR_ZERO_AREA_BOX');

      const outOfBounds = computeCardUnionNormalizedBox({
        product_graphic_box: [-10, 50, 200, 1050]
      });
      expect(outOfBounds.ok).toBe(false);
      expect(outOfBounds.issues[0]).toContain('OUT_OF_NORMALIZED_BOUNDS');

      const tinyCrop = await generateHybridRegionCrop({
        cropId: 'tiny_test',
        parentSourceOfferId: 'offer_tiny',
        regionKind: 'offer_card',
        pageImagePath: join(REPO_ROOT, 'Extracts/Panda_Test/pages/page.2.png'),
        outputDir: workDir,
        explicitNormalizedBox: [10, 10, 12, 12],
        paddingPercent: 0
      });
      expect(tinyCrop.geometryValid).toBe(false);
      expect(tinyCrop.geometryIssues).toContain('CROP_TOO_SMALL_UNDER_32PX');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('Tests 12, 13, 14 & 15: handles P0 timeout/failure hold, budget exhaustion, cache reuse, and interrupted checkpoint resume', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'wp6-t12-15-'));
    try {
      let pageCalls = 0;
      let cropCalls = 0;
      const cacheStore = new InMemoryHybridCacheStore();
      const checkpointPath = join(workDir, 'checkpoint.json');

      const pageJson = loadRawJson('pilot_page_01_panda_p002');
      const moussyCropJson = loadRawJson('pilot_crop_02_moussy');

      // Test 12 & 13: cap crops to 0 (budget exhausted immediately on P0s) -> P0 held fail-closed
      const budgetZeroProvider: HybridExtractionProvider = {
        providerId: 'mock_budget_zero',
        isOfflineOrMock: true,
        async extractPage() {
          pageCalls++;
          return { ok: true, parsedJson: pageJson, durationMs: 100, costUsdOverride: 0.02 };
        },
        async extractCardCrop() {
          cropCalls++;
          return { ok: false, errorCode: 'ETIMEDOUT', errorMessage: 'Flex timeout', durationMs: 100 };
        }
      };

      const exhaustedRes = await runHybridPageWorkflow({
        executionContext: 'isolated_hybrid_workflow',
        explicitAuthorization: true,
        featureEnabled: true,
        runId: 'wp6-budget-cap',
        leafletId: 'panda-national-national-2026-10-20',
        pageNumber: 2,
        retailer: 'Panda',
        retailerId: 'sm-panda',
        locationScope: 'national',
        offerStartDate: '2026-10-14',
        offerEndDate: '2026-10-20',
        pageAssetPath: join(REPO_ROOT, 'Extracts/Panda_Test/chunks/chunk-002-pages-002-002.pdf'),
        pageImagePath: join(REPO_ROOT, 'Extracts/Panda_Test/pages/page.2.png'),
        cropOutputDir: workDir,
        dryRunGeometryOnly: true,
        budgetPolicy: { maxCropsPerPage: 0, failClosedOnUnverifiedP0: true },
        provider: budgetZeroProvider
      });
      expect(cropCalls).toBe(0);
      expect(exhaustedRes.summary.heldUnverifiedP0Cards).toBe(exhaustedRes.p0FlaggedCount);
      for (const r of exhaustedRes.reconciledCards.filter((c) => c.selectionDecision.priority === 'P0')) {
        expect(r.overallStatus).toBe('held_unverified_p0_budget_or_failure');
        expect(r.matchingAdapterSummary.matchableChildrenCount).toBe(0);
        expect(r.publicationAssessment.isEligibleForNonCatalogPublication).toBe(false);
      }

      // Tests 14 & 15: Run interrupted after 1 crop, then resumed with same checkpoint + cache
      pageCalls = 0;
      cropCalls = 0;
      const flakyThenResumeProvider: HybridExtractionProvider = {
        providerId: 'mock_interrupt_resume',
        isOfflineOrMock: true,
        async extractPage() {
          pageCalls++;
          return { ok: true, parsedJson: pageJson, durationMs: 100, costUsdOverride: 0.02 };
        },
        async extractCardCrop(req) {
          cropCalls++;
          if (req.sourceOfferId?.endsWith('_008')) {
            return { ok: true, parsedJson: moussyCropJson, durationMs: 100, costUsdOverride: 0.005 };
          }
          // Simulated timeout on other P0s
          return { ok: false, errorCode: 'TIMEOUT', errorMessage: 'Simulated timeout', durationMs: 100, costUsdOverride: 0 };
        }
      };

      await expect(
        runHybridPageWorkflow({
          executionContext: 'isolated_hybrid_workflow',
          explicitAuthorization: true,
          featureEnabled: true,
          runId: 'wp6-resume',
          leafletId: 'panda-national-national-2026-10-20',
          pageNumber: 2,
          retailer: 'Panda',
          retailerId: 'sm-panda',
          offerStartDate: '2026-10-14',
          offerEndDate: '2026-10-20',
          pageAssetPath: join(REPO_ROOT, 'Extracts/Panda_Test/chunks/chunk-002-pages-002-002.pdf'),
          pageImagePath: join(REPO_ROOT, 'Extracts/Panda_Test/pages/page.2.png'),
          cropOutputDir: workDir,
          checkpointPath,
          dryRunGeometryOnly: true,
          cacheStore,
          interruptAfterCropsCount: 2,
          provider: flakyThenResumeProvider
        })
      ).rejects.toThrow(/HYBRID_INTERRUPTED/);

      expect(pageCalls).toBe(1);
      const cropCallsBeforeResume = cropCalls;
      expect(cropCallsBeforeResume).toBe(2);

      // Resume: full page MUST hit cache (pageCalls stays 1!) and succeeded crops are NOT re-dispatched
      const resumed = await runHybridPageWorkflow({
        executionContext: 'isolated_hybrid_workflow',
        explicitAuthorization: true,
        featureEnabled: true,
        runId: 'wp6-resume',
        leafletId: 'panda-national-national-2026-10-20',
        pageNumber: 2,
        retailer: 'Panda',
        retailerId: 'sm-panda',
        locationScope: 'national',
        offerStartDate: '2026-10-14',
        offerEndDate: '2026-10-20',
        pageAssetPath: join(REPO_ROOT, 'Extracts/Panda_Test/chunks/chunk-002-pages-002-002.pdf'),
        pageImagePath: join(REPO_ROOT, 'Extracts/Panda_Test/pages/page.2.png'),
        cropOutputDir: workDir,
        checkpointPath,
        dryRunGeometryOnly: true,
        cacheStore,
        provider: flakyThenResumeProvider
      });
      expect(resumed.ok).toBe(true);
      expect(pageCalls).toBe(1); // Cache hit on resume!
      expect(resumed.checkpoint.stage).toBe('completed');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('Test 16: internal crop paths never leak into public V3 matching candidate DTOs', () => {
    const card = makeCleanSingleSkuCard({
      source_card: {
        ...makeCleanSingleSkuCard().source_card,
        source_evidence_ref_internal: 'F:/secret/local/crops/offer_1_crop.webp'
      }
    });
    const decomp = decomposeV3OfferCard(card);
    const adapter = adaptV3DecompositionToOfflineMatching(decomp);
    const serialized =
      JSON.stringify(adapter.matchableChildren) +
      JSON.stringify(adapter.parentOfferForPolicyCheck) +
      JSON.stringify(adapter.localStagingV3Summary);
    expect(serialized).not.toContain('F:/secret');
    expect(serialized).not.toContain('offer_1_crop.webp');
    expect(serialized).not.toContain('C:\\');
  });
});
