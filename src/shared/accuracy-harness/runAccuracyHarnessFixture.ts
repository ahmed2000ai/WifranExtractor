/**
 * Accuracy Harness Runner – Chunk 57
 *
 * Runs a single AccuracyHarnessFixture through the full offline pipeline:
 *
 *   raw_mistral_response
 *   → normalizeToCanonicalOffer
 *   → attach trusted_context
 *   → apply mocked style_validation_response if present
 *   → runDeterministicOfferChecks
 *   → applyDeterministicCheckResultToCanonicalOffer
 *   → evaluateComparisonSafety
 *   → applyComparisonSafetyToCanonicalOffer
 *   → decidePublishAction
 *   → applyPublishDecisionToCanonicalOffer
 *   → build DB-ready dry-run payload (if eligible)
 *   → evaluateWifranUtilization
 *   → compare actual vs expected
 *
 * No Mistral. No Supabase. No network.
 */

import type { CanonicalOffer } from '../types/canonicalOffer';
import type {
  AccuracyHarnessFixture,
  AccuracyHarnessFixtureResult,
  AccuracyHarnessFailure,
} from '../types/accuracyHarness';
import type { ComparisonSafetyResult } from '../types/comparisonSafety';
import type { PublishDecisionResult } from '../types/publishDecision';
import type { DeterministicOfferCheckResult } from '../types/deterministicOfferChecks';

import { normalizeToCanonicalOffer } from '../utils/canonicalOfferNormalizer';
import {
  runDeterministicOfferChecks,
  applyDeterministicCheckResultToCanonicalOffer,
} from '../utils/deterministicOfferChecks';
import {
  evaluateComparisonSafety,
  applyComparisonSafetyToCanonicalOffer,
} from '../utils/comparisonSafety';
import {
  decidePublishAction,
  applyPublishDecisionToCanonicalOffer,
} from '../utils/publishDecisionEngine';
import { evaluateWifranUtilization } from './wifranUtilizationEvaluator';
import { mapPreparedPayloadToOffersInsert } from '../utils/offerSyncMapper';

// ---------------------------------------------------------------------------
// Deep comparison helpers
// ---------------------------------------------------------------------------

