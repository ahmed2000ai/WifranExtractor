/**
 * Accuracy Harness CLI Runner – Chunk 57
 *
 * npm run harness:accuracy
 *
 * Runs the offline fixture harness ONLY. Does NOT:
 *  - call Mistral
 *  - upload images
 *  - write to Supabase
 *  - publish offers
 *  - delete files
 *
 * Outputs:
 *  - antigravity-reports/57-accuracy-harness-report.json
 *  - antigravity-reports/57-accuracy-harness-report.md
 */

import * as fs from 'fs';
import * as path from 'path';

import { runAccuracyHarnessFixture } from '../src/shared/accuracy-harness/runAccuracyHarnessFixture';
import {
  generateAccuracyHarnessReport,
  formatAccuracyHarnessReportMarkdown,
} from '../src/shared/accuracy-harness/accuracyHarnessReport';
import type { AccuracyHarnessFixture, AccuracyHarnessFixtureResult } from '../src/shared/types/accuracyHarness';

// ---------------------------------------------------------------------------
// Load fixtures
// ---------------------------------------------------------------------------

const fixturesRoot = path.resolve(__dirname, '..', 'tests', 'fixtures', 'accuracy-harness');

function loadFixtures(): AccuracyHarnessFixture[] {
  if (!fs.existsSync(fixturesRoot)) {
    console.error(`❌ Fixture directory not found: ${fixturesRoot}`);
    process.exit(1);
  }

  const dirs = fs.readdirSync(fixturesRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
  const fixtures: AccuracyHarnessFixture[] = [];

  for (const dir of dirs) {
    const fixturePath = path.join(fixturesRoot, dir.name, 'fixture.json');
    if (!fs.existsSync(fixturePath)) {
      console.warn(`⚠️  Skipping ${dir.name}: no fixture.json found`);
      continue;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
      fixtures.push(raw as AccuracyHarnessFixture);
    } catch (err: any) {
      console.error(`❌ Failed to parse ${fixturePath}: ${err.message}`);
    }
  }

  return fixtures;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('  Accuracy Harness — Offline Fixture Runner (C57) ');
  console.log('═══════════════════════════════════════════════════');
  console.log('');

  const fixtures = loadFixtures();
  console.log(`Loaded ${fixtures.length} fixtures from ${fixturesRoot}`);
  console.log('');

  if (fixtures.length === 0) {
    console.error('❌ No fixtures found. Exiting.');
    process.exit(1);
  }

  // Run each fixture
  const results: AccuracyHarnessFixtureResult[] = [];

  for (const fixture of fixtures) {
    try {
      const result = runAccuracyHarnessFixture(fixture);
      results.push(result);

      const icon = result.passed ? '✅' : '❌';
      console.log(`  ${icon} ${fixture.id}`);
      if (!result.passed) {
        for (const f of result.failures) {
          console.log(`      └─ ${f.message}`);
        }
      }
    } catch (err: any) {
      console.error(`  💥 ${fixture.id}: ${err.message}`);
      results.push({
        fixture_id: fixture.id,
        passed: false,
        failures: [
          {
            path: 'runner',
            expected: 'no error',
            actual: err.message,
            message: `Runner threw: ${err.message}`,
          },
        ],
        actual: {
          canonical: {},
          blocking_error_codes: [],
          warning_codes: [],
          comparison_exclusion_codes: [],
          comparison: {},
          decision: {},
          utilization: {},
          db_payload: null,
        },
      });
    }
  }

  // Generate report
  const report = generateAccuracyHarnessReport({ fixtures, results });
  const markdownReport = formatAccuracyHarnessReportMarkdown(report);

  // Write reports
  const reportsDir = path.resolve(__dirname, '..', 'antigravity-reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const jsonPath = path.join(reportsDir, '57-accuracy-harness-report.json');
  const mdPath = path.join(reportsDir, '57-accuracy-harness-report.md');

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
  fs.writeFileSync(mdPath, markdownReport, 'utf-8');

  // Print summary
  const m = report.metrics;
  console.log('');
  console.log('─── Summary ───');
  console.log(`  Total:  ${m.total_fixtures}`);
  console.log(`  Passed: ${m.passed_fixtures}`);
  console.log(`  Failed: ${m.failed_fixtures}`);
  console.log('');
  console.log('─── Zero-Tolerance ───');
  console.log(`  false_publish_wrong_price:           ${m.false_publish_wrong_price_count}`);
  console.log(`  size_as_price_published:              ${m.size_as_price_published_count}`);
  console.log(`  old_price_as_offer_price_published:   ${m.old_price_as_offer_price_published_count}`);
  console.log(`  comparison_error_for_eligible:        ${m.comparison_error_for_eligible_count}`);
  console.log(`  invalid_location_published:           ${m.invalid_location_published_count}`);
  console.log('');
  console.log(`─── Thresholds: ${report.thresholds_passed ? '✅ ALL PASSED' : '❌ FAILED'} ───`);
  if (report.threshold_failures.length > 0) {
    for (const tf of report.threshold_failures) {
      console.log(`  ❌ ${tf}`);
    }
  }
  console.log('');
  console.log(`Reports written:`);
  console.log(`  JSON: ${jsonPath}`);
  console.log(`  MD:   ${mdPath}`);
  console.log('');

  // Exit with error code if thresholds failed
  if (!report.thresholds_passed || m.failed_fixtures > 0) {
    process.exit(1);
  }
}

main();
