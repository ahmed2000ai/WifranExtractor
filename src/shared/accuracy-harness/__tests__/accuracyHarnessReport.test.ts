/**
 * Accuracy Harness Report Tests – Chunk 57
 *
 * Tests the report generator's metric aggregation and threshold enforcement.
 * No Mistral. No Supabase. No network.
 */

import { describe, it, expect } from 'vitest';
import { generateAccuracyHarnessReport, formatAccuracyHarnessReportMarkdown } from '../accuracyHarnessReport';
import type { AccuracyHarnessFixture, AccuracyHarnessFixtureResult } from '../../types/accuracyHarness';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFixture(id: string, overrides?: Partial<AccuracyHarnessFixture['expected']>): AccuracyHarnessFixture {
  return {
    schema_version: 1,
    id,
    description: `Test fixture ${id}`,
    supermarket_slug: 'test',
    source: { page_number: 1, item_number: '001' },
    trusted_context: {
      location_scope: 'national',
      offer_start_date: '2026-06-01',
      offer_end_date: '2026-12-31',
    },
    inputs: { raw_mistral_response: {} },
    expected: {
      decision: {
        publish_decision: 'publish',
        should_upsert_db: true,
        should_upload_image: true,
      },
      ...overrides,
    },
  };
}

function makeResult(fixtureId: string, passed: boolean, overrides?: Partial<AccuracyHarnessFixtureResult['actual']>): AccuracyHarnessFixtureResult {
  return {
    fixture_id: fixtureId,
    passed,
    failures: passed ? [] : [{ path: 'test', expected: 'a', actual: 'b', message: 'test failure' }],
    actual: {
      canonical: { offer_price: 10, original_price: 15 },
      blocking_error_codes: [],
      warning_codes: [],
      comparison_exclusion_codes: [],
      comparison: { comparison_eligible: true, comparison_unit: 'liter', comparison_unit_price: 10 },
      decision: { publish_decision: 'publish', should_upsert_db: true, should_upload_image: true, status_for_db: 'published' },
      utilization: {},
      db_payload: null,
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Accuracy Harness Report', () => {
  it('generates report with correct totals', () => {
    const fixtures = [makeFixture('a'), makeFixture('b'), makeFixture('c')];
    const results = [makeResult('a', true), makeResult('b', true), makeResult('c', false)];

    const report = generateAccuracyHarnessReport({ fixtures, results });

    expect(report.metrics.total_fixtures).toBe(3);
    expect(report.metrics.passed_fixtures).toBe(2);
    expect(report.metrics.failed_fixtures).toBe(1);
    expect(report.schema_version).toBe(1);
  });

  it('passes thresholds when all zero-tolerance metrics are zero', () => {
    const fixtures = [makeFixture('a'), makeFixture('b')];
    const results = [makeResult('a', true), makeResult('b', true)];

    const report = generateAccuracyHarnessReport({ fixtures, results });

    expect(report.thresholds_passed).toBe(true);
    expect(report.threshold_failures).toEqual([]);
    expect(report.metrics.false_publish_wrong_price_count).toBe(0);
    expect(report.metrics.size_as_price_published_count).toBe(0);
    expect(report.metrics.old_price_as_offer_price_published_count).toBe(0);
    expect(report.metrics.comparison_error_for_eligible_count).toBe(0);
    expect(report.metrics.invalid_location_published_count).toBe(0);
  });

  it('threshold failure fails report when size-as-price is published', () => {
    const fixtures = [
      makeFixture('bad', {
        blocking_error_codes: ['size_misclassified_as_price'],
        decision: { publish_decision: 'skip_or_quarantine', should_upsert_db: false, should_upload_image: false },
      }),
    ];
    // Simulate the harness incorrectly publishing this fixture
    const results = [
      makeResult('bad', false, {
        decision: { publish_decision: 'publish', should_upsert_db: true, should_upload_image: true, status_for_db: 'published' },
      }),
    ];

    const report = generateAccuracyHarnessReport({ fixtures, results });

    expect(report.metrics.size_as_price_published_count).toBe(1);
    expect(report.thresholds_passed).toBe(false);
    expect(report.threshold_failures.length).toBeGreaterThan(0);
  });

  it('threshold failure fails report when comparison error for eligible', () => {
    const fixtures = [
      makeFixture('comp', {
        comparison: { comparison_eligible: true, comparison_unit: 'liter', comparison_unit_price: 5 },
        decision: { publish_decision: 'publish', should_upsert_db: true, should_upload_image: true },
      }),
    ];
    const results = [
      makeResult('comp', false, {
        comparison: { comparison_eligible: false, comparison_unit: null, comparison_unit_price: null },
      }),
    ];

    const report = generateAccuracyHarnessReport({ fixtures, results });

    expect(report.metrics.comparison_error_for_eligible_count).toBe(1);
    expect(report.thresholds_passed).toBe(false);
  });

  it('generates valid markdown output', () => {
    const fixtures = [makeFixture('a')];
    const results = [makeResult('a', true)];
    const report = generateAccuracyHarnessReport({ fixtures, results });
    const md = formatAccuracyHarnessReportMarkdown(report);

    expect(md).toContain('# Accuracy Harness Report');
    expect(md).toContain('Total fixtures');
    expect(md).toContain('Zero-Tolerance');
    expect(md).toContain('ALL PASSED');
  });

  it('markdown shows failed fixtures when present', () => {
    const fixtures = [makeFixture('a')];
    const results = [makeResult('a', false)];
    const report = generateAccuracyHarnessReport({ fixtures, results });
    const md = formatAccuracyHarnessReportMarkdown(report);

    expect(md).toContain('Failed Fixtures');
    expect(md).toContain('test failure');
  });
});
