import path from 'path';
import fs from 'fs';
import { loadExtractionManifest, saveExtractionManifest, recoverManifestFromExistingFolder } from '../extraction/extractionManifestService';
import type { PrePublishPreviewSummary, PrePublishPreviewItem } from '../../shared/types/prePublishPreview';
import type { CanonicalOffer } from '../../shared/types/canonicalOffer';

export async function buildPrePublishSummary(
  workspacePath: string,
  inMemoryCanonicalOffers?: CanonicalOffer[]
): Promise<PrePublishPreviewSummary> {
  let manifest = await loadExtractionManifest(workspacePath);
  if (!manifest) {
    try {
      manifest = await recoverManifestFromExistingFolder(workspacePath);
    } catch {
      throw new Error('Manifest not found and could not be recovered');
    }
  }

  const reportsDir = path.join(workspacePath, 'metadata', 'reports');
  const summaryPath = path.join(reportsDir, 'pre-publish-preview-summary.json');

  // If a summary was already generated and we aren't overriding with in-memory offers, return the existing summary
  if ((!inMemoryCanonicalOffers || inMemoryCanonicalOffers.length === 0) && fs.existsSync(summaryPath)) {
    try {
      const existingSummary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
      if (existingSummary && Array.isArray(existingSummary.items) && existingSummary.items.length > 0) {
        // Fix crop paths if project was moved or absolute paths differ
        for (const it of existingSummary.items) {
          if (it.crop_path && !fs.existsSync(it.crop_path)) {
            const relMatch = it.crop_path.match(/(metadata[\\/].*|crops[\\/].*)/i);
            if (relMatch) {
              const candidate = path.join(workspacePath, relMatch[1]);
              if (fs.existsSync(candidate)) {
                it.crop_path = candidate;
              }
            }
          }
          if (it.thumbnail_path && !fs.existsSync(it.thumbnail_path)) {
            const relMatch = it.thumbnail_path.match(/(metadata[\\/].*|crops[\\/].*)/i);
            if (relMatch) {
              const candidate = path.join(workspacePath, relMatch[1]);
              if (fs.existsSync(candidate)) {
                it.thumbnail_path = candidate;
              }
            }
          }
          if (!it.thumbnail_path && it.crop_path) {
            const candidate = path.join(path.dirname(it.crop_path), 'product_thumb_crop.webp');
            if (fs.existsSync(candidate)) {
              it.thumbnail_path = candidate;
            }
          }
        }
        existingSummary.db_update_status = manifest.db_update_status || 'not_started';
        existingSummary.published_at = (manifest.db_update_status === 'completed' || manifest.stages?.db_update === 'completed')
          ? (manifest.updated_at || manifest.pre_publish_preview?.approved_at || null)
          : null;
        return existingSummary;
      }
    } catch {
      // Proceed to rebuild if existing file is unparsable
    }
  }

  const rawCropsDir = manifest.paths?.crops_dir;
  const rawJsonDir = manifest.paths?.json_dir;

  const cropsDir = rawCropsDir
    ? (path.isAbsolute(rawCropsDir) ? rawCropsDir : path.join(workspacePath, rawCropsDir))
    : path.join(workspacePath, 'crops');
  const jsonDir = rawJsonDir
    ? (path.isAbsolute(rawJsonDir) ? rawJsonDir : path.join(workspacePath, rawJsonDir))
    : path.join(workspacePath, 'json');

  const items: PrePublishPreviewItem[] = [];
  const counts = {
    total_items: 0,
    publish: 0,
    publish_but_exclude_from_comparison: 0,
    skip_or_quarantine: 0,
    warnings: 0,
    blocking_errors: 0,
    non_grocery: 0,
    display_unit_price_visible: 0,
    display_unit_price_hidden: 0,
    display_unit_price_below_threshold: 0,
    display_unit_price_calculation_error: 0
  };

  const canonicalOffersToProcess: CanonicalOffer[] = [];

  if (inMemoryCanonicalOffers && inMemoryCanonicalOffers.length > 0) {
    canonicalOffersToProcess.push(...inMemoryCanonicalOffers);
    const coveredPages = new Set(inMemoryCanonicalOffers.map(o => o.source.source_page_number));
    // Also preserve any existing canonical offers from unselected pages on disk
    if (fs.existsSync(jsonDir)) {
      const files = fs.readdirSync(jsonDir).filter(f => f.endsWith('.canonical.json'));
      for (const file of files) {
        try {
          const canonical: CanonicalOffer = JSON.parse(fs.readFileSync(path.join(jsonDir, file), 'utf-8'));
          if (!coveredPages.has(canonical.source.source_page_number)) {
            canonicalOffersToProcess.push(canonical);
          }
        } catch {
          // Ignore malformed
        }
      }
    }
  } else if (fs.existsSync(jsonDir)) {
    const files = fs.readdirSync(jsonDir);
    const canonicalFiles = files.filter(f => f.endsWith('.canonical.json'));
    
    for (const file of canonicalFiles) {
      const canonicalPath = path.join(jsonDir, file);
      try {
        const canonical: CanonicalOffer = JSON.parse(fs.readFileSync(canonicalPath, 'utf-8'));
        canonicalOffersToProcess.push(canonical);
      } catch {
        // Skip unparsable or malformed
      }
    }
  }

  for (const canonical of canonicalOffersToProcess) {
    try {
      const dec = canonical.quality?.publish_decision || 'skip_or_quarantine';
      const isPublish = dec === 'publish';
      const isExclude = dec === 'publish_but_exclude_from_comparison';
      const isSkip = dec === 'skip_or_quarantine';

        counts.total_items++;
        if (isPublish) counts.publish++;
        if (isExclude) counts.publish_but_exclude_from_comparison++;
        if (isSkip) counts.skip_or_quarantine++;

        const warnings = canonical.quality?.non_blocking_warnings || [];
        const errors = canonical.quality?.blocking_errors || [];

        if (warnings.length > 0) counts.warnings++;
        if (errors.length > 0) counts.blocking_errors++;

        const domain = canonical.product?.item_domain;
        if (['electronics', 'appliance', 'other_non_grocery'].includes(domain as string)) {
          counts.non_grocery++;
        }

        if (canonical.display) {
          if (canonical.display.show_display_unit_price) {
            counts.display_unit_price_visible++;
            if (canonical.display.below_min_display_price_threshold) counts.display_unit_price_below_threshold++;
          } else {
            counts.display_unit_price_hidden++;
          }
          if (canonical.display.hidden_reason === 'unsafe_conversion') {
            counts.display_unit_price_calculation_error++;
          }
        }

        const cropPath = canonical.source.crop_path || path.join(cropsDir, `page-${String(canonical.source.source_page_number).padStart(3, '0')}`, `${canonical.source.source_item_number}.jpg`);

        let resolvedThumbPath = canonical.source?.thumbnail_path || canonical.image?.thumbnail_path || null;
        if (resolvedThumbPath && !fs.existsSync(resolvedThumbPath)) {
          const relMatch = resolvedThumbPath.match(/(metadata[\\/].*|crops[\\/].*)/i);
          if (relMatch) {
            const candidate = path.join(workspacePath, relMatch[1]);
            if (fs.existsSync(candidate)) {
              resolvedThumbPath = candidate;
            }
          }
        }
        if (!resolvedThumbPath && cropPath) {
          const siblingThumb = path.join(path.dirname(cropPath), 'product_thumb_crop.webp');
          if (fs.existsSync(siblingThumb)) {
            resolvedThumbPath = siblingThumb;
          }
        }

        const catalogImageUrl = (canonical.image?.image_source_type !== 'leaflet_crop' ? canonical.image?.image_url : null) || null;

        items.push({
          source_page_number: canonical.source.source_page_number,
          source_item_number: canonical.source.source_item_number,
          crop_path: cropPath,
          thumbnail_path: resolvedThumbPath,
          catalog_image_url: catalogImageUrl,
          publish_decision: dec,
          preview_eligible: canonical.pre_publish?.preview_eligible ?? false,
          display_in_preview: canonical.pre_publish?.display_in_preview ?? true,
          confidence: canonical.quality?.extraction_confidence || 'not_run',
          comparison_eligible: canonical.comparison?.comparison_eligible ?? false,
          comparison_exclusion_reason: canonical.comparison?.comparison_exclusion_reason || null,
          fields: [
            { field_name: 'source_page_number', value: canonical.source.source_page_number },
            { field_name: 'source_item_number', value: canonical.source.source_item_number },
            { field_name: 'title_ar', value: canonical.product?.title_ar },
            { field_name: 'title_en', value: canonical.product?.title_en },
            { field_name: 'brand_text', value: canonical.product?.brand_text },
            { field_name: 'category_hint', value: canonical.product?.category_hint },
            { field_name: 'item_domain', value: canonical.product?.item_domain },
            { field_name: 'offer_price', value: canonical.prices?.offer_price },
            { field_name: 'original_price', value: canonical.prices?.original_price },
            { field_name: 'currency', value: canonical.prices?.currency },
            { field_name: 'size_text', value: canonical.content?.size_text },
            { field_name: 'pack_quantity', value: canonical.content?.pack_quantity },
            { field_name: 'bundle_quantity', value: canonical.content?.bundle_quantity },
            { field_name: 'each_size_value', value: canonical.content?.each_size_value },
            { field_name: 'each_size_unit', value: canonical.content?.each_size_unit },
            { field_name: 'total_content_value', value: canonical.content?.total_content_value },
            { field_name: 'total_content_unit', value: canonical.content?.total_content_unit },
            { field_name: 'price_basis', value: canonical.prices?.price_basis },
            { field_name: 'promotion_mechanic', value: canonical.promotion?.mechanic },
            { field_name: 'condition_text', value: canonical.promotion?.condition_text },
            { field_name: 'comparison_eligible', value: canonical.comparison?.comparison_eligible },
            { field_name: 'comparison_unit', value: canonical.comparison?.comparison_unit },
            { field_name: 'comparison_unit_price', value: canonical.comparison?.comparison_unit_price },
            { field_name: 'comparison_exclusion_reason', value: canonical.comparison?.comparison_exclusion_reason },
            { field_name: 'display_unit_price_label_ar', value: canonical.display?.display_unit_price_label_ar },
            { field_name: 'display_unit_price_label_en', value: canonical.display?.display_unit_price_label_en },
            { field_name: 'display_unit_price_hidden_reason', value: canonical.display?.hidden_reason },
            { field_name: 'special_offer', value: canonical.promotion?.special_offer ?? null },
            { field_name: 'quantity_limit', value: canonical.promotion?.quantity_limit ?? null },
            { field_name: 'publish_decision', value: dec }
          ],
          blocking_errors: errors.map(e => ({ code: e.code, message: e.message })),
          non_blocking_warnings: warnings.map(w => ({ code: w.code, message: w.message })),
          page_first_diagnostics: (canonical.raw?.raw_attributes as any)?.page_first ? {
            ocr_block_confidence: 0.95,
            evidence_link_confidence: (canonical.raw?.raw_attributes as any)?.page_first.evidence_link_confidence ?? null,
            current_price_anchor_matched: Boolean((canonical.raw?.raw_attributes as any)?.page_first.current_price_anchor_block_id),
            page_completeness_status: (canonical.raw?.raw_attributes as any)?.page_first.completeness_status || 'pass',
            source_pass: (canonical.raw?.raw_attributes as any)?.page_first.is_retry ? ('retry' as const) : ('primary' as const),
            crop_confidence: (canonical.raw?.raw_attributes as any)?.page_first.crop_confidence ?? 0.85,
            has_unmatched_evidence: Boolean((canonical.raw?.raw_attributes as any)?.page_first.unmatched_evidence?.length > 0),
            uncovered_price_anchor_on_page: ['retry_required', 'unresolved'].includes((canonical.raw?.raw_attributes as any)?.page_first.completeness_status),
            page_unresolved: ['unresolved', 'failed'].includes((canonical.raw?.raw_attributes as any)?.page_first.completeness_status)
          } : undefined,
          raw: {
            canonical,
            raw_ocr_json: canonical.raw?.raw_ocr_json,
            raw_validation_json: canonical.raw?.raw_validation_json
          }
        });
      } catch (e) {
        // Skip unparsable or malformed
      }
    }

  // Load runtime accuracy harness report if available
  const runtimeReportPath = path.join(workspacePath, 'metadata', 'reports', 'runtime-accuracy-harness-report.json');
  let runtimeGate: PrePublishPreviewSummary['runtime_accuracy_gate'] = undefined;

  if (fs.existsSync(runtimeReportPath)) {
    try {
      const runtimeReport = JSON.parse(fs.readFileSync(runtimeReportPath, 'utf-8'));
      runtimeGate = {
        decision: runtimeReport.decision || null,
        critical_failure_count: runtimeReport.summary?.critical_failure_count ?? 0,
        suspicious_row_count: runtimeReport.summary?.suspicious_row_count ?? 0,
        fixture_candidate_count: runtimeReport.fixture_candidates?.length ?? 0,
        page_style_profile_failure_count: runtimeReport.summary?.page_style_profile_failure_count ?? 0,
      };

      // Attach harness issue codes to individual items
      const suspiciousRows = runtimeReport.suspicious_rows || [];
      for (const row of suspiciousRows) {
        const item = items.find(
          i => i.source_page_number === row.source_page_number &&
               i.source_item_number === row.source_item_number
        );
        if (item) {
          item.harness_issue_codes = row.reason_codes || [];
        }
      }
    } catch {
      // Non-critical: runtime report read failed
    }
  }

  const summary: PrePublishPreviewSummary = {
    leaflet_id: manifest.location?.location_slug || null, // Best effort
    package_name: manifest.extraction_folder_name,
    supermarket_name: manifest.supermarket?.name || (manifest.supermarket as any)?.name_en || null,
    coverage_scope: manifest.location?.location_scope || null,
    location_label: manifest.location?.display_name || (manifest.location as any)?.label || null,
    offer_start_date: manifest.offer_dates?.valid_from || (manifest as any)?.validity?.start_date || null,
    offer_end_date: manifest.offer_dates?.valid_to || (manifest as any)?.validity?.end_date || null,
    db_update_status: manifest.db_update_status || 'not_started',
    published_at: (manifest.db_update_status === 'completed' || manifest.stages?.db_update === 'completed')
      ? (manifest.updated_at || manifest.pre_publish_preview?.approved_at || null)
      : null,
    counts,
    page_style_profile_status: manifest.page_style_profiles ? {
      mode: manifest.page_style_profiles.mode as 'all_pages' | 'disabled',
      status: manifest.page_style_profiles.status,
      completed_pages: manifest.page_style_profiles.completed_pages || 0,
      failed_pages: manifest.page_style_profiles.failed_pages || 0,
      missing_pages: manifest.page_style_profiles.total_pages - (manifest.page_style_profiles.completed_pages || 0) - (manifest.page_style_profiles.failed_pages || 0)
    } : undefined,
    runtime_accuracy_gate: runtimeGate,
    items
  };

  // Save the summary
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  // Update manifest if possible
  if (manifest) {
    if (!manifest.reports) manifest.reports = {};
    if (!manifest.reports.pre_publish_preview_summary) {
      manifest.reports.pre_publish_preview_summary = { status: 'not_started', path: 'metadata/reports/pre-publish-preview-summary.json', updated_at: null };
    }
    manifest.reports.pre_publish_preview_summary.status = 'generated';
    manifest.reports.pre_publish_preview_summary.updated_at = new Date().toISOString();
    await saveExtractionManifest(workspacePath, manifest);
  }

  return summary;
}

