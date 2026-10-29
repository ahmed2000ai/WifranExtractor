/**
 * Runtime Accuracy Harness Tests – Chunk 58
 *
 * Tests the pure evaluation function. No I/O, no Mistral, no Supabase.
 */

import { describe, it, expect } from 'vitest';
import { evaluateRuntimeAccuracy } from '../runtimeAccuracyHarness';
import type { CanonicalOffer } from '../../types/canonicalOffer';
import type { RuntimeAccuracyHarnessInput, RuntimeAccuracyThresholds } from '../../types/runtimeAccuracyHarness';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<{
  pageNum: number;
  itemNum: string;
  decision: string;
  offerPrice: number | null;
  originalPrice: number | null;
  sizeText: string | null;
  blockingErrors: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
  comparisonEligible: boolean;
  comparisonUnit: string | null;
  comparisonUnitPrice: number | null;
  validationConfidence: string;
  validationResult: string;
  itemDomain: string;
}> = {}): CanonicalOffer {
  return {
    source: { leaflet_id: null, source_page_number: overrides.pageNum ?? 1, source_item_number: overrides.itemNum ?? '001', external_image_id: null },
    trusted_context: { supermarket_id: 'sm-test', location_scope: 'national', city_id: null, region_id: null, offer_start_date: '2026-06-01', offer_end_date: '2026-12-31' },
    product: { title_ar: 'منتج', title_en: 'Product', brand_text: null, category_hint: null, item_domain: (overrides.itemDomain as any) ?? 'grocery', description_ar: null, description_en: null },
    prices: { offer_price: overrides.offerPrice !== undefined ? overrides.offerPrice : 10, original_price: overrides.originalPrice !== undefined ? overrides.originalPrice : 15, currency: 'SAR', discount_amount: null, discount_percentage: null, price_basis: 'each', price_condition_text: null, all_price_candidates: [] },
    content: { size_text: overrides.sizeText ?? '1L', pack_quantity: null, bundle_quantity: null, each_size_value: null, each_size_unit: null, total_content_value: null, total_content_unit: null },
    promotion: { mechanic: 'standard_price', special_offer: null, condition_text: null, bundle_quantity: null },
    comparison: { comparison_eligible: overrides.comparisonEligible ?? true, comparison_unit: overrides.comparisonUnit !== undefined ? overrides.comparisonUnit : 'liter', comparison_unit_price: overrides.comparisonUnitPrice !== undefined ? overrides.comparisonUnitPrice : 10, comparison_confidence: 'high', comparison_exclusion_reason: null },
    image: { image_bucket: null, image_path: null, image_url: null, image_source_type: null },
    quality: {
      publish_decision: (overrides.decision as any) ?? 'publish',
      extraction_confidence: 'high',
      validation_confidence: (overrides.validationConfidence as any) ?? 'high',
      comparison_confidence: 'high',
      blocking_errors: overrides.blockingErrors ?? [],
      non_blocking_warnings: overrides.warnings ?? [],
    },
    style_validation: { validation_result: (overrides.validationResult as any) ?? 'pass', visual_evidence: {}, corrected_fields: {}, style_profile_scope: 'page' },
    pre_publish: { preview_eligible: false, preview_group: 'skip_or_quarantine', display_in_preview: true },
    display: {
      show_display_unit_price: false,
      display_unit_price: null,
      display_unit_basis_value: null,
      display_unit_basis_unit: null,
      display_unit_family: null,
      display_unit_price_label_ar: null,
      display_unit_price_label_en: null,
      below_min_display_price_threshold: false,
      min_display_unit_price_sar: 0.50,
      hidden_reason: null,
    },
    raw: { raw_ocr_json: {}, raw_validation_json: null, raw_ocr_text: null, raw_attributes: {} },
  };
}

