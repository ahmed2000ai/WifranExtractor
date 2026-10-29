/**
 * Runtime Accuracy Harness Service – Chunk 58
 *
 * Orchestrator that loads data from disk, calls the pure evaluator,
 * creates fixture candidates, writes reports, and updates the manifest.
 */

import fs from 'fs';
import path from 'path';
import { loadExtractionManifest, saveExtractionManifest } from '../extraction/extractionManifestService';
import { evaluateRuntimeAccuracy } from '../../shared/utils/runtimeAccuracyHarness';
import { createFixtureCandidates } from './runtimeFixtureCandidateService';
import { writeRuntimeAccuracyReport } from '../reporting/runtimeAccuracyReportService';
import type { CanonicalOffer } from '../../shared/types/canonicalOffer';
import type {
  RuntimeAccuracyHarnessInput,
  RuntimeAccuracyHarnessResult,
  PageStyleProfileStatus,
} from '../../shared/types/runtimeAccuracyHarness';

export type RunRuntimeAccuracyHarnessOptions = {
  isDryRun?: boolean;
  revalidateSuspiciousItems?: boolean;
  retryFailedPageStyleProfiles?: boolean;
};

/**
 * Runs the full runtime accuracy harness for an extraction package.
 *
 * Steps:
 * 1. Load manifest
 * 2. Load canonical items from JSON dir
 * 3. Build page style profile status
 * 4. Call pure evaluator
 * 5. Create fixture candidates
 * 6. Write reports
 * 7. Update manifest
 */
export async function runRuntimeAccuracyHarness(
  workspacePath: string,
  options: RunRuntimeAccuracyHarnessOptions = {}
): Promise<RuntimeAccuracyHarnessResult> {
  const isDryRun = options.isDryRun ?? false;

  // 1. Load manifest
  const manifest = await loadExtractionManifest(workspacePath);
  if (!manifest) {
    throw new Error('Manifest not found — cannot run runtime accuracy harness');
  }

  // Update manifest status to running
  if (!manifest.runtime_accuracy_harness) {
    (manifest as any).runtime_accuracy_harness = {
      status: 'running',
      decision: null,
      started_at: new Date().toISOString(),
      completed_at: null,
      report_path: 'metadata/reports/runtime-accuracy-harness-report.json',
      fixture_candidates_dir: 'metadata/fixture-candidates',
      critical_failure_count: 0,
      suspicious_row_count: 0,
    };
  } else {
    (manifest as any).runtime_accuracy_harness.status = 'running';
    (manifest as any).runtime_accuracy_harness.started_at = new Date().toISOString();
  }
  await saveExtractionManifest(workspacePath, manifest);

  try {
    // 2. Load canonical items from JSON dir
    const jsonDir = manifest.paths.json_dir || path.join(workspacePath, 'json');
    const items: CanonicalOffer[] = [];

    if (fs.existsSync(jsonDir)) {
      const files = fs.readdirSync(jsonDir).filter(f => f.endsWith('.canonical.json'));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(jsonDir, file), 'utf-8');
          items.push(JSON.parse(content) as CanonicalOffer);
        } catch {
          // Skip unparsable files
        }
      }
    }

    // 3. Build page style profile status
    const pageStyleProfileStatus = buildPageStyleProfileStatus(workspacePath, manifest, items);

    // 4. Call pure evaluator
    const input: RuntimeAccuracyHarnessInput = {
      extractionPackagePath: workspacePath,
      leafletId: manifest.location?.location_slug || null,
      pageStyleProfileStatus,
      items,
      context: {
        supermarketSlug: manifest.supermarket?.slug || null,
        locationScope: manifest.location?.location_scope || null,
        cityId: manifest.location?.city_id || null,
        regionId: manifest.location?.region_id || null,
        offerStartDate: manifest.offer_dates?.valid_from || null,
        offerEndDate: manifest.offer_dates?.valid_to || null,
      },
      cropSuggestionStatus: manifest.crop_suggestions ? {
        enabled: manifest.crop_suggestions.status !== 'disabled',
        mode: manifest.crop_suggestions.mode,
        failures: (manifest.crop_suggestions.failures || []).map((f: any) => ({ pageNumber: f.page_number, message: f.message }))
      } : undefined,
      manualCropSession: (() => {
        try {
          const p = path.join(workspacePath, 'manual-crop-layout.json')
          if (fs.existsSync(p)) {
            return JSON.parse(fs.readFileSync(p, 'utf8'))
          }
        } catch {}
        return undefined;
      })(),
      isDryRun,
    };

    const result = evaluateRuntimeAccuracy(input);

    // 5. Create fixture candidates
    const fixtureCandidates = await createFixtureCandidates(
      workspacePath,
      result.suspicious_rows,
      items
    );
    result.fixture_candidates = fixtureCandidates;

    // 6. Write reports
    await writeRuntimeAccuracyReport(workspacePath, result);

    // 7. Update manifest
    (manifest as any).runtime_accuracy_harness = {
      status: 'completed',
      decision: result.decision,
      started_at: (manifest as any).runtime_accuracy_harness?.started_at || new Date().toISOString(),
      completed_at: new Date().toISOString(),
      report_path: 'metadata/reports/runtime-accuracy-harness-report.json',
      fixture_candidates_dir: 'metadata/fixture-candidates',
      critical_failure_count: result.summary.critical_failure_count,
      suspicious_row_count: result.summary.suspicious_row_count,
    };
    await saveExtractionManifest(workspacePath, manifest);

    return result;
  } catch (error: any) {
    // Update manifest with failure
    (manifest as any).runtime_accuracy_harness = {
      ...((manifest as any).runtime_accuracy_harness || {}),
      status: 'failed',
      completed_at: new Date().toISOString(),
    };
    await saveExtractionManifest(workspacePath, manifest);
    throw error;
  }
}

