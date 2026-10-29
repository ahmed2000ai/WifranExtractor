import { describe, it, expect } from 'vitest';
import { buildAccuracyRunReport } from '../accuracyRunReportService';

describe('accuracyRunReportService', () => {
  it('aggregates counts correctly for a mixed batch', async () => {
    const mockManifest = {
      extraction_folder_name: 'test-package',
      paths: {
        crops_dir: 'crops',
        json_dir: 'json',
        pdf: 'test.pdf'
      },
      counts: {
        crop_images: 10,
        json_files: 10,
        pages_rendered: 2
      },
      pre_publish_preview: {
        status: 'opened',
        summary: {
          opened_at: '2023-01-01',
          publish_count: 1,
          publish_but_exclude_from_comparison_count: 1,
          skip_or_quarantine_count: 1
        }
      }
    };

    const mockItems = [
      {
        source: { source_page_number: 1, source_item_number: '1', crop_path: 'c1' },
        raw: {},
        product: { item_domain: 'grocery' },
        prices: { offer_price: 10, original_price: null, currency: 'SAR' },
        content: {},
        promotion: {},
        quality: { publish_decision: 'publish' },
        style_validation: { validation_result: 'pass' },
        comparison: { comparison_eligible: true, comparison_unit: 'piece' }
      },
      {
        source: { source_page_number: 1, source_item_number: '2', crop_path: 'c2' },
        raw: {},
        product: { item_domain: 'electronics' },
        prices: { offer_price: 1500, original_price: null, currency: 'SAR' },
        content: {},
        promotion: {},
        quality: { publish_decision: 'publish_but_exclude_from_comparison', non_blocking_warnings: [{ code: 'missing_size', message: '' }] },
        style_validation: { validation_result: 'pass' },
        comparison: { comparison_eligible: false, comparison_exclusion_reason: 'non_grocery_item' }
      },
      {
        source: { source_page_number: 1, source_item_number: '3', crop_path: 'c3' },
        raw: {},
        product: { item_domain: 'grocery' },
        prices: { offer_price: 1.5, original_price: null, currency: 'SAR' },
        content: {},
        promotion: {},
        quality: { publish_decision: 'skip_or_quarantine', blocking_errors: [{ code: 'size_misclassified_as_price', message: '' }] },
        style_validation: { validation_result: 'fail' },
        comparison: { comparison_eligible: false, comparison_exclusion_reason: 'blocking_errors_present' }
      }
    ];

    const report = await buildAccuracyRunReport({
      extractionPackagePath: 'dummy',
      manifest: mockManifest as any,
      canonicalItems: mockItems as any
    });

    expect(report.counts.total_canonical_items).toBe(3);
    expect(report.counts.publish_count).toBe(1);
    expect(report.counts.publish_but_exclude_from_comparison_count).toBe(1);
    expect(report.counts.skip_or_quarantine_count).toBe(1);
    expect(report.counts.comparison_eligible_count).toBe(1);
    expect(report.counts.non_grocery_count).toBe(1);
    expect(report.counts.size_as_price_detections).toBe(1);
    expect(report.errors_by_code['size_misclassified_as_price']).toBe(1);
    expect(report.warnings_by_code['missing_size']).toBe(1);
    expect(report.comparison_exclusions_by_code['non_grocery_item']).toBe(1);
    expect(report.pre_publish_preview.status).toBe('opened');
  });
});
