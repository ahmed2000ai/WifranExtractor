/**
 * Runtime Accuracy Report Service Tests – Chunk 58
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

import { writeRuntimeAccuracyReport, formatRuntimeAccuracyReportMarkdown } from '../runtimeAccuracyReportService';

vi.mock('fs');

describe('runtimeAccuracyReportService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockResult: any = {
    schema_version: 1,
    created_at: '2026-06-23T00:00:00.000Z',
    decision: 'needs_human_review',
    summary: {
      total_items: 10,
      publish_count: 5,
      publish_but_exclude_from_comparison_count: 1,
      skip_or_quarantine_count: 4,
      blocking_error_count: 1,
      warning_count: 2,
      comparison_excluded_count: 3,
      critical_failure_count: 1,
      suspicious_row_count: 2,
      page_style_profile_failure_count: 0,
      low_confidence_validation_count: 1,
      validation_correction_count: 1,
    },
    critical_failures: [
      { code: 'missing_offer_price', message: 'test', source_page_number: 1, source_item_number: '001' }
    ],
    warnings: [
      { code: 'high_skip_rate', message: 'skip test', source_page_number: null, source_item_number: null }
    ],
    suspicious_rows: [
      { source_page_number: 1, source_item_number: '001', publish_decision: 'publish', offer_price: null, original_price: null, size_text: null, reason_codes: ['missing_offer_price'] }
    ],
    page_summaries: [
      { page_number: 1, item_count: 10, publish_count: 6, skip_count: 4, warning_count: 2, blocking_error_count: 1, suspicious_count: 2, style_profile_status: 'completed' }
    ],
    auto_actions: [
      { action: 'created_fixture_candidate', source_page_number: 1, source_item_number: '001', reason: 'suspicious', result: 'created' }
    ],
    fixture_candidates: [
      { fixture_candidate_id: 'page-001-item-001', path: 'metadata/fixture-candidates/...', reason_codes: ['missing_offer_price'] }
    ],
  };

  it('writes JSON and MD reports', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    
    await writeRuntimeAccuracyReport('/workspace', mockResult);

    expect(fs.mkdirSync).toHaveBeenCalled();
    const calls = vi.mocked(fs.writeFileSync).mock.calls;
    expect(calls).toHaveLength(2);
    
    const paths = calls.map(c => c[0] as string);
    expect(paths.some(p => p.includes('runtime-accuracy-harness-report.json'))).toBe(true);
    expect(paths.some(p => p.includes('runtime-accuracy-harness-report.md'))).toBe(true);
  });

  it('formats MD report correctly', () => {
    const md = formatRuntimeAccuracyReportMarkdown(mockResult);
    expect(md).toContain('🔍 NEEDS HUMAN REVIEW');
    expect(md).toContain('missing_offer_price');
    expect(md).toContain('high_skip_rate');
    expect(md).toContain('created_fixture_candidate');
  });
});
