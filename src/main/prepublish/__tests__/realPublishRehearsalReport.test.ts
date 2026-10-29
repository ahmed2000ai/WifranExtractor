import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as realPublishRehearsalService from '../realPublishRehearsalService';
import * as envConfig from '../../config/env';
import * as extractionManifestService from '../../extraction/extractionManifestService';
import fs from 'fs';
import path from 'path';

vi.mock('../../config/env');
vi.mock('../../extraction/extractionManifestService');
vi.mock('fs');
vi.mock('path');

describe('realPublishRehearsalReport', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('writes rehearsal report and updates manifest', async () => {
    vi.mocked(envConfig.loadEnvConfig).mockReturnValue({ rehearsal: { publishRehearsalMaxRows: 5 }, supabase: { url: 'sandbox', serviceRoleKey: 'key' } } as any);
    const mockManifest = {
      extraction_folder_name: 'test-package',
      pre_publish_preview: { summary: { publish_count: 3, publish_but_exclude_from_comparison_count: 0 } },
    };
    vi.mocked(extractionManifestService.loadExtractionManifest).mockResolvedValue(mockManifest as any);
    vi.mocked(path.join).mockImplementation((...args) => args.join('/'));
    vi.mocked(fs.existsSync).mockReturnValue(false);
    
    await realPublishRehearsalService.writeRealPublishRehearsalReport('/workspace', {
      status: 'completed',
      image_upload_success_count: 3,
      image_upload_failure_count: 0,
      db_upsert_success_count: 3,
      db_upsert_failure_count: 0,
      items: []
    });

    expect(fs.mkdirSync).toHaveBeenCalledWith('/workspace/metadata/reports', { recursive: true });
    expect(fs.writeFileSync).toHaveBeenCalled();
    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    expect(writeCall[0]).toContain('real-publish-rehearsal-report.json');
    const reportStr = writeCall[1] as string;
    const reportObj = JSON.parse(reportStr);
    
    expect(reportObj.mode).toBe('rehearsal');
    expect(reportObj.eligible_rows).toBe(3);
    expect(reportObj.target_classification).toBe('sandbox');
    expect(reportObj.gates.typed_confirmation_passed).toBe(true);

    expect(extractionManifestService.saveExtractionManifest).toHaveBeenCalled();
    const saveCall = vi.mocked(extractionManifestService.saveExtractionManifest).mock.calls[0];
    const savedManifest = saveCall[1];
    expect(savedManifest.real_publish_rehearsal).toBeDefined();
    expect(savedManifest.real_publish_rehearsal?.status).toBe('completed');
  });
});
