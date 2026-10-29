/**
 * Accuracy Harness Report Generator – Chunk 57
 *
 * Aggregates fixture results into per-field accuracy metrics and
 * zero-tolerance counters. Evaluates thresholds.
 *
 * No API calls. No Supabase. No Mistral.
 */

import type {
  AccuracyHarnessFixture,
  AccuracyHarnessFixtureResult,
  AccuracyHarnessMetrics,
  AccuracyHarnessReport,
  AccuracyThresholds,
} from '../types/accuracyHarness';
import { DEFAULT_ACCURACY_THRESHOLDS } from '../types/accuracyHarness';

// ---------------------------------------------------------------------------
// Field accuracy helpers
// ---------------------------------------------------------------------------

function fieldAccuracy(
  results: AccuracyHarnessFixtureResult[],
  fixtures: AccuracyHarnessFixture[],
  fieldPath: string
): number {
  let total = 0;
  let correct = 0;

  for (let i = 0; i < results.length; i++) {
    const fixture = fixtures[i];
    if (!fixture) continue;

    // Only count fixtures that declare an expected value for this field
    const expectedCanonical = fixture.expected.canonical as Record<string, unknown> | undefined;
    if (!expectedCanonical || expectedCanonical[fieldPath] === undefined) continue;

    total++;
    const hasFailure = results[i].failures.some((f) => f.path === `canonical.${fieldPath}`);
    if (!hasFailure) correct++;
  }

  return total === 0 ? 1.0 : correct / total;
}

// ---------------------------------------------------------------------------
// Zero-tolerance counter helpers
// ---------------------------------------------------------------------------

function countFalsePublish(
  results: AccuracyHarnessFixtureResult[],
  fixtures: AccuracyHarnessFixture[]
): number {
  let count = 0;
  for (let i = 0; i < results.length; i++) {
    const f = fixtures[i];
    if (!f) continue;
    const expectedDecision = f.expected.decision?.publish_decision;
    const actualDecision = (results[i].actual.decision as Record<string, unknown>).publish_decision;
    if (expectedDecision === 'skip_or_quarantine' && actualDecision !== 'skip_or_quarantine') {
      count++;
    }
  }
  return count;
}

function countFalsePublishWrongPrice(
  results: AccuracyHarnessFixtureResult[],
  fixtures: AccuracyHarnessFixture[]
): number {
  let count = 0;
  for (let i = 0; i < results.length; i++) {
    const f = fixtures[i];
    if (!f) continue;
    const actualDecision = (results[i].actual.decision as Record<string, unknown>).publish_decision;
    if (actualDecision === 'skip_or_quarantine') continue;

    // Check if the expected offer price differs from actual
    const expectedPrice = f.expected.canonical?.offer_price;
    const actualPrice = (results[i].actual.canonical as Record<string, unknown>).offer_price as number | null;
    if (expectedPrice !== undefined && expectedPrice !== null && actualPrice !== expectedPrice) {
      count++;
    }
  }
  return count;
}

function countSizeAsPricePublished(
  results: AccuracyHarnessFixtureResult[],
  fixtures: AccuracyHarnessFixture[]
): number {
  let count = 0;
  for (let i = 0; i < results.length; i++) {
    const f = fixtures[i];
    if (!f) continue;
    const actualDecision = (results[i].actual.decision as Record<string, unknown>).publish_decision;
    if (actualDecision === 'skip_or_quarantine') continue;

    // Check for size-as-price blocking codes that should have blocked
    const expectedBlocking = f.expected.blocking_error_codes || [];
    const sizeAsPriceCodes = ['size_misclassified_as_price', 'offer_price_matches_size_value'];
    if (expectedBlocking.some((c) => sizeAsPriceCodes.includes(c))) {
      count++;
    }
  }
  return count;
}

function countOldPriceAsOfferPricePublished(
  results: AccuracyHarnessFixtureResult[],
  fixtures: AccuracyHarnessFixture[]
): number {
  let count = 0;
  for (let i = 0; i < results.length; i++) {
    const f = fixtures[i];
    if (!f) continue;
    const actualDecision = (results[i].actual.decision as Record<string, unknown>).publish_decision;
    if (actualDecision === 'skip_or_quarantine') continue;

    const expectedBlocking = f.expected.blocking_error_codes || [];
    if (expectedBlocking.includes('original_price_misclassified_as_offer_price')) {
      count++;
    }
  }
  return count;
}

function countComparisonErrorForEligible(
  results: AccuracyHarnessFixtureResult[],
  fixtures: AccuracyHarnessFixture[]
): number {
  let count = 0;
  for (let i = 0; i < results.length; i++) {
    const f = fixtures[i];
    if (!f) continue;
    if (f.expected.comparison?.comparison_eligible !== true) continue;

    const actualEligible = (results[i].actual.comparison as Record<string, unknown>).comparison_eligible;
    if (actualEligible !== true) {
      count++;
    }
  }
  return count;
}

