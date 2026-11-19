import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as realPublishRehearsalService from '../realPublishRehearsalService';
import * as envConfig from '../../config/env';
import * as extractionManifestService from '../../extraction/extractionManifestService';
import fs from 'fs';


vi.mock('../../config/env');
vi.mock('../../extraction/extractionManifestService');
vi.mock('fs');

describe('realPublishRehearsalService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('blocks rehearsal publish if extraction status is not completed', async () => {
    vi.mocked(envConfig.loadEnvConfig).mockReturnValue({ rehearsal: { publishRehearsalMaxRows: 5 }, supabase: { url: 'sandbox', serviceRoleKey: 'key' } } as any);
    vi.mocked(extractionManifestService.loadExtractionManifest).mockResolvedValue({ extraction_status: 'in_progress' } as any);

    const result = await realPublishRehearsalService.checkRealPublishRehearsalGates('/workspace');
    expect(result.ok).toBe(false);
    expect(result.blockedReason).toContain('Extraction status is not completed');
  });

  it('blocks rehearsal publish if style-profile status is missing for new package', async () => {
    vi.mocked(envConfig.loadEnvConfig).mockReturnValue({ rehearsal: { publishRehearsalMaxRows: 5 }, supabase: { url: 'sandbox', serviceRoleKey: 'key' } } as any);
    vi.mocked(extractionManifestService.loadExtractionManifest).mockResolvedValue({
      extraction_status: 'completed',
      page_style_profiles: { status: 'not_started' }
    } as any);

    const result = await realPublishRehearsalService.checkRealPublishRehearsalGates('/workspace');
    expect(result.ok).toBe(false);
    expect(result.blockedReason).toContain('page-level style profiling step has not been completed');
  });

  it('blocks rehearsal publish if preview not approved', async () => {
    vi.mocked(envConfig.loadEnvConfig).mockReturnValue({ rehearsal: { publishRehearsalMaxRows: 5 }, supabase: { url: 'sandbox', serviceRoleKey: 'key' } } as any);
    vi.mocked(extractionManifestService.loadExtractionManifest).mockResolvedValue({
      extraction_status: 'completed',
      style_profile_selection: { status: 'generated' },
      pre_publish_preview: { status: 'opened' }
    } as any);

    const result = await realPublishRehearsalService.checkRealPublishRehearsalGates('/workspace');
    expect(result.ok).toBe(false);
    expect(result.blockedReason).toContain('Pre-Publish Preview not approved');
  });

  it('blocks rehearsal publish if dry-run report is missing or not clean', async () => {
    vi.mocked(envConfig.loadEnvConfig).mockReturnValue({ rehearsal: { publishRehearsalMaxRows: 5 }, supabase: { url: 'sandbox', serviceRoleKey: 'key' } } as any);
    vi.mocked(extractionManifestService.loadExtractionManifest).mockResolvedValue({
      extraction_status: 'completed',
      style_profile_selection: { status: 'generated' },
      pre_publish_preview: { status: 'approved', summary: { publish_count: 3, publish_but_exclude_from_comparison_count: 0 } },
      reports: {
        pre_publish_preview_summary: { path: 'summary.json' },
        accuracy_run_report: { path: 'accuracy.json' }
      }
    } as any);

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['dry-run-report-123.json'] as any);
    vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
      if (String(filePath).includes('confirmed')) {
        return JSON.stringify({
          record: {
            operatorConfirmed: true,
            retailer: { resolvedRetailerId: 'c2cc16c2-0001-4444-b000-c00000000001' },
            validity: { startDate: '2026-11-01', endDate: '2026-11-07' }
          }
        });
      }
      return JSON.stringify({
        result: { image_upload_success_count: 1, db_upsert_success_count: 0 } // Not clean
      });
    });

    const result = await realPublishRehearsalService.checkRealPublishRehearsalGates('/workspace');
    expect(result.ok).toBe(false);
    expect(result.blockedReason).toContain('latest dry-run report does not show zero Supabase writes/uploads');
  });

  it('blocks rehearsal publish if eligible rows exceed max', async () => {
    vi.mocked(envConfig.loadEnvConfig).mockReturnValue({ rehearsal: { publishRehearsalMaxRows: 2 }, supabase: { url: 'sandbox', serviceRoleKey: 'key' } } as any);
    vi.mocked(extractionManifestService.loadExtractionManifest).mockResolvedValue({
      extraction_status: 'completed',
      style_profile_selection: { status: 'skipped' },
      pre_publish_preview: { status: 'approved', summary: { publish_count: 3, publish_but_exclude_from_comparison_count: 0 } },
      reports: {
        pre_publish_preview_summary: { path: 'summary.json' },
        accuracy_run_report: { path: 'accuracy.json' }
      }
    } as any);

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['dry-run-report-123.json'] as any);
    vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
      if (String(filePath).includes('confirmed')) {
        return JSON.stringify({
          record: {
            operatorConfirmed: true,
            retailer: { resolvedRetailerId: 'c2cc16c2-0001-4444-b000-c00000000001' },
            validity: { startDate: '2026-11-01', endDate: '2026-11-07' }
          }
        });
      }
      return JSON.stringify({
        result: { image_upload_success_count: 0, db_upsert_success_count: 0 } // Clean
      });
    });

    const result = await realPublishRehearsalService.checkRealPublishRehearsalGates('/workspace');
    expect(result.ok).toBe(false);
    expect(result.blockedReason).toContain('exceeds rehearsal limit');
  });

  it('allows rehearsal publish when all gates pass', async () => {
    vi.mocked(envConfig.loadEnvConfig).mockReturnValue({ rehearsal: { publishRehearsalMaxRows: 5 }, supabase: { url: 'sandbox', serviceRoleKey: 'key' } } as any);
    vi.mocked(extractionManifestService.loadExtractionManifest).mockResolvedValue({
      extraction_status: 'completed',
      style_profile_selection: { status: 'skipped' },
      pre_publish_preview: { status: 'approved', summary: { publish_count: 3, publish_but_exclude_from_comparison_count: 0 } },
      reports: {
        pre_publish_preview_summary: { path: 'summary.json' },
        accuracy_run_report: { path: 'accuracy.json' }
      }
    } as any);

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['dry-run-report-123.json'] as any);
    vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
      if (String(filePath).includes('confirmed')) {
        return JSON.stringify({
          record: {
            operatorConfirmed: true,
            retailer: { resolvedRetailerId: 'c2cc16c2-0001-4444-b000-c00000000001' },
            validity: { startDate: '2026-11-01', endDate: '2026-11-07' }
          }
        });
      }
      return JSON.stringify({
        result: { image_upload_success_count: 0, db_upsert_success_count: 0 } // Clean
      });
    });

    const result = await realPublishRehearsalService.checkRealPublishRehearsalGates('/workspace', 'PUBLISH VERIFIED REHEARSAL');
    expect(result.ok).toBe(true);
    expect(result.eligibleRows).toBe(3);
    expect(result.targetClassification).toBe('sandbox');
  });
});
