/**
 * Runtime Fixture Candidate Service Tests – Chunk 58
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

import { createFixtureCandidates } from '../runtimeFixtureCandidateService';

vi.mock('fs');

describe('createFixtureCandidates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false); // pretend dir doesn't exist to test mkdir
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
  });

  it('creates fixture candidates for suspicious rows', async () => {
    const suspiciousRows = [
      {
        source_page_number: 1,
        source_item_number: '001',
        reason_codes: ['missing_original_price'],
        messages: ['Missing orig'],
        publish_decision: 'publish',
        offer_price: 10,
        original_price: null,
        size_text: '1L',
        comparison_eligible: true,
      },
    ];

    const canonicalItems: any[] = [
      {
        source: { source_page_number: 1, source_item_number: '001', crop_path: '/crops/test.jpg' },
        raw: { raw_ocr_json: { raw: true }, raw_validation_json: { val: true } },
      },
    ];

    const result = await createFixtureCandidates('/workspace', suspiciousRows, canonicalItems);

    expect(result).toHaveLength(1);
    expect(result[0].fixture_candidate_id).toBe('page-001-item-001');

    // Should create directory
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('page-001-item-001'),
      { recursive: true }
    );

    // Should write JSONs
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('fixture-candidate.json'),
      expect.any(String)
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('canonical.json'),
      expect.any(String)
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('raw_mistral_response.json'),
      expect.any(String)
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('validation.json'),
      expect.any(String)
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('runtime_issue.json'),
      expect.any(String)
    );
  });

  it('handles rows missing canonical item gracefully', async () => {
    const suspiciousRows = [
      {
        source_page_number: 2,
        source_item_number: '002',
        reason_codes: ['missing'],
        messages: ['missing'],
        publish_decision: 'publish',
        offer_price: null,
        original_price: null,
        size_text: null,
        comparison_eligible: false,
      },
    ];

    const result = await createFixtureCandidates('/workspace', suspiciousRows, []);

    expect(result).toHaveLength(1);
    // Should still write fixture-candidate and runtime_issue, but not canonical
    const calls = vi.mocked(fs.writeFileSync).mock.calls;
    const paths = calls.map(c => c[0] as string);
    expect(paths.some(p => p.includes('fixture-candidate.json'))).toBe(true);
    expect(paths.some(p => p.includes('runtime_issue.json'))).toBe(true);
    expect(paths.some(p => p.includes('canonical.json'))).toBe(false);
  });
});
