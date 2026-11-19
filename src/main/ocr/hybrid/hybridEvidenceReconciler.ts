/**
 * WIFRAN-EXTRACTOR-IDENTITY-005G (WP6-E & WP6-F)
 * Field-Level Evidence Reconciliation & Multi-Product / Multi-Tier Reconciler.
 *
 * Reconciles full-page V3 extraction against selective high-resolution crop extraction
 * (and optional page-context verification) without blindly trusting crop over page or
 * erasing genuine printed contradictions.
 */

import type {
  OfferContractV3Record,
  SubItemV3,
  V3ConflictCode
} from '../../../shared/types/extractorContractV3';
import {
  mapHybridStatusToLegacyWp6Alias,
  type CardCropSelectionDecision,
  type CatalogVerificationStatus,
  type CropLineageMetadata,
  type FieldReconciliationEntry,
  type ReconciledCardOverallStatus,
  type ReconciledV3CardResult,
  type VisionVerificationStatus
} from '../../../shared/types/hybridExtractionV3';
import type { OfferPublicationAssessment } from '../../../shared/types/catalogMatching';
import { enforceV3PublicationQuarantineInvariant } from '../../../shared/utils/nonCatalogPublicationPolicy';
import { adaptV3DecompositionToOfflineMatching } from '../../db/v3MatchingInputAdapter';
import { decomposeV3OfferCard } from '../offerV3DecompositionEngine';
import { verifyCropSourceLineage } from './pilotCropProvenanceLedger';

function cloneCard(card: OfferContractV3Record): OfferContractV3Record {
  return JSON.parse(JSON.stringify(card)) as OfferContractV3Record;
}

function toCanonicalSizeBase(
  value: number | null,
  unit: string | null
): { baseValue: number; baseUnit: 'g' | 'ml' | string } | null {
  if (value == null || !Number.isFinite(value) || value <= 0 || !unit) return null;
  const u = unit.toLowerCase();
  if (u === 'kg') return { baseValue: value * 1000, baseUnit: 'g' };
  if (u === 'g') return { baseValue: value, baseUnit: 'g' };
  if (u === 'l') return { baseValue: value * 1000, baseUnit: 'ml' };
  if (u === 'ml') return { baseValue: value, baseUnit: 'ml' };
  return { baseValue: value, baseUnit: u };
}

function numbersNearlyEqual(a: number | null, b: number | null, eps = 0.015): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= eps;
}

const PRINTED_CONTRADICTION_CODES: ReadonlySet<V3ConflictCode> = new Set([
  'EN_AR_WEIGHT_VOLUME_CONFLICT',
  'EN_AR_PACK_COUNT_CONFLICT',
  'TEXT_VS_IMAGE_CONFLICT',
  'PRICE_ROLE_AMBIGUOUS',
  'PROMO_QTY_VS_MFG_PACK_CONFLICT'
]);

const INCOMPLETE_ASSORTMENT_CONFLICTS: ReadonlySet<V3ConflictCode> = new Set([
  'UNLABELED_SWATCH_OR_BOTTLE_VARIANTS',
  'INCOMPLETE_VISIBLE_ASSORTMENT',
  'RETAILER_SKU_WITHOUT_VARIANT_NAMES'
]);

function buildSafetyOutputs(
  card: OfferContractV3Record,
  options: {
    forceUnverifiedP0Hold?: boolean;
    holdReason?: string;
    suppressCatalogMatching?: boolean;
    enforceNonExpiredForPublication?: boolean;
    publicationReferenceDateIso?: string | null;
  } = {}
): {
  decomposition: ReturnType<typeof decomposeV3OfferCard>;
  publicationAssessment: OfferPublicationAssessment;
  matchingAdapterSummary: ReconciledV3CardResult['matchingAdapterSummary'];
} {
  const decomposition = decomposeV3OfferCard(card);
  const adapter = adaptV3DecompositionToOfflineMatching(decomposition, {
    enforceNonExpiredForPublication: options.enforceNonExpiredForPublication,
    publicationReferenceDateIso: options.publicationReferenceDateIso
  });

  let publicationAssessment = enforceV3PublicationQuarantineInvariant(
    adapter.parentPublicationAssessment,
    {
      parentOfferRetentionMode: decomposition.parent_offer_retention_mode,
      conflictCodes: Array.from(
        new Set([...decomposition.conflict_codes, ...card.evidence_conflicts])
      ),
      currency: card.pricing.currency
    }
  );

  if (options.forceUnverifiedP0Hold) {
    publicationAssessment = {
      ...publicationAssessment,
      outcome: 'quarantined',
      catalogMatchStatus: 'conflict_needs_review',
      isEligibleForNonCatalogPublication: false,
      isSafeForNonCatalogPublication: false,
      comparisonDisabled: true,
      quarantineReasons: Array.from(
        new Set([
          ...publicationAssessment.quarantineReasons,
          options.holdReason || 'UNVERIFIED_P0_HOLD_BUDGET_OR_FAILURE'
        ])
      )
    };
  }

  const shouldSuppressCatalogMatching =
    Boolean(options.suppressCatalogMatching) ||
    decomposition.parent_offer_retention_mode === 'quarantined_do_not_publish' ||
    (publicationAssessment.outcome === 'quarantined' &&
      !publicationAssessment.isEligibleForNonCatalogPublication);

  return {
    decomposition,
    publicationAssessment,
    matchingAdapterSummary: shouldSuppressCatalogMatching
      ? {
          matchableChildrenCount: 0,
          singleSkuMatchEligible: false,
          unresolvedChildrenCount: Math.max(
            adapter.unresolvedChildren.length,
            adapter.matchableChildren.length
          ),
          candidateKeys: [],
          isolatedIdentityTokens: []
        }
      : {
          matchableChildrenCount: adapter.matchableChildren.length,
          singleSkuMatchEligible:
            decomposition.parent_offer_retention_mode === 'unsplit_single_sku' &&
            adapter.matchableChildren.length === 1,
          unresolvedChildrenCount: adapter.unresolvedChildren.length,
          candidateKeys: adapter.matchableChildren.map((c) => c.candidate_key),
          isolatedIdentityTokens: adapter.matchableChildren.map((c) => c.deduplicationKey)
        }
  };
}

