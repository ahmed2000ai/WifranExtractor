import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { buildPrePublishSummary, markPrePublishOpened, markPrePublishApproved } from '../prePublishApprovalService';
import { loadExtractionManifest, saveExtractionManifest } from '../../extraction/extractionManifestService';

vi.mock('../../extraction/extractionManifestService', () => ({
  loadExtractionManifest: vi.fn(),
  saveExtractionManifest: vi.fn()
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn()
  }
}));

describe('prePublishApprovalService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('builds summary from canonical json files', async () => {
    const mockManifest = {
      extraction_folder_name: 'test-folder',
      supermarket: { name: 'Test Supermarket' },
      location: { location_scope: 'city', display_name: 'Test City' },
      offer_dates: { valid_from: '2026-06-10', valid_to: '2026-06-16' },
      paths: { crops_dir: '/test/crops', json_dir: '/test/json' }
    };

    (loadExtractionManifest as any).mockResolvedValue(mockManifest);
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readdirSync as any).mockReturnValue(['item-001.canonical.json', 'item-002.canonical.json']);
    
    (fs.readFileSync as any).mockImplementation((path: string) => {
      if (path.includes('item-001')) {
        return JSON.stringify({
          source: { source_page_number: 1, source_item_number: '001', crop_path: '/test/crops/1.jpg' },
          quality: { publish_decision: 'publish', blocking_errors: [], non_blocking_warnings: [] },
          product: { item_domain: 'grocery' },
          comparison: { comparison_eligible: true },
          pre_publish: { preview_eligible: true, display_in_preview: true },
          prices: {}, content: {}, promotion: {}, raw: {}
        });
      } else {
        return JSON.stringify({
          source: { source_page_number: 1, source_item_number: '002', crop_path: '/test/crops/2.jpg' },
          quality: { publish_decision: 'skip_or_quarantine', blocking_errors: [{ code: 'err', message: 'err msg' }], non_blocking_warnings: [] },
          product: { item_domain: 'electronics' },
          comparison: { comparison_eligible: false },
          pre_publish: { preview_eligible: false, display_in_preview: true },
          prices: {}, content: {}, promotion: {}, raw: {}
        });
      }
    });

    const summary = await buildPrePublishSummary('/workspace');
    
    expect(summary.counts.total_items).toBe(2);
    expect(summary.counts.publish).toBe(1);
    expect(summary.counts.skip_or_quarantine).toBe(1);
    expect(summary.counts.blocking_errors).toBe(1);
    expect(summary.counts.non_grocery).toBe(1);
    
    expect(summary.items.length).toBe(2);
    expect(summary.items[0].publish_decision).toBe('publish');
    expect(summary.items[1].publish_decision).toBe('skip_or_quarantine');
    const writeCall = vi.mocked(fs.writeFileSync).mock.calls.find(c => c[0] === path.join('/workspace', 'metadata', 'reports', 'pre-publish-preview-summary.json'));
    expect(writeCall).toBeDefined();
    const writtenJson = JSON.parse(writeCall![1] as string);
    expect(writtenJson.counts).toMatchObject({
      total_items: 2,
      publish: 1,
      skip_or_quarantine: 1
    });
  });

  it('marks preview opened in manifest', async () => {
    const mockManifest = { pre_publish_preview: { status: 'not_opened' } };
    (loadExtractionManifest as any).mockResolvedValue(mockManifest);
    
    await markPrePublishOpened('/workspace');
    
    expect(mockManifest.pre_publish_preview.status).toBe('opened');
    expect(saveExtractionManifest).toHaveBeenCalledWith('/workspace', mockManifest);
  });

  it('marks preview approved in manifest and sets db_update_status', async () => {
    const mockManifest = { pre_publish_preview: { status: 'opened' } };
    (loadExtractionManifest as any).mockResolvedValue(mockManifest);
    
    const counts = { publish: 5, publish_but_exclude_from_comparison: 2, skip_or_quarantine: 1 };
    await markPrePublishApproved('/workspace', counts);
    
    expect((mockManifest as any).pre_publish_preview.status).toBe('approved');
    expect((mockManifest as any).pre_publish_preview.summary.publish_count).toBe(5);
    expect((mockManifest as any).db_update_status).toBe('in_progress');
    expect(saveExtractionManifest).toHaveBeenCalledWith('/workspace', mockManifest);
  });
});
