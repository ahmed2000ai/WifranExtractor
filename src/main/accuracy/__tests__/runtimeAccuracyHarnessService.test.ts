/**
 * Runtime Accuracy Harness Service Tests – Chunk 58
 *
 * Tests the orchestrator service with mocked filesystem.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

import { runRuntimeAccuracyHarness } from '../runtimeAccuracyHarnessService';

vi.mock('fs');
vi.mock('../../../shared/utils/runtimeAccuracyHarness', () => ({
  evaluateRuntimeAccuracy: vi.fn().mockReturnValue({
    schema_version: 1,
    created_at: '2026-06-23T00:00:00.000Z',
    decision: 'pass',
    summary: {
      total_items: 2,
      publish_count: 2,
      publish_but_exclude_from_comparison_count: 0,
      skip_or_quarantine_count: 0,
      blocking_error_count: 0,
      warning_count: 0,
      comparison_excluded_count: 0,
      critical_failure_count: 0,
      suspicious_row_count: 0,
      page_style_profile_failure_count: 0,
      low_confidence_validation_count: 0,
      validation_correction_count: 0,
    },
    critical_failures: [],
    warnings: [],
    suspicious_rows: [],
    page_summaries: [],
    thresholds: {} as any,
    auto_actions: [],
    fixture_candidates: [],
  }),
}));
vi.mock('../../extraction/extractionManifestService', () => ({
  loadExtractionManifest: vi.fn().mockResolvedValue({
    schema_version: 1,
    extraction_status: 'completed',
    db_update_status: 'not_started',
    created_at: '2026-06-23T00:00:00.000Z',
    updated_at: '2026-06-23T00:00:00.000Z',
    extraction_folder_name: 'test-package',
    pdf_file_name: 'test.pdf',
    pdf_base_name: 'test',
    processing_scope: { mode: 'all_pages', pages: [1] },
    supermarket: { slug: 'test-market' },
    location: { location_scope: 'national' },
    offer_dates: { valid_from: '2026-06-01', valid_to: '2026-12-31' },
    stages: {} as any,
    counts: {} as any,
    paths: {
      pdf: '/test/test.pdf',
      chunks_dir: '/test/chunks',
      pages_dir: '/test/pages',
      crops_dir: '/test/crops',
      json_dir: '/test/json',
      logs_dir: '/test/logs',
      metadata_dir: '/test/metadata',
      manual_crop_layout: '/test/manual_crop_layout.json',
      flexible_item_ocr_summary: '/test/ocr-summary.json',
      ocr_returned_keys: '/test/ocr-keys.json',
      ocr_keys_without_values: '/test/ocr-keys-no-values.json',
    },
    validation: { package_valid: true, db_update_eligible: true, checked_at: '2026-06-23T00:00:00.000Z', warnings: [], errors: [] },
  }),
  saveExtractionManifest: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../runtimeFixtureCandidateService', () => ({
  createFixtureCandidates: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../reporting/runtimeAccuracyReportService', () => ({
  writeRuntimeAccuracyReport: vi.fn().mockResolvedValue(undefined),
}));

describe('runRuntimeAccuracyHarness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([
      'item-001.canonical.json',
      'item-002.canonical.json',
    ] as any);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      source: { source_page_number: 1, source_item_number: '001', leaflet_id: null, external_image_id: null },
      trusted_context: { supermarket_id: null, location_scope: 'national', city_id: null, region_id: null, offer_start_date: '2026-06-01', offer_end_date: '2026-12-31' },
      product: { title_ar: 'test', title_en: 'test', brand_text: null, category_hint: null, item_domain: 'grocery', description_ar: null, description_en: null },
      prices: { offer_price: 10, original_price: 15, currency: 'SAR', discount_amount: null, discount_percentage: null, price_basis: 'each', price_condition_text: null, all_price_candidates: [] },
      content: { size_text: '1L', pack_quantity: null, bundle_quantity: null, each_size_value: null, each_size_unit: null, total_content_value: null, total_content_unit: null },
      promotion: { mechanic: 'standard_price', special_offer: null, condition_text: null, bundle_quantity: null },
      comparison: { comparison_eligible: true, comparison_unit: 'liter', comparison_unit_price: 10, comparison_confidence: 'high', comparison_exclusion_reason: null },
      image: { image_bucket: null, image_path: null, image_url: null, image_source_type: null },
      quality: { publish_decision: 'publish', extraction_confidence: 'high', validation_confidence: 'high', comparison_confidence: 'high', blocking_errors: [], non_blocking_warnings: [] },
      style_validation: { validation_result: 'pass', visual_evidence: {}, corrected_fields: {}, style_profile_scope: 'page' },
      pre_publish: { preview_eligible: true, preview_group: 'publish', display_in_preview: true },
      raw: { raw_ocr_json: {}, raw_validation_json: null, raw_ocr_text: null, raw_attributes: {} },
    }));
  });

  it('runs the harness and returns a result', async () => {
    const result = await runRuntimeAccuracyHarness('/test/path');
    expect(result).toBeDefined();
    expect(result.decision).toBe('pass');
  });

  it('updates manifest with completed status', async () => {
    const { saveExtractionManifest } = await import('../../extraction/extractionManifestService');
    await runRuntimeAccuracyHarness('/test/path');
    const lastCall = vi.mocked(saveExtractionManifest).mock.calls;
    const lastManifest = lastCall[lastCall.length - 1][1] as any;
    expect(lastManifest.runtime_accuracy_harness.status).toBe('completed');
    expect(lastManifest.runtime_accuracy_harness.decision).toBe('pass');
  });

  it('writes reports', async () => {
    const { writeRuntimeAccuracyReport } = await import('../../reporting/runtimeAccuracyReportService');
    await runRuntimeAccuracyHarness('/test/path');
    expect(writeRuntimeAccuracyReport).toHaveBeenCalledOnce();
  });

  it('creates fixture candidates', async () => {
    const { createFixtureCandidates } = await import('../runtimeFixtureCandidateService');
    await runRuntimeAccuracyHarness('/test/path');
    expect(createFixtureCandidates).toHaveBeenCalledOnce();
  });

  it('passes isDryRun to evaluator', async () => {
    const { evaluateRuntimeAccuracy } = await import('../../../shared/utils/runtimeAccuracyHarness');
    await runRuntimeAccuracyHarness('/test/path', { isDryRun: true });
    const callArg = vi.mocked(evaluateRuntimeAccuracy).mock.calls[0][0];
    expect(callArg.isDryRun).toBe(true);
  });
});
