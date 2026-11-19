import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { PageFirstExtractionReport, PageFirstReportPageItem, PageFirstReportOfferItem, PageFirstQualityMetrics } from '../../shared/types/pageFirstExtractionReport';
import { calculateEstimatedCostUsd, PageFirstCostTracker } from '../page-first/pageFirstCostBudget';
import type { GeminiJobUsageSummary } from '../ocr/geminiCacheTypes';

export function generatePageFirstReport(input: {
  packageDir: string;
  pdfBaseName: string;
  model: string;
  rolloutMode: 'pilot' | 'primary';
  pages: PageFirstReportPageItem[];
  offers: PageFirstReportOfferItem[];
  startTime: number;
  costTracker: PageFirstCostTracker;
  geminiUsageSummary?: GeminiJobUsageSummary;
}): PageFirstExtractionReport {
  const { packageDir, pdfBaseName, model, rolloutMode, pages, offers, startTime, costTracker, geminiUsageSummary } = input;

  const totalPages = pages.length;
  const offerPages = pages.filter(p => p.page_classification === 'offer_page' || p.structured_offer_count > 0).length;
  const nonOfferPages = totalPages - offerPages;

  const primaryOcrPages = costTracker.primaryPageCalls > 0 ? costTracker.primaryPageCalls : totalPages;
  const retryOcrPages = costTracker.retryPageCalls;

  const offersDetected = offers.length;
  const offersLinked = offers.filter(o => o.current_price_anchor_block_id !== null).length;
  const offersMissingAnchors = offersDetected - offersLinked;

  let uncoveredAnchors = 0;
  let duplicateAnchors = 0;
  for (const p of pages) {
    uncoveredAnchors += p.uncovered_anchor_count;
  }

  const validCrops = offers.filter(o => o.crop_path !== null).length;
  const invalidCrops = offersDetected - validCrops;

  const pagesPassedWithoutRetry = pages.filter(p => p.pass_status === 'primary_completed' && (p.completeness_status === 'pass' || p.completeness_status === 'pass_with_warnings')).length;
  const pagesPassedAfterRetry = pages.filter(p => p.pass_status === 'retry_completed' && (p.completeness_status === 'pass' || p.completeness_status === 'pass_with_warnings')).length;
  const unresolvedPages = pages.filter(p => p.pass_status === 'unresolved' || p.completeness_status === 'unresolved').length;

  const estimatedCost = geminiUsageSummary
    ? geminiUsageSummary.totalCostUsd
    : calculateEstimatedCostUsd(costTracker);
  const processingTime = Date.now() - startTime;

  const pageAutomationRate = totalPages > 0 ? Number(((totalPages - unresolvedPages) / totalPages).toFixed(4)) : 1.0;
  const offerAnchorLinkRate = offersDetected > 0 ? Number((offersLinked / offersDetected).toFixed(4)) : 1.0;
  const validCropRate = offersDetected > 0 ? Number((validCrops / offersDetected).toFixed(4)) : 1.0;
  const pageRetryRate = totalPages > 0 ? Number((retryOcrPages / totalPages).toFixed(4)) : 0;
  const manualReviewRate = totalPages > 0 ? Number((unresolvedPages / totalPages).toFixed(4)) : 0;
  const publishableRows = offers.filter(o => o.publish_decision === 'publish' || o.publish_decision === 'publish_but_exclude_from_comparison').length;
  const publishableRowRate = offersDetected > 0 ? Number((publishableRows / offersDetected).toFixed(4)) : 0;

  let criticalErrors = 0;
  for (const p of pages) {
    criticalErrors += p.blocking_issues.length;
  }

  const metrics: PageFirstQualityMetrics = {
    total_pages: totalPages,
    offer_pages: offerPages,
    non_offer_pages: nonOfferPages,
    primary_ocr_pages: primaryOcrPages,
    retry_ocr_pages: retryOcrPages,
    offers_detected: offersDetected,
    offers_linked: offersLinked,
    offers_missing_current_price_anchors: offersMissingAnchors,
    uncovered_current_price_anchors: uncoveredAnchors,
    duplicate_anchor_assignments: duplicateAnchors,
    automatic_crops_generated: validCrops,
    valid_crops: validCrops,
    invalid_crops: invalidCrops,
    pages_passed_without_retry: pagesPassedWithoutRetry,
    pages_passed_after_retry: pagesPassedAfterRetry,
    unresolved_pages: unresolvedPages,
    estimated_cost_usd: estimatedCost,
    is_cost_estimate: true,
    processing_time_ms: processingTime,
    page_automation_rate: pageAutomationRate,
    offer_anchor_link_rate: offerAnchorLinkRate,
    valid_crop_rate: validCropRate,
    page_retry_rate: pageRetryRate,
    manual_review_rate: manualReviewRate,
    publishable_row_rate: publishableRowRate,
    critical_error_count: criticalErrors
  };

  const report: PageFirstExtractionReport = {
    schema_version: 1,
    created_at: new Date().toISOString(),
    extraction_mode: 'page_first_annotated_ocr',
    rollout_mode: rolloutMode,
    model,
    leaflet_base_name: pdfBaseName,
    package_path: packageDir,
    budget_usd: costTracker.budgetUsd,
    ...(geminiUsageSummary
      ? {
          gemini_usage_summary: {
            api_calls_count: geminiUsageSummary.apiCallsCount,
            cache_hits_count: geminiUsageSummary.cacheHitsCount,
            retries_count: geminiUsageSummary.retriesCount,
            total_prompt_tokens: geminiUsageSummary.totalPromptTokens,
            total_candidates_tokens: geminiUsageSummary.totalCandidatesTokens,
            total_thoughts_tokens: geminiUsageSummary.totalThoughtsTokens,
            total_cached_tokens: geminiUsageSummary.totalCachedTokens,
            total_tokens: geminiUsageSummary.totalTokens,
            total_cost_usd: geminiUsageSummary.totalCostUsd,
            is_estimate: true,
            models_used: geminiUsageSummary.modelsUsed || []
          }
        }
      : {}),
    metrics,
    pages,
    offers
  };

  const reportsDir = join(packageDir, 'metadata', 'reports');
  mkdirSync(reportsDir, { recursive: true });

  const jsonReportPath = join(reportsDir, 'page-first-extraction-report.json');
  const mdReportPath = join(reportsDir, 'page-first-extraction-report.md');

  writeFileSync(jsonReportPath, JSON.stringify(report, null, 2), 'utf8');

  // Format Markdown report
  const mdContent = formatPageFirstReportMarkdown(report);
  writeFileSync(mdReportPath, mdContent, 'utf8');

  // Update existing reports if they exist
  updateExistingReportsWithPageFirstMetrics(packageDir, report);

  return report;
}