const VISION_STATUS_BY_OVERALL: Record<
  ReconciledCardOverallStatus,
  VisionVerificationStatus
> = {
  evidence_confirmed_single_sku: 'vision_evidence_confirmed_single_sku',
  evidence_confirmed_multi_sku: 'vision_evidence_confirmed_multi_sku',
  evidence_confirmed_compound_tiers: 'vision_evidence_confirmed_compound_tiers',
  retained_non_catalog_review: 'vision_retained_non_catalog_review',
  quarantined_conflict: 'vision_quarantined_conflict',
  held_unverified_p0_budget_or_failure: 'vision_held_unverified_p0',
  unverified_page_only_p2: 'vision_unverified_page_only_p2'
};

function buildStatusClassification(input: {
  overallStatus: ReconciledCardOverallStatus;
  cropExecuted: boolean;
  selectionRequiresCropForCatalogMatch: boolean;
  reconciledCard: OfferContractV3Record;
  matchingAdapterSummary: ReconciledV3CardResult['matchingAdapterSummary'];
}): {
  overallStatus: ReconciledCardOverallStatus;
  legacyOverallStatusAlias: ReconciledV3CardResult['legacyOverallStatusAlias'];
  visionVerificationStatus: VisionVerificationStatus;
  catalogVerificationStatus: CatalogVerificationStatus;
  requiresCropVerificationForCatalogMatch: boolean;
} {
  const {
    overallStatus,
    cropExecuted: _cropExecuted,
    selectionRequiresCropForCatalogMatch: _selectionRequiresCropForCatalogMatch,
    reconciledCard: _reconciledCard,
    matchingAdapterSummary
  } = input;

  // Under routine B1-first architecture, missing B2 crop calls do not block catalog matching.
  const requiresCropVerificationForCatalogMatch = false;

  let catalogVerificationStatus: CatalogVerificationStatus = 'not_run_offline';
  if (
    overallStatus === 'quarantined_conflict' ||
    overallStatus === 'held_unverified_p0_budget_or_failure' ||
    overallStatus === 'retained_non_catalog_review'
  ) {
    catalogVerificationStatus = 'blocked_conflict_or_incomplete';
  } else if (requiresCropVerificationForCatalogMatch) {
    catalogVerificationStatus = 'crop_verification_required_before_catalog_match';
  } else if (matchingAdapterSummary.matchableChildrenCount > 0) {
    catalogVerificationStatus = 'candidate_ready_unmatched_pending_catalog_match';
  }

  return {
    overallStatus,
    legacyOverallStatusAlias: mapHybridStatusToLegacyWp6Alias(overallStatus),
    visionVerificationStatus: VISION_STATUS_BY_OVERALL[overallStatus],
    catalogVerificationStatus,
    requiresCropVerificationForCatalogMatch
  };
}

function appendCropPackagingEvidenceEntries(
  targetCard: OfferContractV3Record,
  cropCard: OfferContractV3Record,
  cropImagePath: string | null
): void {
  const existingIds = new Set(targetCard.evidence_ledger.map((e) => e.evidence_id));
  const pkgTypes = new Set([
    'printed_package_label',
    'visible_variant_label',
    'manufacturer_packaging_marking'
  ]);
  let addedPackagingEntry = false;

  for (const entry of cropCard.evidence_ledger || []) {
    if (pkgTypes.has(entry.evidence_type)) {
      const id = entry.evidence_id.startsWith('ev_crop_')
        ? entry.evidence_id
        : `ev_crop_${targetCard.source_card.source_offer_id}_${entry.evidence_id}`;
      if (!existingIds.has(id)) {
        targetCard.evidence_ledger.push({
          ...entry,
          evidence_id: id,
          source_ref_internal: cropImagePath || entry.source_ref_internal
        });
        existingIds.add(id);
        addedPackagingEntry = true;
      }
    }
  }

  if (!addedPackagingEntry) {
    const id = `ev_crop_pkg_${targetCard.source_card.source_offer_id}`;
    if (!existingIds.has(id)) {
      const summaryVal =
        cropCard.quantity_and_promo.each_size_value != null &&
        cropCard.quantity_and_promo.each_size_unit
          ? `${cropCard.quantity_and_promo.each_size_value} ${cropCard.quantity_and_promo.each_size_unit}`
          : cropCard.source_card.raw_text.title_en ||
            cropCard.source_card.raw_text.title_ar ||
            'crop_verified';
      targetCard.evidence_ledger.push({
        evidence_id: id,
        target_field: 'product_identity.packaging_confirmation',
        evidence_type: 'printed_package_label',
        extracted_value: summaryVal,
        original_source_evidence: `[high_res_crop] ${summaryVal}`,
        normalized_value: summaryVal,
        confidence: cropCard.extraction_confidence || 'high',
        source_ref_internal: cropImagePath || targetCard.source_card.source_evidence_ref_internal,
        operator_correction: null
      });
    }
  }
}

