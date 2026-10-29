import fs from 'fs';
import path from 'path';
import { loadExtractionManifest, saveExtractionManifest } from '../extraction/extractionManifestService';
import { AccuracyRunReport, AccuracyRunReportItem } from '../../shared/types/accuracyRunReport';
import { CanonicalOffer } from '../../shared/types/canonicalOffer';
import { ExtractionManifest } from '../../shared/types/extractionManifest';

export async function buildAccuracyRunReport(input: {
  extractionPackagePath: string;
  manifest?: ExtractionManifest;
  canonicalItems?: CanonicalOffer[];
  dbUpdateResult?: any;
  queueSummary?: any;
}): Promise<AccuracyRunReport> {
  const manifest = input.manifest || await loadExtractionManifest(input.extractionPackagePath);
  if (!manifest) {
    throw new Error('Cannot build accuracy report without a manifest.');
  }

  const jsonDir = manifest.paths.json_dir || path.join(input.extractionPackagePath, 'json');

  let items = input.canonicalItems;
  if (!items) {
    items = [];
    if (fs.existsSync(jsonDir)) {
      const files = fs.readdirSync(jsonDir).filter(f => f.endsWith('.canonical.json'));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(jsonDir, file), 'utf8');
          items.push(JSON.parse(content) as CanonicalOffer);
        } catch (e) {
          // ignore
        }
      }
    }
  }

  const reportItems: AccuracyRunReportItem[] = items.map(item => {
    const blockingErrs = item.quality.blocking_errors || [];
    const nonBlockingWarns = item.quality.non_blocking_warnings || [];

    return {
      source_page_number: item.source.source_page_number,
      source_item_number: item.source.source_item_number,
      crop_path: item.source.crop_path || null,
      raw_json_path: item.raw.raw_ocr_json ? `json/item-${item.source.source_item_number}.json` : null,
      canonical_json_path: `json/item-${item.source.source_item_number}.canonical.json`,
      validation_json_path: item.raw.raw_validation_json ? `json/item-${item.source.source_item_number}.validation.json` : null,

      title_ar: item.product.title_ar,
      title_en: item.product.title_en,
      brand_text: item.product.brand_text,
      item_domain: item.product.item_domain,

      offer_price: item.prices.offer_price,
      original_price: item.prices.original_price,
      currency: item.prices.currency,

      size_text: item.content.size_text,
      pack_quantity: item.content.pack_quantity,
      bundle_quantity: item.promotion.bundle_quantity,
      price_basis: (item.content as any).price_basis || null,
      promotion_mechanic: item.promotion.mechanic,

      extraction_confidence: item.quality.extraction_confidence,
      validation_result: item.style_validation.validation_result,
      validation_confidence: item.quality.validation_confidence,

      publish_decision: item.quality.publish_decision as 'publish' | 'publish_but_exclude_from_comparison' | 'skip_or_quarantine',

      comparison_eligible: item.comparison.comparison_eligible,
      comparison_unit: item.comparison.comparison_unit,
      comparison_unit_price: item.comparison.comparison_unit_price,
      comparison_exclusion_reason: item.comparison.comparison_exclusion_reason,

      blocking_errors: blockingErrs,
      non_blocking_warnings: nonBlockingWarns,

      image_upload_status: 'not_started', // Provided externally later
      db_upsert_status: 'not_started', // Provided externally later
      db_error_message: null
    };
  });

  const errorsByCode: Record<string, number> = {};
  const warningsByCode: Record<string, number> = {};
  const compExclusionsByCode: Record<string, number> = {};

  let publishCount = 0;
  let publishButExcludeCount = 0;
  let skipCount = 0;
  let compEligibleCount = 0;
  let compExcludedCount = 0;
  let nonGroceryCount = 0;

  let priceAmbiguityCount = 0;
  let sizeAsPriceCount = 0;
  let oldPriceAsOfferCount = 0;
  let validationPassCount = 0;
  let validationCorrectedCount = 0;
  let validationFailedCount = 0;

  let displayUnitPriceVisibleCount = 0;
  let displayUnitPriceHiddenCount = 0;
  let displayUnitPriceBelowThresholdCount = 0;
  let displayUnitPriceCalculationErrorCount = 0;
  const displayUnitPriceHiddenReasons: Record<string, number> = {};

  for (const item of items) {
    if (item.display) {
      if (item.display.show_display_unit_price) {
        displayUnitPriceVisibleCount++;
        if (item.display.below_min_display_price_threshold) displayUnitPriceBelowThresholdCount++;
      } else {
        displayUnitPriceHiddenCount++;
        if (item.display.hidden_reason) {
          displayUnitPriceHiddenReasons[item.display.hidden_reason] = (displayUnitPriceHiddenReasons[item.display.hidden_reason] || 0) + 1;
        }
      }
      if (item.display.hidden_reason === 'unsafe_conversion') displayUnitPriceCalculationErrorCount++;
    }
  }

  for (const item of reportItems) {
    if (item.publish_decision === 'publish') publishCount++;
    else if (item.publish_decision === 'publish_but_exclude_from_comparison') publishButExcludeCount++;
    else skipCount++;

    if (item.comparison_eligible) compEligibleCount++;
    else {
      compExcludedCount++;
      if (item.comparison_exclusion_reason) {
        compExclusionsByCode[item.comparison_exclusion_reason] = (compExclusionsByCode[item.comparison_exclusion_reason] || 0) + 1;
      }
    }

    if (item.item_domain === 'electronics' || item.item_domain === 'appliance' || item.item_domain === 'other_non_grocery') {
      nonGroceryCount++;
    }

    if (item.validation_result === 'pass') validationPassCount++;
    else if (item.validation_result === 'corrected') validationCorrectedCount++;
    else if (item.validation_result === 'fail') validationFailedCount++;

    for (const err of item.blocking_errors) {
      errorsByCode[err.code] = (errorsByCode[err.code] || 0) + 1;
      if (err.code === 'ambiguous_offer_price') priceAmbiguityCount++;
      if (err.code === 'size_misclassified_as_price') sizeAsPriceCount++;
      if (err.code === 'original_price_misclassified_as_offer_price') oldPriceAsOfferCount++;
    }

    for (const warn of item.non_blocking_warnings) {
      warningsByCode[warn.code] = (warningsByCode[warn.code] || 0) + 1;
      if (warn.code === 'offer_price_matches_size_value' || warn.code === 'offer_price_is_size_candidate') {
        sizeAsPriceCount++;
      }
    }
  }

  const dbUpdateState = manifest.db_update_status || 'not_started';
  
  const report: AccuracyRunReport = {
    schema_version: 1,
    report_id: `accuracy-report-${Date.now()}`,
    created_at: new Date().toISOString(),
    updated_at: null,
    package: {
      package_name: manifest.extraction_folder_name,
      package_path: input.extractionPackagePath,
      leaflet_id: (manifest.location as any)?.leaflet_id || null,
      source_pdf_path: manifest.paths.pdf
    },
    context: {
      supermarket_name: manifest.supermarket?.name || null,
      supermarket_slug: manifest.supermarket?.slug || null,
      coverage_scope: manifest.location?.location_scope || null,
      location_label: manifest.location?.display_name || null,
      city_id: manifest.location?.city_id || null,
      region_id: manifest.location?.region_id || null,
      offer_start_date: manifest.offer_dates?.valid_from || null,
      offer_end_date: manifest.offer_dates?.valid_to || null,
      style_profile_selection_status: manifest.style_profile_selection?.status || null,
      selected_style_profile_pages: manifest.style_profile_selection?.selected_page_numbers || null,
      leaflet_style_profile_generated: manifest.style_profile_selection?.status === 'generated',
      leaflet_style_profile_path: manifest.style_profile_selection?.profile_path || null,
      style_profile_generation_error: manifest.style_profile_selection?.error_message || null,

      page_style_profile_mode: manifest.page_style_profiles?.mode || 'disabled',
      page_style_profiles_status: manifest.page_style_profiles?.status || null,
      page_style_profiles_completed_pages: manifest.page_style_profiles?.completed_pages || 0,
      page_style_profiles_failed_pages: manifest.page_style_profiles?.failed_pages || 0,
      page_style_profiles_missing_pages: manifest.page_style_profiles ? manifest.page_style_profiles.total_pages - (manifest.page_style_profiles.completed_pages || 0) - (manifest.page_style_profiles.failed_pages || 0) : 0,
      page_style_profile_errors_by_page: manifest.page_style_profiles?.failures?.map((f: any) => ({ page: f.page_number, error: f.message })) || []
    },
    counts: {
      total_crops: manifest.counts?.crop_images || 0,
      total_raw_json: manifest.counts?.json_files || 0,
      total_canonical_items: items.length,

      extraction_calls: items.length, // approximation
      validation_calls: items.length, // approximation
      style_profile_calls: manifest.counts?.pages_rendered || 0,

      extracted_count: items.length,
      validation_pass_count: validationPassCount,
      validation_corrected_count: validationCorrectedCount,
      validation_failed_count: validationFailedCount,

      publish_count: publishCount,
      publish_but_exclude_from_comparison_count: publishButExcludeCount,
      skip_or_quarantine_count: skipCount,

      comparison_eligible_count: compEligibleCount,
      comparison_excluded_count: compExcludedCount,
      non_grocery_count: nonGroceryCount,

      display_unit_price_visible_count: displayUnitPriceVisibleCount,
      display_unit_price_hidden_count: displayUnitPriceHiddenCount,
      display_unit_price_below_threshold_count: displayUnitPriceBelowThresholdCount,
      display_unit_price_calculation_error_count: displayUnitPriceCalculationErrorCount,

      price_ambiguity_count: priceAmbiguityCount,
      size_as_price_detections: sizeAsPriceCount,
      old_price_as_offer_price_detections: oldPriceAsOfferCount,

      image_upload_success_count: 0,
      image_upload_failure_count: 0,
      db_upsert_success_count: 0,
      db_upsert_failure_count: 0,

      pre_publish_preview_opened_count: manifest.pre_publish_preview?.status === 'opened' || manifest.pre_publish_preview?.status === 'approved' ? 1 : 0,
      pre_publish_approved_count: manifest.pre_publish_preview?.status === 'approved' ? 1 : 0,

      automatic_fixed_grid_generated_count: 0,
      manual_grid_generated_count: 0,
      pages_with_cv_suggestions: 0,
      pages_with_template_suggestions: 0,
      pages_confirmed_without_changes: 0,
      pages_corrected_after_detection: 0,
      pages_created_manually: 0,
      training_annotations_created: manifest.training_annotations?.eligible_annotation_count || 0,
      training_annotations_updated: 0,
      training_annotation_save_failures: manifest.training_annotations?.save_failure_count || 0,
      negative_examples_saved: manifest.training_annotations?.negative_example_count || 0,
      active_template_count: manifest.template_library_reset?.active_template_count || 0,
      archived_template_count: manifest.template_library_reset?.archived_template_count || 0,
      
      warning_count: reportItems.reduce((acc, item) => acc + item.non_blocking_warnings.length, 0),
      blocking_error_count: reportItems.reduce((acc, item) => acc + item.blocking_errors.length, 0)
    },
    display_unit_price_hidden_reasons: displayUnitPriceHiddenReasons,
    warnings_by_code: warningsByCode,
    errors_by_code: errorsByCode,
    comparison_exclusions_by_code: compExclusionsByCode,
    queue_summary: {
      total_mistral_requests: input.queueSummary?.total_mistral_requests || 0,
      total_queue_wait_ms: input.queueSummary?.total_queue_wait_ms || null,
      completed_by_kind: input.queueSummary?.completed_by_kind || {},
      failed_by_kind: input.queueSummary?.failed_by_kind || {},
      retry_after_count: input.queueSummary?.retry_after_count || 0,
      rate_limit_429_count: input.queueSummary?.rate_limit_429_count || 0
    },
    pre_publish_preview: {
      status: manifest.pre_publish_preview?.status || 'not_opened',
      opened_at: (manifest.pre_publish_preview?.summary as any)?.opened_at || null,
      approved_at: (manifest.pre_publish_preview?.summary as any)?.approved_at || null,
      publish_count: manifest.pre_publish_preview?.summary?.publish_count || 0,
      publish_but_exclude_from_comparison_count: manifest.pre_publish_preview?.summary?.publish_but_exclude_from_comparison_count || 0,
      skip_or_quarantine_count: manifest.pre_publish_preview?.summary?.skip_or_quarantine_count || 0,
      warning_count: 0, // Need to aggregate from summary if available
      blocking_error_count: 0
    },
    db_update: {
      status: dbUpdateState as any,
      started_at: null,
      completed_at: null,
      error_message: null
    },
    items: reportItems
  };

  return report;
}

export async function writeAccuracyRunReport(input: {
  extractionPackagePath: string;
  report: AccuracyRunReport;
}): Promise<{ reportPath: string }> {
  const reportsDir = path.join(input.extractionPackagePath, 'metadata', 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const reportPath = path.join(reportsDir, 'accuracy-run-report.json');
  input.report.updated_at = new Date().toISOString();
  fs.writeFileSync(reportPath, JSON.stringify(input.report, null, 2));

  const manifest = await loadExtractionManifest(input.extractionPackagePath);
  if (manifest) {
    if (!manifest.reports) manifest.reports = {};
    if (!manifest.reports.accuracy_run_report) {
      manifest.reports.accuracy_run_report = { status: 'not_started', path: 'metadata/reports/accuracy-run-report.json', updated_at: null };
    }
    manifest.reports.accuracy_run_report.status = 'generated';
    manifest.reports.accuracy_run_report.updated_at = new Date().toISOString();
    await saveExtractionManifest(input.extractionPackagePath, manifest);
  }

  return { reportPath };
}
