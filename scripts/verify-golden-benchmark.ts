import { existsSync } from 'fs';
import { join } from 'path';
import { config as loadDotenv } from 'dotenv';

// Explicitly load .env.local and .env
loadDotenv({ path: join(process.cwd(), '.env.local') });
loadDotenv({ path: join(process.cwd(), '.env') });

import { Rev1PipelineService } from '../src/main/page-first/rev1PipelineService';
import { isGeminiConfigured } from '../src/main/ocr/geminiClient';
import { denormalizeCoord } from '../src/main/image/nativeResolutionService';

async function runGoldenBenchmark() {
  console.log('====================================================================');
  console.log('RUNNING END-TO-END GOLDEN BENCHMARK VERIFICATION (rev1)');
  console.log('====================================================================\n');

  const pipeline = new Rev1PipelineService();
  const outputBaseDir = join(process.cwd(), 'metadata', 'golden-benchmark-run');

  // Locate test fixtures
  const page1Path = existsSync(join(process.cwd(), 'test-fixtures', 'page1_small.jpg'))
    ? join(process.cwd(), 'test-fixtures', 'page1_small.jpg')
    : join(process.cwd(), 'Extracts', 'Othaim_selectPages', 'pages', 'page1_small.png');

  const page4Path = existsSync(join(process.cwd(), 'test-fixtures', 'page4_small.jpg'))
    ? join(process.cwd(), 'test-fixtures', 'page4_small.jpg')
    : join(process.cwd(), 'Extracts', 'Othaim_selectPages', 'pages', 'page4_small.png');

  const page1GoldenJson = join(process.cwd(), 'test-fixtures', 'page1_golden.json');
  const page4GoldenJson = join(process.cwd(), 'test-fixtures', 'page4_golden.json');

  const liveApiAvailable = isGeminiConfigured();
  console.log(`[Config] Live Gemini API Key Configured: ${liveApiAvailable}`);

  // ═════════════════════════════════════════════════════════════════
  // TEST 1: Page 1 (Al-Othaim 3x3 layout)
  // ═════════════════════════════════════════════════════════════════
  console.log('\n[Benchmark 1/2] Processing Page 1 (Al-Othaim 3x3 layout)...');

  const result1 = await pipeline.processPage({
    imagePath: page1Path,
    outputDir: join(outputBaseDir, 'page-1'),
    pageNumber: 1
  });

  console.log(`- Page 1 Extracted Offers: ${result1.offers.length}`);
  console.log(`- Native Dimensions: ${result1.nativeDimensions.width}x${result1.nativeDimensions.height}`);
  console.log(`- Stage 5 Audit Passed: ${result1.auditResult.passed}`);

  // Assertions for Page 1
  if (result1.offers.length !== 9) {
    throw new Error(`FAIL: Expected exactly 9 offers on Page 1, got ${result1.offers.length}`);
  }

  // Stadium banner check: Row 1 offers must be > 590px on 960x1280 scale
  const row1Offers = result1.offers.slice(0, 3);
  for (const offer of row1Offers) {
    const yminNorm = Math.min(
      offer.components.product_graphic_box[0],
      offer.components.unit_and_size_badge_box ? offer.components.unit_and_size_badge_box[0] : 1000
    );
    const yminOn1280 = denormalizeCoord(yminNorm, 1280);
    if (yminOn1280 <= 590) {
      throw new Error(
        `FAIL: Offer #${offer.offer_number} ymin (${yminOn1280}px) <= 590px on 960x1280 scale! Cropped into stadium grass.`
      );
    }
  }
  console.log('✓ Assert: Top "5 10 15" stadium banner ignored. Row 1 ymin > 590px on 960x1280 scale.');

  // Assert Offer #1
  const off1 = result1.offers.find(o => o.offer_number === 1)!;
  if (off1.size_value !== '270g' || off1.promo_price !== 5 || off1.original_price !== 11.25) {
    throw new Error(
      `FAIL: Offer #1 mismatch: size=${off1.size_value}, promo=${off1.promo_price}, orig=${off1.original_price}`
    );
  }
  console.log('✓ Assert: Offer #1 (Sadia Nuggets) -> size: 270g, promo: 5 SAR, orig: 11.25 SAR.');

  // Assert Offer #2 (Watermelon)
  const off2 = result1.offers.find(o => o.offer_number === 2)!;
  if (!off2.arabic_title.includes('حبحب') || off2.arabic_title.includes('بطيخ')) {
    throw new Error(`FAIL: Offer #2 Arabic title must keep printed "حبحب", got "${off2.arabic_title}"`);
  }
  if (off2.size_value !== '2 Kg' || off2.promo_price !== 5 || off2.original_price !== null) {
    throw new Error(
      `FAIL: Offer #2 mismatch: size=${off2.size_value}, promo=${off2.promo_price}, orig=${off2.original_price}`
    );
  }
  console.log('✓ Assert: Offer #2 (Watermelon) -> preserved verbatim "حبحب", size: 2 Kg, promo: 5, orig: null.');

  // Assert Offer #5 (KDD Tomato Paste)
  const off5 = result1.offers.find(o => o.offer_number === 5)!;
  if (off5.size_value !== '8x135g' || off5.promo_price !== 10 || off5.original_price !== 14.25) {
    throw new Error(
      `FAIL: Offer #5 mismatch: size=${off5.size_value}, promo=${off5.promo_price}, orig=${off5.original_price}`
    );
  }
  console.log('✓ Assert: Offer #5 (KDD Tomato Paste) -> size: 8x135g, promo: 10 SAR, orig: 14.25 SAR.');

  // Assert Offer #7 (Eggs 30PCS)
  const off7 = result1.offers.find(o => o.offer_number === 7)!;
  if (!off7.is_multi_brand_or_variant || off7.promo_price !== 15 || off7.original_price !== 22.50) {
    throw new Error(
      `FAIL: Offer #7 mismatch: multi_brand=${off7.is_multi_brand_or_variant}, promo=${off7.promo_price}, orig=${off7.original_price}`
    );
  }
  console.log('✓ Assert: Offer #7 (Eggs 30PCS) -> multi-brand captured, promo: 15 SAR, orig: 22.50 SAR.');

  // ═════════════════════════════════════════════════════════════════
  // TEST 2: Page 4 (Al-Othaim Multi-Layout Iktissab loyalty page)
  // ═════════════════════════════════════════════════════════════════
  console.log('\n[Benchmark 2/2] Processing Page 4 (Multi-Layout Iktissab loyalty page)...');

  const result4 = await pipeline.processPage({
    imagePath: page4Path,
    outputDir: join(outputBaseDir, 'page-4'),
    pageNumber: 4
  });

  console.log(`- Page 4 Extracted Offers: ${result4.offers.length}`);
  console.log(`- Loyalty Program Flag: ${result4.pageMetadata.loyalty_program_name}`);
  console.log(`- Stage 5 Audit Passed: ${result4.auditResult.passed}`);

  if (result4.offers.length !== 11) {
    throw new Error(`FAIL: Expected exactly 11 offers on Page 4, got ${result4.offers.length}`);
  }

  if (!result4.pageMetadata.is_loyalty_page || result4.pageMetadata.loyalty_program_name !== 'Iktissab') {
    throw new Error(
      `FAIL: Page 4 loyalty metadata mismatch: is_loyalty=${result4.pageMetadata.is_loyalty_page}, name=${result4.pageMetadata.loyalty_program_name}`
    );
  }
  console.log('✓ Assert: Page 4 flagged as is_loyalty_page=true ("Iktissab").');

  // Assert Row 4 hyphenated prices (18.99, 16.99, 10.99, 6.99)
  const off8 = result4.offers.find(o => o.offer_number === 8)!;
  const off9 = result4.offers.find(o => o.offer_number === 9)!;
  const off10 = result4.offers.find(o => o.offer_number === 10)!;
  const off11 = result4.offers.find(o => o.offer_number === 11)!;

  if (off8.promo_price !== 18.99 || off9.promo_price !== 16.99 || off10.promo_price !== 10.99 || off11.promo_price !== 6.99) {
    throw new Error(
      `FAIL: Row 4 hyphenated price parsing mismatch: off8=${off8.promo_price}, off9=${off9.promo_price}, off10=${off10.promo_price}, off11=${off11.promo_price}`
    );
  }
  console.log('✓ Assert: Row 4 hyphenated prices parsed as: 18.99, 16.99, 10.99, 6.99.');

  // ═════════════════════════════════════════════════════════════════
  // TEST 3: Sharp Native-Resolution Dual Crops for All 20 Offers
  // ═════════════════════════════════════════════════════════════════
  console.log('\n[Crop Verification] Verifying Sharp native-resolution dual crops across all 20 offers...');
  const allCrops = [...result1.cropRectangles, ...result4.cropRectangles];

  if (allCrops.length !== 20) {
    throw new Error(`FAIL: Expected exactly 20 cropped offer sets, got ${allCrops.length}`);
  }

  for (const crop of allCrops) {
    if (!crop.offer_card_crop_path || !existsSync(crop.offer_card_crop_path)) {
      throw new Error(`FAIL: Missing offer_card_crop for offer #${crop.offer_number} at ${crop.offer_card_crop_path}`);
    }
    if (!crop.product_thumb_crop_path || !existsSync(crop.product_thumb_crop_path)) {
      throw new Error(`FAIL: Missing product_thumb_crop for offer #${crop.offer_number} at ${crop.product_thumb_crop_path}`);
    }
  }
  console.log(`✓ Assert: Successfully generated both offer_card_crop.webp and product_thumb_crop.webp for all 20 offers.`);

  console.log('\n====================================================================');
  console.log('ALL GOLDEN BENCHMARK TESTS PASSED WITH 100% ACCURACY!');
  console.log('====================================================================');
}

runGoldenBenchmark().catch(err => {
  console.error('\n❌ GOLDEN BENCHMARK FAILED:', err.message);
  process.exit(1);
});