function deriveOverallStatus(input: {
  selectionPriority: 'P0' | 'P1' | 'P2';
  cropExecuted: boolean;
  isCompoundMultiTier?: boolean;
  heldUnverifiedP0?: boolean;
  decomposition: ReturnType<typeof decomposeV3OfferCard>;
  publicationAssessment: OfferPublicationAssessment;
}): ReconciledCardOverallStatus {
  if (input.heldUnverifiedP0) {
    return 'held_unverified_p0_budget_or_failure';
  }
  if (
    input.decomposition.parent_offer_retention_mode === 'quarantined_do_not_publish' ||
    (input.publicationAssessment.outcome === 'quarantined' &&
      !input.publicationAssessment.isEligibleForNonCatalogPublication)
  ) {
    return 'quarantined_conflict';
  }
  if (input.isCompoundMultiTier) {
    return 'evidence_confirmed_compound_tiers';
  }
  if (!input.cropExecuted && input.selectionPriority === 'P2') {
    return 'unverified_page_only_p2';
  }
  if (
    input.decomposition.decomposed &&
    input.decomposition.children.length > 0
  ) {
    return 'evidence_confirmed_multi_sku';
  }
  if (input.decomposition.parent_offer_retention_mode === 'unsplit_single_sku') {
    return 'evidence_confirmed_single_sku';
  }
  return 'retained_non_catalog_review';
}

export interface ReconcileCardInput {
  pageCard: OfferContractV3Record;
  selectionDecision: CardCropSelectionDecision;
  cropCards: OfferContractV3Record[];
  cropExecuted: boolean;
  cropStatus: ReconciledV3CardResult['cropStatus'];
  cropLineage: CropLineageMetadata | null;
  failClosedOnUnverifiedP0: boolean;
  expectedLeafletId?: string;
  expectedPageNumber?: number;
  expectedSourcePageImagePath?: string | null;
  auditedPilotManifestSlotId?: string | null;
  enforceNonExpiredForPublication?: boolean;
  publicationReferenceDateIso?: string | null;
}

/**
 * Reconciles a page-extracted V3 offer card with 0, 1, or N crop-extracted V3 cards.
 * Returns 1 result normally, or N independent tier results when a compound card
 * resolves into multiple distinct pricing tiers (`WP6-F` / `WP7-E`).
 * Rejects unverified or mismatched crop source lineage fail-closed (`WP7-B`).
 */
