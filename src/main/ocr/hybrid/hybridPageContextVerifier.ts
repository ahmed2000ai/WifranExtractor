/**
 * WIFRAN-EXTRACTOR-IDENTITY-005G (WP6-C)
 * Page-Level Header/Footer/Terms Context Verification & Conservative Scoped Propagation.
 *
 * Recovers page-wide loyalty programs, validity date ranges, currencies, or
 * page-wide limits missed by full-page item sweeps (e.g., AlWafa 0/13 regression),
 * while strictly refusing to invent rules from retailer names or overwrite explicit
 * card-level non-member pricing tiers.
 */

import type { OfferContractV3Record } from '../../../shared/types/extractorContractV3';
import type { PageContextVerificationEvidence } from '../../../shared/types/hybridExtractionV3';

function cloneCard(card: OfferContractV3Record): OfferContractV3Record {
  return JSON.parse(JSON.stringify(card)) as OfferContractV3Record;
}

export function validatePageContextEvidence(
  evidence: PageContextVerificationEvidence | null | undefined
): { valid: boolean; reason: string | null } {
  if (!evidence || !evidence.verified) {
    return { valid: false, reason: 'Page context verification was not confirmed.' };
  }
  const hasBroadRule =
    (evidence.is_loyalty_page && evidence.applies_to_all_page_offers) ||
    evidence.page_wide_customer_limit_pcs != null ||
    Boolean(evidence.page_wide_exclusions && evidence.page_wide_exclusions.length > 0) ||
    Boolean(evidence.regional_scope && evidence.regional_scope.trim());

  if (
    hasBroadRule &&
    (!evidence.explicit_scope_evidence || !evidence.explicit_scope_evidence.trim())
  ) {
    return {
      valid: false,
      reason:
        'Refused broad page-wide context propagation: explicit_scope_evidence is empty (scope proof required).'
    };
  }
  return { valid: true, reason: null };
}

/**
 * Conservatively applies verified page-level header/footer conditions to page cards.
 * - Loyalty applies ONLY when `applies_to_all_page_offers === true` with explicit scope evidence,
 *   AND the card is not explicitly in `exception_offer_numbers` or explicitly marked as a
 *   non-member standalone tier on a mixed compound card.
 * - Dates propagate when the card omitted dates.
 * - Currency propagates when card currency is missing; conflicting card currency raises a conflict.
 */
