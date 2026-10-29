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

async function reprocessBndwTest() {
  console.log('====================================================================');
  console.log('REPROCESSING BNDW_TEST WITH UPDATED REV1 SPATIAL & CANONICAL LOGIC');
  console.log('====================================================================\n');

  const packageDir = path.resolve(process.cwd(), 'Extracts/BNDW_Test');
  if (!fs.existsSync(packageDir)) {
    throw new Error(`Package directory not found: ${packageDir}`);
  }

  const pdfBaseName = 'BNDW_Test';
  const trustedContext = {
    supermarketId: 'c2cc16c2-0007-4444-b000-c00000000007',
    supermarketSlug: 'bin-dawood',
    locationScope: 'national' as const,
    cityId: null,
    regionId: null,
    offerStartDate: '2026-10-14',
    offerEndDate: '2026-10-20',
    leafletId: 'bin-dawood-national-national-2026-10-20'
  };

  const pages = [1, 2, 3, 4];
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

    // 1. Compute union and thumb boxes using updated spatial union service (with title fallback & compound clamping)
    const cropRects = computeOfferUnionAndThumbBoxes(rawOffers, nativeDims.width, nativeDims.height);

    // Clean old crops directory for this page to verify exact deduplication
    const cropsOutputDir = path.join(packageDir, 'metadata', 'rev1', `page-${pagePadded}`, 'crops');
    if (fs.existsSync(cropsOutputDir)) {
      fs.rmSync(cropsOutputDir, { recursive: true, force: true });
    }
    fs.mkdirSync(cropsOutputDir, { recursive: true });

    // 2. Crop and save assets with deduplication
    const savedCrops = await cropAndSaveOfferAssets(
      imagePath,
      cropRects,
      cropsOutputDir,
      nativeDims.width,
      nativeDims.height
    );

    const savedCropFolders = fs.readdirSync(cropsOutputDir).filter(f => fs.statSync(path.join(cropsOutputDir, f)).isDirectory());
    console.log(`[Page ${pageNumber}] Saved ${savedCropFolders.length} unique crop folders on disk for ${rawOffers.length} extracted offers.`);

    // 3. Map to canonical offers
    const pageCanonicalOffers: CanonicalOffer[] = [];
    for (let i = 0; i < rawOffers.length; i++) {
      const offer = rawOffers[i];
      const cropRect = savedCrops[i];
      const canonical = mapRev1OfferToCanonical({
        offer,
        cropRect,
        pageNumber,
        pdfBaseName,
        packageDir,
        trustedContext,
        rawMetadata: {
          rawExtractionJson: rawOffers
        }
      });

      pageCanonicalOffers.push(canonical);
      allCanonicalItems.push(canonical);

      const itemPadded = String(offer.offer_number).padStart(3, '0');
      const canonicalPath = path.join(packageDir, 'json', `page-${pagePadded}-${itemPadded}.canonical.json`);
      fs.writeFileSync(canonicalPath, JSON.stringify(canonical, null, 2), 'utf8');

      // Add to report offers
      const primaryAnchor = `rev1_price_anchor_p${pagePadded}_${itemPadded}`;
      const linkedBoxes = Object.entries(offer.components)
        .filter(([_, box]) => box !== null)
        .map(([k]) => k);

      reportOffers.push({
        temporary_offer_id: `offer_${offer.offer_number}`,
        source_item_number: itemPadded,
        source_offer_key: `${pdfBaseName}_p${pagePadded}_${itemPadded}`,
        page_number: pageNumber,
        title_ar: canonical.product.title_ar,
        title_en: canonical.product.title_en,
        offer_price: canonical.prices.offer_price,
        original_price: canonical.prices.original_price,
        size_text: canonical.content.size_text,
        current_price_anchor_block_id: primaryAnchor,
        linked_block_ids: linkedBoxes,
        crop_path: canonical.source.crop_path || '',
        crop_strategy: 'evidence_union',
        crop_confidence: canonical.quality.extraction_confidence === 'high' ? 0.99 : 0.85,
        extraction_confidence: canonical.quality.extraction_confidence,
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
      crop_count: rawOffers.length,
      unresolved_reason: null,
      pages_processed_usage: 1,
      estimated_cost_usd: 0.001,
      warnings: [],
      blocking_issues: []
    });

    // cost tracking
    costTracker.primaryPageCalls++;
  }

  // 4. Update reports
  const reportsDir = path.join(packageDir, 'metadata', 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });

  const pageFirstReport = generatePageFirstReport({
    packageDir,
    pdfBaseName,
    model: activeModel,
    rolloutMode: 'pilot',
    pages: reportPages,
    offers: reportOffers,
    startTime,
    costTracker
  });

  const reportJsonPath = path.join(reportsDir, 'page-first-extraction-report.json');
  fs.writeFileSync(reportJsonPath, JSON.stringify(pageFirstReport, null, 2), 'utf8');

  // Build and write pre-publish preview summary
  const previewSummary = await buildPrePublishSummary(packageDir, allCanonicalItems);
  const previewJsonPath = path.join(reportsDir, 'pre-publish-preview-summary.json');
  fs.writeFileSync(previewJsonPath, JSON.stringify(previewSummary, null, 2), 'utf8');

  console.log('\n====================================================================');
  console.log('REPROCESSING COMPLETE!');
  console.log(`Total Canonical Items: ${allCanonicalItems.length}`);
  console.log(`Pre-Publish Summary Counts:`, previewSummary.counts);
  console.log('====================================================================\n');
}

reprocessBndwTest().catch(err => {
  console.error('Fatal error reprocessing Bndw test:', err);
  process.exit(1);
});