export function reconcilePageAndCropCards(
  input: ReconcileCardInput
): ReconciledV3CardResult[] {
  const {
    pageCard,
    selectionDecision,
    failClosedOnUnverifiedP0
  } = input;
  const parentSourceOfferId = pageCard.source_card.source_offer_id;

  let cropCards = input.cropCards;
  let cropExecuted = input.cropExecuted;
  let cropStatus = input.cropStatus;
  let cropLineage = input.cropLineage ? { ...input.cropLineage } : null;
  let lineageErrorNote: string | null = null;

  if (cropStatus === 'invalid_lineage') {
    cropCards = [];
    cropExecuted = false;
    lineageErrorNote =
      cropLineage?.lineageRejectionReason || 'Crop rejected due to invalid source lineage.';
  } else if (cropCards.length > 0 && cropLineage) {
    const lineageCheck = verifyCropSourceLineage({
      expectedSourceOfferId: parentSourceOfferId,
      expectedLeafletId: input.expectedLeafletId || pageCard.source_card.leaflet_id,
      expectedPageNumber: input.expectedPageNumber ?? pageCard.source_card.page_number,
      expectedOfferNumber: selectionDecision.offerNumber,
      expectedSourcePageImagePath: input.expectedSourcePageImagePath,
      cropLineage,
      cropCards,
      auditedPilotManifestSlotId:
        input.auditedPilotManifestSlotId ?? cropLineage.manifestSlotId ?? null
    });
    if (!lineageCheck.verified) {
      cropCards = [];
      cropExecuted = false;
      cropStatus = 'invalid_lineage';
      cropLineage.lineageVerified = false;
      cropLineage.lineageRejectionReason = lineageCheck.rejectionReason;
      lineageErrorNote = lineageCheck.rejectionReason;
    } else {
      cropLineage.lineageVerified = true;
      cropLineage.lineageRejectionReason = null;
    }
  }

  // Case 1: No crop cards returned (P2 skipped intentionally, P0/P1 failed/budget exhausted, or invalid_lineage fail-closed)
  if (cropCards.length === 0) {
    const isLineageFailure = cropStatus === 'invalid_lineage';
    const isUnverifiedP0Hold =
      (selectionDecision.priority === 'P0' && !cropExecuted && failClosedOnUnverifiedP0) ||
      isLineageFailure;

    const cardCopy = cloneCard(pageCard);
    const safety = buildSafetyOutputs(cardCopy, {
      forceUnverifiedP0Hold: isUnverifiedP0Hold,
      holdReason: isLineageFailure
        ? `INVALID_CROP_LINEAGE`
        : isUnverifiedP0Hold
          ? `UNVERIFIED_P0_${cropStatus.toUpperCase()}`
          : undefined,
      suppressCatalogMatching: isUnverifiedP0Hold,
      enforceNonExpiredForPublication: input.enforceNonExpiredForPublication,
      publicationReferenceDateIso: input.publicationReferenceDateIso
    });

    const overallStatus = deriveOverallStatus({
      selectionPriority: selectionDecision.priority,
      cropExecuted,
      heldUnverifiedP0: isUnverifiedP0Hold,
      decomposition: safety.decomposition,
      publicationAssessment: safety.publicationAssessment
    });
    const statusFields = buildStatusClassification({
      overallStatus,
      cropExecuted,
      selectionRequiresCropForCatalogMatch: selectionDecision.requiresCropVerificationForCatalogMatch,
      reconciledCard: safety.decomposition.normalized_card,
      matchingAdapterSummary: safety.matchingAdapterSummary
    });

    const notes: string[] = [];
    if (lineageErrorNote) {
      notes.push(`Fail-closed crop quarantine (${cropStatus}): ${lineageErrorNote}`);
    } else if (isUnverifiedP0Hold) {
      notes.push(
        `P0 card held fail-closed (${cropStatus}): blocked from catalog matching and auto-publication until high-res verification succeeds.`
      );
    }

    return [
      {
        sourceOfferId: parentSourceOfferId,
        parentSourceOfferId,
        offerNumber: selectionDecision.offerNumber,
        selectionDecision,
        cropExecuted,
        cropStatus,
        cropLineage,
        ...statusFields,
        reconciledCard: safety.decomposition.normalized_card,
        fieldDecisions: [],
        decomposition: safety.decomposition,
        publicationAssessment: safety.publicationAssessment,
        matchingAdapterSummary: safety.matchingAdapterSummary,
        tierCompletenessUnresolved: Boolean(
          cardCopy.compound_card_context?.has_multiple_price_badges_in_card
        ),
        notes
      }
    ];
  }

  // Case 2: Compound multi-tier card split into N distinct tier cards by crop extraction (WP6-F)
  if (cropCards.length > 1) {
    const compoundGroupId =
      pageCard.compound_card_context?.compound_group_id || `${parentSourceOfferId}_compound`;
    const results: ReconciledV3CardResult[] = [];
    const seenTierSignatures = new Set<string>();

    for (let idx = 0; idx < cropCards.length; idx++) {
      const rawTier = cloneCard(cropCards[idx]);
      const tierSig = `${rawTier.pricing.promo_price ?? 'null'}|${rawTier.quantity_and_promo.manufacturer_pack_count ?? 'null'}|${rawTier.quantity_and_promo.retailer_checkout_multibuy_qty ?? 'null'}|${rawTier.quantity_and_promo.each_size_value ?? 'null'}${rawTier.quantity_and_promo.each_size_unit ?? ''}`;
      if (seenTierSignatures.has(tierSig)) {
        continue;
      }
      seenTierSignatures.add(tierSig);

      const tierId = `${parentSourceOfferId}__tier_${idx + 1}`;
      rawTier.source_card.source_offer_id = tierId;
      rawTier.source_card.leaflet_id = pageCard.source_card.leaflet_id;
      rawTier.source_card.page_number = pageCard.source_card.page_number;
      rawTier.source_card.retailer_id =
        rawTier.source_card.retailer_id || pageCard.source_card.retailer_id;
      rawTier.source_card.retailer_name =
        rawTier.source_card.retailer_name || pageCard.source_card.retailer_name;
      rawTier.source_card.offer_start_date =
        rawTier.source_card.offer_start_date || pageCard.source_card.offer_start_date;
      rawTier.source_card.offer_end_date =
        rawTier.source_card.offer_end_date || pageCard.source_card.offer_end_date;
      rawTier.compound_card_context = {
        compound_group_id: compoundGroupId,
        card_shared_caption_en: pageCard.source_card.raw_text.title_en,
        card_shared_caption_ar: pageCard.source_card.raw_text.title_ar,
        has_multiple_price_badges_in_card: true,
        has_different_packaging_across_entries: true,
        inherited_caption_attributes_requiring_override: ['promo_price', 'manufacturer_pack_count']
      };

      // Conservative loyalty: propagate verified page loyalty ONLY if tier does not represent an explicit non-member tier
      if (
        pageCard.quantity_and_promo.loyalty_required &&
        !rawTier.quantity_and_promo.loyalty_required &&
        !cropCards.some((other) => other.quantity_and_promo.loyalty_required)
      ) {
        rawTier.quantity_and_promo.loyalty_required = true;
        rawTier.quantity_and_promo.loyalty_program_name =
          rawTier.quantity_and_promo.loyalty_program_name ||
          pageCard.quantity_and_promo.loyalty_program_name;
      }

      // Guardrail WP7-E: never leak retailer checkout multibuy qty into manufacturer_pack_count
      if (
        rawTier.quantity_and_promo.retailer_checkout_multibuy_qty != null &&
        rawTier.quantity_and_promo.retailer_checkout_multibuy_qty > 1 &&
        rawTier.quantity_and_promo.manufacturer_pack_count ===
          rawTier.quantity_and_promo.retailer_checkout_multibuy_qty &&
        rawTier.quantity_and_promo.sale_basis === 'multi_buy_checkout'
      ) {
        rawTier.quantity_and_promo.manufacturer_pack_count = 1;
      }

      appendCropPackagingEvidenceEntries(
        rawTier,
        cropCards[idx],
        cropLineage?.cropImagePath ?? null
      );

      if (cropLineage?.cropImagePath) {
        rawTier.source_card.source_evidence_ref_internal = cropLineage.cropImagePath;
      }

      const safety = buildSafetyOutputs(rawTier, {
        enforceNonExpiredForPublication: input.enforceNonExpiredForPublication,
        publicationReferenceDateIso: input.publicationReferenceDateIso
      });
      const overallStatus = deriveOverallStatus({
        selectionPriority: selectionDecision.priority,
        cropExecuted,
        isCompoundMultiTier: true,
        decomposition: safety.decomposition,
        publicationAssessment: safety.publicationAssessment
      });
      const statusFields = buildStatusClassification({
        overallStatus,
        cropExecuted,
        selectionRequiresCropForCatalogMatch:
          selectionDecision.requiresCropVerificationForCatalogMatch,
        reconciledCard: safety.decomposition.normalized_card,
        matchingAdapterSummary: safety.matchingAdapterSummary
      });

      results.push({
        sourceOfferId: tierId,
        parentSourceOfferId,
        offerNumber: selectionDecision.offerNumber,
        selectionDecision,
        cropExecuted,
        cropStatus,
        cropLineage,
        ...statusFields,
        reconciledCard: safety.decomposition.normalized_card,
        fieldDecisions: [
          {
            field: 'compound_tier_separation',
            outcome: 'enriched',
            pageValue: pageCard.pricing.promo_price,
            cropValue: rawTier.pricing.promo_price,
            finalValue: rawTier.pricing.promo_price,
            rationale: `Recovered independent compound tier ${idx + 1}/${cropCards.length} from high-res crop without cross-tier price/pack contamination.`
          }
        ],
        decomposition: safety.decomposition,
        publicationAssessment: safety.publicationAssessment,
        matchingAdapterSummary: safety.matchingAdapterSummary,
        tierCompletenessUnresolved: false,
        notes: [
          `Compound card ${parentSourceOfferId} split cleanly into tier ${idx + 1} (${rawTier.pricing.promo_price} ${rawTier.pricing.currency || ''}).`
        ]
      });
    }

    return results;
  }

  // Case 3: 1-to-1 field-level reconciliation
  const normPageDecomp = decomposeV3OfferCard(pageCard);
  const normCropDecomp = decomposeV3OfferCard(cropCards[0]);
  const p = normPageDecomp.normalized_card;
  const c = normCropDecomp.normalized_card;
  const reconciled = cloneCard(p);
  const fieldDecisions: FieldReconciliationEntry[] = [];
  const notes: string[] = [];
  const addedConflicts = new Set<V3ConflictCode>();

  // Helper to record field decisions
  const recordField = (
    field: string,
    outcome: FieldReconciliationEntry['outcome'],
    pageValue: unknown,
    cropValue: unknown,
    finalValue: unknown,
    rationale: string
  ) => {
    fieldDecisions.push({
      field,
      outcome,
      pageValue,
      cropValue,
      finalValue,
      rationale
    });
  };

  // 3A. Promo price & price-role check (§14)
  if (numbersNearlyEqual(p.pricing.promo_price, c.pricing.promo_price)) {
    recordField(
      'pricing.promo_price',
      'confirmed',
      p.pricing.promo_price,
      c.pricing.promo_price,
      reconciled.pricing.promo_price,
      'Page and high-res crop agree on promo price.'
    );
  } else if (p.pricing.promo_price == null && c.pricing.promo_price != null && c.pricing.promo_price > 0) {
    reconciled.pricing.promo_price = c.pricing.promo_price;
    recordField(
      'pricing.promo_price',
      'corrected',
      p.pricing.promo_price,
      c.pricing.promo_price,
      c.pricing.promo_price,
      'High-res crop recovered missing promo price.'
    );
  } else if (c.pricing.promo_price != null && p.pricing.promo_price != null) {
    addedConflicts.add('PRICE_ROLE_AMBIGUOUS');
    recordField(
      'pricing.promo_price',
      'conflict_unresolved',
      p.pricing.promo_price,
      c.pricing.promo_price,
      p.pricing.promo_price,
      `Material promo price disagreement between page (${p.pricing.promo_price}) and crop (${c.pricing.promo_price}); quarantined/escalated instead of overwriting blindly.`
    );
  }

  // 3B. Original price + inversion check (§14)
  if (numbersNearlyEqual(p.pricing.original_price, c.pricing.original_price, 0.05)) {
    recordField(
      'pricing.original_price',
      'confirmed',
      p.pricing.original_price,
      c.pricing.original_price,
      reconciled.pricing.original_price,
      'Page and crop agree on original price.'
    );
  } else if (p.pricing.original_price == null && c.pricing.original_price != null) {
    reconciled.pricing.original_price = c.pricing.original_price;
    recordField(
      'pricing.original_price',
      'enriched',
      null,
      c.pricing.original_price,
      c.pricing.original_price,
      'High-res crop extracted secondary original price omitted on page.'
    );
  } else if (c.pricing.original_price != null && p.pricing.original_price != null) {
    addedConflicts.add('PRICE_ROLE_AMBIGUOUS');
    recordField(
      'pricing.original_price',
      'conflict_unresolved',
      p.pricing.original_price,
      c.pricing.original_price,
      p.pricing.original_price,
      `Original price disagreement between page (${p.pricing.original_price}) and crop (${c.pricing.original_price}).`
    );
  }

  if (
    reconciled.pricing.promo_price != null &&
    reconciled.pricing.original_price != null &&
    reconciled.pricing.promo_price >= reconciled.pricing.original_price
  ) {
    addedConflicts.add('PRICE_ROLE_AMBIGUOUS');
    recordField(
      'pricing.price_role_inversion',
      'quarantined',
      p.pricing.promo_price,
      c.pricing.original_price,
      reconciled.pricing.promo_price,
      'Promo price >= original price triggers mandatory price-role quarantine.'
    );
  }

  // 3C. Currency: strictly fixed internal SAR (never extracted or gated from Gemini)
  reconciled.pricing.currency = 'SAR';
  reconciled.pricing.currency_evidence = 'fixed_sar_internal';

  // 3D. Each size & manufacturer pack count
  const pBase = toCanonicalSizeBase(p.quantity_and_promo.each_size_value, p.quantity_and_promo.each_size_unit);
  const cBase = toCanonicalSizeBase(c.quantity_and_promo.each_size_value, c.quantity_and_promo.each_size_unit);

  if (pBase == null && cBase != null) {
    reconciled.quantity_and_promo.each_size_value = c.quantity_and_promo.each_size_value;
    reconciled.quantity_and_promo.each_size_unit = c.quantity_and_promo.each_size_unit;
    recordField(
      'quantity_and_promo.each_size',
      'corrected',
      null,
      `${c.quantity_and_promo.each_size_value}${c.quantity_and_promo.each_size_unit}`,
      `${c.quantity_and_promo.each_size_value}${c.quantity_and_promo.each_size_unit}`,
      'Crop supplied missing physical size.'
    );
  } else if (
    pBase != null &&
    cBase != null &&
    pBase.baseUnit === cBase.baseUnit &&
    Math.abs(pBase.baseValue - cBase.baseValue) <= Math.max(1, pBase.baseValue * 0.01)
  ) {
    recordField(
      'quantity_and_promo.each_size',
      'confirmed',
      `${p.quantity_and_promo.each_size_value}${p.quantity_and_promo.each_size_unit}`,
      `${c.quantity_and_promo.each_size_value}${c.quantity_and_promo.each_size_unit}`,
      `${reconciled.quantity_and_promo.each_size_value}${reconciled.quantity_and_promo.each_size_unit}`,
      'Page and crop agree on normalized unit size.'
    );
  } else if (pBase != null && cBase != null) {
    addedConflicts.add('TEXT_VS_IMAGE_CONFLICT');
    recordField(
      'quantity_and_promo.each_size',
      'conflict_unresolved',
      `${p.quantity_and_promo.each_size_value}${p.quantity_and_promo.each_size_unit}`,
      `${c.quantity_and_promo.each_size_value}${c.quantity_and_promo.each_size_unit}`,
      `${p.quantity_and_promo.each_size_value}${p.quantity_and_promo.each_size_unit}`,
      'Physical size discrepancy between page and crop; preserved as unresolved conflict.'
    );
  }

  // Pack count reconciliation
  const pPack = p.quantity_and_promo.manufacturer_pack_count;
  const cPack = c.quantity_and_promo.manufacturer_pack_count;
  if (pPack === cPack) {
    recordField(
      'quantity_and_promo.manufacturer_pack_count',
      'confirmed',
      pPack,
      cPack,
      pPack,
      'Page and crop agree on manufacturer pack count.'
    );
  } else if (pPack == null && cPack != null) {
    reconciled.quantity_and_promo.manufacturer_pack_count = cPack;
    recordField(
      'quantity_and_promo.manufacturer_pack_count',
      'corrected',
      null,
      cPack,
      cPack,
      'Crop recovered missing manufacturer pack count.'
    );
  } else if (pPack != null && cPack != null) {
    addedConflicts.add('EN_AR_PACK_COUNT_CONFLICT');
    recordField(
      'quantity_and_promo.manufacturer_pack_count',
      'conflict_unresolved',
      pPack,
      cPack,
      pPack,
      `Manufacturer pack count mismatch between page (${pPack}) and crop (${cPack}).`
    );
  }

  // 3E. Checkout multibuy, customer limit & loyalty
  if (
    p.quantity_and_promo.retailer_checkout_multibuy_qty == null &&
    c.quantity_and_promo.retailer_checkout_multibuy_qty != null
  ) {
    reconciled.quantity_and_promo.retailer_checkout_multibuy_qty =
      c.quantity_and_promo.retailer_checkout_multibuy_qty;
    reconciled.quantity_and_promo.sale_basis = c.quantity_and_promo.sale_basis;
    reconciled.pricing.price_basis = c.pricing.price_basis;
    recordField(
      'quantity_and_promo.retailer_checkout_multibuy_qty',
      'corrected',
      null,
      c.quantity_and_promo.retailer_checkout_multibuy_qty,
      c.quantity_and_promo.retailer_checkout_multibuy_qty,
      'Crop recovered checkout multibuy quantity.'
    );
  } else if (
    p.quantity_and_promo.retailer_checkout_multibuy_qty != null &&
    c.quantity_and_promo.retailer_checkout_multibuy_qty != null &&
    p.quantity_and_promo.retailer_checkout_multibuy_qty !==
      c.quantity_and_promo.retailer_checkout_multibuy_qty
  ) {
    addedConflicts.add('PROMO_QTY_VS_MFG_PACK_CONFLICT');
    recordField(
      'quantity_and_promo.retailer_checkout_multibuy_qty',
      'conflict_unresolved',
      p.quantity_and_promo.retailer_checkout_multibuy_qty,
      c.quantity_and_promo.retailer_checkout_multibuy_qty,
      p.quantity_and_promo.retailer_checkout_multibuy_qty,
      'Checkout multibuy quantity differs between page and crop.'
    );
  }

  if (
    p.quantity_and_promo.customer_limit_pcs == null &&
    c.quantity_and_promo.customer_limit_pcs != null
  ) {
    reconciled.quantity_and_promo.customer_limit_pcs =
      c.quantity_and_promo.customer_limit_pcs;
    reconciled.pricing.promo_conditions =
      reconciled.pricing.promo_conditions || c.pricing.promo_conditions;
    recordField(
      'quantity_and_promo.customer_limit_pcs',
      'enriched',
      null,
      c.quantity_and_promo.customer_limit_pcs,
      c.quantity_and_promo.customer_limit_pcs,
      'Crop recovered small-print per-customer limit.'
    );
  }

  if (!p.quantity_and_promo.loyalty_required && c.quantity_and_promo.loyalty_required) {
    reconciled.quantity_and_promo.loyalty_required = true;
    reconciled.quantity_and_promo.loyalty_program_name =
      c.quantity_and_promo.loyalty_program_name || p.quantity_and_promo.loyalty_program_name;
    recordField(
      'quantity_and_promo.loyalty_required',
      'corrected',
      false,
      true,
      true,
      'Crop detected card-level loyalty/rewards requirement omitted on page.'
    );
  }

  // Preserve bilingual texts when crop surfaced printed contradiction text (e.g. Arabic weight on AlWafa #4)
  if (!p.source_card.raw_text.title_ar && c.source_card.raw_text.title_ar) {
    reconciled.source_card.raw_text.title_ar = c.source_card.raw_text.title_ar;
  }
  if (!p.source_card.raw_text.title_en && c.source_card.raw_text.title_en) {
    reconciled.source_card.raw_text.title_en = c.source_card.raw_text.title_en;
  }

  // 3F. Assortment & Sub-Items Reconciliation (WP6-F)
  const cropSubItemsHaveExplicitNames =
    c.sub_items.length >= 2 &&
    c.sub_items.every(
      (si) =>
        Boolean(si.variant_or_flavor && si.variant_or_flavor.trim()) ||
        Boolean(si.product_name_en && si.product_name_en.trim())
    );
  const cropHasBlockingAssortmentFlag =
    !c.assortment.is_enumerated_list_complete ||
    c.sub_items.length === 0 ||
    normCropDecomp.conflict_codes.includes('UNLABELED_SWATCH_OR_BOTTLE_VARIANTS') ||
    normCropDecomp.conflict_codes.includes('INCOMPLETE_VISIBLE_ASSORTMENT') ||
    (normCropDecomp.conflict_codes.includes('RETAILER_SKU_WITHOUT_VARIANT_NAMES') &&
      !(normPageDecomp.decomposed && cropSubItemsHaveExplicitNames));

  const pageAssortmentIncomplete =
    !p.assortment.is_enumerated_list_complete ||
    normPageDecomp.conflict_codes.some((code) => INCOMPLETE_ASSORTMENT_CONFLICTS.has(code)) ||
    p.sub_items.length < (p.assortment.visible_variant_count || 0);

  const cropSubItemsAllComplete =
    c.assortment.is_enumerated_list_complete &&
    c.sub_items.length >= Math.max(2, c.assortment.visible_variant_count || 0) &&
    !cropHasBlockingAssortmentFlag;

  if (cropHasBlockingAssortmentFlag && !normCropDecomp.decomposed) {
    // Crop vetoed unsafe assortment split or confirmed incomplete assortment (e.g., BinDawood Tide, Baskin Robbins)
    reconciled.assortment.is_enumerated_list_complete = false;
    reconciled.assortment.status = c.assortment.status;
    reconciled.assortment.visible_variant_count =
      c.assortment.visible_variant_count ?? p.assortment.visible_variant_count;
    if (c.sub_items.length === 0) {
      reconciled.sub_items = [];
      reconciled.assortment.identifiable_sub_item_count = 0;
      reconciled.assortment.all_options_linkable = false;
    } else {
      reconciled.sub_items = cloneCard(c).sub_items.map((si: SubItemV3) => ({
        ...si,
        safe_for_catalog_matching: false
      }));
    }
    for (const code of [...c.evidence_conflicts, ...normCropDecomp.conflict_codes]) {
      if (INCOMPLETE_ASSORTMENT_CONFLICTS.has(code)) {
        addedConflicts.add(code);
      }
    }
    recordField(
      'assortment.sub_items',
      p.assortment.is_enumerated_list_complete ? 'corrected' : 'requires_operator_review',
      p.sub_items.length,
      c.sub_items.length,
      reconciled.sub_items.length,
      'Crop established unlabeled swatch/incomplete assortment; suppressed unsafe child SKU splitting and retained non-catalog parent.'
    );
    notes.push(
      'Crop vetoed catalog assortment splitting due to incomplete/unlabeled visible variants.'
    );
  } else if (pageAssortmentIncomplete && cropSubItemsAllComplete) {
    // Crop resolved previously incomplete assortment (e.g., Moussy Classic + Pomegranate)
    reconciled.assortment = { ...c.assortment };
    reconciled.sub_items = cloneCard(c).sub_items;
    // Clear stale INCOMPLETE_VISIBLE_ASSORTMENT that crop just resolved cleanly
    reconciled.evidence_conflicts = reconciled.evidence_conflicts.filter(
      (code) => code !== 'INCOMPLETE_VISIBLE_ASSORTMENT'
    );
    recordField(
      'assortment.sub_items',
      'enriched',
      p.sub_items.length,
      c.sub_items.length,
      c.sub_items.length,
      `High-res crop resolved all ${c.sub_items.length} explicit sub-items from visual labels.`
    );
    notes.push(
      `Assortment enriched by crop from ${p.sub_items.length} to ${c.sub_items.length} verified sub-items.`
    );
  } else if (
    p.sub_items.length === c.sub_items.length &&
    p.sub_items.length >= 1
  ) {
    recordField(
      'assortment.sub_items',
      'confirmed',
      p.sub_items.length,
      c.sub_items.length,
      reconciled.sub_items.length,
      'Page and crop agree on enumerated sub-items.'
    );
  }

  // 3G. Propagate genuine printed contradictions from either page or crop (NEVER erase!)
  for (const code of [
    ...p.evidence_conflicts,
    ...normPageDecomp.conflict_codes,
    ...c.evidence_conflicts,
    ...normCropDecomp.conflict_codes
  ]) {
    if (code === 'CURRENCY_UNVERIFIED_OR_CONFLICT') {
      continue;
    }
    if (PRINTED_CONTRADICTION_CODES.has(code)) {
      addedConflicts.add(code);
    }
  }
  if (
    reconciled.non_grocery_specs.domain !== c.non_grocery_specs.domain &&
    reconciled.non_grocery_specs.domain !== 'fresh_loose'
  ) {
    // Respect crop non-grocery / specialty classification when more specific
    if (c.non_grocery_specs.excluded_from_default_grocery_feed) {
      reconciled.non_grocery_specs = { ...c.non_grocery_specs };
    }
  }

  reconciled.evidence_conflicts = Array.from(
    new Set([...reconciled.evidence_conflicts, ...addedConflicts])
  ).filter((code) => code !== 'CURRENCY_UNVERIFIED_OR_CONFLICT');
  reconciled.pricing.price_conflict_flags = Array.from(
    new Set([
      ...reconciled.pricing.price_conflict_flags,
      ...Array.from(addedConflicts).filter((code) => code === 'PRICE_ROLE_AMBIGUOUS')
    ])
  ).filter((code) => code !== 'CURRENCY_UNVERIFIED_OR_CONFLICT');

  // Escalate extraction confidence when crop confirmed without conflict
  const hasAnyUnresolvedOrQuarantined =
    addedConflicts.size > 0 ||
    fieldDecisions.some(
      (d) => d.outcome === 'conflict_unresolved' || d.outcome === 'quarantined'
    );
  if (!hasAnyUnresolvedOrQuarantined && c.extraction_confidence === 'high') {
    reconciled.extraction_confidence = 'high';
  }

  if (cropLineage?.cropImagePath) {
    reconciled.source_card.source_evidence_ref_internal = cropLineage.cropImagePath;
  }

  // Separate caption vs packaging evidence ledger entries upon verified crop confirmation
  appendCropPackagingEvidenceEntries(
    reconciled,
    c,
    cropLineage?.cropImagePath ?? null
  );

  // Final WP6-G safety gate evaluation
  const safety = buildSafetyOutputs(reconciled, {
    enforceNonExpiredForPublication: input.enforceNonExpiredForPublication,
    publicationReferenceDateIso: input.publicationReferenceDateIso
  });
  const overallStatus = deriveOverallStatus({
    selectionPriority: selectionDecision.priority,
    cropExecuted,
    decomposition: safety.decomposition,
    publicationAssessment: safety.publicationAssessment
  });
  const statusFields = buildStatusClassification({
    overallStatus,
    cropExecuted,
    selectionRequiresCropForCatalogMatch:
      selectionDecision.requiresCropVerificationForCatalogMatch,
    reconciledCard: safety.decomposition.normalized_card,
    matchingAdapterSummary: safety.matchingAdapterSummary
  });

  if (overallStatus === 'quarantined_conflict') {
    for (const d of fieldDecisions) {
      if (d.outcome === 'conflict_unresolved') {
        d.outcome = 'quarantined';
      }
    }
  }

  const tierCompletenessUnresolved = Boolean(
    (reconciled.compound_card_context?.has_multiple_price_badges_in_card ||
      p.compound_card_context?.has_multiple_price_badges_in_card) &&
      !safety.decomposition.decomposed
  );

  return [
    {
      sourceOfferId: parentSourceOfferId,
      parentSourceOfferId,
      offerNumber: selectionDecision.offerNumber,
      selectionDecision,
      cropExecuted,
      cropStatus,
      cropLineage,
      ...statusFields,
      reconciledCard: safety.decomposition.normalized_card,
      fieldDecisions,
      decomposition: safety.decomposition,
      publicationAssessment: safety.publicationAssessment,
      matchingAdapterSummary: safety.matchingAdapterSummary,
      tierCompletenessUnresolved,
      notes
    }
  ];
}