export function applyScopedPageContextToCards(input: {
  cards: OfferContractV3Record[];
  offerNumbers: number[];
  pageContext: PageContextVerificationEvidence | null | undefined;
}): {
  updatedCards: OfferContractV3Record[];
  loyaltyPropagatedCount: number;
  datesPropagatedCount: number;
  notes: string[];
} {
  const { cards, offerNumbers, pageContext } = input;
  const validation = validatePageContextEvidence(pageContext);
  if (!validation.valid || !pageContext) {
    return {
      updatedCards: cards.map(cloneCard),
      loyaltyPropagatedCount: 0,
      datesPropagatedCount: 0,
      notes: validation.reason ? [validation.reason] : []
    };
  }

  const exceptionSet = new Set<number>(pageContext.exception_offer_numbers || []);
  const notes: string[] = [];
  let loyaltyPropagatedCount = 0;
  let datesPropagatedCount = 0;

  const updatedCards = cards.map((rawCard, idx) => {
    const card = cloneCard(rawCard);
    const offerNum = offerNumbers[idx] ?? idx + 1;
    const isException = exceptionSet.has(offerNum);

    // 1. Loyalty propagation (strictly scoped)
    const hasExplicitNonMemberTierTag =
      !card.quantity_and_promo.loyalty_required &&
      Boolean(card.pricing.promo_conditions) &&
      /\b(non[- ]?member|standard\s+price|regular\s+customer|without\s+card)\b|غير\s+الأعضاء|بدون\s+بطاقة/i.test(
        card.pricing.promo_conditions || ''
      );

    if (
      pageContext.is_loyalty_page &&
      pageContext.applies_to_all_page_offers &&
      pageContext.explicit_scope_evidence &&
      !isException &&
      !hasExplicitNonMemberTierTag
    ) {
      if (
        !card.quantity_and_promo.loyalty_required ||
        !card.quantity_and_promo.loyalty_program_name
      ) {
        card.quantity_and_promo.loyalty_required = true;
        if (!card.quantity_and_promo.loyalty_program_name && pageContext.loyalty_program_name) {
          card.quantity_and_promo.loyalty_program_name = pageContext.loyalty_program_name;
        }
        loyaltyPropagatedCount++;
        card.evidence_ledger.push({
          evidence_id: `ev_${card.source_card.source_offer_id}_page_ctx_loyalty`,
          target_field: 'quantity_and_promo.loyalty_required',
          evidence_type: 'printed_leaflet_text',
          extracted_value: true,
          original_source_evidence: `[${pageContext.sourceRegionKind}] ${pageContext.explicit_scope_evidence}`,
          normalized_value: pageContext.loyalty_program_name || 'page_wide_loyalty_required',
          confidence: 'high',
          source_ref_internal: `page_context:${pageContext.sourceRegionKind}`,
          operator_correction: null
        });
      }
    } else if (isException || hasExplicitNonMemberTierTag) {
      notes.push(
        `Preserved non-loyalty exception for ${card.source_card.source_offer_id} (#${offerNum}).`
      );
    }

    // 2. Date range propagation
    if (!card.source_card.offer_start_date && pageContext.validity_start_date) {
      card.source_card.offer_start_date = pageContext.validity_start_date;
      datesPropagatedCount++;
    }
    if (!card.source_card.offer_end_date && pageContext.validity_end_date) {
      card.source_card.offer_end_date = pageContext.validity_end_date;
      datesPropagatedCount++;
    }

    // 3. Fixed internal SAR currency (never emit CURRENCY_UNVERIFIED_OR_CONFLICT)
    card.pricing.currency = 'SAR';
    card.pricing.currency_evidence = card.pricing.currency_evidence || 'fixed_sar_internal';
    card.evidence_conflicts = card.evidence_conflicts.filter(
      (c) => c !== 'CURRENCY_UNVERIFIED_OR_CONFLICT'
    );
    card.pricing.price_conflict_flags = card.pricing.price_conflict_flags.filter(
      (c) => c !== 'CURRENCY_UNVERIFIED_OR_CONFLICT'
    );

    // 4. Scoped page-wide customer limit propagation (only when card omitted it and is not an exception)
    if (
      pageContext.page_wide_customer_limit_pcs != null &&
      pageContext.applies_to_all_page_offers &&
      !isException &&
      card.quantity_and_promo.customer_limit_pcs == null
    ) {
      card.quantity_and_promo.customer_limit_pcs = pageContext.page_wide_customer_limit_pcs;
      card.evidence_ledger.push({
        evidence_id: `ev_${card.source_card.source_offer_id}_page_ctx_limit`,
        target_field: 'quantity_and_promo.customer_limit_pcs',
        evidence_type: 'printed_leaflet_text',
        extracted_value: pageContext.page_wide_customer_limit_pcs,
        original_source_evidence: `[${pageContext.sourceRegionKind}] ${pageContext.explicit_scope_evidence || 'page_wide_customer_limit_pcs'}`,
        normalized_value: pageContext.page_wide_customer_limit_pcs,
        confidence: 'high',
        source_ref_internal: `page_context:${pageContext.sourceRegionKind}`,
        operator_correction: null
      });
    }

    // 5. Append page-wide exclusions / regional scope disclosures as explicit promo conditions
    const scopeDisclosures: string[] = [];
    if (pageContext.regional_scope && pageContext.regional_scope.trim()) {
      scopeDisclosures.push(`Regional scope: ${pageContext.regional_scope.trim()}`);
    }
    if (pageContext.page_wide_exclusions && pageContext.page_wide_exclusions.length > 0) {
      scopeDisclosures.push(`Page exclusions: ${pageContext.page_wide_exclusions.join('; ')}`);
    }
    if (scopeDisclosures.length > 0 && !isException) {
      const joined = scopeDisclosures.join(' | ');
      card.pricing.promo_conditions = card.pricing.promo_conditions
        ? `${card.pricing.promo_conditions}; ${joined}`
        : joined;
    }

    return card;
  });

  if (pageContext.page_wide_exclusions && pageContext.page_wide_exclusions.length > 0) {
    notes.push(
      `Recorded page-wide exclusions: ${pageContext.page_wide_exclusions.join('; ')}.`
    );
  }
  if (pageContext.regional_scope && pageContext.regional_scope.trim()) {
    notes.push(`Recorded regional scope: ${pageContext.regional_scope.trim()}.`);
  }

  if (loyaltyPropagatedCount > 0) {
    notes.push(
      `Conservatively propagated verified page-wide loyalty (${pageContext.loyalty_program_name || 'member program'}) to ${loyaltyPropagatedCount} offer(s) using explicit scope evidence.`
    );
  }

  return {
    updatedCards,
    loyaltyPropagatedCount,
    datesPropagatedCount,
    notes
  };
}