export async function markPrePublishOpened(workspacePath: string): Promise<void> {
  const manifest = await loadExtractionManifest(workspacePath);
  if (!manifest) return;

  if (!manifest.pre_publish_preview) {
    manifest.pre_publish_preview = {
      status: 'not_opened',
      opened_at: null,
      approved_at: null,
      approved_by: null,
      summary: {
        publish_count: 0,
        publish_but_exclude_from_comparison_count: 0,
        skip_or_quarantine_count: 0,
        warning_count: 0,
        blocking_error_count: 0
      }
    };
  }

  if (manifest.pre_publish_preview.status === 'not_opened') {
    manifest.pre_publish_preview.status = 'opened';
    manifest.pre_publish_preview.opened_at = new Date().toISOString();
  }

  await saveExtractionManifest(workspacePath, manifest);
}

export async function markPrePublishApproved(
  workspacePath: string,
  summaryCounts: any,
  options?: { forceRePublish?: boolean }
): Promise<void> {
  const manifest = await loadExtractionManifest(workspacePath);
  if (!manifest) return;

  const isAlreadyPublished = manifest.db_update_status === 'completed' || manifest.stages?.db_update === 'completed';
  if (isAlreadyPublished && !options?.forceRePublish) {
    throw new Error(
      `Pre-publish approval blocked: Extraction '${manifest.extraction_folder_name || path.basename(workspacePath)}' was already published to the database. Re-publishing is blocked.`
    );
  }

  if (!manifest.pre_publish_preview) {
    manifest.pre_publish_preview = {
      status: 'opened',
      opened_at: new Date().toISOString(),
      approved_at: null,
      approved_by: null,
      summary: {
        publish_count: 0,
        publish_but_exclude_from_comparison_count: 0,
        skip_or_quarantine_count: 0,
        warning_count: 0,
        blocking_error_count: 0
      }
    };
  }

  manifest.pre_publish_preview.status = 'approved';
  manifest.pre_publish_preview.approved_at = new Date().toISOString();
  manifest.pre_publish_preview.summary = {
    publish_count: summaryCounts.publish || 0,
    publish_but_exclude_from_comparison_count: summaryCounts.publish_but_exclude_from_comparison || 0,
    skip_or_quarantine_count: summaryCounts.skip_or_quarantine || 0,
    warning_count: summaryCounts.warnings || 0,
    blocking_error_count: summaryCounts.blocking_errors || 0
  };
  manifest.db_update_status = 'in_progress';

  await saveExtractionManifest(workspacePath, manifest);
}
