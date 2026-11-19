/**
 * WIFRAN-EXTRACTOR-IDENTITY-005H (WP7-G)
 * Offline Hybrid Consumer-Safety Invariants Auditor & Legacy Check Isolation Guard.
 *
 * Audits every `HybridPageRunResult` against all 10 consumer safety invariants and
 * statically verifies that hybrid extraction modules cannot reach legacy
 * `deterministicOfferChecks.ts`.
 */

import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import {
  HYBRID_EXTRACTION_DEFAULT_FLAGS,
  type HybridPageRunResult
} from '../../../shared/types/hybridExtractionV3';

export interface SafetyInvariantViolation {
  invariantId: number;
  invariantName: string;
  sourceOfferId: string | null;
  detail: string;
}

export interface HybridSafetyAuditResult {
  passed: boolean;
  checkedInvariantsCount: 10;
  evaluatedCardsCount: number;
  violations: SafetyInvariantViolation[];
}

/**
 * Evaluates a `HybridPageRunResult` against all 10 consumer safety & catalog-identity invariants.
 */
export function auditHybridSafetyInvariants(
  runResult: HybridPageRunResult
): HybridSafetyAuditResult {
  const violations: SafetyInvariantViolation[] = [];

  // Invariant 1: Zero Supabase writes
  if (runResult.databaseWritesEnabled !== false) {
    violations.push({
      invariantId: 1,
      invariantName: 'ZERO_DATABASE_WRITES',
      sourceOfferId: null,
      detail: 'databaseWritesEnabled must strictly be false in hybrid offline/Stage-A/preflight runs.'
    });
  }

  // Invariant 2: Default feature flags remain disabled
  if (
    HYBRID_EXTRACTION_DEFAULT_FLAGS.enabledByDefault !== false ||
    HYBRID_EXTRACTION_DEFAULT_FLAGS.enableHybridOrchestration !== false ||
    HYBRID_EXTRACTION_DEFAULT_FLAGS.allowDatabaseWrites !== false
  ) {
    violations.push({
      invariantId: 2,
      invariantName: 'DISABLED_BY_DEFAULT_FLAGS',
      sourceOfferId: null,
      detail: 'HYBRID_EXTRACTION_DEFAULT_FLAGS must keep enabledByDefault=false and enableHybridOrchestration=false.'
    });
  }

  for (const r of runResult.reconciledCards) {
    const card = r.reconciledCard;
    const conflicts = new Set([
      ...card.evidence_conflicts,
      ...r.decomposition.conflict_codes
    ]);

    // Invariant 3: Quarantined or unresolved-conflict cards never auto-publish or permit catalog match
    if (
      r.overallStatus === 'quarantined_conflict' &&
      (r.publicationAssessment.isEligibleForNonCatalogPublication ||
        r.matchingAdapterSummary.matchableChildrenCount > 0)
    ) {
      violations.push({
        invariantId: 3,
        invariantName: 'QUARANTINED_CARDS_NEVER_PUBLISH_OR_MATCH',
        sourceOfferId: r.sourceOfferId,
        detail: `Quarantined card reported eligible=${r.publicationAssessment.isEligibleForNonCatalogPublication}, matchable=${r.matchingAdapterSummary.matchableChildrenCount}.`
      });
    }

    // Invariant 4: Held P0 or invalid-lineage cards never publish or permit catalog matching
    if (
      (r.overallStatus === 'held_unverified_p0_budget_or_failure' ||
        r.cropStatus === 'invalid_lineage') &&
      (r.publicationAssessment.isEligibleForNonCatalogPublication ||
        r.matchingAdapterSummary.matchableChildrenCount > 0)
    ) {
      violations.push({
        invariantId: 4,
        invariantName: 'HELD_P0_OR_INVALID_LINEAGE_FAIL_CLOSED',
        sourceOfferId: r.sourceOfferId,
        detail: `Held/invalid-lineage card (${r.cropStatus}) leaked into consumer eligibility or matching.`
      });
    }

    // Invariant 5: Incomplete assortments or unlabeled swatches never emit matchable children
    if (
      (conflicts.has('INCOMPLETE_VISIBLE_ASSORTMENT') ||
        conflicts.has('UNLABELED_SWATCH_OR_BOTTLE_VARIANTS') ||
        !card.assortment.is_enumerated_list_complete) &&
      (r.decomposition.decomposed || r.matchingAdapterSummary.matchableChildrenCount > 0)
    ) {
      violations.push({
        invariantId: 5,
        invariantName: 'INCOMPLETE_ASSORTMENT_BLOCKS_CHILD_MATCHING',
        sourceOfferId: r.sourceOfferId,
        detail: `Incomplete assortment leaked decomposed=${r.decomposition.decomposed} or matchable=${r.matchingAdapterSummary.matchableChildrenCount}.`
      });
    }

    // Invariant 6: Retailer checkout multibuy qty is never copied as manufacturer pack count when sale_basis='multi_buy_checkout'
    if (
      card.quantity_and_promo.sale_basis === 'multi_buy_checkout' &&
      (card.quantity_and_promo.retailer_checkout_multibuy_qty ?? 1) > 1 &&
      card.quantity_and_promo.manufacturer_pack_count ===
        card.quantity_and_promo.retailer_checkout_multibuy_qty
    ) {
      violations.push({
        invariantId: 6,
        invariantName: 'MULTIBUY_NOT_COPIED_TO_MANUFACTURER_PACK',
        sourceOfferId: r.sourceOfferId,
        detail: `multi_buy_checkout qty=${card.quantity_and_promo.retailer_checkout_multibuy_qty} duplicated into manufacturer_pack_count.`
      });
    }

    // Invariant 7: Non-grocery offers must stay excluded from default grocery consumer feed
    const domain = card.non_grocery_specs.domain;
    const isNonGrocery =
      domain === 'electronics' ||
      domain === 'appliance' ||
      domain === 'textiles_home' ||
      domain === 'other_non_grocery';
    if (isNonGrocery && !card.non_grocery_specs.excluded_from_default_grocery_feed) {
      violations.push({
        invariantId: 7,
        invariantName: 'NON_GROCERY_EXCLUDED_FROM_DEFAULT_FEED',
        sourceOfferId: r.sourceOfferId,
        detail: `Domain=${domain} had excluded_from_default_grocery_feed=false.`
      });
    }

    // Invariant 8: Cards requiring crop verification for catalog match never become candidate_ready offline
    if (
      r.requiresCropVerificationForCatalogMatch &&
      r.catalogVerificationStatus === 'candidate_ready_unmatched_pending_catalog_match'
    ) {
      violations.push({
        invariantId: 8,
        invariantName: 'CAPTION_ONLY_PACKAGED_REQUIRES_CROP_BEFORE_CATALOG_MATCH',
        sourceOfferId: r.sourceOfferId,
        detail:
          'Card still requires crop verification yet reported catalogVerificationStatus=candidate_ready_unmatched_pending_catalog_match.'
      });
    }

    // Invariant 9: Price-role inversions (promo >= original) or ambiguous prices never publish
    if (
      (card.pricing.promo_price != null &&
        card.pricing.original_price != null &&
        card.pricing.promo_price >= card.pricing.original_price) ||
      conflicts.has('PRICE_ROLE_AMBIGUOUS')
    ) {
      if (r.publicationAssessment.isEligibleForNonCatalogPublication) {
        violations.push({
          invariantId: 9,
          invariantName: 'AMBIGUOUS_OR_INVERTED_PRICE_BLOCKED',
          sourceOfferId: r.sourceOfferId,
          detail: 'Price-role ambiguous or inverted card was marked consumer-eligible.'
        });
      }
    }

    // Invariant 10: Fixed internal SAR currency invariant
    if (
      card.pricing.currency !== 'SAR' &&
      r.publicationAssessment.isEligibleForNonCatalogPublication
    ) {
      violations.push({
        invariantId: 10,
        invariantName: 'UNVERIFIED_CURRENCY_NEVER_PUBLISHES',
        sourceOfferId: r.sourceOfferId,
        detail: `Card with non-SAR currency=${String(card.pricing.currency)} leaked into consumer publication.`
      });
    }
  }

  return {
    passed: violations.length === 0,
    checkedInvariantsCount: 10,
    evaluatedCardsCount: runResult.reconciledCards.length,
    violations
  };
}

