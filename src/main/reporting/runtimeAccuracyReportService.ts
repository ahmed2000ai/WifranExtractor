/**
 * Runtime Accuracy Report Service – Chunk 58
 *
 * Writes the runtime accuracy harness report to JSON and Markdown.
 */

import fs from 'fs';
import path from 'path';
import type { RuntimeAccuracyHarnessResult } from '../../shared/types/runtimeAccuracyHarness';

/**
 * Write the runtime accuracy harness report.
 */
export async function writeRuntimeAccuracyReport(
  workspacePath: string,
  result: RuntimeAccuracyHarnessResult
): Promise<void> {
  const reportsDir = path.join(workspacePath, 'metadata', 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  // Write JSON report
  const jsonPath = path.join(reportsDir, 'runtime-accuracy-harness-report.json');
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));

  // Write Markdown report
  const mdPath = path.join(reportsDir, 'runtime-accuracy-harness-report.md');
  const md = formatRuntimeAccuracyReportMarkdown(result);
  fs.writeFileSync(mdPath, md);
}

/**
 * Format the result as a Markdown report.
 */
export function formatRuntimeAccuracyReportMarkdown(result: RuntimeAccuracyHarnessResult): string {
  const s = result.summary;
  const decisionEmoji: Record<string, string> = {
    pass: '✅',
    pass_with_warnings: '⚠️',
    needs_human_review: '🔍',
    block_publish: '🚫',
  };

  const lines: string[] = [
    '# Runtime Accuracy Harness Report',
    '',
    `**Created at:** ${result.created_at}`,
    '',
    `## Gate Decision: ${decisionEmoji[result.decision] || ''} ${result.decision.toUpperCase().replace(/_/g, ' ')}`,
    '',
    '## Summary',
    '',
    '| Metric | Value |',
    '|---|---|',
    `| Total items | ${s.total_items} |`,
    `| Publish | ${s.publish_count} |`,
    `| Publish (no comparison) | ${s.publish_but_exclude_from_comparison_count} |`,
    `| Skip/Quarantine | ${s.skip_or_quarantine_count} |`,
    `| Blocking errors | ${s.blocking_error_count} |`,
    `| Warnings | ${s.warning_count} |`,
    `| Comparison excluded | ${s.comparison_excluded_count} |`,
    `| **Critical failures** | **${s.critical_failure_count}** |`,
    `| **Suspicious rows** | **${s.suspicious_row_count}** |`,
    `| Page style profile failures | ${s.page_style_profile_failure_count} |`,
    `| Low confidence validations | ${s.low_confidence_validation_count} |`,
    `| Validation corrections | ${s.validation_correction_count} |`,
    '',
  ];

  // Critical failures
  if (result.critical_failures.length > 0) {
    lines.push('## Critical Failures');
    lines.push('');
    for (const f of result.critical_failures) {
      lines.push(`- 🚫 **${f.code}** (page ${f.source_page_number}, item ${f.source_item_number}): ${f.message}`);
    }
    lines.push('');
  }

  // Warnings
  if (result.warnings.length > 0) {
    lines.push('## Warnings');
    lines.push('');
    for (const w of result.warnings) {
      lines.push(`- ⚠️ **${w.code}**: ${w.message}`);
    }
    lines.push('');
  }

  // Suspicious rows
  if (result.suspicious_rows.length > 0) {
    lines.push('## Suspicious Rows');
    lines.push('');
    lines.push('| Page | Item | Decision | Price | Original | Size | Reasons |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const r of result.suspicious_rows) {
      lines.push(
        `| ${r.source_page_number} | ${r.source_item_number} | ${r.publish_decision} | ${r.offer_price} | ${r.original_price} | ${r.size_text} | ${r.reason_codes.join(', ')} |`
      );
    }
    lines.push('');
  }

  // Page summaries
  if (result.page_summaries.length > 0) {
    lines.push('## Page Summaries');
    lines.push('');
    lines.push('| Page | Items | Publish | Skip | Warnings | Errors | Suspicious | Style |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const p of result.page_summaries) {
      lines.push(
        `| ${p.page_number} | ${p.item_count} | ${p.publish_count} | ${p.skip_count} | ${p.warning_count} | ${p.blocking_error_count} | ${p.suspicious_count} | ${p.style_profile_status} |`
      );
    }
    lines.push('');
  }

  // Auto actions
  if (result.auto_actions.length > 0) {
    lines.push('## Auto Actions');
    lines.push('');
    for (const a of result.auto_actions) {
      lines.push(`- **${a.action}** (page ${a.source_page_number}, item ${a.source_item_number}): ${a.reason} → ${a.result}`);
    }
    lines.push('');
  }

  // Fixture candidates
  if (result.fixture_candidates.length > 0) {
    lines.push('## Fixture Candidates');
    lines.push('');
    for (const fc of result.fixture_candidates) {
      lines.push(`- **${fc.fixture_candidate_id}**: ${fc.reason_codes.join(', ')} → \`${fc.path}\``);
    }
    lines.push('');
  }

  return lines.join('\n');
}
