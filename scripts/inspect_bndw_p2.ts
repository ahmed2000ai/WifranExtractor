import { readFileSync } from 'fs';
import { join } from 'path';

console.log('--- BNDW-P2 CANONICAL OFFERS ---');
for (let i = 1; i <= 7; i++) {
  const file = `Extracts/BNDW_Test/json/page-002-00${i}.canonical.json`;
  const data = JSON.parse(readFileSync(file, 'utf8'));
  console.log(`Offer ${i}:`, {
    ar: data.product?.title_ar,
    en: data.product?.title_en,
    brand: data.product?.brand_text,
    price: data.prices?.offer_price,
    orig: data.prices?.original_price,
    size: data.content?.size_text,
    unit: data.content?.each_size_unit
  });
}
process.exit(0);

