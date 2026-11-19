import { readFileSync, existsSync } from 'fs';
import { renderVisualCropsForPage } from './render_visual_crops';

async function testCropRenderer() {
  console.log('Testing visual crop rendering on GOLDEN-P1 verified reference...');
  const refPath = 'test-fixtures/page1_golden_verified_reference.json';
  const imgPath = 'test-fixtures/page1_small.png';
  const refData = JSON.parse(readFileSync(refPath, 'utf8'));

  const result = await renderVisualCropsForPage(
    imgPath,
    refData.offers,
    'temp/benchmark_runs/OPT-004C/test_golden_crops',
    'ref_offer'
  );

  console.log('Result annotated image:', result.annotatedPageImagePath);
  console.log('Rendered offers count:', result.offerCrops.length);
  console.log('Flags detected:', result.allFlags);
  process.exit(0);
}

testCropRenderer().catch(err => {
  console.error('Renderer test error:', err);
  process.exit(1);
});

