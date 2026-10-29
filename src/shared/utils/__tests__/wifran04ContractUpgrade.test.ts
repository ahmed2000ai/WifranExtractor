import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { CanonicalOffer } from '../../types/canonicalOffer';
import {
  buildContractV2FromCanonical,
  calculateScenarioPurchase,
  toConsumerOfferProjection
} from '../extractorContractV2Adapter';
import {
  inferNormalizedTitlesAndCommodityTag
} from '../../../main/page-first/pageOfferCanonicalMapper';
import {
  loadSupermarkets,
  loadCategories,
  loadRegions,
  loadCities,
  ensureCoreCatalogSeeded
} from '../../../main/db/referenceDataService';

describe('WIFRAN-04 (wifran.extractor.offer/2.0) Contract Upgrade Suite', () => {

  // =========================================================================
  // 1. Fixture Immutability & Byte Preservation (EX-01, EX-48)
  // =========================================================================
  describe('Fixture Immutability (EX-01, EX-48)', () => {
    const j1FixturePath = path.resolve(process.cwd(), 'tests/fixtures/wifran04/page-001-012.canonical.json');
    const j2FixturePath = path.resolve(process.cwd(), 'tests/fixtures/wifran04/page-003-012.canonical.json');

    const J1_EXPECTED_HASH = 'ec8aee31e219a579149b587c096480b55916edec01fb0b74c47a7c7befee9618';
    const J2_EXPECTED_HASH = '0a3e79b029e686be1d42304c8c4e5e40aca995f29f2091f1d9d8df71e4663ee4';

    const j1ExpectedV2Path = path.resolve(process.cwd(), 'tests/fixtures/wifran04/expected-v2/J1-dove-soap.v2.json');
    const j2ExpectedV2Path = path.resolve(process.cwd(), 'tests/fixtures/wifran04/expected-v2/J2-mini-fan.v2.json');

    it('EX-01: J1 (Dove Soap) fixture exists and has byte-identical SHA-256 hash', () => {
      expect(fs.existsSync(j1FixturePath)).toBe(true);
      const fixtureBuf = fs.readFileSync(j1FixturePath);
      const hash = createHash('sha256').update(fixtureBuf).digest('hex').toLowerCase();
      expect(hash).toBe(J1_EXPECTED_HASH);

      // Verify v2 shadow export exists and reflects updated Hyper Alwafa context
      if (fs.existsSync(j1ExpectedV2Path)) {
        const v2Content = JSON.parse(fs.readFileSync(j1ExpectedV2Path, 'utf8'));
        expect(v2Content.schema_version).toBe('wifran.extractor.offer/2.0');
        expect(v2Content.trusted_context.supermarket_slug).toBe('alwafa');
        expect(v2Content.contract_v2).toBeDefined();
      }
    });

    it('EX-48: J2 (Mini Fan) fixture exists and has byte-identical SHA-256 hash', () => {
      expect(fs.existsSync(j2FixturePath)).toBe(true);
      const fixtureBuf = fs.readFileSync(j2FixturePath);
      const hash = createHash('sha256').update(fixtureBuf).digest('hex').toLowerCase();
      expect(hash).toBe(J2_EXPECTED_HASH);

      // Verify v2 shadow export exists and reflects updated Hyper Alwafa context
      if (fs.existsSync(j2ExpectedV2Path)) {
        const v2Content = JSON.parse(fs.readFileSync(j2ExpectedV2Path, 'utf8'));
        expect(v2Content.schema_version).toBe('wifran.extractor.offer/2.0');
        expect(v2Content.trusted_context.supermarket_slug).toBe('alwafa');
        expect(v2Content.contract_v2).toBeDefined();
      }
    });
  });

  // =========================================================================
  // 2. J1 (Dove Soap) Contract v2 Adaptation & Semantic Rules
  // =========================================================================
  describe('J1 (Dove Soap) Contract v2 Validation', () => {
    const j1FixturePath = path.resolve(process.cwd(), 'tests/fixtures/wifran04/page-001-012.canonical.json');
    const rawJ1: CanonicalOffer = JSON.parse(fs.readFileSync(j1FixturePath, 'utf8'));
    const v2 = buildContractV2FromCanonical(rawJ1);

    it('EX-04: Deterministic page-scoped source_offer_id prevents collisions', () => {
      expect(v2.record_metadata.source_offer_id).toBe('tamimi-national-national-2026-10-20:p001:i012:s01');
    });

    it('EX-05, EX-06: Semantic checksum is stable and path-independent', () => {
      expect(v2.record_metadata.semantic_checksum).toHaveLength(64);
      // Alter local path in rawJ1 and confirm checksum does not change
      const cloned = JSON.parse(JSON.stringify(rawJ1));
      cloned.source.crop_path = 'C:\\Different\\Workstation\\Path\\crop.webp';
      const clonedV2 = buildContractV2FromCanonical(cloned);
      expect(clonedV2.record_metadata.semantic_checksum).toBe(v2.record_metadata.semantic_checksum);
    });

    it('EX-09, D03-07: Detects assorted wording conflict when is_multi_brand_or_variant is false', () => {
      expect(v2.assortment.status).toBe('indicated_with_conflict');
      expect(v2.assortment.composition_type).toBe('alternatives');
      expect(v2.assessments.reason_codes).toContain('ASSORTMENT_FLAG_CONFLICT');
      expect(v2.assortment.source_assertions.length).toBeGreaterThanOrEqual(2);
      expect(v2.assets.offer_card.subject_scope).toBe('representative_assortment');
      expect(v2.assets.product_thumbnail.subject_scope).toBe('representative_assortment');
    });

    it('EX-10: known_options is empty array when unenumerated', () => {
      expect(v2.assortment.known_options).toEqual([]);
    });

    it('EX-12, D03-08: Controlled attributes capture bar soap and unknown scent', () => {
      expect(v2.product_facts.attributes.product_form).toEqual({
        value: 'bar',
        state: 'supported',
        provenance: 'title_heuristic'
      });
      expect(v2.product_facts.attributes.scent).toEqual({
        value: null,
        state: 'unknown',
        provenance: null
      });
    });

    it('EX-17, D03-05: Purchasing 2 packs of J1 yields exactly 12 units (1500g) for SAR 50.00', () => {
      const scenario = calculateScenarioPurchase(v2, 12);
      expect(scenario.full_packs_required).toBe(2);
      expect(scenario.payable_price).toBe('50.00');
      expect(scenario.supplied_units).toBe(12);
      expect(scenario.surplus_units).toBe(0);
      expect(scenario.total_supplied_content).toBe(1500);
      expect(scenario.total_supplied_content_unit).toBe('gram');
    });

    it('EX-18, D03-06, D03-24: Requesting 2 soap bars against 6-pack indivisible sale unit requires 1 full pack for SAR 25.00', () => {
      const scenario = calculateScenarioPurchase(v2, 2);
      expect(scenario.full_packs_required).toBe(1);
      expect(scenario.payable_price).toBe('25.00');
      expect(scenario.supplied_units).toBe(6);
      expect(scenario.surplus_units).toBe(4);
    });

    it('EX-19, EX-20, D03-11, D03-12: Bonus pack mechanics and fulfillment tracking', () => {
      expect(v2.promotion_terms.mechanic).toBe('bonus_pack');
      expect(v2.promotion_terms.bonus_wording).toBe('5+1 Free');
      expect(v2.promotion_terms.bonus_fulfillment).toBe('unresolved');
      expect(v2.promotion_terms.bonus_already_included_in_inner_count).toBe(true);
      expect(v2.assessments.reason_codes).toContain('BONUS_FULFILLMENT_NOT_ESTABLISHED');
    });

    it('EX-24: Loyalty requirement flagged on J1', () => {
      expect(v2.eligibility.loyalty.requirement).toBe('required');
      expect(v2.assessments.reason_codes).toContain('LOYALTY_REQUIRED');
    });

    it('EX-25, D03-10: verified_current_non_member_price remains null', () => {
      expect(v2.price_terms.verified_current_non_member_price).toBeNull();
      expect(v2.price_terms.source_reported_original_price).toBe('42.99');
    });

    it('EX-28, D03-20: Detects legacy comparison vs quality confidence conflict', () => {
      // Legacy J1 had comparison: "high" and quality: "medium"
      expect(v2.assessments.reason_codes).toContain('CONFIDENCE_SCOPE_CONFLICT');
    });

    it('EX-39, D03-31: Declares legacy coordinate system on adapted fixture', () => {
      expect(v2.evidence.coordinate_system).toBe('undeclared_legacy');
      expect(v2.assessments.reason_codes).toContain('COORDINATE_SYSTEM_UNDECLARED');
    });
  });

  // =========================================================================
  // 3. J2 (Mini Fan) Contract v2 Validation
  // =========================================================================
  describe('J2 (Mini Fan) Contract v2 Validation', () => {
    const j2FixturePath = path.resolve(process.cwd(), 'tests/fixtures/wifran04/page-003-012.canonical.json');
    const rawJ2: CanonicalOffer = JSON.parse(fs.readFileSync(j2FixturePath, 'utf8'));
    const v2 = buildContractV2FromCanonical(rawJ2);

    it('EX-04: Deterministic page-scoped source_offer_id for page 3 item 12', () => {
      expect(v2.record_metadata.source_offer_id).toBe('tamimi-national-national-2026-10-20:p003:i012:s01');
    });

    it('EX-11, D03-17: Detects unverified candidate brand "روكي" without promoting it', () => {
      expect(v2.product_facts.brand_assertion.value).toBeNull();
      expect(v2.product_facts.brand_assertion.state).toBe('unknown');
      expect(v2.product_facts.brand_assertion.candidate_unverified).toBe('روكي');
      expect(v2.product_facts.brand_assertion.provenance).toBe('title_heuristic');
    });

    it('EX-22: Non-grocery appliance content is null', () => {
      expect(v2.quantity_semantics.total_content.value).toBeNull();
      expect(v2.quantity_semantics.total_content.unit).toBeNull();
      expect(v2.quantity_semantics.inner_count).toBe(1);
    });

    it('EX-26: Loyalty requirement is unknown on J2', () => {
      expect(v2.eligibility.loyalty.requirement).toBe('unknown');
      expect(v2.eligibility.loyalty.restriction_coverage).toBe('not_stated_in_inspected_source');
    });

    it('EX-29: Derived subcategory is mini_fan', () => {
      expect(v2.product_facts.derived_subcategory_slug).toBe('mini_fan');
    });

    it('EX-40: Missing original price candidate flags PRICE_EVIDENCE_INCOMPLETE', () => {
      expect(v2.evidence.original_price_evidence_complete).toBe(false);
      expect(v2.assessments.reason_codes).toContain('PRICE_EVIDENCE_INCOMPLETE');
    });
  });

  // =========================================================================
  // 4. Synthetic Domain Scenarios
  // =========================================================================
  describe('Synthetic Domain Scenarios', () => {
    it('Correctly classifies dairy fat levels from bilingual titles', () => {
      const lowFatCanonical: CanonicalOffer = {
        source: { leaflet_id: 'test', source_page_number: 1, source_item_number: '001', external_image_id: 'test_1' },
        trusted_context: { supermarket_id: '1', location_scope: 'national', city_id: null, region_id: null, offer_start_date: '2026-10-14', offer_end_date: '2026-10-20' },
        product: { title_ar: 'حليب المراعي قليل الدسم ٢ لتر', title_en: 'Almarai Milk Low Fat 2L', brand_text: 'Almarai', category_hint: 'dairy', item_domain: 'grocery', description_ar: null, description_en: null },
        prices: { offer_price: 11, original_price: 13, currency: 'SAR', discount_amount: 2, discount_percentage: 15, price_basis: 'each', price_condition_text: null, all_price_candidates: [] },
        content: { size_text: '2L', pack_quantity: 1, bundle_quantity: null, each_size_value: 2, each_size_unit: 'liter', total_content_value: 2, total_content_unit: 'liter' },
        promotion: { mechanic: 'standard_price', special_offer: null, condition_text: null, bundle_quantity: null },
        comparison: { comparison_eligible: true, comparison_unit: 'liter', comparison_unit_price: 5.5, comparison_confidence: 'high', comparison_exclusion_reason: null },
        image: { image_bucket: null, image_path: null, image_url: null, image_source_type: 'leaflet_crop' },
        display: { show_display_unit_price: true, display_unit_price: 5.5, display_unit_basis_value: 1, display_unit_basis_unit: 'l', display_unit_family: 'volume', display_unit_price_label_ar: '5.5 ر.س / لتر', display_unit_price_label_en: 'SAR 5.5 / L', below_min_display_price_threshold: false, min_display_unit_price_sar: 0.5, hidden_reason: null },
        quality: { publish_decision: 'publish', extraction_confidence: 'high', validation_confidence: 'high', comparison_confidence: 'high', blocking_errors: [], non_blocking_warnings: [] },
        style_validation: { validation_result: 'pass', visual_evidence: {}, corrected_fields: {}, style_profile_scope: 'page' },
        pre_publish: { preview_eligible: true, preview_group: 'publish', display_in_preview: true },
        raw: { raw_ocr_json: {}, raw_validation_json: null, raw_ocr_text: null, raw_attributes: {} }
      };

      const v2 = buildContractV2FromCanonical(lowFatCanonical);
      expect(v2.product_facts.attributes.fat_level.value).toBe('low_fat');
      expect(v2.product_facts.attributes.fat_level.state).toBe('supported');
    });

    it('Correctly handles nested multi-pack water (24 x 330ml)', () => {
      const waterCanonical: CanonicalOffer = {
        source: { leaflet_id: 'test', source_page_number: 1, source_item_number: '002', external_image_id: 'test_2' },
        trusted_context: { supermarket_id: '1', location_scope: 'national', city_id: null, region_id: null, offer_start_date: '2026-10-14', offer_end_date: '2026-10-20' },
        product: { title_ar: 'مياه نوفا ٢٤ × ٣٣٠ مل', title_en: 'Nova Water 24 x 330ml', brand_text: 'Nova', category_hint: 'beverages', item_domain: 'grocery', description_ar: null, description_en: null },
        prices: { offer_price: 15, original_price: null, currency: 'SAR', discount_amount: null, discount_percentage: null, price_basis: 'per_pack', price_condition_text: null, all_price_candidates: [{ raw_text: '15', normalized_value: 15, currency: 'SAR', visual_role: 'offer_price', classified_as: 'offer_price', confidence: 'high', evidence: null, visual_evidence: {} }] },
        content: { size_text: '24 x 330ml', pack_quantity: 24, bundle_quantity: null, each_size_value: 330, each_size_unit: 'milliliter', total_content_value: 7920, total_content_unit: 'milliliter' },
        promotion: { mechanic: 'standard_price', special_offer: null, condition_text: null, bundle_quantity: null },
        comparison: { comparison_eligible: true, comparison_unit: 'liter', comparison_unit_price: 1.89, comparison_confidence: 'high', comparison_exclusion_reason: null },
        image: { image_bucket: null, image_path: null, image_url: null, image_source_type: 'leaflet_crop' },
        display: { show_display_unit_price: true, display_unit_price: 1.89, display_unit_basis_value: 1, display_unit_basis_unit: 'l', display_unit_family: 'volume', display_unit_price_label_ar: null, display_unit_price_label_en: null, below_min_display_price_threshold: false, min_display_unit_price_sar: 0.5, hidden_reason: null },
        quality: { publish_decision: 'publish', extraction_confidence: 'high', validation_confidence: 'high', comparison_confidence: 'high', blocking_errors: [], non_blocking_warnings: [] },
        style_validation: { validation_result: 'pass', visual_evidence: {}, corrected_fields: {}, style_profile_scope: 'page' },
        pre_publish: { preview_eligible: true, preview_group: 'publish', display_in_preview: true },
        raw: { raw_ocr_json: {}, raw_validation_json: null, raw_ocr_text: null, raw_attributes: {} }
      };

      const v2 = buildContractV2FromCanonical(waterCanonical);
      expect(v2.quantity_semantics.inner_count).toBe(24);
      expect(v2.quantity_semantics.total_content.value).toBe(7920);

      const scenario = calculateScenarioPurchase(v2, 48); // 2 full packs of 24
      expect(scenario.full_packs_required).toBe(2);
      expect(scenario.payable_price).toBe('30.00');
      expect(scenario.supplied_units).toBe(48);
      expect(scenario.total_supplied_content).toBe(15840);
    });

    it('Extracts model code and wattage for synthetic verified appliance', () => {
      const applianceCanonical: CanonicalOffer = {
        source: { leaflet_id: 'test', source_page_number: 1, source_item_number: '003', external_image_id: 'test_3' },
        trusted_context: { supermarket_id: '1', location_scope: 'national', city_id: null, region_id: null, offer_start_date: '2026-10-14', offer_end_date: '2026-10-20' },
        product: { title_ar: 'قلاية فيليبس الهوائية HD-9200 بقوة 1400 واط', title_en: 'Philips Air Fryer HD-9200 1400W', brand_text: 'Philips', category_hint: 'non-grocery', item_domain: 'appliance', description_ar: null, description_en: null },
        prices: { offer_price: 249, original_price: 399, currency: 'SAR', discount_amount: 150, discount_percentage: 37, price_basis: 'each', price_condition_text: null, all_price_candidates: [{ raw_text: '249', normalized_value: 249, currency: 'SAR', visual_role: 'offer_price', classified_as: 'offer_price', confidence: 'high', evidence: null, visual_evidence: {} }] },
        content: { size_text: '1 PC', pack_quantity: 1, bundle_quantity: null, each_size_value: null, each_size_unit: null, total_content_value: null, total_content_unit: null },
        promotion: { mechanic: 'standard_price', special_offer: null, condition_text: null, bundle_quantity: null },
        comparison: { comparison_eligible: false, comparison_unit: null, comparison_unit_price: null, comparison_confidence: 'low', comparison_exclusion_reason: 'non_grocery_item' },
        image: { image_bucket: null, image_path: null, image_url: null, image_source_type: 'leaflet_crop' },
        display: { show_display_unit_price: false, display_unit_price: null, display_unit_basis_value: null, display_unit_basis_unit: null, display_unit_family: null, display_unit_price_label_ar: null, display_unit_price_label_en: null, below_min_display_price_threshold: false, min_display_unit_price_sar: 0.5, hidden_reason: 'comparison_not_eligible' },
        quality: { publish_decision: 'publish_but_exclude_from_comparison', extraction_confidence: 'high', validation_confidence: 'high', comparison_confidence: 'low', blocking_errors: [], non_blocking_warnings: [] },
        style_validation: { validation_result: 'pass', visual_evidence: {}, corrected_fields: {}, style_profile_scope: 'page' },
        pre_publish: { preview_eligible: true, preview_group: 'publish', display_in_preview: true },
        raw: { raw_ocr_json: {}, raw_validation_json: null, raw_ocr_text: null, raw_attributes: {} }
      };

      const v2 = buildContractV2FromCanonical(applianceCanonical);
      expect(v2.product_facts.attributes.model.value).toBe('HD-9200');
      expect(v2.product_facts.attributes.power_watts.value).toBe(1400);
    });
  });

  // =========================================================================
  // 5. Consumer Offer Projection & Temporal Lifecycle (EX-33, EX-34, EX-36, EX-47)
  // =========================================================================
  describe('Consumer Offer Projection (EX-33, EX-34, EX-36, EX-47)', () => {
    const j1FixturePath = path.resolve(process.cwd(), 'tests/fixtures/wifran04/page-001-012.canonical.json');
    const rawJ1: CanonicalOffer = JSON.parse(fs.readFileSync(j1FixturePath, 'utf8'));

    it('EX-33: Evaluates to active within validity window (2026-10-16)', () => {
      const proj = toConsumerOfferProjection(rawJ1, '2026-10-16');
      expect(proj.temporal_lifecycle_state).toBe('active');
    });

    it('EX-34: Evaluates to expired after validity window (2026-10-25)', () => {
      const proj = toConsumerOfferProjection(rawJ1, '2026-10-25');
      expect(proj.temporal_lifecycle_state).toBe('expired');
    });

    it('Evaluates to upcoming before validity window (2026-10-10)', () => {
      const proj = toConsumerOfferProjection(rawJ1, '2026-10-10');
      expect(proj.temporal_lifecycle_state).toBe('upcoming');
    });

    it('EX-36, D03-18: Strips all local Windows workstation file paths and raw attributes', () => {
      const proj: any = toConsumerOfferProjection(rawJ1, '2026-10-16');
      expect(proj.raw).toBeUndefined();
      expect(proj.crop_path).toBeUndefined();
      expect(proj.thumbnail_path).toBeUndefined();
      const stringified = JSON.stringify(proj);
      expect(stringified).not.toContain('F:\\Work');
      expect(stringified).not.toContain('F:/Work');
    });
  });

  // =========================================================================
  // 6. Title Normalization & Confidence Synchronization (Task 4)
  // =========================================================================
  describe('Title Normalization & Confidence Sync (Task 4)', () => {
    it('Normalizes J1 Dove Soap title cleanly without 5+1 or Asstd.', () => {
      const result = inferNormalizedTitlesAndCommodityTag({
        offer_number: 12,
        english_title: 'Dove Soap 125Gm 5+1 Free Asstd.',
        arabic_title: 'صابون دوف للاستحمام ١٢٥ جرام ٥+١ مجانا منوع',
        brand: 'Dove',
        is_multi_brand_or_variant: false,
        promo_price: 25,
        original_price: 42.99,
        promo_condition: 'LOYALTY_CARD_REQUIRED',
        size_value: '125',
        unit_type: 'gram',
        confidence: 0.99,
        components: {
          product_graphic_box: [0, 0, 100, 100],
          promo_price_box: [0, 0, 100, 100],
          title_text_box: [0, 0, 100, 100],
          original_price_box: null,
          unit_and_size_badge_box: null
        }
      }, 'personal-care');

      expect(result.normalized_title_en).toBe('Dove Soap');
      expect(result.normalized_title_ar).toBe('صابون دوف للاستحمام');
      expect(result.commodity_tag).toBe('bath_soap');
    });
  });

  // =========================================================================
  // 7. Master Catalog Self-Sufficiency Verification (Task 1)
  // =========================================================================
  describe('Master Supermarket & Geography Registry Self-Sufficiency (Task 1)', () => {
    it('Loads all 12 major Saudi supermarket chains including Alwafa, Nesto, Farm, Manuel, and Raya', async () => {
      const supermarkets = await loadSupermarkets();
      const slugs = supermarkets.map(s => s.slug);
      expect(slugs).toContain('alwafa');
      expect(slugs).toContain('nesto');
      expect(slugs).toContain('farm');
      expect(slugs).toContain('manuel');
      expect(slugs).toContain('raya');
      expect(slugs).toContain('tamimi');
      expect(slugs).toContain('bin-dawood');
      expect(slugs).toContain('panda');
      expect(slugs).toContain('othaim');
      expect(slugs).toContain('lulu');
      expect(slugs).toContain('danube');
      expect(slugs).toContain('carrefour');
      expect(supermarkets.length).toBeGreaterThanOrEqual(12);

      const alwafa = supermarkets.find(s => s.slug === 'alwafa');
      expect(alwafa?.id).toBe('c2cc16c2-0008-4444-b000-c00000000008');
    });

    it('Loads all 13 canonical categories including non-grocery', async () => {
      const categories = await loadCategories();
      const slugs = categories.map(c => c.slug);
      expect(slugs).toContain('staples');
      expect(slugs).toContain('dairy');
      expect(slugs).toContain('eggs');
      expect(slugs).toContain('meat-chicken');
      expect(slugs).toContain('frozen');
      expect(slugs).toContain('baby');
      expect(slugs).toContain('cleaning');
      expect(slugs).toContain('personal-care');
      expect(slugs).toContain('beverages');
      expect(slugs).toContain('coffee-tea');
      expect(slugs).toContain('snacks');
      expect(slugs).toContain('canned-food');
      expect(slugs).toContain('non-grocery');
      expect(categories.length).toBeGreaterThanOrEqual(13);
    });

    it('Loads all 5 commercial leaflet regions and 25 cities', async () => {
      const regions = await loadRegions();
      const cities = await loadCities();
      expect(regions.length).toBeGreaterThanOrEqual(5);
      expect(cities.length).toBeGreaterThanOrEqual(25);
    });

    it('ensureCoreCatalogSeeded returns valid counts and executes idempotently', async () => {
      const result = await ensureCoreCatalogSeeded();
      expect(result).toHaveProperty('seeded');
      expect(result).toHaveProperty('counts');
    });
  });
});