export function formatPageFirstReportMarkdown(report: PageFirstExtractionReport): string {
  const m = report.metrics;
  const isGemini = report.model?.toLowerCase().includes('gemini') || report.model?.toLowerCase().includes('flash');
  const title = isGemini
    ? `# Spatial Vision (rev1) Extraction Report — Gemini 3.8 Flash`
    : `# Page-First Mistral OCR 4.1 Extraction Report`;
  return `${title}

**Leaflet:** ${report.leaflet_base_name}  
**Model:** ${report.model}  
**Extraction Mode:** ${report.extraction_mode}  
**Rollout Mode:** ${report.rollout_mode}  
**Created:** ${report.created_at}  

---

## 1. Executive Summary & Quality Gates

| Metric | Measured Value | Target / Threshold | Status |
| :--- | :--- | :--- | :--- |
| **Page Automation Rate** | ${(m.page_automation_rate * 100).toFixed(1)}% | ≥ 90.0% | ${m.page_automation_rate >= 0.9 ? '✅ PASS' : '⚠️ REVIEW'} |
| **Offer Anchor Link Rate** | ${(m.offer_anchor_link_rate * 100).toFixed(1)}% | 100% | ${m.offer_anchor_link_rate === 1.0 ? '✅ PASS' : '⚠️ WARNING'} |
| **Valid Crop Rate** | ${(m.valid_crop_rate * 100).toFixed(1)}% | ≥ 95.0% | ${m.valid_crop_rate >= 0.95 ? '✅ PASS' : '⚠️ WARNING'} |
| **Unresolved Pages** | ${m.unresolved_pages} | 0 | ${m.unresolved_pages === 0 ? '✅ NONE' : '⚠️ QUARANTINED'} |
| **Post-Call Estimated Cost (Local Estimate — Not Provider Billing)** | $${m.estimated_cost_usd.toFixed(6)} | < $${(report.budget_usd ?? 0.95).toFixed(2)} | ${m.estimated_cost_usd < (report.budget_usd ?? 0.95) ? '✅ PASS' : '❌ EXCEEDED'} |
| **Critical Errors** | ${m.critical_error_count} | 0 | ${m.critical_error_count === 0 ? '✅ ZERO' : '❌ BLOCKED'} |

---

## 2. Extraction Pipeline Metrics

- **Total Pages Processed:** ${m.total_pages} (Offer pages: ${m.offer_pages}, Non-offer: ${m.non_offer_pages})
- **Primary OCR Requests:** ${m.primary_ocr_pages}
- **Semantic Retry Passes:** ${m.retry_ocr_pages} (Retry rate: ${(m.page_retry_rate * 100).toFixed(1)}%)
- **Offers Detected:** ${m.offers_detected}
- **Offers Linked to Evidence:** ${m.offers_linked}
- **Missing Current-Price Anchors:** ${m.offers_missing_current_price_anchors}
- **Uncovered Current-Price Anchors:** ${m.uncovered_current_price_anchors}
- **Duplicate Anchor Assignments:** ${m.duplicate_anchor_assignments}
- **Automatic Crops Generated:** ${m.automatic_crops_generated}
- **Processing Time:** ${(m.processing_time_ms / 1000).toFixed(1)}s
${report.gemini_usage_summary ? `- **Gemini Token Usage (Measured):** ${report.gemini_usage_summary.total_prompt_tokens} prompt + ${report.gemini_usage_summary.total_candidates_tokens} output + ${report.gemini_usage_summary.total_thoughts_tokens} thinking = ${report.gemini_usage_summary.total_tokens} total tokens (API calls: ${report.gemini_usage_summary.api_calls_count}, cache hits: ${report.gemini_usage_summary.cache_hits_count})
- **Pre-Run Budget Ceiling:** $${(report.budget_usd ?? 0.95).toFixed(2)} | **Post-Call Measured Estimate (isEstimate=${report.gemini_usage_summary.is_estimate}):** $${report.gemini_usage_summary.total_cost_usd.toFixed(6)} (Local pricing estimate, not official provider billing)` : ''}

---

## 3. Per-Page Summary

| Page | Classification | Offers | Anchors | Uncovered | Pass Status | Completeness | Cost |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
${report.pages.map(p => `| ${p.page_number} | ${p.page_classification} | ${p.structured_offer_count} | ${p.current_price_anchor_count} | ${p.uncovered_anchor_count} | ${p.pass_status} | ${p.completeness_status} | $${p.estimated_cost_usd.toFixed(6)} |`).join('\n')}

---

## 4. Unresolved Exceptions & Warnings

${report.pages.filter(p => p.unresolved_reason || p.blocking_issues.length > 0).map(p => `
### Page ${p.page_number}
- **Reason:** ${p.unresolved_reason || 'Completeness validation failure'}
- **Blocking Issues:** ${p.blocking_issues.join(', ') || 'None'}
- **Warnings:** ${p.warnings.join(', ') || 'None'}
`).join('\n') || '*No unresolved pages. All processed pages passed completeness gates.*'}
`;
}

