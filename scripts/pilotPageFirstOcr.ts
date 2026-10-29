import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { PageFirstPipelineService } from '../src/main/page-first/pageFirstPipelineService';
import { ANNOTATED_OCR_ESTIMATED_USD_PER_PAGE, LEAFLET_ANNOTATED_OCR_BUDGET_USD } from '../src/main/page-first/pageFirstCostBudget';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

// Command-line arguments
// Example: npx tsx scripts/pilotPageFirstOcr.ts --package "Extracts_QA/..." --pages "2"
const args = process.argv.slice(2);
let packageArg: string | null = null;
let pagesArg: string = '1';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--package' && args[i + 1]) {
    packageArg = args[++i];
  } else if (args[i] === '--pages' && args[i + 1]) {
    pagesArg = args[++i];
  }
}

async function main() {
  console.log('================================================================');
  console.log('  PAGE-FIRST MISTRAL OCR 4.1 LIVE PILOT RUNNER (CHUNK 68)     ');
  console.log('================================================================');

  if (!packageArg) {
    console.error('Error: --package argument is required.');
    console.error('Example: npm run pilot:page-first-ocr -- --package "Extracts_QA/Danube_01" --pages "2"');
    process.exit(1);
  }

  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    console.error('Error: MISTRAL_API_KEY is not defined in environment or .env.local');
    process.exit(1);
  }

  // Resolve package path
  const workspacePath = path.isAbsolute(packageArg)
    ? packageArg
    : path.resolve(process.cwd(), packageArg);

  if (!fs.existsSync(workspacePath)) {
    console.error(`Error: Workspace package directory does not exist: ${workspacePath}`);
    process.exit(1);
  }

  // Parse pages
  const targetPages: number[] = [];
  const pageParts = pagesArg.split(',');
  for (const part of pageParts) {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [start, end] = trimmed.split('-').map(Number);
      if (!isNaN(start) && !isNaN(end)) {
        for (let p = start; p <= end; p++) targetPages.push(p);
      }
    } else {
      const p = Number(trimmed);
      if (!isNaN(p)) targetPages.push(p);
    }
  }

  if (targetPages.length === 0) {
    console.error(`Error: No valid page numbers parsed from --pages "${pagesArg}"`);
    process.exit(1);
  }

  const projectedCost = targetPages.length * ANNOTATED_OCR_ESTIMATED_USD_PER_PAGE;
  console.log(`\nWorkspace: ${workspacePath}`);
  console.log(`Target pages: ${targetPages.join(', ')} (${targetPages.length} pages)`);
  console.log(`Projected annotated OCR cost: $${projectedCost.toFixed(4)} USD`);
  console.log(`Leaflet maximum budget: $${LEAFLET_ANNOTATED_OCR_BUDGET_USD.toFixed(2)} USD`);
  console.log(`Rollout mode: PILOT (Database publishing is strictly disabled; images will NOT be uploaded to Supabase)`);
  console.log(`Sequential queue: 1 concurrent request, minimum 5000ms delay between starts\n`);

  if (projectedCost > LEAFLET_ANNOTATED_OCR_BUDGET_USD) {
    console.error(`Error: Projected cost ($${projectedCost.toFixed(4)}) exceeds leaflet budget ($${LEAFLET_ANNOTATED_OCR_BUDGET_USD.toFixed(2)}).`);
    process.exit(1);
  }

  console.log('Starting page-first processing...\n');
  const startTime = Date.now();

  for (const pageNum of targetPages) {
    console.log(`--- [Page ${pageNum}] Processing ---`);
    try {
      const result = await PageFirstPipelineService.processPage({
        workspacePath,
        pageNumber: pageNum,
        rolloutMode: 'pilot'
      });

      console.log(`  Status: ${result.status}`);
      console.log(`  Offers Detected: ${result.offers_detected}`);
      console.log(`  Offers Linked: ${result.offers_linked}`);
      console.log(`  Crops Generated: ${result.crops_generated}`);
      console.log(`  Completeness Score: ${result.completeness_score.toFixed(2)}`);
      if (result.warnings.length > 0) {
        console.log(`  Warnings (${result.warnings.length}):`);
        result.warnings.slice(0, 5).forEach(w => console.log(`    - ${w}`));
      }
      if (result.blocking_issues.length > 0) {
        console.log(`  Blocking Issues (${result.blocking_issues.length}):`);
        result.blocking_issues.forEach(b => console.log(`    ! [${b.code}] ${b.message}`));
      }
      console.log('');
    } catch (err: any) {
      console.error(`  Failed to process page ${pageNum}:`, err.message);
    }
  }

  const elapsedSec = Math.round((Date.now() - startTime) / 1000);
  const status = await PageFirstPipelineService.getStatus(workspacePath);

  console.log('================================================================');
  console.log('  PILOT RUN COMPLETE                                            ');
  console.log('================================================================');
  console.log(`Elapsed time: ${elapsedSec}s`);
  console.log(`Total completed pages: ${status.completed_pages}`);
  console.log(`Unresolved pages: ${status.unresolved_pages}`);
  console.log(`Offers detected: ${status.offers_detected}`);
  console.log(`Offers linked: ${status.offers_linked}`);
  console.log(`Crops generated: ${status.crops_generated}`);
  console.log(`Estimated cost so far: $${status.estimated_cost_usd.toFixed(4)} USD`);
  console.log(`Report path: metadata/reports/page-first-extraction-report.md`);
  console.log('\nSafety Check: ZERO offers were published to Supabase (pilot mode).');
  console.log('Open Pre-Publish Preview in UI or check markdown report to inspect results.');
}

main().catch(err => {
  console.error('Fatal error in pilot runner:', err);
  process.exit(1);
});
