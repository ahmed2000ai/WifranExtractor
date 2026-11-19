import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { OfferContractV3Record } from '../../../shared/types/extractorContractV3';
import {
  SUPPORTED_LEAFLET_SCHEMA_VERSIONS,
  getLeafletPageGenAiSchema
} from '../../../shared/schemas/leafletPageExtractionSchema';
import {
  V3_EXTRACTION_PROFILE_ID,
  V3_EXTRACTION_SCHEMA_VERSION,
  getV3LeafletPageGenAiSchema,
  offerContractV3RecordSchema,
  parseOfferContractV3Record
} from '../../../shared/schemas/leafletPageExtractionV3Schema';
import {
  V3_EXTRACTION_PROFILE_DEFINITION,
  V3_PROMPT_VERSION,
  buildV3PageExtractionSystemPrompt,
  estimateV3IncrementalCostAndTokens,
  getV3PromptAndSchemaFingerprints,
  resolveSafeExtractionProfile,
  runV3PilotProfilePreflight
} from '../geminiV3PromptBuilder';
import {
  decomposeV3OfferCard,
  normalizeV3OfferCard
} from '../offerV3DecompositionEngine';
import { adaptV3DecompositionToOfflineMatching } from '../../db/v3MatchingInputAdapter';
import { runOfflineV3EvaluationFramework } from '../v3OfflineEvaluator';
import {
  getTrustedWifranSupabaseHosts,
  sanitizeConsumerContractV2Assets,
  sanitizePublicConsumerImageUrl
} from '../../../shared/utils/nonCatalogPublicationPolicy';

const REPO_ROOT = process.cwd();
const positiveFixturesJson = JSON.parse(
  readFileSync(
    join(REPO_ROOT, 'src', 'shared', 'fixtures', 'v3', 'positive_decomposition_fixtures.json'),
    'utf8'
  )
);
const negativeFixturesJson = JSON.parse(
  readFileSync(
    join(REPO_ROOT, 'src', 'shared', 'fixtures', 'v3', 'negative_and_control_fixtures.json'),
    'utf8'
  )
);

function cloneFirstPositiveRecord(): OfferContractV3Record {
  return JSON.parse(JSON.stringify(positiveFixturesJson.cases[0].record));
}