/**
 * Verifies statically that NO module under `src/main/ocr/hybrid/` imports or references
 * the defective legacy `deterministicOfferChecks` module, and documents known active legacy callers.
 */
export function verifyHybridIsolationFromLegacyChecks(repoRoot: string): {
  hybridClean: boolean;
  hybridReferencingFiles: string[];
  activeLegacyCallersFound: string[];
} {
  const hybridDir = resolve(repoRoot, 'src/main/ocr/hybrid');
  const hybridReferencingFiles: string[] = [];
  for (const file of readdirSync(hybridDir)) {
    if (!file.endsWith('.ts') || file === 'hybridSafetyInvariants.ts') continue;
    const text = readFileSync(join(hybridDir, file), 'utf8');
    if (text.includes('deterministicOfferChecks') || text.includes('runDeterministicOfferChecks')) {
      hybridReferencingFiles.push(`src/main/ocr/hybrid/${file}`);
    }
  }

  const candidateLegacyFiles = [
    'src/main/page-first/pageOfferCanonicalMapper.ts',
    'src/main/workflow/cropAndItemOcrWorkflow.ts'
  ];
  const activeLegacyCallersFound: string[] = [];
  for (const rel of candidateLegacyFiles) {
    const abs = resolve(repoRoot, rel);
    try {
      const text = readFileSync(abs, 'utf8');
      if (text.includes('runDeterministicOfferChecks')) {
        activeLegacyCallersFound.push(rel);
      }
    } catch {
      // Ignore if moved
    }
  }

  return {
    hybridClean: hybridReferencingFiles.length === 0,
    hybridReferencingFiles,
    activeLegacyCallersFound
  };
}
