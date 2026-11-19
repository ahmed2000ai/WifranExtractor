import path from 'path';
import { generateDerivedTierProductCropsFromGeometry } from '../src/main/ocr/hybrid/hybridCropGenerator';

async function main() {
  const workspacePath = path.resolve('Extracts/alnokhbah-markets-1');
  const targets = [
    { sourceOfferId: 'leaflet-001_p018_010__tier_1', parentCardId: 'leaflet-001_p018_010', tierIndex: 1 },
    { sourceOfferId: 'leaflet-001_p018_010__tier_2', parentCardId: 'leaflet-001_p018_010', tierIndex: 2 },
    { sourceOfferId: 'leaflet-001_p018_011__tier_1', parentCardId: 'leaflet-001_p018_011', tierIndex: 1 },
    { sourceOfferId: 'leaflet-001_p018_011__tier_2', parentCardId: 'leaflet-001_p018_011', tierIndex: 2 },
    { sourceOfferId: 'leaflet-001_p018_012__tier_1', parentCardId: 'leaflet-001_p018_012', tierIndex: 1 },
    { sourceOfferId: 'leaflet-001_p018_012__tier_2', parentCardId: 'leaflet-001_p018_012', tierIndex: 2 },
    { sourceOfferId: 'leaflet-001_p018_013__tier_1', parentCardId: 'leaflet-001_p018_013', tierIndex: 1 },
    { sourceOfferId: 'leaflet-001_p018_013__tier_2', parentCardId: 'leaflet-001_p018_013', tierIndex: 2 }
  ];

  const results = await generateDerivedTierProductCropsFromGeometry({
    workspacePath,
    pageNumber: 18,
    targets
  });
  console.log('Generated 8 derived rice tier crops:');
  for (const r of results) {
    console.log({
      sourceOfferId: r.sourceOfferId,
      tierIndex: r.tierIndex,
      sizeConfirmationStatus: r.sizeConfirmationStatus,
      priceBoxTrimmed: r.priceBoxTrimmed,
      pixelBox: r.pixelBox,
      outputPath: r.outputPath
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
