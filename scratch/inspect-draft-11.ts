import fs from 'fs';
import path from 'path';

const draftPath = path.resolve('Extracts/alnokhbah-markets-1/staged-draft.json');
const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));

const targetIds = [
  'leaflet-001_p001_010',
  'leaflet-001_p001_014',
  'leaflet-001_p001_015',
  'leaflet-001_p018_010__tier_1',
  'leaflet-001_p018_010__tier_2',
  'leaflet-001_p018_011__tier_1',
  'leaflet-001_p018_011__tier_2',
  'leaflet-001_p018_012__tier_1',
  'leaflet-001_p018_012__tier_2',
  'leaflet-001_p018_013__tier_1',
  'leaflet-001_p018_013__tier_2'
];

console.log('--- ACTUAL STAGED DRAFT DATA FOR 11 OFFERS ---');
for (const id of targetIds) {
  const item = draft.items.find((i: any) => i.id === id);
  if (!item) {
    console.log(`NOT FOUND: ${id}`);
    continue;
  }
  console.log('--------------------------------------------------');
  console.log(`ID: ${item.id}`);
  console.log(`Page: ${item.pageNumber}`);
  console.log(`Title EN: "${item.titleEn}"`);
  console.log(`Title AR: "${item.titleAr}"`);
  console.log(`Brand Candidate: "${item.brandCandidateText}"`);
  console.log(`Price: ${item.offerPrice} (was ${item.originalPrice})`);
  console.log(`Size/Unit: ${item.eachSizeValue} ${item.eachSizeUnit} (${item.saleUnitType})`);
  console.log(`Publication State:`, item.publicationState);
  console.log(`productThumbLocalPath:`, item.productThumbLocalPath);
  console.log(`croppedEvidenceLocalPath:`, item.croppedEvidenceLocalPath);
  console.log(`customProductThumbCropPath:`, item.customProductThumbCropPath);
  console.log(`offerCardCropPath:`, item.offerCardCropPath);
}
