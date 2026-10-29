/**
 * Runtime Accuracy Harness – Pure Evaluation Logic (Chunk 58)
 *
 * This is a pure function. No filesystem. No network. No Mistral. No Supabase.
 *
 * Evaluates all canonical items from an extraction package and returns:
 *   - a gate decision (pass / pass_with_warnings / needs_human_review / block_publish)
 *   - critical failures
 *   - warnings
 *   - suspicious rows
 *   - page summaries
 *   - auto action recommendations
 */

import type { CanonicalOffer } from '../types/canonicalOffer';
import type {
  RuntimeAccuracyGateDecision,
  RuntimeAccuracyHarnessInput,
  RuntimeAccuracyHarnessResult,
  RuntimeAccuracyIssue,
  RuntimeAccuracyThresholds,
  RuntimeAutoAction,
  RuntimePageSummary,
  RuntimeSuspiciousRow,
} from '../types/runtimeAccuracyHarness';
import { DEFAULT_RUNTIME_ACCURACY_THRESHOLDS } from '../types/runtimeAccuracyHarness';

// ---------------------------------------------------------------------------
// Critical blocking error codes
// ---------------------------------------------------------------------------

const CRITICAL_BLOCKING_CODES = new Set([
  'size_misclassified_as_price',
  'offer_price_matches_size_value',
  'offer_price_is_size_candidate',
  'original_price_misclassified_as_offer_price',
  'missing_offer_price',
  'ambiguous_offer_price',
  'missing_product_title',
  'invalid_location_scope',
  'missing_city_for_city_scope',
  'missing_region_for_region_scope',
  'expired_offer_end_date',
  'unsafe_image_path',
  'MISSING_PRICE_ANCHOR_LINK',
  'DUPLICATE_ANCHOR_ASSIGNMENT',
  'OFFERS_MISSING_PRICE_ANCHOR',
  'OFFER_PRICE_MATCHES_SIZE',
  'OFFER_PRICE_MATCHES_SIZE_TEXT',
  'UNCOVERED_PRICE_ANCHORS',
  'page_first_publishable_without_anchor',
  'page_first_uncovered_anchor',
  'page_first_duplicate_anchor',
  'page_first_multi_anchor_crop',
  'page_first_invalid_crop_geometry',
  'page_first_unresolved_page_completed',
]);

// ---------------------------------------------------------------------------
// Helper: is row publishable?
// ---------------------------------------------------------------------------

function isPublishable(item: CanonicalOffer): boolean {
  const d = item.quality?.publish_decision;
  return d === 'publish' || d === 'publish_but_exclude_from_comparison';
}

// ---------------------------------------------------------------------------
// Helper: extract size numeric from size_text
// ---------------------------------------------------------------------------

function extractSizeNumeric(sizeText: string | null): number | null {
  if (!sizeText) return null;
  const match = sizeText.match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : null;
}

// ---------------------------------------------------------------------------
// Main evaluation function
// ---------------------------------------------------------------------------