function countInvalidLocationPublished(
  results: AccuracyHarnessFixtureResult[],
  fixtures: AccuracyHarnessFixture[]
): number {
  let count = 0;
  for (let i = 0; i < results.length; i++) {
    const f = fixtures[i];
    if (!f) continue;
    const actualDecision = (results[i].actual.decision as Record<string, unknown>).publish_decision;
    if (actualDecision === 'skip_or_quarantine') continue;

    const expectedBlocking = f.expected.blocking_error_codes || [];
    const locationCodes = [
      'invalid_location_scope',
      'missing_city_for_city_scope',
      'missing_region_for_region_scope',
    ];
    if (expectedBlocking.some((c) => locationCodes.includes(c))) {
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Report generator
// ---------------------------------------------------------------------------

export function generateAccuracyHarnessReport(input: {
  fixtures: AccuracyHarnessFixture[];
  results: AccuracyHarnessFixtureResult[];
  thresholds?: AccuracyThresholds;
}): AccuracyHarnessReport {
  const { fixtures, results, thresholds = DEFAULT_ACCURACY_THRESHOLDS } = input;

  const metrics: AccuracyHarnessMetrics = {
    total_fixtures: results.length,
    passed_fixtures: results.filter((r) => r.passed).length,
    failed_fixtures: results.filter((r) => !r.passed).length,

    offer_price_accuracy: fieldAccuracy(results, fixtures, 'offer_price'),
    original_price_accuracy: fieldAccuracy(results, fixtures, 'original_price'),
    size_content_accuracy: fieldAccuracy(results, fixtures, 'size_text'),
    pack_quantity_accuracy: fieldAccuracy(results, fixtures, 'pack_quantity'),
    bundle_quantity_accuracy: fieldAccuracy(results, fixtures, 'bundle_quantity'),

    comparison_eligibility_accuracy: (() => {
      let total = 0;
      let correct = 0;
      for (let i = 0; i < results.length; i++) {
        if (fixtures[i]?.expected.comparison?.comparison_eligible === undefined) continue;
        total++;
        const ac = (results[i].actual.comparison as Record<string, unknown>).comparison_eligible;
        if (ac === fixtures[i].expected.comparison!.comparison_eligible) correct++;
      }
      return total === 0 ? 1.0 : correct / total;
    })(),

    unit_price_calculation_accuracy: (() => {
      let total = 0;
      let correct = 0;
      const tolerance = 0.05;
      for (let i = 0; i < results.length; i++) {
        const expectedUnitPrice = fixtures[i]?.expected.comparison?.comparison_unit_price;
        if (expectedUnitPrice === undefined || expectedUnitPrice === null) continue;
        total++;
        const actualUnitPrice = (results[i].actual.comparison as Record<string, unknown>)
          .comparison_unit_price as number | null;
        if (
          actualUnitPrice !== null &&
          Math.abs(expectedUnitPrice - actualUnitPrice) <= tolerance
        ) {
          correct++;
        }
      }
      return total === 0 ? 1.0 : correct / total;
    })(),

    publish_decision_accuracy: (() => {
      let total = 0;
      let correct = 0;
      for (let i = 0; i < results.length; i++) {
        if (!fixtures[i]?.expected.decision?.publish_decision) continue;
        total++;
        const ac = (results[i].actual.decision as Record<string, unknown>).publish_decision;
        if (ac === fixtures[i].expected.decision.publish_decision) correct++;
      }
      return total === 0 ? 1.0 : correct / total;
    })(),

    // Zero-tolerance counters
    false_publish_count: countFalsePublish(results, fixtures),
    false_publish_wrong_price_count: countFalsePublishWrongPrice(results, fixtures),
    size_as_price_published_count: countSizeAsPricePublished(results, fixtures),
    old_price_as_offer_price_published_count: countOldPriceAsOfferPricePublished(results, fixtures),
    comparison_error_for_eligible_count: countComparisonErrorForEligible(results, fixtures),
    invalid_location_published_count: countInvalidLocationPublished(results, fixtures),
  };

  // Threshold evaluation
  const thresholdFailures: string[] = [];
  if (metrics.false_publish_wrong_price_count > thresholds.falsePublishWrongPriceMax) {
    thresholdFailures.push(
      `false_publish_wrong_price_count=${metrics.false_publish_wrong_price_count} exceeds max=${thresholds.falsePublishWrongPriceMax}`
    );
  }
  if (metrics.size_as_price_published_count > thresholds.sizeAsPricePublishedMax) {
    thresholdFailures.push(
      `size_as_price_published_count=${metrics.size_as_price_published_count} exceeds max=${thresholds.sizeAsPricePublishedMax}`
    );
  }
  if (metrics.old_price_as_offer_price_published_count > thresholds.oldPriceAsOfferPricePublishedMax) {
    thresholdFailures.push(
      `old_price_as_offer_price_published_count=${metrics.old_price_as_offer_price_published_count} exceeds max=${thresholds.oldPriceAsOfferPricePublishedMax}`
    );
  }
  if (metrics.invalid_location_published_count > thresholds.invalidLocationPublishedMax) {
    thresholdFailures.push(
      `invalid_location_published_count=${metrics.invalid_location_published_count} exceeds max=${thresholds.invalidLocationPublishedMax}`
    );
  }
  if (metrics.comparison_error_for_eligible_count > thresholds.comparisonErrorForEligibleMax) {
    thresholdFailures.push(
      `comparison_error_for_eligible_count=${metrics.comparison_error_for_eligible_count} exceeds max=${thresholds.comparisonErrorForEligibleMax}`
    );
  }

  return {
    schema_version: 1,
    run_at: new Date().toISOString(),
    metrics,
    thresholds_passed: thresholdFailures.length === 0,
    threshold_failures: thresholdFailures,
    fixture_results: results,
  };
}

// ---------------------------------------------------------------------------
// Markdown report formatter
// ---------------------------------------------------------------------------

export function formatAccuracyHarnessReportMarkdown(report: AccuracyHarnessReport): string {
  const m = report.metrics;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

  const lines: string[] = [
    '# Accuracy Harness Report — Chunk 57',
    '',
    `**Run at:** ${report.run_at}`,
    '',
    '## Summary',
    '',
    `| Metric | Value |`,
    `|---|---|`,
    `| Total fixtures | ${m.total_fixtures} |`,
    `| Passed | ${m.passed_fixtures} |`,
    `| Failed | ${m.failed_fixtures} |`,
    '',
    '## Field Accuracy',
    '',
    `| Field | Accuracy |`,
    `|---|---|`,
    `| offer_price | ${pct(m.offer_price_accuracy)} |`,
    `| original_price | ${pct(m.original_price_accuracy)} |`,
    `| size/content | ${pct(m.size_content_accuracy)} |`,
    `| pack_quantity | ${pct(m.pack_quantity_accuracy)} |`,
    `| bundle_quantity | ${pct(m.bundle_quantity_accuracy)} |`,
    `| comparison_eligibility | ${pct(m.comparison_eligibility_accuracy)} |`,
    `| unit_price_calculation | ${pct(m.unit_price_calculation_accuracy)} |`,
    `| publish_decision | ${pct(m.publish_decision_accuracy)} |`,
    '',
    '## Zero-Tolerance Counters',
    '',
    `| Counter | Count | Max Allowed | Status |`,
    `|---|---|---|---|`,
    `| false_publish_wrong_price | ${m.false_publish_wrong_price_count} | 0 | ${m.false_publish_wrong_price_count === 0 ? '✅' : '❌'} |`,
    `| size_as_price_published | ${m.size_as_price_published_count} | 0 | ${m.size_as_price_published_count === 0 ? '✅' : '❌'} |`,
    `| old_price_as_offer_price_published | ${m.old_price_as_offer_price_published_count} | 0 | ${m.old_price_as_offer_price_published_count === 0 ? '✅' : '❌'} |`,
    `| comparison_error_for_eligible | ${m.comparison_error_for_eligible_count} | 0 | ${m.comparison_error_for_eligible_count === 0 ? '✅' : '❌'} |`,
    `| invalid_location_published | ${m.invalid_location_published_count} | 0 | ${m.invalid_location_published_count === 0 ? '✅' : '❌'} |`,
    `| false_publish (any) | ${m.false_publish_count} | — | ${m.false_publish_count === 0 ? '✅' : '⚠️'} |`,
    '',
    `## Thresholds: ${report.thresholds_passed ? '✅ ALL PASSED' : '❌ FAILED'}`,
    '',
  ];

  if (report.threshold_failures.length > 0) {
    lines.push('**Failures:**');
    for (const f of report.threshold_failures) {
      lines.push(`- ❌ ${f}`);
    }
    lines.push('');
  }

  // Failed fixture details
  const failed = report.fixture_results.filter((r) => !r.passed);
  if (failed.length > 0) {
    lines.push('## Failed Fixtures');
    lines.push('');
    for (const r of failed) {
      lines.push(`### ${r.fixture_id}`);
      lines.push('');
      for (const f of r.failures) {
        lines.push(`- **${f.path}**: ${f.message}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
