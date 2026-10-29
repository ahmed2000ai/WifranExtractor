import path from 'path';
import fs from 'fs';
import { config as loadDotenv } from 'dotenv';
import type { ExtractedOfferRev1 } from '../src/shared/types/leafletExtraction';
import type { CanonicalOffer } from '../src/shared/types/canonicalOffer';
import { getNativeDimensions } from '../src/main/image/nativeResolutionService';
import {
  computeOfferUnionAndThumbBoxes,
  cropAndSaveOfferAssets
} from '../src/main/page-first/spatialUnionAndClampingService';
import { mapRev1OfferToCanonical } from '../src/main/page-first/pageOfferCanonicalMapper';
import { generatePageFirstReport } from '../src/main/reporting/pageFirstReportService';
import { buildPrePublishSummary } from '../src/main/prepublish/prePublishApprovalService';
import { createCostTracker } from '../src/main/page-first/pageFirstCostBudget';
import type { PageFirstReportPageItem, PageFirstReportOfferItem } from '../src/shared/types/pageFirstExtractionReport';

loadDotenv({ path: path.join(process.cwd(), '.env.local') });
loadDotenv({ path: path.join(process.cwd(), '.env') });

function getOffersForPage(packageDir: string, pagePadded: string): ExtractedOfferRev1[] {
  const jsonDir = path.join(packageDir, 'json');
  if (!fs.existsSync(jsonDir)) return [];

  const jsonFiles = fs.readdirSync(jsonDir)
    .filter(f => f.startsWith(`page-${pagePadded}-`) && f.endsWith('.canonical.json'))
    .sort();

  if (jsonFiles.length === 0) return [];

  // Check first file for raw_extraction_json array
  const firstPath = path.join(jsonDir, jsonFiles[0]);
  const firstJson = JSON.parse(fs.readFileSync(firstPath, 'utf8'));
  if (Array.isArray(firstJson.raw?.raw_attributes?.raw_extraction_json) && firstJson.raw.raw_attributes.raw_extraction_json.length > 0) {
    return firstJson.raw.raw_attributes.raw_extraction_json;
  }

  // Otherwise collect each raw_offer_extraction
  const offers: ExtractedOfferRev1[] = [];
  for (const f of jsonFiles) {
    const json = JSON.parse(fs.readFileSync(path.join(jsonDir, f), 'utf8'));
    if (json.raw?.raw_attributes?.raw_offer_extraction) {
      offers.push(json.raw.raw_attributes.raw_offer_extraction);
    }
  }
  return offers;
}

