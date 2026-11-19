/**
 * WIFRAN-EXTRACTOR-IDENTITY-005H (WP7 — Stage A Preflight)
 * Comprehensive Offline Verification Suite covering WP7-A through WP7-H:
 *   - WP7-A: Wafir (Noori #7) generalizable selection, catalog-match gate, limitation note,
 *            and stratified Independent P2 Quality Audit.
 *   - WP7-B: Immutable 12-crop provenance ledger + strict source-lineage quarantine guard.
 *   - WP7-C: Unambiguous vision vs catalog vs publication statuses + WP6 backward aliases.
 *   - WP7-D: Page-context positive/negative/ambiguous scoping, exclusions, regional scope, limits.
 *   - WP7-E: Compound card multi-tier separation readiness (Panda Sun Top R3C1 fixture).
 *   - WP7-F: Live Gemini/Vertex Flex adapter offline testing via mock @google/genai client.
 *   - WP7-G: 10 consumer safety invariants & static isolation from legacy deterministicOfferChecks.
 *
 * Strictly offline: ZERO live Gemini/Vertex API calls, ZERO Supabase writes.
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import type { OfferContractV3Record } from '../../../shared/types/extractorContractV3';
import {
  LEGACY_WP6_STATUS_ALIAS_MAP,
  mapHybridStatusToLegacyWp6Alias,
  type CropLineageMetadata
} from '../../../shared/types/hybridExtractionV3';
import { parseOfferContractV3Record } from '../../../shared/schemas/leafletPageExtractionV3Schema';
import {
  assessPageContextVerificationNeed,
  evaluateCardForCropVerification,
  markDecisionAsIndependentP2Audit,
  selectIndependentP2AuditSample
} from '../hybrid/hybridCropSelector';
import { applyScopedPageContextToCards } from '../hybrid/hybridPageContextVerifier';
import { reconcilePageAndCropCards } from '../hybrid/hybridEvidenceReconciler';
import {
  PILOT_005E_CROP_PROVENANCE_LEDGER,
  findPilotCropProvenanceBySlotId,
  verifyCropSourceLineage
} from '../hybrid/pilotCropProvenanceLedger';
import {
  createOffline005eReplayProvider,
  runHybridPageWorkflow
} from '../hybrid/hybridWorkflowOrchestrator';
import {
  createHybridGeminiLiveProvider,
  preflightHybridLiveProvider
} from '../hybrid/hybridGeminiLiveProvider';
import {
  auditHybridSafetyInvariants,
  verifyHybridIsolationFromLegacyChecks
} from '../hybrid/hybridSafetyInvariants';

const REPO_ROOT = resolve(__dirname, '../../../..');
const RESPONSES_DIR = join(REPO_ROOT, 'Extracts/pilot_v3_005e/responses');

function sha256File(absPath: string): string {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex');
}

function loadRawJson(slotId: string): any {
  const raw = JSON.parse(readFileSync(join(RESPONSES_DIR, `${slotId}.raw.json`), 'utf8'));
  return raw.parsedResponse || JSON.parse(raw.rawResponseText);
}

function makePackagedCard(overrides?: {
  sourceOfferId?: string;
  leafletId?: string;
  pageNumber?: number;
  titleAr?: string | null;
  titleEn?: string | null;
  variantOrFlavor?: string | null;
  domain?: OfferContractV3Record['non_grocery_specs']['domain'];
  promoPrice?: number | null;
  originalPrice?: number | null;
  currency?: string | null;
  loyaltyRequired?: boolean;
  promoConditions?: string | null;
  multibuyQty?: number | null;
  mfgPackCount?: number | null;
  saleBasis?: OfferContractV3Record['quantity_and_promo']['sale_basis'];
  priceBasis?: OfferContractV3Record['pricing']['price_basis'];
  hasIndependentPkgEvidence?: boolean;
  hasMultiplePriceBadges?: boolean;
}): OfferContractV3Record {
  const srcId = overrides?.sourceOfferId || 'test-leaflet_p001_001';
  const evidence: OfferContractV3Record['evidence_ledger'] = [
    {
      evidence_id: `ev_${srcId}_caption`,
      target_field: 'quantity_and_promo.each_size_value',
      evidence_type: 'printed_leaflet_text',
      extracted_value: '500g',
      original_source_evidence: overrides?.titleEn ?? overrides?.titleAr ?? 'Caption 500g',
      normalized_value: 500,
      confidence: 'high',
      source_ref_internal: 'page_caption',
      operator_correction: null
    }
  ];
  if (overrides?.hasIndependentPkgEvidence) {
    evidence.push({
      evidence_id: `ev_${srcId}_pkg`,
      target_field: 'product_identity.packaging_confirmation',
      evidence_type: 'printed_package_label',
      extracted_value: '500g',
      original_source_evidence: '[high_res_crop] 500g label',
      normalized_value: '500g',
      confidence: 'high',
      source_ref_internal: 'crop.png',
      operator_correction: null
    });
  }

  return parseOfferContractV3Record({
    schema_version: 'wifran.extractor.card/3.0',
    source_card: {
      leaflet_id: overrides?.leafletId || 'test-leaflet',
      page_number: overrides?.pageNumber ?? 1,
      source_offer_id: srcId,
      source_evidence_ref_internal: 'private/page1.png',
      retailer_id: 'sm-test',
      retailer_name: 'GenericMart',
      offer_start_date: '2026-11-01',
      offer_end_date: '2026-11-10',
      location_scope: 'national',
      city_id: null,
      region_id: null,
      raw_text: {
        title_ar:
          overrides && 'titleAr' in overrides
            ? overrides.titleAr
            : 'مسحوق غسيل أزرق 2.5 كجم',
        title_en:
          overrides && 'titleEn' in overrides
            ? overrides.titleEn
            : 'Blue Detergent Powder 2.5kg',
        size_text: '500g',
        promo_badge_text: null,
        price_text_candidates: ['19.95', '29.95']
      }
    },
    pricing: {
      promo_price: overrides && 'promoPrice' in overrides ? overrides.promoPrice : 19.95,
      original_price:
        overrides && 'originalPrice' in overrides ? overrides.originalPrice : 29.95,
      currency: overrides && 'currency' in overrides ? overrides.currency : 'SAR',
      currency_evidence: 'SAR',
      price_basis: overrides?.priceBasis ?? 'each',
      price_role_confidence: 'high',
      promo_conditions: overrides?.promoConditions ?? null,
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
        product_name_en: overrides?.titleEn ?? 'Blue Detergent Powder',
        product_name_ar: overrides?.titleAr ?? 'مسحوق غسيل أزرق',
        brand_en: 'TestBrand',
        brand_ar: 'تست',
        variant_or_flavor: overrides?.variantOrFlavor ?? null,
        product_form: null,
        each_size_value: 500,
        each_size_unit: 'g',
        manufacturer_pack_count: overrides?.mfgPackCount ?? 1,
        printed_retailer_sku_code: null,
        is_retailer_sku_only_not_gtin: true,
        evidence_refs: [`ev_${srcId}_caption`],
        unknown_attributes: [],
        conflict_attributes: [],
        safe_for_catalog_matching: true
      }
    ],
    quantity_and_promo: {
      each_size_value: 500,
      each_size_unit: 'g',
      manufacturer_pack_count: overrides?.mfgPackCount ?? 1,
      retailer_checkout_multibuy_qty: overrides?.multibuyQty ?? null,
      factory_bonus_paid_qty: null,
      factory_bonus_free_qty: null,
      shared_promotional_price: overrides?.promoPrice ?? 19.95,
      quantity_price_tiers: [],
      sale_basis: overrides?.saleBasis ?? 'single_unit',
      is_per_weight_pricing: false,
      loyalty_required: overrides?.loyaltyRequired ?? false,
      loyalty_program_name: null,
      customer_limit_pcs: null
    },
    non_grocery_specs: {
      domain: overrides?.domain ?? 'grocery',
      excluded_from_default_grocery_feed:
        overrides?.domain === 'electronics' ||
        overrides?.domain === 'appliance' ||
        overrides?.domain === 'textiles_home' ||
        overrides?.domain === 'other_non_grocery'
    },
    compound_card_context: overrides?.hasMultiplePriceBadges
      ? {
          compound_group_id: `${srcId}_group`,
          card_shared_caption_en: overrides?.titleEn ?? null,
          card_shared_caption_ar: overrides?.titleAr ?? null,
          has_multiple_price_badges_in_card: true,
          has_different_packaging_across_entries: true,
          inherited_caption_attributes_requiring_override: ['promo_price']
        }
      : null,
    evidence_ledger: evidence,
    evidence_conflicts: [],
    printed_retailer_sku_codes: [],
    extraction_confidence: 'high'
  });
}

describe('WIFRAN-EXTRACTOR-IDENTITY-005H (WP7 Stage A Preflight)', () => {
  it('WP7-A: flags Wafir (Noori #7) via generalizable geometry+evidence risk rules and quarantines after crop replay', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'wp7-wafir-'));
    try {
      const provider = createOffline005eReplayProvider({
        'noori-jeddah-2026-11-15::p1': {
          pageSlotId: 'pilot_page_03_noori_p001',
          rawPageFile: join(RESPONSES_DIR, 'pilot_page_03_noori_p001.raw.json'),
          savedCropFilesByOfferNumber: {
            2: join(RESPONSES_DIR, 'pilot_crop_08_fakieh_compound.raw.json'),
            7: join(RESPONSES_DIR, 'pilot_crop_10_wafir_conflict_negative.raw.json'),
            8: join(RESPONSES_DIR, 'pilot_crop_09_softy_arabic_only_bonus.raw.json')
          }
        }
      });

      const res = await runHybridPageWorkflow({
        executionContext: 'isolated_hybrid_workflow',
        explicitAuthorization: true,
        featureEnabled: true,
        runId: 'wp7-noori-wafir-test',
        leafletId: 'noori-jeddah-2026-11-15',
        pageNumber: 1,
        retailer: 'Noori Supermarket',
        retailerId: 'sm-noori',
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
        budgetPolicy: { maxCropsPerPage: 15, maxSpendUsdPerPage: 0.15 },
        auditedPilotSlotByOfferNumber: {
          2: 'pilot_crop_08_fakieh_compound',
          7: 'pilot_crop_10_wafir_conflict_negative',
          8: 'pilot_crop_09_softy_arabic_only_bonus'
        },
        provider
      });

      expect(res.ok).toBe(true);
      const wafir = res.reconciledCards.find((c) => c.offerNumber === 7)!;
      expect(wafir.selectionDecision.priority).toBe('P0');
      expect(wafir.selectionDecision.triggerCodes).toContain(
        'UNVERIFIED_PACKAGING_EVIDENCE_FOR_IDENTITY'
      );
      expect(wafir.selectionDecision.triggerCodes).toContain('DENSE_OR_SMALL_PACKAGING_TEXT');
      expect(wafir.cropExecuted).toBe(true);
      expect(wafir.overallStatus).toBe('quarantined_conflict');
      expect(wafir.visionVerificationStatus).toBe('vision_quarantined_conflict');
      expect(wafir.catalogVerificationStatus).toBe('blocked_conflict_or_incomplete');
      expect(wafir.publicationAssessment.isEligibleForNonCatalogPublication).toBe(false);
      expect(
        wafir.reconciledCard.evidence_ledger.some(
          (e) => e.evidence_type === 'printed_package_label'
        )
      ).toBe(true);
      expect(
        wafir.reconciledCard.evidence_ledger.some(
          (e) => e.evidence_type === 'printed_leaflet_text'
        )
      ).toBe(true);

      // P2 caption-only packaged card requires crop verification before catalog matching
      const largeCleanP2 = makePackagedCard({
        sourceOfferId: 'clean-large-p2',
        hasIndependentPkgEvidence: false
      });
      const selP2 = evaluateCardForCropVerification(largeCleanP2, {
        components: {
          product_graphic_box: [100, 100, 500, 500] // 16% normalized area >= 2.5%
        }
      });
      expect(selP2.priority).toBe('P2');
      expect(selP2.requiresCropVerificationForCatalogMatch).toBe(true);
      expect(selP2.knownLimitationNote).toContain('caption evidence only');

      const [reconciledP2] = reconcilePageAndCropCards({
        pageCard: largeCleanP2,
        selectionDecision: selP2,
        cropCards: [],
        cropExecuted: false,
        cropStatus: 'not_needed',
        cropLineage: null,
        failClosedOnUnverifiedP0: true
      });
      expect(reconciledP2.requiresCropVerificationForCatalogMatch).toBe(true);
      expect(reconciledP2.catalogVerificationStatus).toBe(
        'crop_verification_required_before_catalog_match'
      );
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('WP7-A: stratified Independent P2 Quality Audit selects deterministic samples and tracks separate audit cost', async () => {
    const c1 = makePackagedCard({ sourceOfferId: 'p2_groc_1', domain: 'grocery' });
    const c2 = makePackagedCard({ sourceOfferId: 'p2_groc_2', domain: 'grocery' });
    const c3 = makePackagedCard({ sourceOfferId: 'p2_home_1', domain: 'household' });
    const c4 = makePackagedCard({
      sourceOfferId: 'p2_nongroc_1',
      domain: 'textiles_home'
    });

    const items = [c1, c2, c3, c4].map((card) => ({
      card,
      decision: evaluateCardForCropVerification(card, {
        components: { product_graphic_box: [100, 100, 450, 450] }
      })
    }));

    const run1 = selectIndependentP2AuditSample({
      items,
      enabled: true,
      sampleRate: 0.5,
      seed: 'audit-seed-1'
    });
    const run2 = selectIndependentP2AuditSample({
      items,
      enabled: true,
      sampleRate: 0.5,
      seed: 'audit-seed-1'
    });
    expect(run1.selectedOfferIds).toEqual(run2.selectedOfferIds);
    expect(run1.selectedOfferIds.length).toBe(2);

    const tagged = markDecisionAsIndependentP2Audit(
      items[0].decision,
      run1.stratumByOfferId[items[0].decision.sourceOfferId],
      { samplingRate: 0.5, seed: 'audit-seed-1' }
    );
    expect(tagged.priority).toBe('P2');
    expect(tagged.needsCrop).toBe(true);
    expect(tagged.triggerCodes).toContain('INDEPENDENT_P2_QUALITY_AUDIT');
    expect(tagged.p2Audit?.selectedForAudit).toBe(true);
  });

  it('WP7-B: verifies immutable 12-crop provenance hashes and rejects mismatched crop lineage fail-closed', () => {
    expect(PILOT_005E_CROP_PROVENANCE_LEDGER.length).toBe(12);
    expect(Object.isFrozen(PILOT_005E_CROP_PROVENANCE_LEDGER)).toBe(true);
    expect(findPilotCropProvenanceBySlotId('pilot_crop_12_noori_compound_weight')).toBeUndefined();

    const fakiehNoori = findPilotCropProvenanceBySlotId('pilot_crop_08_fakieh_compound')!;
    expect(fakiehNoori.sourceOfferId).toBe('noori-supermarket-229798534-jeddah_p001_002');
    expect(fakiehNoori.historicalNote).toContain('pilot_crop_12_noori_compound_weight');

    for (const entry of PILOT_005E_CROP_PROVENANCE_LEDGER) {
      expect(Object.isFrozen(entry)).toBe(true);
      const cropAbs = join(REPO_ROOT, entry.cropImagePath);
      const rawAbs = join(REPO_ROOT, entry.rawResponseArchivePath);
      expect(existsSync(cropAbs)).toBe(true);
      expect(existsSync(rawAbs)).toBe(true);
      expect(sha256File(cropAbs)).toBe(entry.assetSha256);
      expect(sha256File(rawAbs)).toBe(entry.rawResponseSha256);
    }

    const tamperedLineage: CropLineageMetadata = {
      cropId: 'tampered_crop',
      parentSourceOfferId: 'panda-national-national-2026-10-20_p002_007',
      regionKind: 'offer_card',
      expectedLeafletId: 'panda-national-national-2026-10-20',
      expectedPageNumber: 2,
      expectedOfferNumber: 7,
      manifestSlotId: 'pilot_crop_10_wafir_conflict_negative',
      sourcePageImagePath: 'Extracts/Panda_Test/pages/page.2.png',
      sourcePageWidth: 2067,
      sourcePageHeight: 2923,
      rawUnionNormalizedBox: [100, 100, 400, 400],
      paddedNormalizedBox: [90, 90, 410, 410],
      pixelBox: { x: 100, y: 100, width: 300, height: 300 },
      paddingRatio: 0.08,
      cropImagePath:
        'Extracts/noori-supermarket-229798534-jeddah/metadata/rev1/page-001/crops/offer-008/offer_card_crop.webp',
      cropSha256: '0000000000000000000000000000000000000000000000000000000000000000',
      geometryValid: true,
      geometryIssues: []
    };

    const mismatchCheck = verifyCropSourceLineage({
      expectedSourceOfferId: 'panda-national-national-2026-10-20_p002_007',
      expectedLeafletId: 'panda-national-national-2026-10-20',
      expectedPageNumber: 2,
      expectedOfferNumber: 7,
      cropLineage: tamperedLineage,
      cropCards: []
    });
    expect(mismatchCheck.verified).toBe(false);
    expect(mismatchCheck.rejectionReason).toContain('LINEAGE_LEAFLET_MISMATCH');

    const card = makePackagedCard({
      sourceOfferId: 'panda-national-national-2026-10-20_p002_007',
      leafletId: 'panda-national-national-2026-10-20',
      pageNumber: 2
    });
    const [quarantined] = reconcilePageAndCropCards({
      pageCard: card,
      selectionDecision: evaluateCardForCropVerification(card),
      cropCards: [makePackagedCard()],
      cropExecuted: true,
      cropStatus: 'executed',
      cropLineage: tamperedLineage,
      failClosedOnUnverifiedP0: true,
      expectedLeafletId: 'panda-national-national-2026-10-20',
      expectedPageNumber: 2
    });
    expect(quarantined.cropStatus).toBe('invalid_lineage');
    expect(quarantined.cropExecuted).toBe(false);
    expect(quarantined.overallStatus).toBe('held_unverified_p0_budget_or_failure');
    expect(quarantined.publicationAssessment.isEligibleForNonCatalogPublication).toBe(false);
  });

  it('WP7-C: separates vision verification status from catalog matching status with WP6 backward aliases', () => {
    expect(mapHybridStatusToLegacyWp6Alias('evidence_confirmed_single_sku')).toBe(
      'verified_single_sku'
    );
    expect(mapHybridStatusToLegacyWp6Alias('evidence_confirmed_multi_sku')).toBe(
      'verified_decomposed_multi_sku'
    );
    expect(mapHybridStatusToLegacyWp6Alias('evidence_confirmed_compound_tiers')).toBe(
      'verified_compound_tiers'
    );
    expect(LEGACY_WP6_STATUS_ALIAS_MAP.evidence_confirmed_single_sku).toBe('verified_single_sku');
  });

  it('WP7-D: handles page-context exclusions, regional scope, limits, positive exceptions, and rejects ambiguous scope', () => {
    const card1 = makePackagedCard({ sourceOfferId: 'ctx_p001_001' });
    const card2 = makePackagedCard({ sourceOfferId: 'ctx_p001_002' });
    const card3NonMember = makePackagedCard({
      sourceOfferId: 'ctx_p001_003',
      promoConditions: 'Regular customer non-member price'
    });

    const need = assessPageContextVerificationNeed({
      cards: [card1, card2, card3NonMember],
      isLoyaltyPage: false,
      loyaltyProgramName: null,
      validityStartDate: null,
      validityEndDate: null,
      pageCurrency: 'SAR',
      ignoredBanners: [
        'Members Only Rewards | Valid in Jeddah branches only | Limit 3 per customer | Excludes baby milk'
      ]
    });
    expect(need.needsPageContextVerification).toBe(true);
    expect(need.triggerCodes).toContain('PAGE_WIDE_EXCLUSIONS_SUSPECTED');
    expect(need.triggerCodes).toContain('PAGE_WIDE_REGIONAL_SCOPE_SUSPECTED');
    expect(need.triggerCodes).toContain('PAGE_WIDE_CUSTOMER_LIMIT_SUSPECTED');
    expect(need.recommendedRegions.some((r) => r.regionKind === 'full_page_context')).toBe(true);

    // Negative/ambiguous case: missing explicit_scope_evidence refuses broad propagation
    const ambiguous = applyScopedPageContextToCards({
      cards: [card1, card2, card3NonMember],
      offerNumbers: [1, 2, 3],
      pageContext: {
        verified: true,
        is_loyalty_page: true,
        loyalty_program_name: 'MemberClub',
        applies_to_all_page_offers: true,
        explicit_scope_evidence: null,
        validity_start_date: '2026-11-01',
        validity_end_date: '2026-11-07',
        page_currency: 'SAR',
        page_wide_customer_limit_pcs: 3,
        page_wide_exclusions: ['Excludes baby milk'],
        regional_scope: 'Jeddah branches',
        exception_offer_numbers: [2],
        sourceRegionKind: 'page_header'
      }
    });
    expect(ambiguous.loyaltyPropagatedCount).toBe(0);
    expect(ambiguous.notes[0]).toContain('explicit_scope_evidence is empty');

    // Positive scoped application: propagates loyalty + limit + disclosures while preserving #2 exception and #3 non-member tier
    const positive = applyScopedPageContextToCards({
      cards: [card1, card2, card3NonMember],
      offerNumbers: [1, 2, 3],
      pageContext: {
        verified: true,
        is_loyalty_page: true,
        loyalty_program_name: 'MemberClub',
        applies_to_all_page_offers: true,
        explicit_scope_evidence: 'Header reads "MemberClub offers across page except offer #2"',
        scope_proof_quote: 'MemberClub offers across page except #2',
        validity_start_date: '2026-11-01',
        validity_end_date: '2026-11-07',
        page_currency: 'SAR',
        page_wide_customer_limit_pcs: 3,
        page_wide_exclusions: ['Excludes baby formula'],
        regional_scope: 'Jeddah branches only',
        exception_offer_numbers: [2],
        sourceRegionKind: 'page_header'
      }
    });
    expect(positive.loyaltyPropagatedCount).toBe(1);
    expect(positive.updatedCards[0].quantity_and_promo.loyalty_required).toBe(true);
    expect(positive.updatedCards[0].quantity_and_promo.customer_limit_pcs).toBe(3);
    expect(positive.updatedCards[0].pricing.promo_conditions).toContain('Jeddah branches only');
    expect(positive.updatedCards[0].pricing.promo_conditions).toContain('Excludes baby formula');
    expect(positive.updatedCards[1].quantity_and_promo.loyalty_required).toBe(false);
    expect(positive.updatedCards[1].quantity_and_promo.customer_limit_pcs).toBeNull();
    expect(positive.updatedCards[2].quantity_and_promo.loyalty_required).toBe(false);
  });

  it('WP7-E: enforces fail-closed hold on unrecovered compound Sun Top R3C1 and splits cleanly when crop tiers arrive', () => {
    const sunTopPageCard = makePackagedCard({
      sourceOfferId: 'panda-national-national-2026-10-20_p002_007',
      leafletId: 'panda-national-national-2026-10-20',
      pageNumber: 2,
      titleAr: 'سن توب شراب فواكه 1 لتر',
      titleEn: 'Sun Top Fruit Drink 1 L',
      promoPrice: 41.99,
      originalPrice: 54.0,
      loyaltyRequired: true,
      multibuyQty: 3,
      mfgPackCount: 1,
      saleBasis: 'multi_buy_checkout',
      priceBasis: 'buy_n',
      hasMultiplePriceBadges: true
    });

    const sel = evaluateCardForCropVerification(sunTopPageCard);
    expect(sel.priority).toBe('P0');
    expect(sel.triggerCodes).toContain('COMPOUND_MULTI_TIER_OR_UNPAIRED_WEIGHT');

    // Unrecovered without crop: MUST stay held fail-closed
    const [heldResult] = reconcilePageAndCropCards({
      pageCard: sunTopPageCard,
      selectionDecision: sel,
      cropCards: [],
      cropExecuted: false,
      cropStatus: 'missing_offline_archive',
      cropLineage: null,
      failClosedOnUnverifiedP0: true
    });
    expect(heldResult.tierCompletenessUnresolved).toBe(true);
    expect(heldResult.overallStatus).toBe('held_unverified_p0_budget_or_failure');
    expect(heldResult.publicationAssessment.isEligibleForNonCatalogPublication).toBe(false);

    // Recovered compound tiers fixture (41.99 / 3 pcs loyalty vs 15.99 / 1 pc non-member)
    const tierLoyalty = makePackagedCard({
      sourceOfferId: 'sun_top_t1',
      leafletId: 'panda-national-national-2026-10-20',
      pageNumber: 2,
      titleEn: 'Sun Top Fruit Drink 1 L (3 pcs Loyalty)',
      promoPrice: 41.99,
      originalPrice: 54.0,
      loyaltyRequired: true,
      multibuyQty: 3,
      mfgPackCount: 3, // Intentionally polluted in raw tier output to verify WP7-E guardrail clears it!
      saleBasis: 'multi_buy_checkout',
      priceBasis: 'buy_n'
    });
    const tierRegular = makePackagedCard({
      sourceOfferId: 'sun_top_t2',
      leafletId: 'panda-national-national-2026-10-20',
      pageNumber: 2,
      titleEn: 'Sun Top Fruit Drink 1 L (Single Non-Member)',
      promoPrice: 15.99,
      originalPrice: 18.0,
      loyaltyRequired: false,
      promoConditions: 'Non-member single item price',
      multibuyQty: 1,
      mfgPackCount: 1,
      saleBasis: 'single_unit',
      priceBasis: 'each'
    });

    const validLineage: CropLineageMetadata = {
      cropId: 'sun_top_crop',
      parentSourceOfferId: sunTopPageCard.source_card.source_offer_id,
      regionKind: 'compound_card_full',
      expectedLeafletId: 'panda-national-national-2026-10-20',
      expectedPageNumber: 2,
      expectedOfferNumber: 0,
      sourcePageImagePath: 'Extracts/Panda_Test/pages/page.2.png',
      sourcePageWidth: 2067,
      sourcePageHeight: 2923,
      rawUnionNormalizedBox: [100, 100, 400, 400],
      paddedNormalizedBox: [90, 90, 410, 410],
      pixelBox: { x: 100, y: 100, width: 300, height: 300 },
      paddingRatio: 0.08,
      cropImagePath: 'temp/sun_top_crop.png',
      cropSha256: 'abc123',
      geometryValid: true,
      geometryIssues: []
    };

    const splitTiers = reconcilePageAndCropCards({
      pageCard: sunTopPageCard,
      selectionDecision: sel,
      cropCards: [tierLoyalty, tierRegular],
      cropExecuted: true,
      cropStatus: 'executed',
      cropLineage: validLineage,
      failClosedOnUnverifiedP0: true,
      expectedLeafletId: 'panda-national-national-2026-10-20',
      expectedPageNumber: 2,
      expectedSourcePageImagePath: 'Extracts/Panda_Test/pages/page.2.png'
    });

    expect(splitTiers.length).toBe(2);
    expect(splitTiers[0].overallStatus).toBe('evidence_confirmed_compound_tiers');
    expect(splitTiers[0].legacyOverallStatusAlias).toBe('verified_compound_tiers');
    expect(splitTiers[0].reconciledCard.pricing.promo_price).toBe(41.99);
    expect(splitTiers[0].reconciledCard.quantity_and_promo.loyalty_required).toBe(true);
    expect(splitTiers[0].reconciledCard.quantity_and_promo.manufacturer_pack_count).toBe(1);
    expect(splitTiers[1].reconciledCard.pricing.promo_price).toBe(15.99);
    expect(splitTiers[1].reconciledCard.quantity_and_promo.loyalty_required).toBe(false);
    expect(splitTiers.every((t) => t.tierCompletenessUnresolved === false)).toBe(true);
  });

  it('WP7-F: offline-tests HybridGeminiLiveProvider using mocked @google/genai client and saved 005E JSONs', async () => {
    const disabledPreflight = preflightHybridLiveProvider({
      executionContext: 'normal_app',
      featureEnabled: false,
      explicitLiveAuthorization: false
    });
    expect(disabledPreflight.ok).toBe(false);
    expect(disabledPreflight.reason).toContain('HYBRID_LIVE_CONTEXT_BLOCKED');

    const workDir = mkdtempSync(join(tmpdir(), 'wp7-live-mock-'));
    try {
      const nooriPageJson = loadRawJson('pilot_page_03_noori_p001');
      const fakiehCropJson = loadRawJson('pilot_crop_08_fakieh_compound');

      const seenRequests: any[] = [];
      let callMode: 'normal' | 'max_tokens' | 'timeout' = 'normal';

      const mockClient = {
        vertexai: true,
        models: {
          async generateContent(params: any) {
            seenRequests.push(params);
            if (callMode === 'timeout') {
              const err = new Error('Request timeout ETIMEDOUT after 300000ms');
              err.name = 'AbortError';
              throw err;
            }
            if (callMode === 'max_tokens') {
              return {
                text: '{"offers":[',
                candidates: [{ finishReason: 'MAX_TOKENS' }],
                usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 16384 }
              };
            }
            const prompt = String(params?.contents?.[0]?.parts?.[1]?.text || '');
            if (prompt.includes('Inspect leaflet page context')) {
              return {
                text: JSON.stringify({
                  verified: true,
                  is_loyalty_page: true,
                  loyalty_program_name: 'MockClub',
                  applies_to_all_page_offers: true,
                  explicit_scope_evidence: 'Header shows MockClub',
                  scope_proof_quote: 'MockClub Member Prices',
                  validity_start_date: '2026-11-01',
                  validity_end_date: '2026-11-10',
                  page_currency: 'SAR',
                  page_wide_customer_limit_pcs: 4,
                  page_wide_exclusions: ['Excludes electronics'],
                  regional_scope: 'All branches',
                  exception_offer_numbers: []
                }),
                candidates: [{ finishReason: 'STOP' }],
                usageMetadata: {
                  promptTokenCount: 1800,
                  candidatesTokenCount: 250,
                  thoughtsTokenCount: 120,
                  totalTokenCount: 2170
                }
              };
            }
            const isCrop = prompt.includes('crop');
            return {
              text: JSON.stringify(isCrop ? fakiehCropJson : nooriPageJson),
              candidates: [{ finishReason: 'STOP' }],
              usageMetadata: {
                promptTokenCount: isCrop ? 1200 : 3200,
                candidatesTokenCount: isCrop ? 900 : 4100,
                thoughtsTokenCount: 500,
                totalTokenCount: isCrop ? 2600 : 7800
              }
            };
          }
        }
      };

      const provider = createHybridGeminiLiveProvider({
        executionContext: 'isolated_hybrid_workflow',
        featureEnabled: true,
        explicitLiveAuthorization: true,
        archiveDir: workDir,
        client: mockClient
      });

      const pageRes = await provider.extractPage({
        requestKind: 'full_page',
        cacheKey: 'page_k1',
        leafletId: 'noori-jeddah-2026-11-15',
        pageNumber: 1,
        retailer: 'Noori Supermarket',
        imagePath: join(
          REPO_ROOT,
          'Extracts/noori-supermarket-229798534-jeddah/pages/page.1.png'
        ),
        promptText: ''
      });
      expect(pageRes.ok).toBe(true);
      expect(pageRes.finishReason).toBe('STOP');
      expect(pageRes.promptSha256).toBeTruthy();
      expect(pageRes.schemaSha256).toBeTruthy();
      expect(existsSync(pageRes.rawArchivePath!)).toBe(true);
      expect(seenRequests[0].config.httpOptions.headers).toEqual({
        'X-Vertex-AI-LLM-Request-Type': 'shared',
        'X-Vertex-AI-LLM-Shared-Request-Type': 'flex'
      });

      const cropRes = await provider.extractCardCrop({
        requestKind: 'card_crop',
        cacheKey: 'crop_k1',
        leafletId: 'noori-jeddah-2026-11-15',
        pageNumber: 1,
        retailer: 'Noori Supermarket',
        sourceOfferId: 'noori-supermarket-229798534-jeddah_p001_002',
        regionKind: 'offer_card',
        imagePath: join(
          REPO_ROOT,
          'Extracts/noori-supermarket-229798534-jeddah/metadata/rev1/page-001/crops/offer-002/offer_card_crop.webp'
        ),
        promptText: 'Inspect high-res crop'
      });
      expect(cropRes.ok).toBe(true);

      const ctxRes = await provider.verifyPageContext!({
        requestKind: 'page_context',
        cacheKey: 'ctx_k1',
        leafletId: 'noori-jeddah-2026-11-15',
        pageNumber: 1,
        retailer: 'Noori Supermarket',
        regionKind: 'page_header',
        imagePath: join(
          REPO_ROOT,
          'Extracts/noori-supermarket-229798534-jeddah/pages/page.1.png'
        ),
        promptText: 'Inspect leaflet page context'
      });
      expect(ctxRes.ok).toBe(true);
      expect(ctxRes.evidence?.loyalty_program_name).toBe('MockClub');
      expect(ctxRes.evidence?.page_wide_exclusions).toEqual(['Excludes electronics']);

      // Non-STOP finishReason fails with zero automatic retries
      const beforeFailCalls = seenRequests.length;
      callMode = 'max_tokens';
      const maxTokRes = await provider.extractCardCrop({
        requestKind: 'card_crop',
        cacheKey: 'crop_k_max',
        leafletId: 'noori-jeddah-2026-11-15',
        pageNumber: 1,
        retailer: 'Noori Supermarket',
        sourceOfferId: 'offer_x',
        regionKind: 'offer_card',
        imagePath: join(
          REPO_ROOT,
          'Extracts/noori-supermarket-229798534-jeddah/pages/page.1.png'
        ),
        promptText: 'crop'
      });
      expect(maxTokRes.ok).toBe(false);
      expect(maxTokRes.errorCode).toBe('GEMINI_FINISH_REASON_MAX_TOKENS');
      expect(seenRequests.length - beforeFailCalls).toBe(1);

      // Timeout produces outcomeUnknown:true with conservative cost reserve and 0 auto-retries
      callMode = 'timeout';
      const timeoutRes = await provider.extractCardCrop({
        requestKind: 'card_crop',
        cacheKey: 'crop_k_timeout',
        leafletId: 'noori-jeddah-2026-11-15',
        pageNumber: 1,
        retailer: 'Noori Supermarket',
        sourceOfferId: 'offer_t',
        regionKind: 'offer_card',
        imagePath: join(
          REPO_ROOT,
          'Extracts/noori-supermarket-229798534-jeddah/pages/page.1.png'
        ),
        promptText: 'crop'
      });
      expect(timeoutRes.ok).toBe(false);
      expect(timeoutRes.outcomeUnknown).toBe(true);
      expect((timeoutRes.costUsdOverride ?? 0) > 0).toBe(true);
      expect(seenRequests.length - beforeFailCalls).toBe(2);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('WP7-G: audits all 10 consumer safety invariants & proves hybrid path cannot reach deterministicOfferChecks.ts', async () => {
    const isolation = verifyHybridIsolationFromLegacyChecks(REPO_ROOT);
    expect(isolation.hybridClean).toBe(true);
    expect(isolation.hybridReferencingFiles).toEqual([]);
    expect(isolation.activeLegacyCallersFound).toContain(
      'src/main/page-first/pageOfferCanonicalMapper.ts'
    );
    expect(isolation.activeLegacyCallersFound).toContain(
      'src/main/workflow/cropAndItemOcrWorkflow.ts'
    );

    const workDir = mkdtempSync(join(tmpdir(), 'wp7-invariants-'));
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
        runId: 'wp7-invariants-panda',
        leafletId: 'panda-national-national-2026-10-20',
        pageNumber: 2,
        retailer: 'Panda',
        offerStartDate: '2026-10-14',
        offerEndDate: '2026-10-20',
        pageAssetPath: join(REPO_ROOT, 'Extracts/Panda_Test/chunks/chunk-002-pages-002-002.pdf'),
        pageImagePath: join(REPO_ROOT, 'Extracts/Panda_Test/pages/page.2.png'),
        cropOutputDir: workDir,
        budgetPolicy: { enableIndependentP2Audit: true, p2AuditSampleRate: 0.25 },
        auditedPilotSlotByOfferNumber: {
          5: 'pilot_crop_01_baskin_robbins',
          8: 'pilot_crop_02_moussy'
        },
        provider
      });

      const audit = auditHybridSafetyInvariants(res);
      expect(audit.checkedInvariantsCount).toBe(10);
      expect(audit.violations).toEqual([]);
      expect(audit.passed).toBe(true);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