function updateExistingReportsWithPageFirstMetrics(packageDir: string, report: PageFirstExtractionReport): void {
  const reportsDir = join(packageDir, 'metadata', 'reports');

  const patchJson = (fileName: string) => {
    const fullPath = join(reportsDir, fileName);
    if (existsSync(fullPath)) {
      try {
        const raw = JSON.parse(readFileSync(fullPath, 'utf8'));
        raw.extraction_mode = 'page_first_annotated_ocr';
        raw.page_first_primary_requests = report.metrics.primary_ocr_pages;
        raw.page_first_retry_requests = report.metrics.retry_ocr_pages;
        raw.page_first_estimated_cost_usd = report.metrics.estimated_cost_usd;
        raw.page_first_offers_detected = report.metrics.offers_detected;
        raw.page_first_offers_linked = report.metrics.offers_linked;
        raw.page_first_uncovered_anchors = report.metrics.uncovered_current_price_anchors;
        raw.page_first_valid_crops = report.metrics.valid_crops;
        raw.page_first_unresolved_pages = report.metrics.unresolved_pages;
        raw.page_first_manual_review_rate = report.metrics.manual_review_rate;
        raw.local_detector_status = 'not_used_in_page_first_mode';
        writeFileSync(fullPath, JSON.stringify(raw, null, 2), 'utf8');
      } catch (e) {
        // ignore
      }
    }
  };

  patchJson('accuracy-run-report.json');
  patchJson('runtime-accuracy-harness-report.json');
  patchJson('pre-publish-preview-summary.json');
  patchJson('qa-dry-run-publish-report.json');
}
