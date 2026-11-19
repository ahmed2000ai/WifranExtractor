import fs from 'fs';

const p1 = JSON.parse(fs.readFileSync('Extracts/alnokhbah-markets-1/hybrid_v3_results/page_1.v3.json', 'utf8'));
const p18 = JSON.parse(fs.readFileSync('Extracts/alnokhbah-markets-1/hybrid_v3_results/page_18.v3.json', 'utf8'));

console.log('=== PAGE 1 RECONCILED CARDS ===');
for (const c of p1.pageResult.reconciledCards) {
  if (['leaflet-001_p001_010', 'leaflet-001_p001_014', 'leaflet-001_p001_015'].includes(c.sourceOfferId)) {
    console.log(JSON.stringify({
      sourceOfferId: c.sourceOfferId,
      titleEn: c.card?.titleEn || c.titleEn,
      titleAr: c.card?.titleAr || c.titleAr,
      brandName: c.card?.brandName || c.brandName,
      price: c.card?.price || c.price,
      size: c.card?.size || c.size,
      unit: c.card?.unit || c.unit,
      p0: c.p0,
      p1: c.p1,
      p2: c.p2,
      rawB1Card: c.rawB1Card
    }, null, 2));
  }
}

console.log('=== PAGE 18 RECONCILED CARDS ===');
for (const c of p18.pageResult.reconciledCards) {
  if (['leaflet-001_p018_010', 'leaflet-001_p018_011', 'leaflet-001_p018_012', 'leaflet-001_p018_013'].some(id => c.sourceOfferId?.includes(id))) {
    console.log(JSON.stringify({
      sourceOfferId: c.sourceOfferId,
      titleEn: c.card?.titleEn || c.titleEn,
      titleAr: c.card?.titleAr || c.titleAr,
      brandName: c.card?.brandName || c.brandName,
      price: c.card?.price || c.price,
      size: c.card?.size || c.size,
      unit: c.card?.unit || c.unit,
      tiers: c.tiers,
      p0: c.p0,
      p1: c.p1,
      p2: c.p2,
      rawB1Card: c.rawB1Card
    }, null, 2));
  }
}