function makeInput(items: CanonicalOffer[], overrides?: Partial<RuntimeAccuracyHarnessInput>): RuntimeAccuracyHarnessInput {
  return {
    extractionPackagePath: '/test/path',
    leafletId: null,
    pageStyleProfileStatus: {
      mode: 'all_pages',
      totalPagesWithCrops: 1,
      completedPages: 1,
      failedPages: 0,
      missingPages: [],
      failures: [],
    },
    items,
    context: {
      supermarketSlug: 'test',
      locationScope: 'national',
      cityId: null,
      regionId: null,
      offerStartDate: '2026-06-01',
      offerEndDate: '2026-12-31',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('evaluateRuntimeAccuracy', () => {
  it('returns pass for clean valid run', () => {
    const items = [
      makeItem({ pageNum: 1, itemNum: '001' }),
      makeItem({ pageNum: 1, itemNum: '002' }),
      makeItem({ pageNum: 2, itemNum: '003' }),
    ];
    const result = evaluateRuntimeAccuracy(makeInput(items));
    expect(result.decision).toBe('pass');
    expect(result.summary.critical_failure_count).toBe(0);
    expect(result.summary.suspicious_row_count).toBe(0);
    expect(result.summary.total_items).toBe(3);
    expect(result.summary.publish_count).toBe(3);
  });

  it('identifies missing original prices as suspicious but does not warn by default', () => {
    const items = [
      makeItem({ itemNum: '001', originalPrice: null }),
      makeItem({ itemNum: '002' }),
    ];
    const result = evaluateRuntimeAccuracy(makeInput(items));
    expect(result.decision).toBe('pass');
    expect(result.summary.suspicious_row_count).toBe(1);
    expect(result.suspicious_rows[0].reason_codes).toContain('missing_original_price');
  });

  it('returns block_publish if publishable row has size_misclassified_as_price', () => {
    const items = [
      makeItem({
        decision: 'publish',
        blockingErrors: [{ code: 'size_misclassified_as_price', message: 'Size as price' }],
      }),
    ];
    const result = evaluateRuntimeAccuracy(makeInput(items));
    expect(result.decision).toBe('block_publish');
    expect(result.summary.critical_failure_count).toBeGreaterThan(0);
  });

  it('returns block_publish if publishable row has old-price-as-offer-price', () => {
    const items = [
      makeItem({
        decision: 'publish',
        blockingErrors: [{ code: 'original_price_misclassified_as_offer_price', message: 'Old price as offer' }],
      }),
    ];
    const result = evaluateRuntimeAccuracy(makeInput(items));
    expect(result.decision).toBe('block_publish');
    expect(result.critical_failures.some(f => f.code === 'original_price_misclassified_as_offer_price')).toBe(true);
  });

  it('returns block_publish if comparison_eligible row has null unit price', () => {
    const items = [
      makeItem({
        decision: 'publish',
        comparisonEligible: true,
        comparisonUnit: 'liter',
        comparisonUnitPrice: null,
      }),
    ];
    // Threshold is maxUnsafeComparisonEligibleRows = 0
    const result = evaluateRuntimeAccuracy(makeInput(items));
    expect(result.decision).toBe('block_publish');
    expect(result.critical_failures.some(f => f.code === 'comparison_eligible_null_unit_price')).toBe(true);
  });

  it('returns needs_human_review if skip rate exceeds threshold', () => {
    const items = [
      makeItem({ decision: 'skip_or_quarantine', comparisonEligible: false, comparisonUnit: null, comparisonUnitPrice: null }),
      makeItem({ decision: 'skip_or_quarantine', comparisonEligible: false, comparisonUnit: null, comparisonUnitPrice: null }),
      makeItem({ decision: 'skip_or_quarantine', comparisonEligible: false, comparisonUnit: null, comparisonUnitPrice: null }),
      makeItem({ decision: 'skip_or_quarantine', comparisonEligible: false, comparisonUnit: null, comparisonUnitPrice: null }),
      makeItem({ decision: 'publish' }),
    ];
    const result = evaluateRuntimeAccuracy(makeInput(items));
    // skip rate = 4/5 = 80% > 35% threshold
    expect(result.decision).toBe('needs_human_review');
    expect(result.warnings.some(w => w.code === 'high_skip_rate')).toBe(true);
  });

  it('returns needs_human_review if page warning rate exceeds threshold', () => {
    const items = [
      makeItem({ pageNum: 1, itemNum: '001', warnings: [{ code: 'w1', message: 'warn' }] }),
      makeItem({ pageNum: 1, itemNum: '002', warnings: [{ code: 'w2', message: 'warn' }] }),
      makeItem({ pageNum: 1, itemNum: '003', warnings: [{ code: 'w3', message: 'warn' }] }),
    ];
    const thresholds: RuntimeAccuracyThresholds = {
      maxCriticalFailuresForPublish: 0,
      maxPublishableRowsWithBlockingErrors: 0,
      maxUnsafeComparisonEligibleRows: 0,
      maxSkipRateWarning: 0.35,
      maxValidationFailureRateWarning: 0.15,
      maxValidationCorrectionRateWarning: 0.30,
      maxLowConfidenceValidationRateWarning: 0.25,
      maxPageWarningRateWarning: 0.40,
    };
    const result = evaluateRuntimeAccuracy(makeInput(items), thresholds);
    // 3/3 = 100% > 40%
    expect(result.warnings.some(w => w.code === 'high_page_warning_rate')).toBe(true);
  });

  it('records page style profile failures', () => {
    const items = [makeItem({ pageNum: 1 })];
    const input = makeInput(items, {
      pageStyleProfileStatus: {
        mode: 'all_pages',
        totalPagesWithCrops: 1,
        completedPages: 0,
        failedPages: 1,
        missingPages: [],
        failures: [{ pageNumber: 1, message: 'Mistral error' }],
      },
    });
    const result = evaluateRuntimeAccuracy(input);
    expect(result.summary.page_style_profile_failure_count).toBe(1);
    expect(result.warnings.some(w => w.code === 'page_style_profile_failed')).toBe(true);
    expect(result.decision).toBe('needs_human_review');
  });

  it('creates fixture candidate auto actions for suspicious rows', () => {
    const items = [
      makeItem({ offerPrice: 10, originalPrice: null }),
    ];
    const result = evaluateRuntimeAccuracy(makeInput(items));
    expect(result.auto_actions.some(a => a.action === 'created_fixture_candidate')).toBe(true);
  });

  it('does not call Mistral in dry-run mode', () => {
    const items = [
      makeItem({ validationConfidence: 'low' }),
    ];
    const input = makeInput(items, { isDryRun: true });
    const result = evaluateRuntimeAccuracy(input);
    expect(result.auto_actions.some(a => a.action === 'skipped_due_to_dry_run')).toBe(true);
    expect(result.auto_actions.every(a => a.action !== 'revalidated_item')).toBe(true);
  });

  it('records revalidation skipped_due_to_dry_run', () => {
    const items = [
      makeItem({ validationConfidence: 'low', originalPrice: null }),
    ];
    const input = makeInput(items, { isDryRun: true });
    const result = evaluateRuntimeAccuracy(input);
    const skippedActions = result.auto_actions.filter(a => a.action === 'skipped_due_to_dry_run');
    expect(skippedActions.length).toBeGreaterThan(0);
  });

  it('generates correct page summaries', () => {
    const items = [
      makeItem({ pageNum: 1, itemNum: '001' }),
      makeItem({ pageNum: 1, itemNum: '002', decision: 'skip_or_quarantine', comparisonEligible: false, comparisonUnit: null, comparisonUnitPrice: null }),
      makeItem({ pageNum: 2, itemNum: '003' }),
    ];
    const result = evaluateRuntimeAccuracy(makeInput(items));
    expect(result.page_summaries).toHaveLength(2);
    const p1 = result.page_summaries.find(p => p.page_number === 1);
    expect(p1?.item_count).toBe(2);
    expect(p1?.publish_count).toBe(1);
    expect(p1?.skip_count).toBe(1);
  });

  it('marks publishable rows with blocking errors as critical', () => {
    const items = [
      makeItem({
        decision: 'publish',
        blockingErrors: [{ code: 'missing_offer_price', message: 'No price' }],
      }),
    ];
    const result = evaluateRuntimeAccuracy(makeInput(items));
    expect(result.decision).toBe('block_publish');
    expect(result.suspicious_rows.length).toBe(1);
  });

  it('skipped items do not trigger critical failures', () => {
    const items = [
      makeItem({
        decision: 'skip_or_quarantine',
        blockingErrors: [{ code: 'missing_offer_price', message: 'No price' }],
        comparisonEligible: false,
        comparisonUnit: null,
        comparisonUnitPrice: null,
      }),
    ];
    const result = evaluateRuntimeAccuracy(makeInput(items));
    expect(result.decision).not.toBe('block_publish');
    expect(result.summary.critical_failure_count).toBe(0);
  });

  it('empty items returns pass', () => {
    const result = evaluateRuntimeAccuracy(makeInput([]));
    expect(result.decision).toBe('pass');
    expect(result.summary.total_items).toBe(0);
  });
});
