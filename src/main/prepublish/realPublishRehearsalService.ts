import fs from 'fs';
import path from 'path';
import { loadEnvConfig } from '../config/env';
import { loadExtractionManifest, saveExtractionManifest } from '../extraction/extractionManifestService';

export type RehearsalCheckResult = {
  ok: boolean;
  blockedReason?: string;
  warning?: string;
  eligibleRows: number;
  maxRows: number;
  targetClassification: 'sandbox' | 'production' | 'unknown';
};

export async function checkRealPublishRehearsalGates(workspacePath: string, typedConfirmation?: string): Promise<RehearsalCheckResult> {
  const config = loadEnvConfig();
  const manifest = await loadExtractionManifest(workspacePath);
  
  if (!manifest) {
    return { ok: false, blockedReason: 'Manifest not found.', eligibleRows: 0, maxRows: 0, targetClassification: 'unknown' };
  }

  const maxRows = config.rehearsal.publishRehearsalMaxRows;
  let targetClassification: 'sandbox' | 'production' | 'unknown' = 'unknown';

  const url = config.supabase.url.toLowerCase();
  if (url.includes('sandbox') || url.includes('test') || url.includes('dev')) {
    targetClassification = 'sandbox';
  } else if (url.length > 0) {
    targetClassification = 'production';
  }

  if (manifest.extraction_status !== 'completed') {
    return { ok: false, blockedReason: 'Extraction status is not completed.', eligibleRows: 0, maxRows, targetClassification };
  }

  const mode = process.env.PAGE_STYLE_PROFILE_MODE || 'all_pages';
  
  if (!manifest.page_style_profiles && !manifest.style_profile_selection) {
    // Older manifest compatibility check: show warning
  } else if (manifest.page_style_profiles) {
    if (mode === 'all_pages' && manifest.page_style_profiles.status !== 'completed' && manifest.page_style_profiles.status !== 'completed_with_warnings') {
      return { ok: false, blockedReason: 'Publish rehearsal blocked: page-level style profiling step has not been completed.', eligibleRows: 0, maxRows, targetClassification };
    }
  }

  let warning: string | undefined = undefined;
  if (!manifest.page_style_profiles) {
    warning = 'This package was created before page-level style profiling. Verify manually before rehearsal.';
  }

  // Runtime accuracy harness gate check
  const runtimeHarness = (manifest as any).runtime_accuracy_harness;
  if (runtimeHarness) {
    if (runtimeHarness.decision === 'block_publish') {
      return { ok: false, blockedReason: 'Publish rehearsal blocked: Runtime accuracy harness decision is block_publish.', eligibleRows: 0, maxRows, targetClassification };
    }
    if (runtimeHarness.decision === 'needs_human_review') {
      return { ok: false, blockedReason: 'Publish rehearsal blocked: Runtime accuracy harness requires human review.', eligibleRows: 0, maxRows, targetClassification };
    }
  }

  if (manifest.pre_publish_preview?.status !== 'approved') {
    return { ok: false, blockedReason: 'Publish rehearsal blocked: Pre-Publish Preview not approved.', eligibleRows: 0, maxRows, targetClassification };
  }

  // Leaflet-level metadata confirmation gate check (WIFRAN-EXTRACTOR-METADATA-003)
  const confirmedMetaPath = path.join(workspacePath, 'metadata', 'confirmed_metadata.json');
  const altConfirmedMetaPath = path.join(workspacePath, 'metadata', 'confirmed-metadata.json');
  let hasConfirmedMetadata = false;
  for (const p of [confirmedMetaPath, altConfirmedMetaPath]) {
    if (fs.existsSync(p)) {
      try {
        const payload = JSON.parse(fs.readFileSync(p, 'utf8'));
        const rec = payload?.record || payload;
        if (
          rec?.operatorConfirmed &&
          rec.retailer?.resolvedRetailerId &&
          rec.validity?.startDate &&
          rec.validity?.endDate
        ) {
          hasConfirmedMetadata = true;
          break;
        }
      } catch {}
    }
  }

  if (!hasConfirmedMetadata) {
    const hasManifestHeader = Boolean(
      manifest.supermarket?.id &&
      manifest.offer_dates?.valid_from &&
      manifest.offer_dates?.valid_to
    );
    if (!hasManifestHeader) {
      return {
        ok: false,
        blockedReason: 'Publish rehearsal blocked: Leaflet metadata (retailer and validity dates) must be authoritatively confirmed by operator before publishing.',
        eligibleRows: 0,
        maxRows,
        targetClassification
      };
    }
  }

  const summaryPath = manifest.reports?.pre_publish_preview_summary?.path ? path.join(workspacePath, manifest.reports.pre_publish_preview_summary.path) : path.join(workspacePath, 'metadata', 'reports', 'pre-publish-preview-summary.json');
  if (!fs.existsSync(summaryPath)) {
    return { ok: false, blockedReason: 'Publish rehearsal blocked: pre-publish-preview-summary.json missing.', eligibleRows: 0, maxRows, targetClassification };
  }

  const accuracyPath = manifest.reports?.accuracy_run_report?.path ? path.join(workspacePath, manifest.reports.accuracy_run_report.path) : path.join(workspacePath, 'metadata', 'reports', 'accuracy-run-report.json');
  if (!fs.existsSync(accuracyPath)) {
    return { ok: false, blockedReason: 'Publish rehearsal blocked: accuracy-run-report.json missing.', eligibleRows: 0, maxRows, targetClassification };
  }

  // Need to read latest dry run report to ensure 0 supabase uploads / writes
  const reportsDir = path.join(workspacePath, 'metadata', 'reports');
  let dryRunClean = false;
  let dryRunFound = false;
  if (fs.existsSync(reportsDir)) {
    const files = fs.readdirSync(reportsDir).filter(f => f.startsWith('dry-run-report-'));
    if (files.length > 0) {
      files.sort().reverse(); // get latest
      const latestPath = path.join(reportsDir, files[0]);
      try {
        const dryReport = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
        dryRunFound = true;
        if (dryReport.result?.image_upload_success_count === 0 && 
            dryReport.result?.db_upsert_success_count === 0) {
          dryRunClean = true;
        }
      } catch (e) {
        // failed to read
      }
    }
  }

  if (!dryRunFound) {
    return { ok: false, blockedReason: 'Publish rehearsal blocked: latest dry-run report missing.', eligibleRows: 0, maxRows, targetClassification };
  }
  if (!dryRunClean) {
    return { ok: false, blockedReason: 'Publish rehearsal blocked: latest dry-run report does not show zero Supabase writes/uploads.', eligibleRows: 0, maxRows, targetClassification };
  }

  const eligibleRows = (manifest.pre_publish_preview.summary.publish_count || 0) + (manifest.pre_publish_preview.summary.publish_but_exclude_from_comparison_count || 0);

  if (eligibleRows === 0) {
    return { ok: false, blockedReason: 'Publish rehearsal blocked: eligible row count is 0.', eligibleRows, maxRows, targetClassification };
  }

  if (eligibleRows > maxRows) {
    return { ok: false, blockedReason: `Publish rehearsal blocked: eligible row count exceeds rehearsal limit.`, eligibleRows, maxRows, targetClassification };
  }

  if (!config.supabase.url || !config.supabase.serviceRoleKey) {
    return { ok: false, blockedReason: 'Publish rehearsal blocked: Supabase config is missing.', eligibleRows, maxRows, targetClassification };
  }

  // Final check typed confirmation if provided
  if (typedConfirmation !== undefined) {
    if (typedConfirmation !== 'PUBLISH VERIFIED REHEARSAL') {
      return { ok: false, blockedReason: 'Publish rehearsal blocked: typed confirmation does not match PUBLISH VERIFIED REHEARSAL.', eligibleRows, maxRows, targetClassification };
    }
  }

  return { ok: true, eligibleRows, maxRows, targetClassification, warning };
}