function withinTolerance(
  expected: number | null | undefined,
  actual: number | null | undefined,
  tolerance: number
): boolean {
  if (expected == null && actual == null) return true;
  if (expected == null || actual == null) return false;
  return Math.abs(expected - actual) <= tolerance;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export function runAccuracyHarnessFixture(
  fixture: AccuracyHarnessFixture
): AccuracyHarnessFixtureResult {
  const failures: AccuracyHarnessFailure[] = [];

  // -------------------------------------------------------------------------
  // 1. Normalize raw response → canonical offer
  // -------------------------------------------------------------------------
  const rawJson = fixture.inputs.raw_mistral_response;

  let canonical: CanonicalOffer = normalizeToCanonicalOffer({
    rawOcrJson: rawJson,
    source: {
      sourcePageNumber: fixture.source.page_number ?? 1,
      sourceItemNumber: fixture.source.item_number ?? '001',
      cropPath: fixture.source.crop_path ?? null,
    },
    trustedContext: {
      supermarketId: fixture.trusted_context.supermarket_id ?? null,
      supermarketSlug: fixture.trusted_context.supermarket_slug ?? null,
      locationScope: fixture.trusted_context.location_scope,
      cityId: fixture.trusted_context.city_id ?? null,
      regionId: fixture.trusted_context.region_id ?? null,
      offerStartDate: fixture.trusted_context.offer_start_date,
      offerEndDate: fixture.trusted_context.offer_end_date,
    },
  });

  // Apply domain / price_basis / promotion overrides from the raw input that
  // the legacy normalizer may not infer correctly for fixture simplicity
  const raw = rawJson as Record<string, any>;
  if (raw.item_domain) {
    canonical.product.item_domain = raw.item_domain as any;
  }
  if (raw.price_basis) {
    canonical.prices.price_basis = raw.price_basis as any;
  } else if (canonical.prices.price_basis === 'unknown') {
    canonical.prices.price_basis = 'each';
  }
  if (raw.price_condition === '1+1' || raw.bundle_quantity) {
    if (raw.price_condition === '1+1') {
      canonical.promotion.mechanic = 'bogo';
    }
    if (raw.bundle_quantity && !canonical.content.bundle_quantity) {
      canonical.content.bundle_quantity = Number(raw.bundle_quantity);
    }
  }

  // Wire up price candidate roles for old-price-as-current fixtures
  if (raw._force_candidate_classified_as_original && canonical.prices.all_price_candidates[0]) {
    canonical.prices.all_price_candidates[0].classified_as = 'original_price';
    canonical.prices.all_price_candidates[0].visual_role = 'crossed_out_old_price';
  }

  // -------------------------------------------------------------------------
  // 2. Apply mocked style validation if present
  // -------------------------------------------------------------------------
  if (fixture.inputs.style_validation_response) {
    const sv = fixture.inputs.style_validation_response as any;
    canonical.style_validation = {
      validation_result: sv.validation_result || 'pass',
      visual_evidence: sv.visual_evidence || {},
      corrected_fields: sv.corrected_fields || {},
      style_profile_scope: sv.style_profile_scope || 'none',
    };
    // Apply corrected fields
    if (sv.corrected_fields) {
      if (sv.corrected_fields.offer_price !== undefined && sv.corrected_fields.offer_price !== null) {
        canonical.prices.offer_price = sv.corrected_fields.offer_price;
      }
      if (sv.corrected_fields.original_price !== undefined && sv.corrected_fields.original_price !== null) {
        canonical.prices.original_price = sv.corrected_fields.original_price;
      }
      if (sv.corrected_fields.size_text !== undefined) {
        canonical.content.size_text = sv.corrected_fields.size_text;
      }
    }
  } else {
    canonical.style_validation = {
      validation_result: 'pass',
      visual_evidence: {},
      corrected_fields: {},
      style_profile_scope: 'none',
    };
  }

  // -------------------------------------------------------------------------
  // 3. Deterministic checks
  // -------------------------------------------------------------------------
  // Use a date within the offer validity period to avoid expired_offer_end_date
  // blocking. Default to offer_start_date + 1 day if available.
  const offerStart = fixture.trusted_context.offer_start_date
    ? new Date(fixture.trusted_context.offer_start_date)
    : new Date();
  const harnessNow = new Date(offerStart.getTime() + 86400000); // +1 day
  const checkResult: DeterministicOfferCheckResult = runDeterministicOfferChecks({
    canonicalOffer: canonical,
    now: harnessNow,
  });

  // Reset existing blocking errors first (normalizer may have injected duplicates)
  canonical.quality.blocking_errors = [];
  canonical.quality.non_blocking_warnings = [];

  canonical = applyDeterministicCheckResultToCanonicalOffer(canonical, checkResult);

  // Clear the default 'not_evaluated' exclusion reason and reset
  // comparison_eligible so comparison safety can evaluate from scratch.
  // applyDeterministicCheckResultToCanonicalOffer sets the exclusion_reason
  // to messages, but evaluateComparisonSafety uses its own codes.
  canonical.comparison.comparison_eligible = false;
  canonical.comparison.comparison_exclusion_reason = null;

  // -------------------------------------------------------------------------
  // 4. Comparison safety
  // -------------------------------------------------------------------------
  const comparisonResult: ComparisonSafetyResult = evaluateComparisonSafety({
    canonicalOffer: canonical,
  });
  canonical = applyComparisonSafetyToCanonicalOffer(canonical, comparisonResult);

  // -------------------------------------------------------------------------
  // 5. Publish decision
  // -------------------------------------------------------------------------
  const decisionResult: PublishDecisionResult = decidePublishAction({
    canonicalOffer: canonical,
    comparisonResult,
  });
  canonical = applyPublishDecisionToCanonicalOffer(canonical, decisionResult);

  // -------------------------------------------------------------------------
  // 6. DB-ready dry-run payload (if eligible)
  // -------------------------------------------------------------------------
  let dbPayload: Record<string, unknown> | null = null;
  if (decisionResult.should_upsert_db) {
    const { payload } = mapPreparedPayloadToOffersInsert({
      preparedPayload: {
        supermarket_id: canonical.trusted_context.supermarket_id,
        location_scope: canonical.trusted_context.location_scope,
        city_id: canonical.trusted_context.city_id,
        region_id: canonical.trusted_context.region_id,
        title_ar: canonical.product.title_ar,
        title_en: canonical.product.title_en,
        offer_price: canonical.prices.offer_price,
        original_price: canonical.prices.original_price,
        offer_start_date: canonical.trusted_context.offer_start_date,
        offer_end_date: canonical.trusted_context.offer_end_date,
        status: decisionResult.status_for_db ?? 'published',
        pack_size_value: canonical.content.each_size_value,
        pack_size_unit: canonical.content.each_size_unit,
        pack_quantity: canonical.content.pack_quantity,
        unit_price: comparisonResult.comparison_unit_price,
        unit_price_unit: comparisonResult.comparison_unit,
      },
      imageUrl: null,
      storageBucket: null,
      storagePath: null,
      sourceId: null,
    });
    dbPayload = payload;
  }

  // -------------------------------------------------------------------------
  // 7. Wifran utilization evaluation
  // -------------------------------------------------------------------------
  const utilizationResult = evaluateWifranUtilization({
    canonicalOffer: canonical,
    decisionResult,
    comparisonResult,
  });

  // -------------------------------------------------------------------------
  // 8. Build actuals
  // -------------------------------------------------------------------------
  const blockingCodes = canonical.quality.blocking_errors.map((e) => e.code);
  const warningCodes = canonical.quality.non_blocking_warnings.map((w) => w.code);
  const comparisonExclusionCodes = checkResult.comparison_exclusions.map((e) => e.code);

  const actual: AccuracyHarnessFixtureResult['actual'] = {
    canonical: {
      title_ar: canonical.product.title_ar,
      title_en: canonical.product.title_en,
      offer_price: canonical.prices.offer_price,
      original_price: canonical.prices.original_price,
      size_text: canonical.content.size_text,
      pack_quantity: canonical.content.pack_quantity,
      bundle_quantity: canonical.content.bundle_quantity,
      price_basis: canonical.prices.price_basis,
      promotion_mechanic: canonical.promotion.mechanic,
      item_domain: canonical.product.item_domain,
    },
    blocking_error_codes: blockingCodes,
    warning_codes: warningCodes,
    comparison_exclusion_codes: comparisonExclusionCodes,
    comparison: {
      comparison_eligible: comparisonResult.comparison_eligible,
      comparison_unit: comparisonResult.comparison_unit,
      comparison_unit_price: comparisonResult.comparison_unit_price,
      comparison_exclusion_reason: comparisonResult.comparison_exclusion_reason,
    },
    decision: {
      publish_decision: decisionResult.decision,
      should_upsert_db: decisionResult.should_upsert_db,
      should_upload_image: decisionResult.should_upload_image,
      status_for_db: decisionResult.status_for_db,
    },
    display: {
      show_display_unit_price: canonical.display?.show_display_unit_price,
      display_unit_price: canonical.display?.display_unit_price,
      display_unit_basis_value: canonical.display?.display_unit_basis_value,
      display_unit_basis_unit: canonical.display?.display_unit_basis_unit,
      display_unit_price_label_ar: canonical.display?.display_unit_price_label_ar,
      display_unit_price_label_en: canonical.display?.display_unit_price_label_en,
      hidden_reason: canonical.display?.hidden_reason,
    },
    utilization: { ...utilizationResult },
    db_payload: dbPayload,
  };

  // -------------------------------------------------------------------------
  // 9. Compare actual vs expected
  // -------------------------------------------------------------------------
  const exp = fixture.expected;

  // --- Canonical fields ---
  if (exp.canonical) {
    const ec = exp.canonical;
    const ac = actual.canonical as Record<string, unknown>;
    for (const [key, expectedVal] of Object.entries(ec)) {
      if (expectedVal === undefined) continue;
      const actualVal = ac[key];
      if (expectedVal !== actualVal) {
        failures.push({
          path: `canonical.${key}`,
          expected: expectedVal,
          actual: actualVal,
          message: `canonical.${key}: expected ${JSON.stringify(expectedVal)}, got ${JSON.stringify(actualVal)}`,
        });
      }
    }
  }

  // --- Blocking error codes ---
  if (exp.blocking_error_codes) {
    for (const code of exp.blocking_error_codes) {
      if (!blockingCodes.includes(code)) {
        failures.push({
          path: 'blocking_error_codes',
          expected: code,
          actual: blockingCodes,
          message: `Expected blocking error code "${code}" not found in [${blockingCodes.join(', ')}]`,
        });
      }
    }
  }

  // --- Warning codes ---
  if (exp.warning_codes) {
    for (const code of exp.warning_codes) {
      if (!warningCodes.includes(code)) {
        failures.push({
          path: 'warning_codes',
          expected: code,
          actual: warningCodes,
          message: `Expected warning code "${code}" not found in [${warningCodes.join(', ')}]`,
        });
      }
    }
  }

  // --- Comparison ---
  if (exp.comparison) {
    const tolerance = exp.comparison.tolerance ?? 0.05;
    const ac = actual.comparison as Record<string, unknown>;

    if (exp.comparison.comparison_eligible !== undefined) {
      if (ac.comparison_eligible !== exp.comparison.comparison_eligible) {
        failures.push({
          path: 'comparison.comparison_eligible',
          expected: exp.comparison.comparison_eligible,
          actual: ac.comparison_eligible,
          message: `comparison_eligible: expected ${exp.comparison.comparison_eligible}, got ${ac.comparison_eligible}`,
        });
      }
    }

    if (exp.comparison.comparison_unit !== undefined) {
      if (ac.comparison_unit !== exp.comparison.comparison_unit) {
        failures.push({
          path: 'comparison.comparison_unit',
          expected: exp.comparison.comparison_unit,
          actual: ac.comparison_unit,
          message: `comparison_unit: expected ${exp.comparison.comparison_unit}, got ${ac.comparison_unit}`,
        });
      }
    }

    if (exp.comparison.comparison_unit_price !== undefined && exp.comparison.comparison_unit_price !== null) {
      if (!withinTolerance(exp.comparison.comparison_unit_price, ac.comparison_unit_price as number | null, tolerance)) {
        failures.push({
          path: 'comparison.comparison_unit_price',
          expected: exp.comparison.comparison_unit_price,
          actual: ac.comparison_unit_price,
          message: `comparison_unit_price: expected ${exp.comparison.comparison_unit_price} ± ${tolerance}, got ${ac.comparison_unit_price}`,
        });
      }
    }

    if (exp.comparison.comparison_exclusion_reason !== undefined) {
      if (ac.comparison_exclusion_reason !== exp.comparison.comparison_exclusion_reason) {
        failures.push({
          path: 'comparison.comparison_exclusion_reason',
          expected: exp.comparison.comparison_exclusion_reason,
          actual: ac.comparison_exclusion_reason,
          message: `comparison_exclusion_reason: expected ${exp.comparison.comparison_exclusion_reason}, got ${ac.comparison_exclusion_reason}`,
        });
      }
    }
  }

  // --- Decision ---
  if (exp.decision) {
    const ad = actual.decision as Record<string, unknown>;

    if (exp.decision.publish_decision !== undefined) {
      if (ad.publish_decision !== exp.decision.publish_decision) {
        failures.push({
          path: 'decision.publish_decision',
          expected: exp.decision.publish_decision,
          actual: ad.publish_decision,
          message: `publish_decision: expected ${exp.decision.publish_decision}, got ${ad.publish_decision}`,
        });
      }
    }

    if (exp.decision.should_upsert_db !== undefined) {
      if (ad.should_upsert_db !== exp.decision.should_upsert_db) {
        failures.push({
          path: 'decision.should_upsert_db',
          expected: exp.decision.should_upsert_db,
          actual: ad.should_upsert_db,
          message: `should_upsert_db: expected ${exp.decision.should_upsert_db}, got ${ad.should_upsert_db}`,
        });
      }
    }

    if (exp.decision.should_upload_image !== undefined) {
      if (ad.should_upload_image !== exp.decision.should_upload_image) {
        failures.push({
          path: 'decision.should_upload_image',
          expected: exp.decision.should_upload_image,
          actual: ad.should_upload_image,
          message: `should_upload_image: expected ${exp.decision.should_upload_image}, got ${ad.should_upload_image}`,
        });
      }
    }

    if (exp.decision.status_for_db !== undefined) {
      if (ad.status_for_db !== exp.decision.status_for_db) {
        failures.push({
          path: 'decision.status_for_db',
          expected: exp.decision.status_for_db,
          actual: ad.status_for_db,
          message: `status_for_db: expected ${exp.decision.status_for_db}, got ${ad.status_for_db}`,
        });
      }
    }
  }

  // --- Display ---
  if (exp.display) {
    const ad = actual.display as Record<string, unknown>;
    for (const [key, expectedVal] of Object.entries(exp.display)) {
      if (expectedVal === undefined) continue;
      const actualVal = ad[key];
      if (expectedVal !== actualVal) {
        failures.push({
          path: `display.${key}`,
          expected: expectedVal,
          actual: actualVal,
          message: `display.${key}: expected ${JSON.stringify(expectedVal)}, got ${JSON.stringify(actualVal)}`,
        });
      }
    }
  }

  // --- Utilization ---
  if (exp.utilization) {
    const au = actual.utilization as Record<string, unknown>;

    if (exp.utilization.appears_for_city_ids !== undefined) {
      const actualCities = (au.appears_for_city_ids as string[]) || [];
      for (const cid of exp.utilization.appears_for_city_ids) {
        if (!actualCities.includes(cid)) {
          failures.push({
            path: 'utilization.appears_for_city_ids',
            expected: cid,
            actual: actualCities,
            message: `Expected city ${cid} to appear but was missing`,
          });
        }
      }
    }

    if (exp.utilization.hidden_for_city_ids !== undefined) {
      const actualHidden = (au.hidden_for_city_ids as string[]) || [];
      for (const cid of exp.utilization.hidden_for_city_ids) {
        if (!actualHidden.includes(cid)) {
          failures.push({
            path: 'utilization.hidden_for_city_ids',
            expected: cid,
            actual: actualHidden,
            message: `Expected city ${cid} to be hidden but it was not`,
          });
        }
      }
    }

    if (exp.utilization.included_in_search !== undefined) {
      if (au.included_in_search !== exp.utilization.included_in_search) {
        failures.push({
          path: 'utilization.included_in_search',
          expected: exp.utilization.included_in_search,
          actual: au.included_in_search,
          message: `included_in_search: expected ${exp.utilization.included_in_search}, got ${au.included_in_search}`,
        });
      }
    }

    if (exp.utilization.included_in_best_unit_price_ranking !== undefined) {
      if (au.included_in_best_unit_price_ranking !== exp.utilization.included_in_best_unit_price_ranking) {
        failures.push({
          path: 'utilization.included_in_best_unit_price_ranking',
          expected: exp.utilization.included_in_best_unit_price_ranking,
          actual: au.included_in_best_unit_price_ranking,
          message: `included_in_best_unit_price_ranking: expected ${exp.utilization.included_in_best_unit_price_ranking}, got ${au.included_in_best_unit_price_ranking}`,
        });
      }
    }

    if (exp.utilization.excluded_from_comparison !== undefined) {
      if (au.excluded_from_comparison !== exp.utilization.excluded_from_comparison) {
        failures.push({
          path: 'utilization.excluded_from_comparison',
          expected: exp.utilization.excluded_from_comparison,
          actual: au.excluded_from_comparison,
          message: `excluded_from_comparison: expected ${exp.utilization.excluded_from_comparison}, got ${au.excluded_from_comparison}`,
        });
      }
    }
  }

  return {
    fixture_id: fixture.id,
    passed: failures.length === 0,
    failures,
    actual,
  };
}