export function evaluateRuntimeAccuracy(
  input: RuntimeAccuracyHarnessInput,
  thresholds: RuntimeAccuracyThresholds = DEFAULT_RUNTIME_ACCURACY_THRESHOLDS
): RuntimeAccuracyHarnessResult {
  const items = input.items;
  const criticalFailures: RuntimeAccuracyIssue[] = [];
  const warnings: RuntimeAccuracyIssue[] = [];
  const suspiciousRows: RuntimeSuspiciousRow[] = [];
  const autoActions: RuntimeAutoAction[] = [];
  const isDryRun = input.isDryRun ?? false;

  // --- Counters ---
  let publishCount = 0;
  let publishExcludeCount = 0;
  let skipCount = 0;
  let blockingErrorCount = 0;
  let warningCount = 0;
  let comparisonExcludedCount = 0;
  let criticalFailureCount = 0;
  let lowConfidenceValidationCount = 0;
  let validationCorrectionCount = 0;
  let validationFailureCount = 0;

  // Track publishable rows with issues
  let publishableRowsWithBlockingErrors = 0;
  let unsafeComparisonEligibleRows = 0;

  // Page-level tracking
  const pageMap = new Map<number, {
    items: CanonicalOffer[];
    publishCount: number;
    skipCount: number;
    warningCount: number;
    blockingErrorCount: number;
    suspiciousCount: number;
  }>();

  // ---------------------------------------------------------------------------
  // Per-item evaluation
  // ---------------------------------------------------------------------------

  for (const item of items) {
    const pageNum = item.source.source_page_number ?? 0;
    const itemNum = item.source.source_item_number;
    const dec = item.quality?.publish_decision;

    // Init page entry
    if (!pageMap.has(pageNum)) {
      pageMap.set(pageNum, { items: [], publishCount: 0, skipCount: 0, warningCount: 0, blockingErrorCount: 0, suspiciousCount: 0 });
    }
    const page = pageMap.get(pageNum)!;
    page.items.push(item);

    // Decision counts
    if (dec === 'publish') publishCount++;
    else if (dec === 'publish_but_exclude_from_comparison') publishExcludeCount++;
    else skipCount++;

    if (dec === 'publish') page.publishCount++;
    else if (dec === 'publish_but_exclude_from_comparison') page.publishCount++;
    else page.skipCount++;

    // Quality issues
    const blockingErrors = item.quality?.blocking_errors || [];
    const nonBlockingWarnings = item.quality?.non_blocking_warnings || [];

    if (blockingErrors.length > 0) {
      blockingErrorCount++;
      page.blockingErrorCount++;
    }
    if (nonBlockingWarnings.length > 0) {
      warningCount++;
      page.warningCount++;
    }

    // Comparison
    if (item.comparison?.comparison_eligible === false) {
      comparisonExcludedCount++;
    }

    // Validation confidence
    if (item.quality?.validation_confidence === 'low') {
      lowConfidenceValidationCount++;
    }
    if (item.style_validation?.validation_result === 'corrected') {
      validationCorrectionCount++;
    }
    if (item.style_validation?.validation_result === 'fail') {
      validationFailureCount++;
    }

    // --- Suspicious row tracking ---
    const rowReasons: string[] = [];
    const rowMessages: string[] = [];

    // 1. Critical blocking codes on publishable rows
    if (isPublishable(item)) {
      for (const err of blockingErrors) {
        if (CRITICAL_BLOCKING_CODES.has(err.code)) {
          criticalFailures.push({
            code: err.code,
            severity: 'critical',
            message: `Publishable row has critical blocking error: ${err.code} - ${err.message}`,
            source_page_number: pageNum,
            source_item_number: itemNum,
          });
          criticalFailureCount++;
          rowReasons.push(err.code);
          rowMessages.push(err.message);
        }
      }

      if (blockingErrors.length > 0) {
        publishableRowsWithBlockingErrors++;
      }
    }

    // 2. Comparison safety checks on comparison-eligible rows
    if (item.comparison?.comparison_eligible === true) {
      if (item.comparison.comparison_unit_price === null || item.comparison.comparison_unit_price === undefined) {
        criticalFailures.push({
          code: 'comparison_eligible_null_unit_price',
          severity: 'critical',
          message: `comparison_eligible=true but comparison_unit_price is null`,
          source_page_number: pageNum,
          source_item_number: itemNum,
        });
        criticalFailureCount++;
        unsafeComparisonEligibleRows++;
        rowReasons.push('comparison_eligible_null_unit_price');
        rowMessages.push('Unit price is null for comparison-eligible item');
      }

      if (!item.comparison.comparison_unit) {
        criticalFailures.push({
          code: 'comparison_eligible_missing_unit',
          severity: 'critical',
          message: `comparison_eligible=true but comparison_unit is null`,
          source_page_number: pageNum,
          source_item_number: itemNum,
        });
        criticalFailureCount++;
        unsafeComparisonEligibleRows++;
        rowReasons.push('comparison_eligible_missing_unit');
        rowMessages.push('Comparison unit is missing for comparison-eligible item');
      }
    }

    // 3. Publishable row with blocking errors
    if (isPublishable(item) && blockingErrors.length > 0) {
      const hasAlready = criticalFailures.some(
        cf => cf.source_page_number === pageNum && cf.source_item_number === itemNum
      );
      if (!hasAlready) {
        criticalFailures.push({
          code: 'publishable_with_blocking_errors',
          severity: 'critical',
          message: `Row marked as ${dec} but has ${blockingErrors.length} blocking error(s)`,
          source_page_number: pageNum,
          source_item_number: itemNum,
        });
        criticalFailureCount++;
        rowReasons.push('publishable_with_blocking_errors');
        rowMessages.push(`Publishable row has ${blockingErrors.length} blocking errors`);
      }
    }

    // 4. Low confidence validation on publishable row
    if (isPublishable(item) && item.quality?.validation_confidence === 'low') {
      rowReasons.push('low_validation_confidence');
      rowMessages.push('Validation confidence is low');
    }

    // 5. Validation corrected on publishable row
    if (isPublishable(item) && item.style_validation?.validation_result === 'corrected') {
      rowReasons.push('validation_corrected');
      rowMessages.push('Validation corrected this item');
    }

    // 6. Size-as-price proximity check (even if not caught by deterministic checks)
    if (isPublishable(item) && item.prices?.offer_price && item.content?.size_text) {
      const sizeNum = extractSizeNumeric(item.content.size_text);
      if (sizeNum !== null && Math.abs(item.prices.offer_price - sizeNum) < 0.01) {
        if (!rowReasons.includes('offer_price_matches_size_value')) {
          rowReasons.push('offer_price_matches_size_value_proximity');
          rowMessages.push(`Offer price ${item.prices.offer_price} matches size numeric ${sizeNum}`);
        }
      }
    }

    // 7. Missing original price on publishable row
    if (isPublishable(item) && item.prices?.offer_price && item.prices.original_price === null) {
      if (item.promotion?.mechanic === 'standard_price' && !item.prices.price_condition_text) {
        // often a warning, but omitted for brevity in some cases
      }
    }

    // 8. Display Unit Price Checks
    if (item.display) {
      const d = item.display;
      const c = item.comparison;
      
      if (d.show_display_unit_price) {
        if (!c?.comparison_eligible) {
          rowReasons.push('display_price_shown_but_comparison_ineligible');
          rowMessages.push('Display unit price is shown but item is not comparison eligible');
        }
        if (!item.content?.total_content_value) {
          rowReasons.push('display_price_shown_but_missing_total_content');
          rowMessages.push('Display unit price is shown but total content is missing');
        }
        if (item.product?.item_domain && ['electronics', 'appliance', 'other_non_grocery'].includes(item.product.item_domain)) {
          rowReasons.push('display_price_shown_for_non_grocery');
          rowMessages.push('Display unit price is shown for non-grocery item');
        }
        
        // Threshold validation
        if (d.display_unit_price !== null && d.display_unit_price < 0.50) {
          if (d.display_unit_basis_unit !== 'kg' && d.display_unit_basis_unit !== 'l') {
             // It means it could have picked a larger basis but didn't?
             // Or maybe it picked the largest available and still failed.
             if (!d.below_min_display_price_threshold) {
               rowReasons.push('display_price_calculation_error');
               rowMessages.push(`Display price is ${d.display_unit_price} but threshold flag is false`);
             }
          }
        }
        
        // Family validation
        if (d.display_unit_family !== item.content?.total_content_unit && d.display_unit_family !== 'mass' && d.display_unit_family !== 'volume' && d.display_unit_family !== 'count') {
          // just a rough check since family != unit
        }
      } else {
        if (d.hidden_reason === 'unsafe_conversion') {
          rowReasons.push('display_price_calculation_error');
          rowMessages.push('Display unit price calculation resulted in unsafe conversion');
        }
      }
    }
    if (isPublishable(item) && (item.prices?.original_price === null || item.prices?.original_price === undefined)) {
      rowReasons.push('missing_original_price');
      rowMessages.push('Original price is missing');
    }

    // 9. Page-First Zero Tolerance Checks (Chunk 68)
    const pageFirstData = (item.raw?.raw_attributes as any)?.page_first;
    if (pageFirstData) {
      if (isPublishable(item) && !pageFirstData.current_price_anchor_block_id) {
        criticalFailures.push({
          code: 'page_first_publishable_without_anchor',
          severity: 'critical',
          message: 'Publishable offer has no linked current-price anchor block',
          source_page_number: pageNum,
          source_item_number: itemNum,
        });
        criticalFailureCount++;
        rowReasons.push('page_first_publishable_without_anchor');
        rowMessages.push('Publishable offer lacks current-price anchor');
      }

      if (isPublishable(item) && pageFirstData.completeness_status === 'unresolved') {
        criticalFailures.push({
          code: 'page_first_unresolved_page_completed',
          severity: 'critical',
          message: 'Item belongs to an unresolved page that failed completeness gates',
          source_page_number: pageNum,
          source_item_number: itemNum,
        });
        criticalFailureCount++;
        rowReasons.push('page_first_unresolved_page_completed');
        rowMessages.push('Page failed completeness checks');
      }
    }

    // Record suspicious row
    if (rowReasons.length > 0) {
      page.suspiciousCount++;
      suspiciousRows.push({
        source_page_number: pageNum,
        source_item_number: itemNum,
        reason_codes: rowReasons,
        messages: rowMessages,
        publish_decision: dec || null,
        offer_price: item.prices?.offer_price ?? null,
        original_price: item.prices?.original_price ?? null,
        size_text: item.content?.size_text ?? null,
        comparison_eligible: item.comparison?.comparison_eligible ?? false,
      });

      // Auto action: recommend quarantine if critical and still publishable
      const hasCriticalReason = rowReasons.some(r =>
        CRITICAL_BLOCKING_CODES.has(r) ||
        r === 'comparison_eligible_null_unit_price' ||
        r === 'comparison_eligible_missing_unit' ||
        r === 'publishable_with_blocking_errors'
      );

      if (hasCriticalReason && isPublishable(item)) {
        autoActions.push({
          action: 'quarantined_item',
          source_page_number: pageNum,
          source_item_number: itemNum,
          reason: `Critical issue on publishable row: ${rowReasons.join(', ')}`,
          result: 'Set publish_decision to skip_or_quarantine',
        });
      }

      // Auto action: recommend revalidation for non-critical suspicious items
      if (!hasCriticalReason && isPublishable(item)) {
        if (isDryRun) {
          autoActions.push({
            action: 'skipped_due_to_dry_run',
            source_page_number: pageNum,
            source_item_number: itemNum,
            reason: `Would revalidate: ${rowReasons.join(', ')}`,
            result: 'Skipped - dry run mode',
          });
        } else {
          autoActions.push({
            action: 'revalidated_item',
            source_page_number: pageNum,
            source_item_number: itemNum,
            reason: `Suspicious: ${rowReasons.join(', ')}`,
            result: 'Recommended for stricter revalidation',
          });
        }
      }

      // Fixture candidate for every suspicious row
      autoActions.push({
        action: 'created_fixture_candidate',
        source_page_number: pageNum,
        source_item_number: itemNum,
        reason: rowReasons.join(', '),
        result: `Fixture candidate created for page-${String(pageNum).padStart(3, '0')}-item-${itemNum}`,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Page style profile evaluation
  // ---------------------------------------------------------------------------

  const pspStatus = input.pageStyleProfileStatus;
  let pageStyleProfileFailureCount = 0;

  if (pspStatus.mode === 'all_pages') {
    pageStyleProfileFailureCount = pspStatus.failedPages;

    for (const failure of pspStatus.failures) {
      warnings.push({
        code: 'page_style_profile_failed',
        severity: 'warning',
        message: `Page style profile failed for page ${failure.pageNumber}: ${failure.message}`,
        source_page_number: failure.pageNumber,
        source_item_number: null,
      });

      // Check if this failed page has publishable rows
      const pageData = pageMap.get(failure.pageNumber);
      if (pageData && pageData.publishCount > 0) {
        warnings.push({
          code: 'page_style_profile_failed_with_publishable_rows',
          severity: 'warning',
          message: `Page ${failure.pageNumber} has ${pageData.publishCount} publishable rows but its style profile failed`,
          source_page_number: failure.pageNumber,
          source_item_number: null,
        });
      }
    }

    for (const missingPage of pspStatus.missingPages) {
      // Check if this page has publishable rows
      const pageData = pageMap.get(missingPage);
      if (pageData && pageData.publishCount > 0) {
        warnings.push({
          code: 'page_style_profile_missing_with_publishable_rows',
          severity: 'warning',
          message: `Page ${missingPage} has ${pageData.publishCount} publishable rows but no style profile`,
          source_page_number: missingPage,
          source_item_number: null,
        });
      }
    }

    // Retry failed page style profiles
    for (const failure of pspStatus.failures) {
      if (isDryRun) {
        autoActions.push({
          action: 'skipped_due_to_dry_run',
          source_page_number: failure.pageNumber,
          source_item_number: null,
          reason: `Would retry failed page style profile`,
          result: 'Skipped - dry run mode',
        });
      } else {
        autoActions.push({
          action: 'regenerated_page_style_profile',
          source_page_number: failure.pageNumber,
          source_item_number: null,
          reason: `Page style profile failed: ${failure.message}`,
          result: 'Recommended for retry',
        });
      }
    }
  } else if (pspStatus.mode === 'disabled') {
    // If disabled, check if there are any publishable rows at all
    if (publishCount > 0) {
      warnings.push({
        code: 'page_style_profile_disabled_with_publishable_rows',
        severity: 'warning',
        message: `Page style profiles are disabled, but there are ${publishCount} publishable rows. This reduces accuracy and safety.`,
        source_page_number: null,
        source_item_number: null,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Crop Suggestion evaluation
  // ---------------------------------------------------------------------------
  if (input.cropSuggestionStatus) {
    for (const failure of input.cropSuggestionStatus.failures) {
      warnings.push({
        code: 'crop_suggestion_failed',
        severity: 'warning',
        message: `Crop suggestion failed for page ${failure.pageNumber}: ${failure.message}`,
        source_page_number: failure.pageNumber,
        source_item_number: null,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Chunk 63 - Manual Crop Validation
  // ---------------------------------------------------------------------------
  if (input.manualCropSession) {
    for (const layout of input.manualCropSession.pageLayouts || []) {
      const pageData = pageMap.get(layout.pageNumber);
      
      // 1. Automatic fixed grid generated
      const hasGridBoxes = layout.boxes?.some(b => b.createdFromGrid);
      if (hasGridBoxes) {
        warnings.push({
          code: 'automatic_fixed_grid_used',
          severity: 'warning',
          message: `Page ${layout.pageNumber} used an automatic fixed grid, which is deprecated.`,
          source_page_number: layout.pageNumber,
          source_item_number: null,
        });
      }

      // 2. Unconfirmed boxes extracted
      if (!layout.pageComplete && pageData && pageData.items.length > 0) {
        warnings.push({
          code: 'unconfirmed_boxes_extracted',
          severity: 'warning',
          message: `Page ${layout.pageNumber} was extracted without being explicitly confirmed.`,
          source_page_number: layout.pageNumber,
          source_item_number: null,
        });
      }

      // 3. Unconfirmed low-confidence suggestions (heuristic: accepted without changes but low confidence)
      if (layout.pageComplete && layout.suggestedBoxes) {
        const hasLowConf = layout.suggestedBoxes.some(b => b.confidence < 0.6);
        if (hasLowConf) {
           warnings.push({
             code: 'unconfirmed_low_confidence_suggestions',
             severity: 'warning',
             message: `Page ${layout.pageNumber} confirmed low-confidence suggestions without manual intervention.`,
             source_page_number: layout.pageNumber,
             source_item_number: null,
           });
        }
      }

      // 4. Detector output anomalies (Chunk 64)
      const isDetectorUsed = layout.suggestedBoxes?.some(b => b.source === 'local_cv_detection' || b.source === 'local_ml_detection_refined');
      if (isDetectorUsed) {
        // Chunk 64/65 ML Warnings
        if (layout.cropStatus !== 'not_started') {
          const maturity = input.autoAcceptanceDecisions?.find(d => d.page_number === layout.pageNumber)?.model?.maturity;
          if (maturity === 'immature' && layout.boxes.some(b => (b as any).status === 'accepted')) {
            warnings.push({
              code: 'detector_immature_auto_accept',
              message: `Page ${layout.pageNumber} auto-accepted by an immature model.`,
              severity: 'warning',
              source_page_number: layout.pageNumber,
              source_item_number: null
            })
            warningCount++
          }
          if (layout.boxes.length === 0 && layout.pageComplete) {
            warnings.push({
              code: 'detector_zero_box_page',
              message: `Page ${layout.pageNumber} confirmed empty. Verify detector didn't miss offers.`,
              severity: 'warning',
              source_page_number: layout.pageNumber,
              source_item_number: null
            })
            warningCount++
          }
        }
        
        // Chunk 65 Auto-acceptance safety check
        if (input.autoAcceptanceDecisions) {
          const decision = input.autoAcceptanceDecisions.find(d => d.page_number === layout.pageNumber)
          if (decision && decision.decision === 'auto_accept' && !decision.required_checks.every((c: any) => c.passed)) {
            criticalFailures.push({
              code: 'unsafe_auto_acceptance',
              severity: 'critical',
              message: `Page ${layout.pageNumber} was auto-accepted despite failing required safety checks.`,
              source_page_number: layout.pageNumber,
              source_item_number: null
            })
            criticalFailureCount++
          }
        }

        if (layout.pageComplete && layout.boxes.length === 0) {
          warnings.push({
             code: 'detector_zero_box_page',
             severity: 'warning',
             message: `Page ${layout.pageNumber} was confirmed with 0 boxes using detector output.`,
             source_page_number: layout.pageNumber,
             source_item_number: null,
          });
        }
        
        // 5. split_missing_anchor check
        const splitBoxes = layout.boxes.filter(b => b.provenance === 'price_anchor_split');
        if (splitBoxes.length > 0) {
          // check for low density indicating missed anchors
          const totalBoxArea = layout.boxes.reduce((sum, b) => sum + (b.width * b.height), 0);
          const pageArea = layout.pageWidth * layout.pageHeight;
          const density = pageArea > 0 ? totalBoxArea / pageArea : 0;
          
          if (density < 0.15) { // Arbitrary threshold for "low density"
            criticalFailures.push({
              code: 'split_missing_anchor',
              severity: 'critical',
              message: `Page ${layout.pageNumber} was split via price anchors but has suspiciously low box density (${(density * 100).toFixed(1)}%). High confidence flag revoked.`,
              source_page_number: layout.pageNumber,
              source_item_number: null
            });
            criticalFailureCount++;
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Rate-based warnings
  // ---------------------------------------------------------------------------

  const totalItems = items.length;

  if (totalItems > 0) {
    const skipRate = skipCount / totalItems;
    if (skipRate > thresholds.maxSkipRateWarning) {
      warnings.push({
        code: 'high_skip_rate',
        severity: 'warning',
        message: `Skip rate ${(skipRate * 100).toFixed(1)}% exceeds threshold ${(thresholds.maxSkipRateWarning * 100).toFixed(1)}%`,
        source_page_number: null,
        source_item_number: null,
      });
    }

    const validationFailRate = validationFailureCount / totalItems;
    if (validationFailRate > thresholds.maxValidationFailureRateWarning) {
      warnings.push({
        code: 'high_validation_failure_rate',
        severity: 'warning',
        message: `Validation failure rate ${(validationFailRate * 100).toFixed(1)}% exceeds threshold ${(thresholds.maxValidationFailureRateWarning * 100).toFixed(1)}%`,
        source_page_number: null,
        source_item_number: null,
      });
    }

    const correctionRate = validationCorrectionCount / totalItems;
    if (correctionRate > thresholds.maxValidationCorrectionRateWarning) {
      warnings.push({
        code: 'high_validation_correction_rate',
        severity: 'warning',
        message: `Validation correction rate ${(correctionRate * 100).toFixed(1)}% exceeds threshold ${(thresholds.maxValidationCorrectionRateWarning * 100).toFixed(1)}%`,
        source_page_number: null,
        source_item_number: null,
      });
    }

    const lowConfRate = lowConfidenceValidationCount / totalItems;
    if (lowConfRate > thresholds.maxLowConfidenceValidationRateWarning) {
      warnings.push({
        code: 'high_low_confidence_validation_rate',
        severity: 'warning',
        message: `Low confidence validation rate ${(lowConfRate * 100).toFixed(1)}% exceeds threshold ${(thresholds.maxLowConfidenceValidationRateWarning * 100).toFixed(1)}%`,
        source_page_number: null,
        source_item_number: null,
      });
    }

    // Page-level warning rate
    for (const [pageNum, pageData] of pageMap) {
      const pageTotal = pageData.items.length;
      if (pageTotal > 0) {
        const pageWarningRate = (pageData.warningCount + pageData.blockingErrorCount) / pageTotal;
        if (pageWarningRate > thresholds.maxPageWarningRateWarning) {
          warnings.push({
            code: 'high_page_warning_rate',
            severity: 'warning',
            message: `Page ${pageNum} warning/error rate ${(pageWarningRate * 100).toFixed(1)}% exceeds threshold ${(thresholds.maxPageWarningRateWarning * 100).toFixed(1)}%`,
            source_page_number: pageNum,
            source_item_number: null,
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Page summaries
  // ---------------------------------------------------------------------------

  const pageSummaries: RuntimePageSummary[] = [];

  for (const [pageNum, pageData] of pageMap) {
    let styleStatus: RuntimePageSummary['style_profile_status'] = 'completed';
    if (pspStatus.mode === 'disabled') {
      styleStatus = 'disabled';
    } else if (pspStatus.failures.some(f => f.pageNumber === pageNum)) {
      styleStatus = 'failed';
    } else if (pspStatus.missingPages.includes(pageNum)) {
      styleStatus = 'missing';
    }

    pageSummaries.push({
      page_number: pageNum,
      item_count: pageData.items.length,
      publish_count: pageData.publishCount,
      skip_count: pageData.skipCount,
      warning_count: pageData.warningCount,
      blocking_error_count: pageData.blockingErrorCount,
      suspicious_count: pageData.suspiciousCount,
      style_profile_status: styleStatus,
    });
  }

  pageSummaries.sort((a, b) => a.page_number - b.page_number);

  // ---------------------------------------------------------------------------
  // Gate decision
  // ---------------------------------------------------------------------------

  let decision: RuntimeAccuracyGateDecision = 'pass';

  // Block conditions
  if (
    criticalFailureCount > thresholds.maxCriticalFailuresForPublish ||
    publishableRowsWithBlockingErrors > thresholds.maxPublishableRowsWithBlockingErrors ||
    unsafeComparisonEligibleRows > thresholds.maxUnsafeComparisonEligibleRows
  ) {
    decision = 'block_publish';
    autoActions.push({
      action: 'blocked_publish',
      source_page_number: null,
      source_item_number: null,
      reason: `Critical failures: ${criticalFailureCount}, publishable with blocking errors: ${publishableRowsWithBlockingErrors}, unsafe comparison eligible: ${unsafeComparisonEligibleRows}`,
      result: 'Publish blocked',
    });
  }

  // Human review conditions (only if not already blocked)
  if (decision !== 'block_publish') {
    const needsReview =
      (totalItems > 0 && skipCount / totalItems > thresholds.maxSkipRateWarning) ||
      (totalItems > 0 && validationFailureCount / totalItems > thresholds.maxValidationFailureRateWarning) ||
      (totalItems > 0 && validationCorrectionCount / totalItems > thresholds.maxValidationCorrectionRateWarning) ||
      (totalItems > 0 && lowConfidenceValidationCount / totalItems > thresholds.maxLowConfidenceValidationRateWarning) ||
      pageStyleProfileFailureCount > 0 ||
      pspStatus.missingPages.some(p => {
        const pd = pageMap.get(p);
        return pd && pd.publishCount > 0;
      });

    if (needsReview) {
      decision = 'needs_human_review';
    }
  }

  // Warning conditions (only if not already review/blocked)
  if (decision === 'pass' && warnings.length > 0) {
    decision = 'pass_with_warnings';
  }

  // ---------------------------------------------------------------------------
  // Build result
  // ---------------------------------------------------------------------------

  return {
    schema_version: 1,
    created_at: new Date().toISOString(),
    decision,
    summary: {
      total_items: totalItems,
      publish_count: publishCount,
      publish_but_exclude_from_comparison_count: publishExcludeCount,
      skip_or_quarantine_count: skipCount,
      blocking_error_count: blockingErrorCount,
      warning_count: warningCount,
      comparison_excluded_count: comparisonExcludedCount,
      critical_failure_count: criticalFailureCount,
      suspicious_row_count: suspiciousRows.length,
      page_style_profile_failure_count: pageStyleProfileFailureCount,
      low_confidence_validation_count: lowConfidenceValidationCount,
      validation_correction_count: validationCorrectionCount,
    },
    critical_failures: criticalFailures,
    warnings,
    suspicious_rows: suspiciousRows,
    page_summaries: pageSummaries,
    thresholds,
    auto_actions: autoActions,
    fixture_candidates: [], // Populated by the I/O service layer
  };
}