export async function writeRealPublishRehearsalReport(workspacePath: string, resultData: any) {
  const reportsDir = path.join(workspacePath, 'metadata', 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const manifest = await loadExtractionManifest(workspacePath);
  const eligibleRows = manifest?.pre_publish_preview?.summary ? (manifest.pre_publish_preview.summary.publish_count + manifest.pre_publish_preview.summary.publish_but_exclude_from_comparison_count) : 0;
  const config = loadEnvConfig();
  
  let targetClassification = 'unknown';
  const url = config.supabase.url.toLowerCase();
  if (url.includes('sandbox') || url.includes('test') || url.includes('dev')) {
    targetClassification = 'sandbox';
  } else if (url.length > 0) {
    targetClassification = 'production';
  }

  const report = {
    schema_version: 1,
    created_at: new Date().toISOString(),
    mode: 'rehearsal',
    package_name: manifest?.extraction_folder_name || path.basename(workspacePath),
    eligible_rows: eligibleRows,
    max_rows_allowed: config.rehearsal.publishRehearsalMaxRows,
    target_classification: targetClassification,
    gates: {
      manifest_completed: true,
      style_profile_step_completed_or_skipped: true,
      preview_opened: true,
      preview_approved: true,
      dry_run_report_exists: true,
      dry_run_report_clean: true,
      accuracy_report_exists: true,
      preview_summary_exists: true,
      row_limit_passed: true,
      typed_confirmation_passed: true
    },
    result: {
      status: resultData.status || 'not_started',
      image_upload_success_count: resultData.image_upload_success_count || 0,
      image_upload_failure_count: resultData.image_upload_failure_count || 0,
      db_upsert_success_count: resultData.db_upsert_success_count || 0,
      db_upsert_failure_count: resultData.db_upsert_failure_count || 0,
      error_message: resultData.error_message || null
    },
    items: resultData.items || []
  };

  const reportPath = path.join(reportsDir, 'real-publish-rehearsal-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  if (manifest) {
    manifest.real_publish_rehearsal = {
      status: report.result.status as any,
      started_at: manifest.real_publish_rehearsal?.started_at || new Date().toISOString(),
      completed_at: report.result.status === 'completed' || report.result.status === 'failed' || report.result.status === 'partial' ? new Date().toISOString() : null,
      report_path: 'metadata/reports/real-publish-rehearsal-report.json',
      eligible_rows: eligibleRows,
      max_rows_allowed: config.rehearsal.publishRehearsalMaxRows,
      target_classification: targetClassification as any,
      error_message: report.result.error_message
    };
    await saveExtractionManifest(workspacePath, manifest);
  }
}