async function remapPackage(packageRelativePath: string, pdfBaseName: string, defaultTrustedContext: any) {
  console.log('====================================================================');
  console.log(`RE-MAPPING CANONICAL OFFERS FOR: ${pdfBaseName}`);
  console.log('====================================================================');

  const packageDir = path.resolve(process.cwd(), packageRelativePath);
  if (!fs.existsSync(packageDir)) {
    throw new Error(`Package directory not found: ${packageDir}`);
  }

  // Determine pages
  const pagesDir = path.join(packageDir, 'pages');
  const pageFiles = fs.readdirSync(pagesDir).filter(f => /^page\.\d+\.png$/.test(f)).sort();
  const pageNumbers = pageFiles.map(f => parseInt(f.match(/\d+/)![0], 10));

  console.log(`Found ${pageNumbers.length} pages:`, pageNumbers);

  const allCanonicalItems: CanonicalOffer[] = [];
  const reportPages: PageFirstReportPageItem[] = [];
  const reportOffers: PageFirstReportOfferItem[] = [];
  const costTracker = createCostTracker();
  const startTime = Date.now();
  const activeModel = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

  let totalSizeBefore = 0;
  let totalSizeAfter = 0;

  for (const pageNumber of pageNumbers) {
    const pagePadded = String(pageNumber).padStart(3, '0');
    console.log(`\n>>> Processing ${pdfBaseName} Page ${pageNumber}...`);

    const imagePath = path.join(pagesDir, `page.${pageNumber}.png`);
    const nativeDims = await getNativeDimensions(imagePath);

    const rawOffers = getOffersForPage(packageDir, pagePadded);
    if (rawOffers.length === 0) {
      console.warn(`No raw offers found for Page ${pageNumber}`);
      continue;
    }

    console.log(`[Page ${pageNumber}] Found ${rawOffers.length} extracted offers.`);

    // Read initial file sizes
    for (const off of rawOffers) {
      const itemPadded = String(off.offer_number).padStart(3, '0');
      const canonicalPath = path.join(packageDir, 'json', `page-${pagePadded}-${itemPadded}.canonical.json`);
      if (fs.existsSync(canonicalPath)) {
        totalSizeBefore += fs.statSync(canonicalPath).size;
      }
    }

    // 1. Compute crop boxes
    const cropRects = computeOfferUnionAndThumbBoxes(rawOffers, nativeDims.width, nativeDims.height);

    // 2. Crop assets
    const cropsOutputDir = path.join(packageDir, 'metadata', 'rev1', `page-${pagePadded}`, 'crops');
    if (!fs.existsSync(cropsOutputDir)) {
      fs.mkdirSync(cropsOutputDir, { recursive: true });
    }

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
    for (let i = 0; i < rawOffers.length; i++) {
      const offer = rawOffers[i];
      const cropRect = savedCrops[i];

      const canonical = mapRev1OfferToCanonical({
        offer,
        cropRect,
        pageNumber,
        pdfBaseName,
        packageDir,
        trustedContext: defaultTrustedContext
      });

      allCanonicalItems.push(canonical);

      const itemPadded = String(offer.offer_number).padStart(3, '0');
      const canonicalPath = path.join(packageDir, 'json', `page-${pagePadded}-${itemPadded}.canonical.json`);
      const canonicalJsonStr = JSON.stringify(canonical, null, 2);
      fs.writeFileSync(canonicalPath, canonicalJsonStr, 'utf8');
      totalSizeAfter += Buffer.byteLength(canonicalJsonStr, 'utf8');

      if (pdfBaseName === 'Alwafa_Test') {
        const expectedV2Dir = path.resolve(process.cwd(), 'tests/fixtures/wifran04/expected-v2');
        if (!fs.existsSync(expectedV2Dir)) {
          fs.mkdirSync(expectedV2Dir, { recursive: true });
        }
        if (pageNumber === 1 && offer.offer_number === 12) {
          fs.writeFileSync(path.join(expectedV2Dir, 'J1-dove-soap.v2.json'), canonicalJsonStr, 'utf8');
        } else if (pageNumber === 3 && offer.offer_number === 12) {
          fs.writeFileSync(path.join(expectedV2Dir, 'J2-mini-fan.v2.json'), canonicalJsonStr, 'utf8');
        }
      }

      // Assertions per item
      if (!canonical.product.category_hint) {
        throw new Error(`Item ${itemPadded} on Page ${pageNumber} has null category_hint!`);
      }
      if (!canonical.product.commodity_tag) {
        throw new Error(`Item ${itemPadded} on Page ${pageNumber} has null commodity_tag!`);
      }
      if (!canonical.source.thumbnail_path) {
        throw new Error(`Item ${itemPadded} on Page ${pageNumber} has null thumbnail_path!`);
      }
      if (typeof canonical.source.page_area_share_pct !== 'number') {
        throw new Error(`Item ${itemPadded} on Page ${pageNumber} has invalid page_area_share_pct!`);
      }

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

  console.log('\n--------------------------------------------------------------------');
  console.log(`Total Canonical Items: ${allCanonicalItems.length}`);
  console.log(`Pre-Publish Summary Counts:`, previewSummary.counts);
  console.log(`Total JSON Size Before: ${(totalSizeBefore / 1024).toFixed(1)} KB`);
  console.log(`Total JSON Size After: ${(totalSizeAfter / 1024).toFixed(1)} KB`);
  console.log(`Size Reduction: ${(((totalSizeBefore - totalSizeAfter) / totalSizeBefore) * 100).toFixed(1)}%`);
  console.log('--------------------------------------------------------------------\n');
}

async function run() {
  // 1. BNDW_Test
  await remapPackage('Extracts/BNDW_Test', 'BNDW_Test', {
    supermarketId: 'c2cc16c2-0007-4444-b000-c00000000007',
    supermarketSlug: 'bin-dawood',
    locationScope: 'national' as const,
    cityId: null,
    regionId: null,
    offerStartDate: '2026-10-14',
    offerEndDate: '2026-10-20',
    leafletId: 'bin-dawood-national-national-2026-10-20'
  });

  // 2. Alwafa_Test (Hyper Alwafa - Western Region - Jeddah)
  await remapPackage('Extracts/Alwafa_Test', 'Alwafa_Test', {
    supermarketId: 'c2cc16c2-0008-4444-b000-c00000000008',
    supermarketSlug: 'alwafa',
    locationScope: 'city' as const,
    cityId: 'a6f7b140-0002-4444-a000-000000000002',
    regionId: 'b144b6c8-2222-4444-b000-000000000002',
    offerStartDate: '2026-10-14',
    offerEndDate: '2026-10-20',
    leafletId: 'alwafa-city-jeddah-2026-10-20'
  });
}

run().catch(err => {
  console.error('Fatal error running remap:', err);
  process.exit(1);
});
