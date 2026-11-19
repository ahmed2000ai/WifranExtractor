import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  decodeV3PageExtractionToOfferCards,
  getV3LeafletPageGenAiSchema
} from '../../../shared/schemas/leafletPageExtractionV3Schema';
import { decomposeV3OfferCard, normalizeV3OfferCard } from '../offerV3DecompositionEngine';
import { adaptV3DecompositionToOfflineMatching } from '../../db/v3MatchingInputAdapter';
import {
  initializeOrLoadV3PilotManifest,
  runV3LivePilot
} from '../v3LivePilotRunner';

const REPO_ROOT = process.cwd();

describe('WIFRAN-EXTRACTOR-IDENTITY-005E (WP5) — Offline Preflight, Decoder Bridge & Durable Runner', () => {
  it('bridges raw Gemini V3 crop/page JSON cleanly to OfferContractV3Record and decomposes explicit assortment', () => {
    const mockRaw = {
      is_loyalty_page: false,
      loyalty_program_name: null,
      validity_start_date: '2026-11-10',
      validity_end_date: '2026-11-30',
      page_currency: 'SAR',
      ignored_banners: [],
      offers: [
        {
          offer_number: 1,
          arabic_title: 'آيس كريم باسكن روبنز (٥٠٠ مل)',
          english_title: 'Baskin Robbins Ice Cream (500ml)',
          brand: 'Baskin Robbins',
          size_text: '500ml',
          promo_badge_text: 'Assorted متنوع',
          assortment_status: 'explicit_assortment',
          visible_variant_count: 2,
          assortment_evidence: ['assorted_badge', 'multi_pack_image'],
          is_enumerated_list_complete: true,
          compound_group_id: null,
          shared_caption_text: null,
          item_domain: 'grocery',
          category_slug: 'ice_cream',
          promo_price: 17.99,
          original_price: 28.99,
          currency: 'SAR',
          currency_evidence: 'Saudi Riyal emblem',
          price_basis: 'shared_assortment',
          price_role_confidence: 'high',
          sale_basis: 'single_unit',
          is_per_weight_pricing: false,
          promo_conditions: null,
          each_size_value: 500,
          each_size_unit: 'ml',
          manufacturer_pack_count: 1,
          retailer_checkout_multibuy_qty: null,
          factory_bonus_paid_qty: null,
          factory_bonus_free_qty: null,
          customer_limit_pcs: null,
          loyalty_required: false,
          printed_retailer_sku_codes: [],
          sub_items: [
            {
              sub_item_ref: 's01',
              brand_en: 'Baskin Robbins',
              brand_ar: 'باسكن روبنز',
              product_name_en: 'Baskin Robbins Vanilla Ice Cream',
              product_name_ar: 'آيس كريم باسكن روبنز فانيليا',
              variant_or_flavor: 'Vanilla',
              each_size_value: 500,
              each_size_unit: 'ml',
              manufacturer_pack_count: 1,
              printed_retailer_sku_code: null
            },
            {
              sub_item_ref: 's02',
              brand_en: 'Baskin Robbins',
              brand_ar: 'باسكن روبنز',
              product_name_en: 'Baskin Robbins Chocolate Ice Cream',
              product_name_ar: 'آيس كريم باسكن روبنز شوكولاتة',
              variant_or_flavor: 'Chocolate',
              each_size_value: 500,
              each_size_unit: 'ml',
              manufacturer_pack_count: 1,
              printed_retailer_sku_code: null
            }
          ],
          non_grocery_specs: null,
          evidence_conflicts: [],
          confidence: 0.96,
          components: {
            product_graphic_box: [50, 100, 600, 700],
            promo_price_box: [650, 700, 900, 950],
            original_price_box: [600, 750, 650, 900],
            unit_and_size_badge_box: null,
            title_text_box: [750, 50, 950, 650]
          }
        }
      ]
    };

    const decoded = decodeV3PageExtractionToOfferCards(mockRaw, {
      leafletId: 'panda-national-national-2026-10-20',
      pageNumber: 2,
      sourceOfferIdPrefix: 'pilot_crop_01_baskin_robbins',
      explicitSingleOfferId: 'Panda_Test_p002_007',
      retailerId: 'c2cc16c2-0005-4444-b000-c00000000005',
      retailerName: 'Panda',
      locationScope: 'national',
      sourceEvidenceRefInternal: 'Extracts/Panda_Test/metadata/rev1/page-002/crops/offer-007/offer_card_crop.webp'
    });

    expect(decoded.schemaValid).toBe(true);
    expect(decoded.cards).toHaveLength(1);
    const decomp = decomposeV3OfferCard(decoded.cards[0]);
    expect(decomp.decomposed).toBe(true);
    expect(decomp.children).toHaveLength(2);
    expect(decomp.children.map((c) => c.variant_or_flavor)).toEqual(['Vanilla', 'Chocolate']);

    const adapter = adaptV3DecompositionToOfflineMatching(decomp);
    expect(adapter.matchableChildren).toHaveLength(2);
    expect(adapter.parentPublicationAssessment.isEligibleForNonCatalogPublication).toBe(true);
    expect(adapter.parentPublicationAssessment.quarantineReasons).toEqual([]);
  });

  it('catches §3.2 price-role confusion, foreign currency AED, and price-as-pack-count trap (5 SAR -> pack=5)', () => {
    const genAiSchema = getV3LeafletPageGenAiSchema() as any;
    expect(genAiSchema.properties.offers.items.properties.sale_basis).toBeDefined();
    expect(genAiSchema.properties.offers.items.properties.sub_items.items.properties.independent_promo_price).toBeDefined();

    // Simulate legacy Godiva-style 3 defects in a decoded V3 card
    const godivaBrokenRaw = {
      is_loyalty_page: false,
      loyalty_program_name: null,
      validity_start_date: null,
      validity_end_date: null,
      page_currency: 'AED',
      ignored_banners: [],
      offers: [
        {
          offer_number: 1,
          arabic_title: 'جوديفا ماستربيسيس بار ٣٢ جم',
          english_title: 'Godiva Masterpieces Bar 32g',
          brand: 'Godiva',
          size_text: '32g',
          promo_badge_text: '5 ريال',
          assortment_status: 'explicit_assortment',
          visible_variant_count: 3,
          assortment_evidence: ['choice_or_separator'],
          is_enumerated_list_complete: true,
          compound_group_id: null,
          shared_caption_text: null,
          item_domain: 'grocery',
          category_slug: 'chocolate',
          promo_price: 7.99,
          original_price: 5.0, // inverted regular vs promo price
          currency: 'AED',
          currency_evidence: 'misread currency',
          price_basis: 'shared_assortment',
          price_role_confidence: 'high',
          sale_basis: 'sealed_multipack',
          is_per_weight_pricing: false,
          promo_conditions: null,
          each_size_value: 32,
          each_size_unit: 'g',
          manufacturer_pack_count: 5, // misread 5 SAR as pack=5
          retailer_checkout_multibuy_qty: null,
          factory_bonus_paid_qty: null,
          factory_bonus_free_qty: null,
          customer_limit_pcs: null,
          loyalty_required: false,
          printed_retailer_sku_codes: [],
          sub_items: [],
          non_grocery_specs: null,
          evidence_conflicts: [],
          confidence: 0.7,
          components: {
            product_graphic_box: [0, 0, 500, 500],
            promo_price_box: [500, 500, 900, 900],
            original_price_box: null,
            unit_and_size_badge_box: null,
            title_text_box: null
          }
        }
      ]
    };

    const decoded = decodeV3PageExtractionToOfferCards(godivaBrokenRaw, {
      leafletId: 'othaim-week24',
      pageNumber: 6,
      sourceOfferIdPrefix: 'othaim_godiva',
      explicitSingleOfferId: 'othaim-week24_006_004',
      retailerName: 'Al-Othaim'
    });
    expect(decoded.schemaValid).toBe(true);
    const norm = normalizeV3OfferCard(decoded.cards[0]);
    expect(norm.normalizedCard.pricing.currency).toBe('SAR');
    expect(norm.conflictCodes).toContain('PRICE_ROLE_AMBIGUOUS');
    expect(norm.conflictCodes).not.toContain('CURRENCY_UNVERIFIED_OR_CONFLICT');
    expect(norm.conflictCodes).toContain('PROMO_QTY_VS_MFG_PACK_CONFLICT');
    expect(decomposeV3OfferCard(decoded.cards[0]).decomposed).toBe(false);
  });

  it('enforces Flex config, crash recovery to outcome_unknown without retry, and hard $0.25 cap in mocked runner', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'wifran-v3-pilot-test-'));
    try {
      const capturedConfigs: any[] = [];
      const capturedContents: any[] = [];

      const mockClient: any = {
        vertexai: true,
        models: {
          generateContent: async (req: any) => {
            capturedConfigs.push(req);
            capturedContents.push(req.contents);
            return {
              candidates: [{ finishReason: 'STOP' }],
              usageMetadata: {
                promptTokenCount: 1000,
                candidatesTokenCount: 400,
                thoughtsTokenCount: 200,
                cachedContentTokenCount: 0,
                totalTokenCount: 1600
              },
              text: JSON.stringify({
                is_loyalty_page: false,
                loyalty_program_name: null,
                validity_start_date: null,
                validity_end_date: null,
                page_currency: 'SAR',
                ignored_banners: [],
                offers: [
                  {
                    offer_number: 1,
                    arabic_title: 'تجربة',
                    english_title: 'Test Crop',
                    brand: 'Test',
                    size_text: '500ml',
                    promo_badge_text: null,
                    assortment_status: 'confirmed_single_sku',
                    visible_variant_count: 1,
                    assortment_evidence: ['printed_leaflet_text'],
                    is_enumerated_list_complete: true,
                    compound_group_id: null,
                    shared_caption_text: null,
                    item_domain: 'grocery',
                    category_slug: 'test',
                    promo_price: 10,
                    original_price: 15,
                    currency: 'SAR',
                    currency_evidence: 'SAR',
                    price_basis: 'each',
                    price_role_confidence: 'high',
                    sale_basis: 'single_unit',
                    is_per_weight_pricing: false,
                    promo_conditions: null,
                    each_size_value: 500,
                    each_size_unit: 'ml',
                    manufacturer_pack_count: 1,
                    retailer_checkout_multibuy_qty: null,
                    factory_bonus_paid_qty: null,
                    factory_bonus_free_qty: null,
                    customer_limit_pcs: null,
                    loyalty_required: false,
                    printed_retailer_sku_codes: [],
                    sub_items: [
                      {
                        sub_item_ref: 's01',
                        brand_en: 'Test',
                        brand_ar: null,
                        product_name_en: 'Test Crop',
                        product_name_ar: 'تجربة',
                        variant_or_flavor: null,
                        each_size_value: 500,
                        each_size_unit: 'ml',
                        manufacturer_pack_count: 1,
                        printed_retailer_sku_code: null
                      }
                    ],
                    non_grocery_specs: null,
                    evidence_conflicts: [],
                    confidence: 0.95,
                    components: {
                      product_graphic_box: [0, 0, 500, 500],
                      promo_price_box: [500, 500, 800, 800],
                      original_price_box: null,
                      unit_and_size_badge_box: null,
                      title_text_box: null
                    }
                  }
                ]
              })
            };
          }
        }
      };

      // 1. Run single slot (crop #1)
      const res1 = await runV3LivePilot({
        repoRoot: REPO_ROOT,
        outputDir: tmpDir,
        onlySlotId: 'pilot_crop_01_baskin_robbins',
        client: mockClient
      });

      expect(res1.executedThisRun).toEqual(['pilot_crop_01_baskin_robbins']);
      expect(res1.manifest.counters.submittedAttemptsCount).toBe(1);
      expect(res1.manifest.counters.completedCount).toBe(1);
      expect(capturedConfigs[0].model).toBe('gemini-3.8-flash');
      expect(capturedConfigs[0].config.thinkingConfig.thinkingLevel).toBe('MEDIUM');
      expect(capturedConfigs[0].config.maxOutputTokens).toBe(16384);
      expect(capturedConfigs[0].config.httpOptions.timeout).toBe(600_000);
      expect(capturedConfigs[0].config.httpOptions.headers).toEqual({
        'X-Vertex-AI-LLM-Request-Type': 'shared',
        'X-Vertex-AI-LLM-Shared-Request-Type': 'flex'
      });
      expect(capturedContents[0][0].parts[0].inlineData.mimeType).toBe('image/webp');
      expect(existsSync(join(tmpDir, 'responses', 'pilot_crop_01_baskin_robbins.raw.json'))).toBe(true);

      // 2. Simulate crash leaving slot 2 as 'in_progress' with attemptCount=1 -> startup recovery marks outcome_unknown without retrying
      const manifestOnDisk = JSON.parse(readFileSync(join(tmpDir, 'manifest.json'), 'utf8'));
      manifestOnDisk.slots[1].status = 'in_progress';
      manifestOnDisk.slots[1].attemptCount = 1;
      manifestOnDisk.slots[1].startedAt = new Date().toISOString();
      writeFileSync(join(tmpDir, 'manifest.json'), JSON.stringify(manifestOnDisk, null, 2), 'utf8');

      const loaded = initializeOrLoadV3PilotManifest({
        repoRoot: REPO_ROOT,
        specPath: join(REPO_ROOT, 'src', 'shared', 'fixtures', 'v3', 'pilot_4pages_12crops_spec.json'),
        groundTruthPath: join(REPO_ROOT, 'src', 'shared', 'fixtures', 'v3', 'pilot_005e_frozen_ground_truth.json'),
        outputDir: tmpDir,
        perRequestTimeoutMs: 600_000,
        maxOutputTokens: 16_384,
        hardSpendCapUsd: 0.25
      });
      expect(loaded.recoveredInterruptedSlots).toEqual(['pilot_crop_02_moussy']);
      expect(loaded.manifest.slots[1].status).toBe('outcome_unknown');
      expect(loaded.manifest.counters.submittedAttemptsCount).toBe(2);

      // 3. Test PDF MIME type on page slot 1 & ZERO retries on error
      const failClient: any = {
        vertexai: true,
        models: {
          generateContent: async (req: any) => {
            capturedConfigs.push(req);
            const err: any = new Error('504 DEADLINE_EXCEEDED');
            err.status = 504;
            throw err;
          }
        }
      };

      const resPage = await runV3LivePilot({
        repoRoot: REPO_ROOT,
        outputDir: tmpDir,
        onlySlotId: 'pilot_page_01_panda_p002',
        client: failClient
      });
      expect(resPage.executedThisRun).toEqual(['pilot_page_01_panda_p002']);
      const lastReq = capturedConfigs[capturedConfigs.length - 1];
      expect(lastReq.contents[0].parts[0].inlineData.mimeType).toBe('application/pdf');
      const pageSlot = resPage.manifest.slots.find((s) => s.slotId === 'pilot_page_01_panda_p002')!;
      expect(pageSlot.status).toBe('failed');
      expect(pageSlot.attemptCount).toBe(1); // Strictly ZERO retries on 504
      expect(pageSlot.errorCode).toBe('HTTP_504');

      // 4. Test hard spend cap pre-dispatch abort
      const budgetAbortRes = await runV3LivePilot({
        repoRoot: REPO_ROOT,
        outputDir: tmpDir,
        hardSpendCapUsd: 0.002,
        client: mockClient
      });
      expect(budgetAbortRes.executedThisRun).toEqual([]);
      expect(budgetAbortRes.manifest.stoppedReason).toContain('HARD_SPEND_CAP_REACHED_PRE_DISPATCH');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('decodes Persil-style response with omitted nullable fields under tolerateOmittedNullableFields and fails closed in decomposition', () => {
    const persilOmittedNullableRaw = {
      is_loyalty_page: false,
      page_currency: 'SAR',
      ignored_banners: [],
      offers: [
        {
          offer_number: 1,
          arabic_title: 'مسحوق غسيل برسيل / جينتو ٢.٥ كيلو',
          english_title: 'Persil / Gento Laundry Powder 2.5 kg',
          size_text: '2.5kg',
          assortment_status: 'visual_multiple_variants',
          visible_variant_count: 3,
          assortment_evidence: ['multiple_bottles_no_distinct_text', 'retailer_sku_series'],
          is_enumerated_list_complete: false,
          item_domain: 'household',
          category_slug: 'laundry_detergent',
          promo_price: 29.95,
          price_basis: 'shared_assortment',
          price_role_confidence: 'high',
          sale_basis: 'single_unit',
          is_per_weight_pricing: false,
          loyalty_required: false,
          printed_retailer_sku_codes: ['458911'],
          sub_items: [],
          evidence_conflicts: ['RETAILER_SKU_WITHOUT_VARIANT_NAMES', 'UNLABELED_SWATCH_OR_BOTTLE_VARIANTS'],
          confidence: 0.91,
          components: {
            product_graphic_box: [40, 40, 620, 700],
            promo_price_box: [650, 650, 900, 950],
            original_price_box: null,
            unit_and_size_badge_box: null,
            title_text_box: [700, 40, 920, 620]
          }
        }
      ]
    };

    const strictRes = decodeV3PageExtractionToOfferCards(persilOmittedNullableRaw, {
      leafletId: 'noori-test',
      pageNumber: 3,
      sourceOfferIdPrefix: 'pilot_crop_07_persil_sku_negative',
      explicitSingleOfferId: 'noori_p003_007',
      tolerateOmittedNullableFields: false
    });
    expect(strictRes.schemaValid).toBe(false);

    const tolerantRes = decodeV3PageExtractionToOfferCards(persilOmittedNullableRaw, {
      leafletId: 'noori-test',
      pageNumber: 3,
      sourceOfferIdPrefix: 'pilot_crop_07_persil_sku_negative',
      explicitSingleOfferId: 'noori_p003_007',
      tolerateOmittedNullableFields: true
    });
    expect(tolerantRes.schemaValid).toBe(true);
    expect(tolerantRes.cards).toHaveLength(1);
    expect(tolerantRes.cards[0].pricing.promo_price).toBe(29.95);
    expect(tolerantRes.cards[0].pricing.currency).toBe('SAR');

    const decomp = decomposeV3OfferCard(tolerantRes.cards[0]);
    expect(decomp.decomposed).toBe(false);
    expect(decomp.children).toHaveLength(0);
    expect(decomp.parent_offer_retention_mode).toBe('unsplit_non_catalog_candidate');
  });
});