/**
 * Build page style profile status from the extraction package.
 */
function buildPageStyleProfileStatus(
  workspacePath: string,
  manifest: any,
  items: CanonicalOffer[]
): PageStyleProfileStatus {
  // Determine which pages have crops
  const pagesWithCrops = new Set<number>();
  for (const item of items) {
    if (item.source.source_page_number) {
      pagesWithCrops.add(item.source.source_page_number);
    }
  }

  const metadataDir = manifest.paths.metadata_dir || path.join(workspacePath, 'metadata');
  const styleProfilesDir = path.join(metadataDir, 'page-style-profiles');

  // Check if page-level profiling is active
  const profileMode: 'all_pages' | 'disabled' = fs.existsSync(styleProfilesDir) ? 'all_pages' : 'disabled';

  if (profileMode === 'disabled') {
    return {
      mode: 'disabled',
      totalPagesWithCrops: pagesWithCrops.size,
      completedPages: 0,
      failedPages: 0,
      missingPages: [...pagesWithCrops],
      failures: [],
    };
  }

  const completedPages: number[] = [];
  const failedPages: number[] = [];
  const missingPages: number[] = [];
  const failures: { pageNumber: number; message: string }[] = [];

  for (const pageNum of pagesWithCrops) {
    const profilePath = path.join(
      styleProfilesDir,
      `page-${String(pageNum).padStart(3, '0')}-style-profile.json`
    );

    if (fs.existsSync(profilePath)) {
      try {
        const profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
        if (profile.error || profile.status === 'failed') {
          failedPages.push(pageNum);
          failures.push({
            pageNumber: pageNum,
            message: profile.error || 'Profile marked as failed',
          });
        } else {
          completedPages.push(pageNum);
        }
      } catch {
        failedPages.push(pageNum);
        failures.push({
          pageNumber: pageNum,
          message: 'Failed to parse style profile JSON',
        });
      }
    } else {
      missingPages.push(pageNum);
    }
  }

  return {
    mode: profileMode,
    totalPagesWithCrops: pagesWithCrops.size,
    completedPages: completedPages.length,
    failedPages: failedPages.length,
    missingPages,
    failures,
  };
}
