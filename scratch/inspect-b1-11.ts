import fs from 'fs';
import path from 'path';

const p1 = JSON.parse(fs.readFileSync('Extracts/alnokhbah-markets-1/hybrid_v3_results/page_1.v3.json', 'utf8'));
const p18 = JSON.parse(fs.readFileSync('Extracts/alnokhbah-markets-1/hybrid_v3_results/page_18.v3.json', 'utf8'));

console.log('=== PAGE 1 B1 EXTRACTION ===');
const p1TargetIds = ['ip001_010', 'ip001_014', 'ip001_015'];
for (const item of p1.items || []) {
  if (p1TargetIds.includes(item.item_id) || p1TargetIds.some(t => item.item_id?.includes(t))) {
    console.log(JSON.stringify({
      item_id: item.item_id,
      title_en: item.title_en,
      title_ar: item.title_ar,
      brand_name: item.brand_name,
      each_size_value: item.each_size_value,
      each_size_unit: item.each_size_unit,
      price: item.offer_price,
      original_price: item.original_price
    }, null, 2));
  }
}

console.log('=== PAGE 18 B1 EXTRACTION ===');
const p18TargetIds = ['ip018_010', 'ip018_011', 'ip018_012', 'ip018_013'];
for (const item of p18.items || []) {
  if (p18TargetIds.some(t => item.item_id?.includes(t))) {
    console.log(JSON.stringify({
      item_id: item.item_id,
      title_en: item.title_en,
      title_ar: item.title_ar,
      brand_name: item.brand_name,
      each_size_value: item.each_size_value,
      each_size_unit: item.each_size_unit,
      price: item.offer_price,
      original_price: item.original_price,
      tier_index: item.tier_index,
      tier_count: item.tier_count
    }, null, 2));
  }
}
