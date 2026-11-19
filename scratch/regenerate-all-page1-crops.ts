import path from 'path';
import fs from 'fs';
import { generateOfferAndProductCrops } from '../src/main/ocr/hybrid/hybridCropGenerator';

async function main() {
  const projectRoot = 'f:/Work/AI Projects/wifran-offers-extractor';
  const v3Path = path.join(projectRoot, 'Extracts/alnokhbah-markets-1/hybrid_v3_results/page_1.v3.json');
  const v3 = JSON.parse(fs.readFileSync(v3Path, 'utf8'));
  const componentMap = v3.pageResult.componentBoxesBySourceOfferId || {};
  const pageImagePath = path.join(projectRoot, 'Extracts/alnokhbah-markets-1/pages/page.1.png');

  console.log(`Regenerating crops for ${Object.keys(componentMap).length} offers on Page 1...`);

  for (const [sourceOfferId, boxes] of Object.entries(componentMap)) {
    const outDir = path.join(projectRoot, 'Extracts/alnokhbah-markets-1/crops/page_1', sourceOfferId);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    const res = await generateOfferAndProductCrops({
      sourceOfferId,
      pageImagePath,
      outputDir: outDir,
      components: boxes as any
    });
    console.log(`  ${sourceOfferId}: productOnlyCrop valid=${res.productOnlyCrop?.geometryValid}, box=${JSON.stringify(res.productOnlyCrop?.rawUnionNormalizedBox)}`);
  }
  console.log('All Page 1 crops regenerated successfully.');
}

main().catch(console.error);