describe('WIFRAN-EXTRACTOR-IDENTITY-005D (WP4 Stage 1) — V3 Contract, Normalization, Decomposition & Safety', () => {
  describe('1. Additive Isolation & Disabled-by-Default Safeguards', () => {
    it('keeps V3 disabled by default and rolls back extraction_v3 without explicit authorization', () => {
      expect(V3_EXTRACTION_PROFILE_DEFINITION.profileId).toBe(V3_EXTRACTION_PROFILE_ID);
      expect(V3_EXTRACTION_PROFILE_DEFINITION.schemaVersion).toBe(V3_EXTRACTION_SCHEMA_VERSION);
      expect(V3_EXTRACTION_PROFILE_DEFINITION.enabledByDefault).toBe(false);
      expect(V3_EXTRACTION_PROFILE_DEFINITION.requiresExplicitAuthorization).toBe(true);
      expect(V3_EXTRACTION_PROFILE_DEFINITION.fallbackRollbackProfile).toBe('legacy');

      const defaultRes = resolveSafeExtractionProfile();
      expect(defaultRes.activeProfileId).toBe('legacy');
      expect(defaultRes.v3Activated).toBe(false);

      const unauthorizedV3 = resolveSafeExtractionProfile({
        requestedProfile: 'extraction_v3',
        explicitV3Authorization: false
      });
      expect(unauthorizedV3.activeProfileId).toBe('legacy');
      expect(unauthorizedV3.v3Activated).toBe(false);
      expect(unauthorizedV3.blockedReason).toContain('V3_PROFILE_DISABLED_BY_DEFAULT');

      const authorizedV3 = resolveSafeExtractionProfile({
        requestedProfile: 'extraction_v3',
        explicitV3Authorization: true
      });
      expect(authorizedV3.activeProfileId).toBe('extraction_v3');
      expect(authorizedV3.v3Activated).toBe(true);
    });

    it('preserves frozen legacy/optimized/compact_v1 schemas untouched and keeps GenAI V3 schema standalone', () => {
      expect(SUPPORTED_LEAFLET_SCHEMA_VERSIONS).toEqual(['legacy', 'optimized', 'compact_v1']);
      const legacySchema = getLeafletPageGenAiSchema('legacy');
      expect(legacySchema).toBeTruthy();

      const v3GenAi = getV3LeafletPageGenAiSchema() as any;
      expect(v3GenAi.properties.is_loyalty_page).toBeUndefined();
      expect(v3GenAi.properties.page_currency).toBeUndefined();
      expect(v3GenAi.properties.offers.items.properties.sub_items).toBeDefined();
      expect(v3GenAi.properties.offers.items.properties.evidence_conflicts).toBeDefined();

      const prompt = buildV3PageExtractionSystemPrompt();
      expect(prompt).toContain('DO NOT default unknown pack count to 1');
      expect(prompt).toContain('Empty sub_items[] NEVER proves confirmed_single_sku');
      expect(prompt).not.toContain('SAR');
    });
  });

  describe('2. Schema & Field-Level Evidence Contract Guarantees', () => {
    it('supports Arabic-only offer cards and Arabic-only sub-items without rejecting null English titles', () => {
      const arCard = cloneFirstPositiveRecord();
      arCard.source_card.source_offer_id = 'test-ar-only-001';
      arCard.source_card.raw_text.title_en = null;
      arCard.source_card.raw_text.title_ar = 'دجاج متبل عادي / حار رضوى 400 جم';
      arCard.sub_items = arCard.sub_items.slice(0, 2).map((s, idx) => ({
        ...s,
        brand_en: null,
        brand_ar: 'رضوى',
        product_name_en: null,
        product_name_ar: idx === 0 ? 'شاورما دجاج عادي رضوى' : 'شاورما دجاج حار رضوى',
        variant_or_flavor: idx === 0 ? 'عادي' : 'حار'
      }));
      arCard.assortment.visible_variant_count = 2;
      arCard.assortment.identifiable_sub_item_count = 2;

      const parsed = parseOfferContractV3Record(arCard);
      const decomp = decomposeV3OfferCard(parsed);
      expect(decomp.decomposed).toBe(true);
      expect(decomp.children).toHaveLength(2);

      const adapter = adaptV3DecompositionToOfflineMatching(decomp);
      expect(adapter.matchableChildren).toHaveLength(2);
      expect(new Set(adapter.matchableChildren.map((m) => m.deduplicationKey)).size).toBe(2);
    });

    it('keeps manufacturer_pack_count strictly nullable and NEVER coerces null to 1 on packaged goods', () => {
      const card = cloneFirstPositiveRecord();
      card.quantity_and_promo.manufacturer_pack_count = null;
      card.sub_items = card.sub_items.map((s) => ({
        ...s,
        manufacturer_pack_count: null
      }));

      const parsed = offerContractV3RecordSchema.parse(card);
      expect(parsed.quantity_and_promo.manufacturer_pack_count).toBeNull();
      expect(parsed.sub_items.every((s) => s.manufacturer_pack_count === null)).toBe(true);

      const decomp = decomposeV3OfferCard(parsed);
      expect(decomp.children.every((c) => c.manufacturer_pack_count === null)).toBe(true);

      // Packaged product with null manufacturer_pack_count fails catalog matching sufficiency safely
      const adapter = adaptV3DecompositionToOfflineMatching(decomp);
      expect(adapter.matchableChildren).toHaveLength(0);
      expect(adapter.unresolvedChildren.length).toBeGreaterThan(0);
      expect(adapter.unresolvedChildren[0].reasons.join(' ')).toContain(
        'manufacturer_pack_count is explicitly unknown'
      );
    });

    it('never treats empty sub_items[] as proof of confirmed_single_sku while preserving WP2 non-catalog eligibility', () => {
      const card = cloneFirstPositiveRecord();
      card.assortment.status = 'confirmed_single_sku';
      card.sub_items = [];

      const norm = normalizeV3OfferCard(card);
      expect(norm.normalizedCard.assortment.status).toBe('unknown_insufficient_evidence');
      expect(norm.conflictCodes).toContain('MISSING_CRITICAL_IDENTITY_ATTRIBUTES');

      const decomp = decomposeV3OfferCard(card);
      expect(decomp.decomposed).toBe(false);
      expect(decomp.children).toHaveLength(0);
      expect(decomp.parent_offer_retention_mode).toBe('unsplit_non_catalog_candidate');

      // Without operator approval -> remains unsplit & awaiting operator approval (never auto-published or auto-linked)
      const pendingAdapter = adaptV3DecompositionToOfflineMatching(decomp);
      expect(pendingAdapter.matchableChildren).toHaveLength(0);
      expect(pendingAdapter.operatorReviewRequired).toBe(true);
      expect(pendingAdapter.parentPublicationAssessment.isEligibleForNonCatalogPublication).toBe(true);
      expect(pendingAdapter.parentPublicationAssessment.exactIdentityStatus).toBe('unresolved');
      expect(pendingAdapter.parentPublicationAssessment.comparisonDisabled).toBe(true);
      expect(pendingAdapter.parentPublicationAssessment.outcome).toBe('quarantined');
      expect(pendingAdapter.parentPublicationAssessment.quarantineReasons).toEqual([]);

      // With explicit operator approval -> approved_non_catalog with comparison disabled & unresolved exact identity
      const approvedAdapter = adaptV3DecompositionToOfflineMatching(decomp, {
        nonCatalogApproval: {
          batchOfferKey: pendingAdapter.parentOfferForPolicyCheck.batchOfferKey,
          decision: 'approved',
          category: 'valid_grocery_unresolved_sku',
          operatorNotes: 'Verified promotional card price/dates despite unknown single-vs-assortment identity',
          updatedAt: '2026-11-13T20:00:00Z'
        }
      });
      expect(approvedAdapter.parentPublicationAssessment.outcome).toBe('approved_non_catalog');
      expect(approvedAdapter.parentPublicationAssessment.isSafeForNonCatalogPublication).toBe(true);
      expect(approvedAdapter.parentPublicationAssessment.exactIdentityStatus).toBe('unresolved');
      expect(approvedAdapter.parentPublicationAssessment.comparisonDisabled).toBe(true);

      // Factual conflict (e.g. ambiguous price role or missing price) STILL quarantines even if operator approval is passed
      const conflictingEmptyCard = cloneFirstPositiveRecord();
      conflictingEmptyCard.assortment.status = 'confirmed_single_sku';
      conflictingEmptyCard.sub_items = [];
      conflictingEmptyCard.pricing.price_role_confidence = 'conflicting';
      const conflictDecomp = decomposeV3OfferCard(conflictingEmptyCard);
      expect(conflictDecomp.parent_offer_retention_mode).toBe('quarantined_do_not_publish');
      const blockedAdapter = adaptV3DecompositionToOfflineMatching(conflictDecomp, {
        nonCatalogApproval: {
          batchOfferKey: pendingAdapter.parentOfferForPolicyCheck.batchOfferKey,
          decision: 'approved',
          category: 'valid_grocery_unresolved_sku',
          operatorNotes: 'Should remain blocked on price ambiguity conflict',
          updatedAt: '2026-11-13T20:00:00Z'
        }
      });
      expect(blockedAdapter.parentPublicationAssessment.outcome).toBe('quarantined');
      expect(blockedAdapter.parentPublicationAssessment.isEligibleForNonCatalogPublication).toBe(false);
    });

    it('preserves extracted_value & original_source_evidence non-destructively when operator_correction is present', () => {
      const card = cloneFirstPositiveRecord();
      const firstEvidence = card.evidence_ledger[0];
      firstEvidence.target_field = 'pricing.promo_price';
      firstEvidence.extracted_value = 13.5;
      firstEvidence.original_source_evidence = '13.50 SAR';
      firstEvidence.operator_correction = {
        corrected_value: 14.5,
        corrected_by: 'operator_auditor_1',
        corrected_at: '2026-11-13T12:00:00Z',
        rationale: 'Verified promo price typo on zoomed label',
        reversible: true
      };

      const norm = normalizeV3OfferCard(card);
      expect(norm.normalizedCard.pricing.promo_price).toBe(14.5);
      // Original extracted evidence stays untouched and reversible
      expect(norm.normalizedCard.evidence_ledger[0].extracted_value).toBe(13.5);
      expect(norm.normalizedCard.evidence_ledger[0].original_source_evidence).toBe('13.50 SAR');
      expect(norm.normalizedCard.evidence_ledger[0].operator_correction?.reversible).toBe(true);
    });
  });

  describe('3. Price, Currency, Date Integrity & Domain Boundaries', () => {
    it('normalizes currency internally to SAR without currency conflict while rejecting ambiguous prices', () => {
      const card = cloneFirstPositiveRecord();
      card.pricing.currency = 'AED';
      card.pricing.price_role_confidence = 'conflicting';

      const norm = normalizeV3OfferCard(card);
      expect(norm.normalizedCard.pricing.currency).toBe('SAR');
      expect(norm.conflictCodes).not.toContain('CURRENCY_UNVERIFIED_OR_CONFLICT');
      expect(norm.conflictCodes).toContain('PRICE_ROLE_AMBIGUOUS');
      expect(decomposeV3OfferCard(card).decomposed).toBe(false);
    });

    it('rejects invalid calendar dates and end_date < start_date fail-closed', () => {
      const badDateCard = cloneFirstPositiveRecord();
      badDateCard.source_card.offer_end_date = '2026-02-30';
      const normBad = normalizeV3OfferCard(badDateCard);
      expect(normBad.conflictCodes).toContain('PRICE_ROLE_AMBIGUOUS');

      const invertedCard = cloneFirstPositiveRecord();
      invertedCard.source_card.offer_start_date = '2026-10-25';
      invertedCard.source_card.offer_end_date = '2026-10-20';
      const normInv = normalizeV3OfferCard(invertedCard);
      expect(normInv.conflictCodes).toContain('PRICE_ROLE_AMBIGUOUS');
    });

    it('separates factory bonus (5+1 Free) from checkout multi-buy (Buy 2) & refuses self-verifying packaging claims', () => {
      // Factory bonus pack: valid arithmetic + source-supported packaging evidence -> pack = 5 + 1 = 6
      const bonusCard = cloneFirstPositiveRecord();
      bonusCard.source_card.raw_text.promo_badge_text = '5+1 Free';
      bonusCard.quantity_and_promo.sale_basis = 'factory_bonus_pack';
      bonusCard.quantity_and_promo.factory_bonus_paid_qty = 5;
      bonusCard.quantity_and_promo.factory_bonus_free_qty = 1;
      bonusCard.quantity_and_promo.manufacturer_pack_count = 6;
      bonusCard.sub_items = [
        {
          ...bonusCard.sub_items[0],
          manufacturer_pack_count: 6
        }
      ];
      bonusCard.evidence_ledger.push({
        evidence_id: 'ev_bonus_pkg_1',
        target_field: 'quantity_and_promo.manufacturer_pack_count',
        extracted_value: 6,
        normalized_value: 6,
        original_source_evidence: 'Factory shrink-wrap band 5+1 Free',
        evidence_type: 'manufacturer_packaging_marking',
        confidence: 'high',
        operator_correction: null
      });
      bonusCard.assortment.status = 'confirmed_single_sku';
      bonusCard.assortment.visible_variant_count = 1;
      bonusCard.assortment.identifiable_sub_item_count = 1;
      expect(normalizeV3OfferCard(bonusCard).conflictCodes).toEqual([]);

      // Negative §4a: Claimed 5+1 Free with NO packaging evidence in ledger or raw_text MUST fail closed
      const unverifiedBonusCard = cloneFirstPositiveRecord();
      unverifiedBonusCard.quantity_and_promo.sale_basis = 'factory_bonus_pack';
      unverifiedBonusCard.quantity_and_promo.factory_bonus_paid_qty = 5;
      unverifiedBonusCard.quantity_and_promo.factory_bonus_free_qty = 1;
      unverifiedBonusCard.quantity_and_promo.manufacturer_pack_count = 6;
      unverifiedBonusCard.sub_items = [{ ...unverifiedBonusCard.sub_items[0], manufacturer_pack_count: 6 }];
      unverifiedBonusCard.assortment.status = 'confirmed_single_sku';
      unverifiedBonusCard.assortment.visible_variant_count = 1;
      unverifiedBonusCard.assortment.identifiable_sub_item_count = 1;
      expect(normalizeV3OfferCard(unverifiedBonusCard).conflictCodes).toContain(
        'PROMO_QTY_VS_MFG_PACK_CONFLICT'
      );

      // Negative §4b: Checkout "Buy 5 Get 1 Free at checkout" disguised as factory_bonus_pack MUST fail closed
      const checkoutAsFactoryBonus = cloneFirstPositiveRecord();
      checkoutAsFactoryBonus.quantity_and_promo.sale_basis = 'factory_bonus_pack';
      checkoutAsFactoryBonus.quantity_and_promo.factory_bonus_paid_qty = 5;
      checkoutAsFactoryBonus.quantity_and_promo.factory_bonus_free_qty = 1;
      checkoutAsFactoryBonus.quantity_and_promo.manufacturer_pack_count = 6;
      checkoutAsFactoryBonus.evidence_ledger.push({
        evidence_id: 'ev_checkout_bonus_1',
        target_field: 'quantity_and_promo.manufacturer_pack_count',
        extracted_value: 6,
        normalized_value: 6,
        original_source_evidence: 'Buy 5 Get 1 Free at checkout',
        evidence_type: 'printed_leaflet_text',
        confidence: 'medium',
        operator_correction: null
      });
      expect(normalizeV3OfferCard(checkoutAsFactoryBonus).conflictCodes).toContain(
        'PROMO_QTY_VS_MFG_PACK_CONFLICT'
      );

      // Negative §4c: Conflicting ledger value vs structured manufacturer_pack_count MUST fail closed
      const contradictoryLedgerCard = cloneFirstPositiveRecord();
      contradictoryLedgerCard.quantity_and_promo.sale_basis = 'sealed_multipack';
      contradictoryLedgerCard.quantity_and_promo.manufacturer_pack_count = 6;
      contradictoryLedgerCard.evidence_ledger.push({
        evidence_id: 'ev_contra_pkg_1',
        target_field: 'quantity_and_promo.manufacturer_pack_count',
        extracted_value: 4,
        normalized_value: 4,
        original_source_evidence: '4 x 400g',
        evidence_type: 'printed_package_label',
        confidence: 'high',
        operator_correction: null
      });
      expect(normalizeV3OfferCard(contradictoryLedgerCard).conflictCodes).toContain(
        'PROMO_QTY_VS_MFG_PACK_CONFLICT'
      );

      // Negative §4d: Shared caption evidence without child override MUST flag COMPOUND_SHARED_CAPTION_CONFLICT
      const sharedCaptionUnoverridden = cloneFirstPositiveRecord();
      sharedCaptionUnoverridden.evidence_ledger = [
        {
          evidence_id: 'ev_shared_cap_1',
          target_field: 'sub_items',
          extracted_value: 10,
          normalized_value: 10,
          original_source_evidence: 'دجاج فقيه مجمد 10 × 1000 جرام shared cell header',
          evidence_type: 'source_card_shared_caption',
          confidence: 'medium',
          operator_correction: null
        }
      ];
      expect(normalizeV3OfferCard(sharedCaptionUnoverridden).conflictCodes).toContain(
        'COMPOUND_SHARED_CAPTION_CONFLICT'
      );

      // Checkout multi-buy trying to pass off Buy 2 promo qty as sealed manufacturer pack count
      const confusedPromoCard = cloneFirstPositiveRecord();
      confusedPromoCard.quantity_and_promo.sale_basis = 'single_unit';
      confusedPromoCard.quantity_and_promo.retailer_checkout_multibuy_qty = 2;
      confusedPromoCard.quantity_and_promo.manufacturer_pack_count = 2;
      confusedPromoCard.quantity_and_promo.customer_limit_pcs = 2;
      expect(normalizeV3OfferCard(confusedPromoCard).conflictCodes).toContain(
        'PROMO_QTY_VS_MFG_PACK_CONFLICT'
      );
    });

    it('keeps non-grocery textile/electronics specs excluded from default grocery consumer feed', () => {
      const perinnaCase = negativeFixturesJson.negative_cases.find(
        (c: any) => c.case_id === 'neg_perinna_bed_sheet_unlabeled_swatches'
      );
      expect(perinnaCase).toBeDefined();

      const decomp = decomposeV3OfferCard(perinnaCase.record);
      expect(decomp.decomposed).toBe(false);
      expect(decomp.normalized_card.non_grocery_specs.excluded_from_default_grocery_feed).toBe(true);
      expect(decomp.normalized_card.non_grocery_specs.textile_dimensions).toBe('225x250cm');

      const adapter = adaptV3DecompositionToOfflineMatching(decomp);
      expect(adapter.parentPublicationAssessment.category).toBeNull();
      expect(adapter.parentPublicationAssessment.itemDomain).toBe('other_non_grocery');
      expect(adapter.parentPublicationAssessment.quarantineReasons).toContain(
        'NON_GROCERY_OUT_OF_DEFAULT_CONSUMER_SCOPE'
      );
      expect(adapter.parentPublicationAssessment.outcome).toBe('quarantined');
    });
  });

  describe('4. All Real-Leaflet Positive & Negative Fixtures', () => {
    it('safely decomposes all 9 positive real-crop fixtures with variant separation & shared promo prices', () => {
      expect(positiveFixturesJson.cases).toHaveLength(9);
      for (const c of positiveFixturesJson.cases) {
        const parsed = parseOfferContractV3Record(c.record);
        const decomp = decomposeV3OfferCard(parsed);

        expect(decomp.decomposed, c.case_id).toBe(true);
        expect(decomp.children, c.case_id).toHaveLength(c.expected_child_count);
        expect(decomp.conflict_codes, c.case_id).toEqual([]);

        const adapter = adaptV3DecompositionToOfflineMatching(decomp);
        expect(adapter.operatorReviewRequired).toBe(true);
        expect(
          adapter.matchableChildren.every((m) => m.autoVerifiedTemporaryProduct === false)
        ).toBe(true);
        // Zero sibling identity collisions
        const keys = adapter.matchableChildren.map((m) => m.deduplicationKey);
        expect(new Set(keys).size, c.case_id).toBe(keys.length);
      }
    });

    it('fails closed (zero false children) on all 9 negative/conflict controls & passes offline Godiva V3 control', () => {
      expect(negativeFixturesJson.negative_cases).toHaveLength(9);
      for (const c of negativeFixturesJson.negative_cases) {
        const parsed = parseOfferContractV3Record(c.record);
        const decomp = decomposeV3OfferCard(parsed);

        expect(decomp.decomposed, c.case_id).toBe(false);
        expect(decomp.children, c.case_id).toHaveLength(0);
      }

      // Godiva legacy /pk=5 remains unresolved without currency conflict; offline V3 proposed fixture splits 3 flavors cleanly
      const legacyGodiva = negativeFixturesJson.negative_cases.find(
        (c: any) => c.case_id === 'neg_godiva_legacy_unresolved_control'
      );
      const legacyGodivaDecomp = decomposeV3OfferCard(legacyGodiva.record);
      expect(legacyGodivaDecomp.decomposed).toBe(false);
      expect(legacyGodivaDecomp.conflict_codes).not.toContain('CURRENCY_UNVERIFIED_OR_CONFLICT');

      const godivaV3 = parseOfferContractV3Record(
        negativeFixturesJson.godiva_proposed_v3_offline_fixture.proposed_v3_record
      );
      const godivaDecomp = decomposeV3OfferCard(godivaV3);
      expect(godivaDecomp.decomposed).toBe(true);
      expect(godivaDecomp.children).toHaveLength(3);
      expect(godivaDecomp.children.every((ch) => ch.parent_promo_price === 5)).toBe(true);
    });
  });

  describe('5. WP2-R1 Consumer Asset Security & Offline Evaluation Track Separation', () => {
    it('blocks external untrusted *.supabase.co hosts while allowing trusted Wifran project hosts', () => {
      const trusted = getTrustedWifranSupabaseHosts();
      expect(trusted.has('swratbmclahjyekouned.supabase.co')).toBe(true);
      expect(trusted.has('gykrbpykjhpyrdrinkuk.supabase.co')).toBe(true);

      // External project impersonation MUST be blocked even on product-images / offer-display-images buckets
      expect(
        sanitizePublicConsumerImageUrl(
          'https://attacker-proj.supabase.co/storage/v1/object/public/product-images/fake.webp'
        )
      ).toBeNull();
      expect(
        sanitizePublicConsumerImageUrl(
          'https://proj.supabase.co/storage/v1/object/public/offer-display-images/produce/tomato.webp'
        )
      ).toBeNull();

      // Trusted Wifran host public display image is allowed
      expect(
        sanitizePublicConsumerImageUrl(
          'https://gykrbpykjhpyrdrinkuk.supabase.co/storage/v1/object/public/offer-display-images/produce/tomato.webp'
        )
      ).toBe(
        'https://gykrbpykjhpyrdrinkuk.supabase.co/storage/v1/object/public/offer-display-images/produce/tomato.webp'
      );

      // ContractV2 asset sanitizer strips external untrusted hosts and private crop/bucket paths
      const sanitized = sanitizeConsumerContractV2Assets({
        assets: {
          offer_card: {
            delivery_url: 'https://proj.supabase.co/storage/v1/object/public/product-images/bad.webp',
            storage_bucket: 'offer-images',
            storage_object_path: 'batches/b1/offer_card_crop.webp',
            local_path_internal: 'F:\\Work\\Extracts\\crop.webp',
            upload_state: 'uploaded'
          }
        }
      });
      expect(sanitized.assets.offer_card.delivery_url).toBeNull();
      expect(sanitized.assets.offer_card.storage_bucket).toBeNull();
      expect(sanitized.assets.offer_card.storage_object_path).toBeNull();
      expect(sanitized.assets.offer_card.local_path_internal).toBeNull();
      expect(sanitized.assets.offer_card.upload_state).toBe('pending');
    });

    it('reports separate Track A / Track B / Track C (NOT_RUN) metrics & token/cost estimate without live API calls', () => {
      const evalReport = runOfflineV3EvaluationFramework(REPO_ROOT);

      expect(evalReport.trackA_structuralRepresentability.fixturesValidated).toBe(19);
      expect(evalReport.trackA_structuralRepresentability.schemaValidCount).toBe(19);
      expect(evalReport.trackA_structuralRepresentability.corpusMetrics.benchmark106.totalOffers).toBe(106);
      expect(evalReport.trackA_structuralRepresentability.corpusMetrics.corpus190.totalRecords).toBe(190);

      expect(evalReport.trackB_deterministicDecomposition.passedFixtures).toBe(19);
      expect(evalReport.trackB_deterministicDecomposition.falseChildCreationCount).toBe(0);
      expect(evalReport.trackB_deterministicDecomposition.missingSubItemsCount).toBe(0);
      expect(evalReport.trackB_deterministicDecomposition.temporaryIdentityMergeSplitErrors).toBe(0);
      expect(evalReport.trackB_deterministicDecomposition.consumerPublicationSafeCount).toBe(19);
      expect(evalReport.eightDimensionSummary.dimension1_schemaValidCards).toBe(19);
      expect(evalReport.eightDimensionSummary.dimension2_explicitAlternativesRepresented).toBe(27);
      expect(evalReport.eightDimensionSummary.dimension3_safeChildIdentitiesEmitted).toBe(22);
      expect(evalReport.eightDimensionSummary.dimension4_intentionallyWithheldChildrenCount).toBe(5);
      expect(evalReport.eightDimensionSummary.dimension4_silentlyLostChildrenCount).toBe(0);
      expect(evalReport.eightDimensionSummary.dimension5_invalidOrConflictingCardsRejected).toBe(9);
      expect(evalReport.eightDimensionSummary.dimension8_actualVerifiedCatalogLinks).toBe(0);

      // Track C MUST stay NOT_RUN
      expect(evalReport.trackC_actualVisionModelAccuracy.status).toBe(
        'NOT_RUN_REQUIRES_AUTHORIZED_LIVE_V3_CALL'
      );
      expect(evalReport.trackC_actualVisionModelAccuracy.liveV3CallsExecuted).toBe(0);
      expect(evalReport.trackC_actualVisionModelAccuracy.validated).toBe(false);

      const est = estimateV3IncrementalCostAndTokens();
      expect(est.isEstimate).toBe(true);
      expect(est.estimatedFlexCostDeltaPer100OffersUsd).toBeGreaterThan(0);
    });

    it('enforces per-environment pinned Supabase hosts and ignores attacker env overrides (§6)', () => {
      const savedEnv = {
        SUPABASE_URL: process.env.SUPABASE_URL,
        VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
        WIFRAN_TRUSTED_SUPABASE_HOSTS: process.env.WIFRAN_TRUSTED_SUPABASE_HOSTS,
        WIFRAN_DB_ENV: process.env.WIFRAN_DB_ENV
      };
      try {
        process.env.SUPABASE_URL = 'https://evil-attacker.supabase.co';
        process.env.VITE_SUPABASE_URL = 'https://rogue.supabase.co';
        process.env.WIFRAN_TRUSTED_SUPABASE_HOSTS = 'attacker.supabase.co,another-evil.com';

        const prodHosts = getTrustedWifranSupabaseHosts('PRODUCTION');
        expect(prodHosts.has('swratbmclahjyekouned.supabase.co')).toBe(true);
        expect(prodHosts.has('gykrbpykjhpyrdrinkuk.supabase.co')).toBe(false);
        expect(prodHosts.has('evil-attacker.supabase.co')).toBe(false);
        expect(prodHosts.has('attacker.supabase.co')).toBe(false);

        const devHosts = getTrustedWifranSupabaseHosts('DEVELOPMENT_TEST');
        expect(devHosts.has('gykrbpykjhpyrdrinkuk.supabase.co')).toBe(true);
        expect(devHosts.has('swratbmclahjyekouned.supabase.co')).toBe(false);
        expect(devHosts.has('evil-attacker.supabase.co')).toBe(false);

        expect(
          sanitizePublicConsumerImageUrl(
            'https://evil-attacker.supabase.co/storage/v1/object/public/product-images/item.webp'
          )
        ).toBeNull();
        expect(
          sanitizePublicConsumerImageUrl(
            'https://gykrbpykjhpyrdrinkuk.supabase.co/storage/v1/object/public/product-images/item.webp',
            'PRODUCTION'
          )
        ).toBeNull();
        expect(
          sanitizePublicConsumerImageUrl(
            'https://swratbmclahjyekouned.supabase.co/storage/v1/object/public/product-images/item.webp',
            'DEVELOPMENT_TEST'
          )
        ).toBeNull();
      } finally {
        process.env.SUPABASE_URL = savedEnv.SUPABASE_URL;
        process.env.VITE_SUPABASE_URL = savedEnv.VITE_SUPABASE_URL;
        process.env.WIFRAN_TRUSTED_SUPABASE_HOSTS = savedEnv.WIFRAN_TRUSTED_SUPABASE_HOSTS;
        process.env.WIFRAN_DB_ENV = savedEnv.WIFRAN_DB_ENV;
      }
    });

    it('enforces V3 profile isolation, unauthorized pilot abort (no silent legacy substitution) & ground-truth leak block (§5/§7)', () => {
      // 1. Normal app cannot activate extraction_v3
      const normalBlocked = runV3PilotProfilePreflight({
        executionContext: 'normal_app',
        requestedProfile: V3_EXTRACTION_PROFILE_ID,
        explicitV3Authorization: true
      });
      expect(normalBlocked.ok).toBe(false);
      expect(normalBlocked.canExecute).toBe(false);
      expect(normalBlocked.v3Activated).toBe(false);
      expect(normalBlocked.actualExecutedProfile).toBe('legacy');
      expect(normalBlocked.abortedReason).toContain('V3_BLOCKED_IN_NORMAL_WORKFLOW');

      // 2. Unauthorized pilot runner requesting extraction_v3 ABORTS cleanly (never silently substitutes legacy)
      const unauthPilot = runV3PilotProfilePreflight({
        executionContext: 'isolated_pilot_runner',
        requestedProfile: V3_EXTRACTION_PROFILE_ID,
        explicitV3Authorization: false
      });
      expect(unauthPilot.ok).toBe(false);
      expect(unauthPilot.canExecute).toBe(false);
      expect(unauthPilot.v3Activated).toBe(false);
      expect(unauthPilot.actualExecutedProfile).toBeNull();
      expect(unauthPilot.abortedReason).toContain('V3_PILOT_UNAUTHORIZED_ABORT');

      // 3. Authorized pilot runner records pinned hashes & telemetry without ground truth leak
      const authPilot = runV3PilotProfilePreflight({
        executionContext: 'isolated_pilot_runner',
        requestedProfile: V3_EXTRACTION_PROFILE_ID,
        explicitV3Authorization: true
      });
      const fp = getV3PromptAndSchemaFingerprints();
      expect(authPilot.ok).toBe(true);
      expect(authPilot.canExecute).toBe(true);
      expect(authPilot.v3Activated).toBe(true);
      expect(authPilot.actualExecutedProfile).toBe(V3_EXTRACTION_PROFILE_ID);
      expect(authPilot.promptVersion).toBe(V3_PROMPT_VERSION);
      expect(authPilot.promptSha256).toBe(fp.promptSha256);
      expect(authPilot.schemaSha256).toBe(fp.schemaSha256);
      expect(authPilot.model).toBe('gemini-3.8-flash');
      expect(authPilot.thinkingLevel).toBe('MEDIUM');
      expect(authPilot.tier).toBe('flex');
      expect(authPilot.vertexLocation).toBe('global');

      // 4. Prompt payload containing offline ground truth aborts fail-closed
      const gtLeakBlocked = runV3PilotProfilePreflight({
        executionContext: 'isolated_pilot_runner',
        requestedProfile: V3_EXTRACTION_PROFILE_ID,
        explicitV3Authorization: true,
        promptPayloadCandidate: '{"expected_sub_items": ["Vanilla", "Chocolate"]}'
      });
      expect(gtLeakBlocked.ok).toBe(false);
      expect(gtLeakBlocked.groundTruthLeakDetected).toBe(true);
      expect(gtLeakBlocked.actualExecutedProfile).toBeNull();

      // 5. All 4 pages & 12 crops planned for future Stage 2 live V3 pilot exist on disk
      const pilotSpec = JSON.parse(
        readFileSync(join(REPO_ROOT, 'src', 'shared', 'fixtures', 'v3', 'pilot_4pages_12crops_spec.json'), 'utf8')
      );
      expect(pilotSpec.status).toBe('PLANNED_NOT_EXECUTED');
      expect(pilotSpec.live_calls_executed).toBe(0);
      expect(pilotSpec.pages).toHaveLength(4);
      expect(pilotSpec.crops).toHaveLength(12);
      for (const p of pilotSpec.pages) {
        expect(existsSync(join(REPO_ROOT, p.file_path)), p.file_path).toBe(true);
      }
      for (const c of pilotSpec.crops) {
        expect(existsSync(join(REPO_ROOT, c.file_path)), c.file_path).toBe(true);
        expect(existsSync(join(REPO_ROOT, c.existing_extraction_json)), c.existing_extraction_json).toBe(true);
      }
    });
  });
});
