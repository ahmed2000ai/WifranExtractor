/**
 * WIFRAN-EXTRACTOR-IDENTITY-005F (WP4 Stage 2 — V3 Safety, Decomposition & Normalization Hardening)
 *
 * Strictly offline regression suite exercising saved WP5 pilot responses, frozen ground-truth errata,
 * unbypassable quarantine invariants, false-decomposition blocks, egg-tray & checkout-multibuy semantics,
 * conservative loyalty propagation, packaged-CPG domain guards, and Arabic-only English leak stripping.
 *
 * ZERO paid Gemini calls. ZERO production or test database writes.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import {
  V3_EXTRACTION_PROFILE_ID,
  decodeV3PageExtractionToOfferCards,
  getV3LeafletPageGenAiSchema
} from '../../../shared/schemas/leafletPageExtractionV3Schema';
import {
  V3_EXTRACTION_PROFILE_DEFINITION,
  V3_PROMPT_VERSION,
  buildV3PageExtractionSystemPrompt,
  resolveSafeExtractionProfile
} from '../geminiV3PromptBuilder';
import {
  decomposeV3OfferCard
} from '../offerV3DecompositionEngine';
import { adaptV3DecompositionToOfflineMatching } from '../../db/v3MatchingInputAdapter';
import {
  assessOfferPublicationOutcome,
  assessOfferQuantitySemanticsConflict,
  enforceV3PublicationQuarantineInvariant
} from '../../../shared/utils/nonCatalogPublicationPolicy';
import { evaluateIdentitySufficiency } from '../../db/productIdentityPolicy';
import type { UnifiedBatchOffer } from '../../../shared/types/batchExtraction';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');

function loadRawPilotArchive(slotFile: string): any {
  return JSON.parse(
    readFileSync(join(REPO_ROOT, 'Extracts', 'pilot_v3_005e', 'responses', slotFile), 'utf8')
  );
}

function decodeSlotWithActiveDates(slotFile: string, mode: 'crop' | 'page', sourceOfferId?: string) {
  const archive = loadRawPilotArchive(slotFile);
  const slotId = slotFile.replace('.raw.json', '');
  const decoded = decodeV3PageExtractionToOfferCards(archive.parsedResponse, {
    leafletId: `${slotId}_leaflet`,
    pageNumber: 1,
    sourceOfferIdPrefix: slotId,
    explicitSingleOfferId: mode === 'crop' ? sourceOfferId || slotId : undefined,
    retailerId: `retailer-${slotId}`,
    retailerName: 'Pilot Retailer',
    locationScope: 'national',
    tolerateOmittedNullableFields: true
  });
  return decoded.cards.map((card) => {
    const withDates = {
      ...card,
      source_card: {
        ...card.source_card,
        offer_start_date: card.source_card.offer_start_date || '2026-11-10',
        offer_end_date: card.source_card.offer_end_date || '2026-11-20'
      }
    };
    const decomp = decomposeV3OfferCard(withDates);
    const adapter = adaptV3DecompositionToOfflineMatching(decomp, {
      storageEnvironment: 'DEVELOPMENT_TEST'
    });
    return { card: withDates, decomp, adapter };
  });
}

describe('WIFRAN-EXTRACTOR-IDENTITY-005F (WP4 Stage 2 Hardening)', () => {
  describe('WP5F-A: Unbypassable Publication Quarantine Invariant', () => {
    it('blocks publication even under operator approved override when V3 quarantine or conflict exists', () => {
      const wafir = decodeSlotWithActiveDates(
        'pilot_crop_10_wafir_conflict_negative.raw.json',
        'crop',
        'noori-wafir-conflict'
      )[0];
      expect(wafir.decomp.parent_offer_retention_mode).toBe('quarantined_do_not_publish');

      const approvedAttempt = adaptV3DecompositionToOfflineMatching(wafir.decomp, {
        storageEnvironment: 'DEVELOPMENT_TEST',
        nonCatalogApproval: {
          batchOfferKey: 'k',
          decision: 'approved',
          category: 'valid_grocery_unresolved_sku',
          updatedAt: '2026-11-10T00:00:00Z'
        }
      });
      expect(approvedAttempt.matchableChildren).toHaveLength(0);
      expect(approvedAttempt.parentPublicationAssessment.outcome).toBe('quarantined');
      expect(approvedAttempt.parentPublicationAssessment.isEligibleForNonCatalogPublication).toBe(false);
      expect(approvedAttempt.parentPublicationAssessment.isSafeForNonCatalogPublication).toBe(false);
      expect(approvedAttempt.parentPublicationAssessment.comparisonDisabled).toBe(true);

      // Direct policy call on parentOfferForPolicyCheck must ALSO remain quarantined under approved override
      const directAttempt = assessOfferPublicationOutcome({
        offer: approvedAttempt.parentOfferForPolicyCheck,
        approval: {
          batchOfferKey: approvedAttempt.parentOfferForPolicyCheck.batchOfferKey,
          decision: 'approved',
          category: 'valid_grocery_unresolved_sku',
          updatedAt: '2026-11-10T00:00:00Z'
        }
      });
      expect(directAttempt.outcome).toBe('quarantined');
      expect(directAttempt.isEligibleForNonCatalogPublication).toBe(false);
      expect(directAttempt.isSafeForNonCatalogPublication).toBe(false);
    });

    it('assigns internal SAR on missing/null V3 currency without conflict while quarantine-locking PRICE_ROLE_AMBIGUOUS', () => {
      const base = decodeSlotWithActiveDates(
        'pilot_crop_02_moussy.raw.json',
        'crop',
        'moussy-null-currency'
      )[0].card;

      const nullCurrencyCard = {
        ...base,
        pricing: { ...base.pricing, currency: null }
      };
      const decompNullCur = decomposeV3OfferCard(nullCurrencyCard);
      expect(decompNullCur.normalized_card.pricing.currency).toBe('SAR');
      expect(decompNullCur.conflict_codes).not.toContain('CURRENCY_UNVERIFIED_OR_CONFLICT');

      // Synthetic PRICE_ROLE_AMBIGUOUS card
      const priceAmbiguousCard = {
        ...base,
        pricing: {
          ...base.pricing,
          promo_price: 25,
          original_price: 15,
          price_role_confidence: 'conflicting' as const
        }
      };
      const decompAmbig = decomposeV3OfferCard(priceAmbiguousCard);
      expect(decompAmbig.conflict_codes).toContain('PRICE_ROLE_AMBIGUOUS');
      expect(decompAmbig.parent_offer_retention_mode).toBe('quarantined_do_not_publish');

      // Direct barrier helper forces quarantine regardless of stale positive flags
      const coerced = enforceV3PublicationQuarantineInvariant(
        {
          batchOfferKey: 'forced',
          outcome: 'approved_non_catalog',
          isEligibleForNonCatalogPublication: true,
          isSafeForNonCatalogPublication: true,
          category: 'valid_grocery_unresolved_sku',
          itemDomain: 'grocery',
          catalogMatchStatus: 'unresolved',
          exactIdentityStatus: 'unresolved',
          assortmentStatus: 'single_sku',
          comparisonDisabled: false,
          unresolvedReason: null,
          quarantineReasons: [],
          correctionReasons: [],
          perUnitPricing: { unitPrice: null, unitPriceUnit: null, basisEstablished: false }
        },
        {
          parentOfferRetentionMode: 'quarantined_do_not_publish',
          conflictCodes: ['PRICE_ROLE_AMBIGUOUS'],
          currency: null
        }
      );
      expect(coerced.outcome).toBe('quarantined');
      expect(coerced.isEligibleForNonCatalogPublication).toBe(false);
      expect(coerced.quarantineReasons).toContain('PRICE_ROLE_AMBIGUOUS');
      expect(coerced.quarantineReasons).not.toContain('UNSUPPORTED_OR_UNVERIFIED_CURRENCY');
    });

    it('guarantees negative pilot crops (crop_07, crop_10, crop_11, crop_12) stay quarantined', () => {
      for (const file of [
        'pilot_crop_07_persil_sku_negative.raw.json',
        'pilot_crop_10_wafir_conflict_negative.raw.json',
        'pilot_crop_11_fakieh_multibuy_en_ar_conflict.raw.json',
        'pilot_crop_12_perinna_non_grocery_negative.raw.json'
      ]) {
        const res = decodeSlotWithActiveDates(file, 'crop')[0];
        expect(res.adapter.matchableChildren, file).toHaveLength(0);
        expect(res.adapter.parentPublicationAssessment.outcome, file).toBe('quarantined');
        if (file !== 'pilot_crop_07_persil_sku_negative.raw.json') {
          expect(res.adapter.parentPublicationAssessment.isEligibleForNonCatalogPublication, file).toBe(false);
        }
      }
    });
  });

  describe('WP5F-B: False Product Decomposition Prevention & Positive Preservation', () => {
    it('blocks generic inferred variants on crop_06 Tide and BinDawood Tide 011', () => {
      const cropTide = decodeSlotWithActiveDates(
        'pilot_crop_06_tide_partial_negative.raw.json',
        'crop'
      )[0];
      expect(cropTide.decomp.decomposed).toBe(false);
      expect(cropTide.adapter.matchableChildren).toHaveLength(0);

      const bndwOffers = decodeSlotWithActiveDates('pilot_page_02_bndw_p004.raw.json', 'page');
      const bndwTide = bndwOffers.find((o) =>
        /tide/i.test(o.card.source_card.raw_text.title_en || '')
      )!;
      expect(bndwTide.decomp.decomposed).toBe(false);
      expect(bndwTide.decomp.normalized_card.assortment.is_enumerated_list_complete).toBe(false);
      expect(bndwTide.decomp.conflict_codes).toContain('UNLABELED_SWATCH_OR_BOTTLE_VARIANTS');
      expect(bndwTide.adapter.matchableChildren).toHaveLength(0);
    });

    it('rejects is_enumerated_list_complete on Asstd. titles without named variants (AlWafa L\'oreal/Garnier)', () => {
      const alwafaOffers = decodeSlotWithActiveDates('pilot_page_04_alwafa_p001.raw.json', 'page');
      const loreal = alwafaOffers.find((o) =>
        /l'oreal|garnier/i.test(o.card.source_card.raw_text.title_en || '')
      )!;
      expect(loreal.decomp.normalized_card.assortment.is_enumerated_list_complete).toBe(false);
      expect(loreal.decomp.conflict_codes).toContain('INCOMPLETE_VISIBLE_ASSORTMENT');
      expect(loreal.decomp.decomposed).toBe(false);
      expect(loreal.adapter.matchableChildren).toHaveLength(0);
      expect(loreal.adapter.parentPublicationAssessment.isEligibleForNonCatalogPublication).toBe(true);
    });

    it('blocks caption-vs-image subset mismatch on Panda Pepsi/7Up/Mirinda/Citrus/Shani', () => {
      const pandaOffers = decodeSlotWithActiveDates('pilot_page_01_panda_p002.raw.json', 'page');
      const pepsiCard = pandaOffers.find((o) =>
        /pepsi/i.test(o.card.source_card.raw_text.title_en || '')
      )!;
      expect(pepsiCard.decomp.normalized_card.assortment.is_enumerated_list_complete).toBe(false);
      expect(pepsiCard.decomp.conflict_codes).toContain('INCOMPLETE_VISIBLE_ASSORTMENT');
      expect(pepsiCard.decomp.decomposed).toBe(false);
      expect(pepsiCard.adapter.matchableChildren).toHaveLength(0);
      expect(pepsiCard.adapter.parentPublicationAssessment.isEligibleForNonCatalogPublication).toBe(true);
    });

    it('preserves all legitimate multi-SKU decompositions across saved crops & pages', () => {
      const pandaOffers = decodeSlotWithActiveDates('pilot_page_01_panda_p002.raw.json', 'page');
      const baskinPanda = pandaOffers.find((o) => /baskin/i.test(o.card.source_card.raw_text.title_en || ''))!;
      const searaPanda = pandaOffers.find((o) => /mushab|burger/i.test(o.card.source_card.raw_text.title_en || ''))!;
      expect(baskinPanda.decomp.decomposed).toBe(true);
      expect(baskinPanda.adapter.matchableChildren).toHaveLength(2);
      expect(searaPanda.decomp.decomposed).toBe(true);
      expect(searaPanda.adapter.matchableChildren).toHaveLength(2);

      const bndwOffers = decodeSlotWithActiveDates('pilot_page_02_bndw_p004.raw.json', 'page');
      const abuKass = bndwOffers.find((o) => /abu kass/i.test(o.card.source_card.raw_text.title_en || ''))!;
      const rana = bndwOffers.find((o) => /rana/i.test(o.card.source_card.raw_text.title_en || ''))!;
      expect(abuKass.decomp.decomposed).toBe(true);
      expect(abuKass.adapter.matchableChildren).toHaveLength(2);
      expect(rana.decomp.decomposed).toBe(true);
      expect(rana.adapter.matchableChildren).toHaveLength(3);

      const nooriOffers = decodeSlotWithActiveDates('pilot_page_03_noori_p001.raw.json', 'page');
      const fakiehNoori = nooriOffers.find((o) => /فقيه/.test(o.card.source_card.raw_text.title_ar || ''))!;
      expect(fakiehNoori.decomp.decomposed).toBe(true);
      expect(fakiehNoori.adapter.matchableChildren).toHaveLength(2);

      const alwafaOffers = decodeSlotWithActiveDates('pilot_page_04_alwafa_p001.raw.json', 'page');
      const taj = alwafaOffers.find((o) => /taj/i.test(o.card.source_card.raw_text.title_en || ''))!;
      const indomie = alwafaOffers.find((o) => /indomie/i.test(o.card.source_card.raw_text.title_en || ''))!;
      expect(taj.decomp.decomposed).toBe(true);
      expect(taj.adapter.matchableChildren).toHaveLength(2);
      expect(indomie.decomp.decomposed).toBe(true);
      expect(indomie.adapter.matchableChildren).toHaveLength(4);

      for (const cropFile of [
        'pilot_crop_02_moussy.raw.json',
        'pilot_crop_03_al_arabi_shams.raw.json',
        'pilot_crop_04_al_khair_plyms.raw.json'
      ]) {
        const c = decodeSlotWithActiveDates(cropFile, 'crop')[0];
        expect(c.decomp.decomposed, cropFile).toBe(true);
        expect(c.adapter.matchableChildren.length, cropFile).toBe(2);
      }
    });
  });

  describe('WP5F-C: Suppress False RETAILER_SKU_WITHOUT_VARIANT_NAMES on Single Confirmed SKUs', () => {
    it('eliminates false SKU conflicts on BinDawood Offers 004, 006, 007, 008, 009, 010 while preserving genuine 011 & 012', () => {
      const bndwOffers = decodeSlotWithActiveDates('pilot_page_02_bndw_p004.raw.json', 'page');
      for (const offerNum of ['004', '006', '007', '008', '009', '010']) {
        const cardRes = bndwOffers.find((o) => o.card.source_card.source_offer_id.endsWith(`_${offerNum}`))!;
        expect(cardRes.decomp.conflict_codes, `BNDW ${offerNum}`).not.toContain('RETAILER_SKU_WITHOUT_VARIANT_NAMES');
        expect(cardRes.adapter.parentPublicationAssessment.isEligibleForNonCatalogPublication, `BNDW ${offerNum}`).toBe(true);
      }
      for (const negNum of ['011', '012']) {
        const negRes = bndwOffers.find((o) => o.card.source_card.source_offer_id.endsWith(`_${negNum}`))!;
        expect(negRes.decomp.conflict_codes, `BNDW ${negNum}`).toContain('RETAILER_SKU_WITHOUT_VARIANT_NAMES');
      }
    });
  });

  describe('WP5F-D: Egg Tray Packaging, Compound Multibuy & Adapter Mapping', () => {
    it('normalizes Noori R1C3 and AlWafa R2C5 30-egg trays to pack=1, piece_or_tray without false conflict', () => {
      const nooriOffers = decodeSlotWithActiveDates('pilot_page_03_noori_p001.raw.json', 'page');
      const nooriEgg = nooriOffers.find((o) => /بيض/.test(o.card.source_card.raw_text.title_ar || ''))!;
      expect(nooriEgg.decomp.normalized_card.quantity_and_promo.each_size_value).toBe(30);
      expect(nooriEgg.decomp.normalized_card.quantity_and_promo.each_size_unit).toBe('pcs');
      expect(nooriEgg.decomp.normalized_card.quantity_and_promo.manufacturer_pack_count).toBe(1);
      expect(nooriEgg.decomp.normalized_card.quantity_and_promo.sale_basis).toBe('piece_or_tray');
      expect(nooriEgg.decomp.conflict_codes).toEqual([]);
      expect(nooriEgg.adapter.parentPublicationAssessment.isEligibleForNonCatalogPublication).toBe(true);

      const alwafaOffers = decodeSlotWithActiveDates('pilot_page_04_alwafa_p001.raw.json', 'page');
      const alwafaEgg = alwafaOffers.find((o) => /egg/i.test(o.card.source_card.raw_text.title_en || ''))!;
      expect(alwafaEgg.decomp.normalized_card.quantity_and_promo.each_size_value).toBe(30);
      expect(alwafaEgg.decomp.normalized_card.quantity_and_promo.each_size_unit).toBe('pcs');
      expect(alwafaEgg.decomp.normalized_card.quantity_and_promo.manufacturer_pack_count).toBe(1);
      expect(alwafaEgg.decomp.normalized_card.quantity_and_promo.sale_basis).toBe('piece_or_tray');
      expect(alwafaEgg.decomp.conflict_codes).toEqual([]);
    });

    it('sets checkout_multibuy on crop_04 Al Khair/Plyms and compound Seara 3 Pcs x 900g without losing match eligibility', () => {
      const crop04 = decodeSlotWithActiveDates('pilot_crop_04_al_khair_plyms.raw.json', 'crop')[0];
      expect(crop04.adapter.matchableChildren).toHaveLength(2);
      for (const child of crop04.adapter.matchableChildren) {
        expect(child.offerInput.quantity_semantics).toBe('checkout_multibuy');
        expect(child.offerInput.inner_pack_count).toBe(1);
        expect(child.offerInput.promo_condition_quantity).toBe(2);
        const suff = evaluateIdentitySufficiency(child.normalizedIdentity, child.offerInput, null);
        expect(suff.isSufficient).toBe(true);
      }

      // Compound card with per-tier sub_items[].retailer_checkout_multibuy_qty (Seara 3 Pcs x 900g vs 1 Pcs 1100g)
      const syntheticSeara = {
        is_loyalty_page: false,
        loyalty_program_name: null,
        validity_start_date: '2026-11-10',
        validity_end_date: '2026-11-20',
        page_currency: 'SAR',
        ignored_banners: [],
        offers: [
          {
            offer_number: 1,
            arabic_title: 'سيرا دجاج مجمد',
            english_title: 'Seara Frozen Chicken 3 Pcs x 900g / 1100g',
            brand: 'Seara',
            size_text: '900g / 1100g',
            promo_badge_text: null,
            assortment_status: 'explicit_assortment',
            visible_variant_count: 2,
            assortment_evidence: ['slash_title'],
            is_enumerated_list_complete: true,
            compound_group_id: 'cg_seara',
            shared_caption_text: 'Seara Frozen Chicken',
            item_domain: 'grocery',
            category_slug: 'frozen-poultry',
            promo_price: 49.95,
            original_price: 68.0,
            currency: 'SAR',
            currency_evidence: 'SAR',
            price_basis: 'each',
            price_role_confidence: 'high',
            sale_basis: 'multi_buy_checkout',
            is_per_weight_pricing: false,
            promo_conditions: null,
            each_size_value: null,
            each_size_unit: null,
            manufacturer_pack_count: null,
            retailer_checkout_multibuy_qty: null,
            factory_bonus_paid_qty: null,
            factory_bonus_free_qty: null,
            customer_limit_pcs: null,
            loyalty_required: false,
            printed_retailer_sku_codes: [],
            sub_items: [
              {
                sub_item_ref: 's01',
                brand_en: 'Seara',
                brand_ar: 'سيرا',
                product_name_en: 'Seara Frozen Chicken',
                product_name_ar: 'دجاج سيرا مجمد',
                variant_or_flavor: '900g',
                each_size_value: 900,
                each_size_unit: 'g',
                manufacturer_pack_count: 1,
                retailer_checkout_multibuy_qty: 3,
                printed_retailer_sku_code: null,
                independent_promo_price: 49.95,
                independent_original_price: 68.0
              },
              {
                sub_item_ref: 's02',
                brand_en: 'Seara',
                brand_ar: 'سيرا',
                product_name_en: 'Seara Frozen Chicken',
                product_name_ar: 'دجاج سيرا مجمد',
                variant_or_flavor: '1100g',
                each_size_value: 1100,
                each_size_unit: 'g',
                manufacturer_pack_count: 1,
                retailer_checkout_multibuy_qty: null,
                printed_retailer_sku_code: null,
                independent_promo_price: 19.95,
                independent_original_price: 26.0
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
      };
      const decoded = decodeV3PageExtractionToOfferCards(syntheticSeara, {
        leafletId: 'seara-leaflet',
        pageNumber: 1,
        sourceOfferIdPrefix: 'seara',
        retailerId: 'panda',
        locationScope: 'national',
        tolerateOmittedNullableFields: false
      });
      expect(decoded.schemaValid).toBe(true);
      const decomp = decomposeV3OfferCard(decoded.cards[0]);
      expect(decomp.decomposed).toBe(true);
      expect(decomp.children[0].retailer_checkout_multibuy_qty).toBe(3);
      expect(decomp.children[1].retailer_checkout_multibuy_qty).toBeNull();
      const adapter = adaptV3DecompositionToOfflineMatching(decomp);
      expect(adapter.matchableChildren).toHaveLength(2);
      expect(adapter.matchableChildren[0].offerInput.quantity_semantics).toBe('checkout_multibuy');
      expect(adapter.matchableChildren[0].offerInput.promo_condition_quantity).toBe(3);
    });
  });

  describe('WP5F-E: Stage 2 Schema & Prompt Hardening (V3 Disabled by Default)', () => {
    it('enforces required nullable keys in GenAI responseSchema while preserving nullable=true and default rollback', () => {
      expect(V3_EXTRACTION_PROFILE_DEFINITION.enabledByDefault).toBe(false);
      const defaultRes = resolveSafeExtractionProfile({ requestedProfile: V3_EXTRACTION_PROFILE_ID });
      expect(defaultRes.v3Activated).toBe(false);
      expect(defaultRes.activeProfileId).toBe('legacy');

      const genAi = getV3LeafletPageGenAiSchema() as any;
      expect(genAi.required).toEqual([
        'validity_start_date',
        'validity_end_date',
        'ignored_banners',
        'offers'
      ]);
      expect(genAi.properties.is_loyalty_page).toBeUndefined();
      expect(genAi.properties.loyalty_program_name).toBeUndefined();
      expect(genAi.properties.page_currency).toBeUndefined();
      expect(genAi.properties.offers.items.required).toContain('original_price');
      expect(genAi.properties.offers.items.required).toContain('manufacturer_pack_count');
      expect(genAi.properties.offers.items.required).toContain('non_grocery_specs');
      expect(genAi.properties.offers.items.properties.sub_items.items.properties.retailer_checkout_multibuy_qty).toEqual({
        type: 'integer',
        nullable: true
      });
      expect(genAi.properties.offers.items.properties.sub_items.items.required).toContain(
        'retailer_checkout_multibuy_qty'
      );

      expect(V3_PROMPT_VERSION).toBe('extraction_v3_stage2_r1');
      const prompt = buildV3PageExtractionSystemPrompt();
      expect(prompt).toContain('EGG TRAY RULE');
      expect(prompt).toContain('NEVER fabricate or infer unprinted variant names');
    });

    it('rejects Persil omitted nulls strictly when tolerateOmittedNullableFields=false and decodes cleanly when true without fabricating fields', () => {
      const persilRaw = loadRawPilotArchive('pilot_crop_07_persil_sku_negative.raw.json').parsedResponse;
      const strictRes = decodeV3PageExtractionToOfferCards(persilRaw, {
        leafletId: 'bndw',
        pageNumber: 4,
        sourceOfferIdPrefix: 'persil',
        tolerateOmittedNullableFields: false
      });
      expect(strictRes.schemaValid).toBe(false);

      const tolerantRes = decodeV3PageExtractionToOfferCards(persilRaw, {
        leafletId: 'bndw',
        pageNumber: 4,
        sourceOfferIdPrefix: 'persil',
        tolerateOmittedNullableFields: true
      });
      expect(tolerantRes.schemaValid).toBe(true);
      expect(tolerantRes.cards[0].pricing.original_price).toBeNull();
    });
  });

  describe('WP5F-F: Conservative Loyalty, Arabic-Only Fidelity, Packaged CPG Domain & EN/AR Checks', () => {
    it('propagates page loyalty ONLY from explicit printed markers and never fabricates on omitted saved AlWafa', () => {
      // Saved AlWafa pilot raw JSON omitted loyalty banner -> honest 0/13 (no fabrication)
      const savedAlwafa = decodeSlotWithActiveDates('pilot_page_04_alwafa_p001.raw.json', 'page');
      expect(savedAlwafa.filter((x) => x.card.quantity_and_promo.loyalty_required)).toHaveLength(0);

      // When explicit page-level banner exists in ignored_banners or is_loyalty_page=true -> propagates cleanly
      const archive = loadRawPilotArchive('pilot_page_04_alwafa_p001.raw.json');
      const withPrintedBanner = {
        ...archive.parsedResponse,
        is_loyalty_page: false,
        loyalty_program_name: null,
        ignored_banners: ['الوفاء Rewards Members Only']
      };
      const decoded = decodeV3PageExtractionToOfferCards(withPrintedBanner, {
        leafletId: 'alwafa',
        pageNumber: 1,
        sourceOfferIdPrefix: 'alwafa',
        tolerateOmittedNullableFields: true
      });
      // Promotional conditions / loyalty flags were removed from MVP extraction
      expect(decoded.cards.every((c) => c.quantity_and_promo.loyalty_required === false)).toBe(true);
      expect(decoded.cards[0].quantity_and_promo.loyalty_program_name).toBeNull();
    });

    it('strips hallucinated English sub-item translation on Arabic-only Noori Fazco card', () => {
      const nooriOffers = decodeSlotWithActiveDates('pilot_page_03_noori_p001.raw.json', 'page');
      const fazco = nooriOffers.find((o) => /فاضكو/.test(o.card.source_card.raw_text.title_ar || ''))!;
      expect(fazco.card.source_card.raw_text.title_en).toBeNull();
      expect(fazco.card.sub_items[0].product_name_en).toBeNull();
      expect(fazco.decomp.normalized_card.sub_items[0].product_name_en).toBeNull();
    });

    it('classifies packaged CPG items accurately instead of loose_produce / meat_seafood_by_weight while preserving real produce/meat', () => {
      const baseOffer = (titleEn: string, titleAr: string, opts?: Partial<UnifiedBatchOffer>): UnifiedBatchOffer =>
        ({
          batchOfferKey: `cpg_${titleEn}`,
          batchId: 'b',
          leafletId: 'l',
          sourceFileName: 'l.pdf',
          sourcePdfPath: '',
          sourcePage: 1,
          sourceOfferId: '001',
          supermarketId: 'sm1',
          supermarketName: 'Panda',
          locationScope: 'national',
          locationLabel: null,
          cityId: null,
          regionId: null,
          offerStartDate: '2026-11-10',
          offerEndDate: '2026-11-20',
          titleAr,
          titleEn,
          brand: 'Brand',
          brandAr: null,
          brandEn: 'Brand',
          promoPrice: 15.95,
          originalPrice: 22,
          promoNotes: null,
          sizeOrWeight: '900g',
          each_size_value: 900,
          each_size_unit: 'g',
          inner_pack_count: 1,
          sale_unit_type: 'each',
          total_content_value: 900,
          total_content_unit: 'g',
          free_units_text: null,
          customer_limit: null,
          productThumbCropPath: null,
          offerCardCropPath: null,
          status: 'extracted',
          confidence: 'high',
          warnings: [],
          blockingErrors: [],
          ...opts
        } as UnifiedBatchOffer);

      for (const [en, ar, extra] of [
        ['Al Arabi Vegetable Oil 2 x 1.5Ltr', 'زيت نباتي العربي ٢ × ١.٥ لتر', { inner_pack_count: 2, each_size_value: 1.5, each_size_unit: 'l' }],
        ['Abu Kass Amber Basmati Rice 10Kg', 'أرز أبو كاس عنبر بسمتي ١٠ كجم', { each_size_value: 10, each_size_unit: 'kg' }],
        ['President Mozzarella Cheese 900g', 'جبنة موزاريلا بريزيدن ٩٠٠ جم', {}],
        ['Mirinda Orange 12 x 150ml', 'ميرندا برتقال ١٢ × ١٥٠ مل', { inner_pack_count: 12, each_size_value: 150, each_size_unit: 'ml' }],
        ['Seara Frozen Chicken 10 x 900g', 'دجاج مجمد سيارا ١٠ × ٩٠٠ جم', { inner_pack_count: 10 }],
        ['Fakieh Frozen Chicken 600Gm', 'دجاج مجمد فقيه ٦٠٠ جم', { each_size_value: 600 }],
        ['Indomie Noodles SP Chicken 10x75Gm', 'نودلز إندومي دجاج خاص ١٠ × ٧٥ جم', { inner_pack_count: 10, each_size_value: 75 }]
      ] as Array<[string, string, Partial<UnifiedBatchOffer>]>) {
        const res = assessOfferPublicationOutcome({ offer: baseOffer(en, ar, extra) });
        expect(res.category, en).toBe('valid_grocery_unresolved_sku');
      }

      // Real loose produce & weighed meat remain classified properly
      const mango = assessOfferPublicationOutcome({
        offer: baseOffer('Mango Keitt Per Kg', 'مانجو كيت للكيلو', {
          brand: null,
          brandEn: null,
          sale_unit_type: 'kg',
          each_size_value: 1,
          each_size_unit: 'kg',
          inner_pack_count: null
        })
      });
      expect(mango.category).toBe('loose_produce');

      const kingFish = assessOfferPublicationOutcome({
        offer: baseOffer('King Fish Small Per Kg', 'سمك كنعد صغير للكيلو', {
          brand: null,
          brandEn: null,
          sale_unit_type: 'kg',
          each_size_value: 1,
          each_size_unit: 'kg',
          inner_pack_count: null
        })
      });
      expect(kingFish.category).toBe('meat_seafood_by_weight');
    });

    it('detects EN/AR multi-measurement and same-(count, val) unit-dimension conflicts (AlWafa Oska & 450ml vs 450g)', () => {
      const oska = assessOfferQuantitySemanticsConflict({
        titleEn: 'Oska Drinking / Arwa Mineral Water 6x1.5Ltr',
        titleAr: 'مياه شرب أوسكا / أروى ٦ × ١.٥ مل'
      });
      expect(oska.hasConflict).toBe(true);
      expect(oska.conflictKind).toBe('unit_or_measure_conflict');

      const massVsVol = assessOfferQuantitySemanticsConflict({
        titleEn: 'Brand Sauce 2x450ml / 900g',
        titleAr: 'صلصة ٢ × ٤٥٠ جم / ٩٠٠ مل'
      });
      expect(massVsVol.hasConflict).toBe(true);
      expect(massVsVol.conflictKind).toBe('unit_or_measure_conflict');
    });
  });

  describe('WP5F-G: Frozen Ground Truth Integrity, Errata Audit & Full 16-Slot Replay', () => {
    it('flags Panda p2 atomic header erratum (13 vs 12) without mutating frozen ground-truth JSON hash and replays all 16 slots safely', () => {
      const gtPath = join(REPO_ROOT, 'src', 'shared', 'fixtures', 'v3', 'pilot_005e_frozen_ground_truth.json');
      const gtSha = createHash('sha256').update(readFileSync(gtPath)).digest('hex');
      expect(gtSha).toBe('347e6617acfbe94746e1fe27124472dd191dee402d21645143f34d56f80b3f02');

      const gt = JSON.parse(readFileSync(gtPath, 'utf8'));
      const pandaGt = gt.pages.find((p: any) => p.pilot_page_id === 'pilot_page_01_panda_p002');
      expect(pandaGt.expected_atomic_offer_count).toBe(13);
      expect(pandaGt.visual_offers).toHaveLength(12);

      // Replay all 16 saved archives from manifest.json
      const manifest = JSON.parse(
        readFileSync(join(REPO_ROOT, 'Extracts', 'pilot_v3_005e', 'manifest.json'), 'utf8')
      );
      expect(manifest.slots).toHaveLength(16);

      let quarantinedCount = 0;
      let unsafeViolations = 0;
      for (const slot of manifest.slots) {
        const archivePath = slot.rawArchivePath.startsWith('Extracts/')
          ? join(REPO_ROOT, slot.rawArchivePath)
          : join(REPO_ROOT, 'Extracts', 'pilot_v3_005e', slot.rawArchivePath);
        const raw = JSON.parse(readFileSync(archivePath, 'utf8'));
        const decoded = decodeV3PageExtractionToOfferCards(raw.parsedResponse, {
          leafletId: slot.leafletId || slot.slotId,
          pageNumber: slot.pageNumber || 1,
          sourceOfferIdPrefix: slot.slotId,
          explicitSingleOfferId: slot.kind === 'crop' ? slot.sourceOfferId || slot.slotId : undefined,
          retailerId: `pilot-${String(slot.retailer || 'r').toLowerCase()}`,
          retailerName: slot.retailer,
          locationScope: 'national',
          tolerateOmittedNullableFields: true
        });
        expect(decoded.schemaValid, slot.slotId).toBe(true);
        for (const c of decoded.cards) {
          const decomp = decomposeV3OfferCard({
            ...c,
            source_card: {
              ...c.source_card,
              offer_start_date: '2026-11-10',
              offer_end_date: '2026-11-20'
            }
          });
          const adapted = adaptV3DecompositionToOfflineMatching(decomp);
          if (decomp.parent_offer_retention_mode === 'quarantined_do_not_publish') {
            quarantinedCount++;
            if (
              adapted.parentPublicationAssessment.isEligibleForNonCatalogPublication ||
              adapted.parentPublicationAssessment.outcome !== 'quarantined' ||
              adapted.matchableChildren.length > 0
            ) {
              unsafeViolations++;
            }
          }
        }
      }
      expect(quarantinedCount).toBeGreaterThanOrEqual(4);
      expect(unsafeViolations).toBe(0);
    });
  });
});
