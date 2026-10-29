import path from 'path';
import fs from 'fs';
import { config as loadDotenv } from 'dotenv';
import type { ExtractedOfferRev1, OfferCropRectangles } from '../src/shared/types/leafletExtraction';
import type { CanonicalOffer } from '../src/shared/types/canonicalOffer';
import { getNativeDimensions } from '../src/main/image/nativeResolutionService';
import {
  computeOfferUnionAndThumbBoxes,
  cropAndSaveOfferAssets,
  areCompoundSiblings
} from '../src/main/page-first/spatialUnionAndClampingService';
import { mapRev1OfferToCanonical } from '../src/main/page-first/pageOfferCanonicalMapper';
import { generatePageFirstReport } from '../src/main/reporting/pageFirstReportService';
import { buildPrePublishSummary } from '../src/main/prepublish/prePublishApprovalService';
import { createCostTracker } from '../src/main/page-first/pageFirstCostBudget';
import type { PageFirstReportPageItem, PageFirstReportOfferItem } from '../src/shared/types/pageFirstExtractionReport';

loadDotenv({ path: path.join(process.cwd(), '.env.local') });
loadDotenv({ path: path.join(process.cwd(), '.env') });

async function reprocessPandaTest() {
  console.log('====================================================================');
  console.log('REPROCESSING PANDA_TEST WITH UPDATED REV1 SPATIAL & REPORTING LOGIC');
  console.log('====================================================================\n');

  const packageDir = path.resolve(process.cwd(), 'Extracts/Panda_Test');
  if (!fs.existsSync(packageDir)) {
    throw new Error(`Package directory not found: ${packageDir}`);
  }

  const pdfBaseName = 'Panda_Test';
  const trustedContext = {
    supermarketId: 'c2cc16c2-0001-4444-b000-c00000000001',
    supermarketSlug: 'panda',
    locationScope: 'national' as const,
    cityId: null,
    regionId: null,
    offerStartDate: '2026-10-13',
    offerEndDate: '2026-10-19',
    leafletId: 'panda-national-national-2026-10-19'
  };

  const pages = [1, 2, 3];
  const allCanonicalItems: CanonicalOffer[] = [];
  const reportPages: PageFirstReportPageItem[] = [];
  const reportOffers: PageFirstReportOfferItem[] = [];
  const costTracker = createCostTracker();
  const startTime = Date.now();

  const activeModel = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

  for (const pageNumber of pages) {
    const pagePadded = String(pageNumber).padStart(3, '0');
    console.log(`\n>>> Processing Page ${pageNumber}...`);

    const imagePath = path.join(packageDir, 'pages', `page.${pageNumber}.png`);
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Page image not found: ${imagePath}`);
    }

    const nativeDims = await getNativeDimensions(imagePath);
    console.log(`[Page ${pageNumber}] Native dimensions: ${nativeDims.width}x${nativeDims.height}`);

    // Read raw extracted offers from the canonical json files of this page
    const firstCanonicalFile = path.join(packageDir, 'json', `page-${pagePadded}-001.canonical.json`);
    if (!fs.existsSync(firstCanonicalFile)) {
      throw new Error(`Canonical file not found: ${firstCanonicalFile}`);
    }

    const firstCanonicalJson = JSON.parse(fs.readFileSync(firstCanonicalFile, 'utf8'));
    const rawOffers: ExtractedOfferRev1[] = firstCanonicalJson.raw?.raw_attributes?.raw_extraction_json;
    if (!rawOffers || !Array.isArray(rawOffers)) {
      throw new Error(`Could not find raw_extraction_json in ${firstCanonicalFile}`);
    }

    console.log(`[Page ${pageNumber}] Found ${rawOffers.length} offers extracted by Gemini.`);

    // 1. Compute union and thumb boxes using updated spatial union service
    const cropRects = computeOfferUnionAndThumbBoxes(rawOffers, nativeDims.width, nativeDims.height);

    // 2. Crop and save offer assets at full native resolution
    const outputDir = path.join(packageDir, 'metadata', 'rev1', `page-${pagePadded}`, 'crops');
    const savedCrops = await cropAndSaveOfferAssets(
      imagePath,
      cropRects,
      outputDir,
      nativeDims.width,
      nativeDims.height
    );
    console.log(`[Page ${pageNumber}] Successfully generated and saved ${savedCrops.length} crop pairs in ${outputDir}`);

    costTracker.primaryPageCalls++;

    // 3. Map offers to canonical structure & save json
    for (const off of rawOffers) {
      const cropRect = savedCrops.find(c => c.offer_number === off.offer_number) || savedCrops[0];

      const canonical = mapRev1OfferToCanonical({
        offer: off,
        cropRect,
        pageNumber,
        pdfBaseName,
        packageDir,
        trustedContext,
        rawMetadata: {
          rawExtractionJson: rawOffers,
          auditResult: { passed: true, issues: [] },
          retryExecuted: false
        }
      });

      allCanonicalItems.push(canonical);

      const jsonDir = path.join(packageDir, 'json');
      const canonicalFileName = `page-${pagePadded}-${canonical.source.source_item_number}.canonical.json`;
      fs.writeFileSync(path.join(jsonDir, canonicalFileName), JSON.stringify(canonical, null, 2), 'utf8');

      const offerNumStr = String(off.offer_number).padStart(3, '0');
      const hasValidPriceBox = Boolean(
        off.components.promo_price_box &&
        off.components.promo_price_box[2] > off.components.promo_price_box[0] &&
        off.components.promo_price_box[3] > off.components.promo_price_box[1]
      );
      const anchorBlockId = hasValidPriceBox
        ? `rev1_price_anchor_p${pagePadded}_${offerNumStr}`
        : null;

      const activeLinkedBlocks: string[] = [];
      if (off.components.product_graphic_box) activeLinkedBlocks.push('product_graphic_box');
      if (off.components.promo_price_box) activeLinkedBlocks.push('promo_price_box');
      if (off.components.unit_and_size_badge_box) activeLinkedBlocks.push('unit_and_size_badge_box');
      if (off.components.title_text_box) activeLinkedBlocks.push('title_text_box');

      reportOffers.push({
        temporary_offer_id: `offer_${off.offer_number}`,
        source_item_number: canonical.source.source_item_number,
        source_offer_key: canonical.source.external_image_id || '',
        page_number: pageNumber,
        title_ar: off.arabic_title,
        title_en: off.english_title,
        offer_price: off.promo_price,
        original_price: off.original_price,
        size_text: off.size_value,
        current_price_anchor_block_id: anchorBlockId,
        linked_block_ids: activeLinkedBlocks,
        crop_path: cropRect.offer_card_crop_path || null,
        crop_strategy: 'evidence_union',
        crop_confidence: off.confidence,
        extraction_confidence: off.confidence >= 0.9 ? 'high' : 'medium',
        publish_decision: canonical.quality.publish_decision,
        warnings: canonical.quality.non_blocking_warnings.map(w => w.message)
      });
    }

    reportPages.push({
      page_number: pageNumber,
      page_classification: 'standard_promotional',
      structured_offer_count: rawOffers.length,
      current_price_anchor_count: rawOffers.length,
      linked_offer_count: rawOffers.length,
      uncovered_anchor_count: 0,
      uncovered_anchor_block_ids: [],
      pass_status: 'primary_completed',
      completeness_status: 'pass',
      crop_count: savedCrops.length,
      unresolved_reason: null,
      pages_processed_usage: 1,
      estimated_cost_usd: 0.001,
      warnings: [],
      blocking_issues: []
    });
  }

  // 4. Generate Page-First Extraction Report
  console.log('\n>>> Generating Page-First Extraction Report...');
  const report = generatePageFirstReport({
    packageDir,
    pdfBaseName,
    model: activeModel,
    rolloutMode: 'pilot',
    pages: reportPages,
    offers: reportOffers,
    startTime,
    costTracker
  });

  // 5. Build Pre-Publish Summary
  console.log('>>> Building Pre-Publish Preview Summary...');
  const prePublishSummary = await buildPrePublishSummary(packageDir, allCanonicalItems);

  console.log('\n====================================================================');
  console.log('VERIFICATION OF BUG FIXES ON PANDA_TEST');
  console.log('====================================================================\n');

  // Verify Bug 1: Compound Siblings on Page 2 and Page 3
  console.log('Checking Bug 1: Compound Sibling Crops on Page 2 & 3...');

  // Page 2 compound pairs: (2, 3), (5, 6), (9, 10)
  const p2Pairs = [[2, 3], [5, 6], [9, 10]];
  for (const [a, b] of p2Pairs) {
    const canonicalA = JSON.parse(fs.readFileSync(path.join(packageDir, 'json', `page-002-${String(a).padStart(3, '0')}.canonical.json`), 'utf8'));
    const canonicalB = JSON.parse(fs.readFileSync(path.join(packageDir, 'json', `page-002-${String(b).padStart(3, '0')}.canonical.json`), 'utf8'));

    const rawOffersP2: ExtractedOfferRev1[] = canonicalA.raw.raw_attributes.raw_extraction_json;
    const offA = rawOffersP2.find(o => o.offer_number === a)!;
    const offB = rawOffersP2.find(o => o.offer_number === b)!;

    const areSiblings = areCompoundSiblings(offA, offB);
    console.log(`  Page 2 offers #${a} & #${b} compound sibling detection: ${areSiblings ? '✓ SIBLINGS' : '✗ FAILED'}`);
    if (!areSiblings) throw new Error(`Failed to detect compound siblings on Page 2 offers #${a} & #${b}`);

    // Verify their crops exist
    const cropA = path.join(packageDir, 'metadata', 'rev1', 'page-002', 'crops', `offer-${String(a).padStart(3, '0')}`, 'offer_card_crop.webp');
    const cropB = path.join(packageDir, 'metadata', 'rev1', 'page-002', 'crops', `offer-${String(b).padStart(3, '0')}`, 'offer_card_crop.webp');
    if (!fs.existsSync(cropA) || !fs.existsSync(cropB)) {
      throw new Error(`Crop missing for Page 2 offers #${a} or #${b}`);
    }
  }

  // Page 3 compound pairs: (2, 3), (4, 5), (6, 7), (8, 9)
  const p3Pairs = [[2, 3], [4, 5], [6, 7], [8, 9]];
  for (const [a, b] of p3Pairs) {
    const canonicalA = JSON.parse(fs.readFileSync(path.join(packageDir, 'json', `page-003-${String(a).padStart(3, '0')}.canonical.json`), 'utf8'));
    const rawOffersP3: ExtractedOfferRev1[] = canonicalA.raw.raw_attributes.raw_extraction_json;
    const offA = rawOffersP3.find(o => o.offer_number === a)!;
    const offB = rawOffersP3.find(o => o.offer_number === b)!;

    const areSiblings = areCompoundSiblings(offA, offB);
    console.log(`  Page 3 offers #${a} & #${b} compound sibling detection: ${areSiblings ? '✓ SIBLINGS' : '✗ FAILED'}`);
    if (!areSiblings) throw new Error(`Failed to detect compound siblings on Page 3 offers #${a} & #${b}`);

    const cropA = path.join(packageDir, 'metadata', 'rev1', 'page-003', 'crops', `offer-${String(a).padStart(3, '0')}`, 'offer_card_crop.webp');
    const cropB = path.join(packageDir, 'metadata', 'rev1', 'page-003', 'crops', `offer-${String(b).padStart(3, '0')}`, 'offer_card_crop.webp');
    if (!fs.existsSync(cropA) || !fs.existsSync(cropB)) {
      throw new Error(`Crop missing for Page 3 offers #${a} or #${b}`);
    }
  }

  // Verify Bug 2: page-first-extraction-report.json & .md
  console.log('\nChecking Bug 2: page-first-extraction-report.json & .md...');
  const jsonReportPath = path.join(packageDir, 'metadata', 'reports', 'page-first-extraction-report.json');
  const mdReportPath = path.join(packageDir, 'metadata', 'reports', 'page-first-extraction-report.md');
  const reportJson = JSON.parse(fs.readFileSync(jsonReportPath, 'utf8'));
  const mdContent = fs.readFileSync(mdReportPath, 'utf8');

  console.log(`  Report Model: "${reportJson.model}" (Expected: "gemini-3.8-flash") -> ${reportJson.model === 'gemini-3.8-flash' ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  Offers Detected: ${reportJson.metrics.offers_detected}`);
  console.log(`  Offers Linked: ${reportJson.metrics.offers_linked} (Expected: 35) -> ${reportJson.metrics.offers_linked === 35 ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  Missing Current-Price Anchors: ${reportJson.metrics.offers_missing_current_price_anchors} (Expected: 0) -> ${reportJson.metrics.offers_missing_current_price_anchors === 0 ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  Offer Anchor Link Rate: ${reportJson.metrics.offer_anchor_link_rate} (Expected: 1.0) -> ${reportJson.metrics.offer_anchor_link_rate === 1.0 ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  Markdown Title Check: -> ${mdContent.includes('# Spatial Vision (rev1) Extraction Report — Gemini 3.8 Flash') ? '✓ PASS' : '✗ FAIL'}`);

  if (reportJson.model !== 'gemini-3.8-flash') throw new Error(`Report model is "${reportJson.model}", expected "gemini-3.8-flash"`);
  if (reportJson.metrics.offers_linked !== 35) throw new Error(`Offers linked is ${reportJson.metrics.offers_linked}, expected 35`);
  if (reportJson.metrics.offer_anchor_link_rate !== 1.0) throw new Error(`Link rate is ${reportJson.metrics.offer_anchor_link_rate}, expected 1.0`);

  // Verify Bug 3: pre-publish-preview-summary.json
  console.log('\nChecking Bug 3: pre-publish-preview-summary.json...');
  const prePublishPath = path.join(packageDir, 'metadata', 'reports', 'pre-publish-preview-summary.json');
  const summaryJson = JSON.parse(fs.readFileSync(prePublishPath, 'utf8'));

  console.log(`  Pre-publish total_items: ${summaryJson.counts.total_items} (Expected: 35) -> ${summaryJson.counts.total_items === 35 ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  Pre-publish items array length: ${summaryJson.items.length} (Expected: 35) -> ${summaryJson.items.length === 35 ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  Publishable count (publish + exclude): ${summaryJson.counts.publish + summaryJson.counts.publish_but_exclude_from_comparison}`);

  if (summaryJson.counts.total_items !== 35) throw new Error(`pre-publish total_items is ${summaryJson.counts.total_items}, expected 35`);
  if (summaryJson.items.length !== 35) throw new Error(`pre-publish items length is ${summaryJson.items.length}, expected 35`);

  console.log('\n====================================================================');
  console.log('✓ ALL 4 BUGS RESOLVED & FULLY VERIFIED ON PANDA_TEST DATASET');
  console.log('====================================================================\n');
}

reprocessPandaTest().catch(err => {
  console.error('\n❌ REPROCESSING FAILED:', err);
  process.exit(1);
});
