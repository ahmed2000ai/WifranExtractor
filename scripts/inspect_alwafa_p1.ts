import { readFileSync } from 'fs';

console.log('--- ALWAFA-P1 CANONICAL OFFERS ---');
for (let i = 1; i <= 13; i++) {
  const pad = i.toString().padStart(3, '0');
  const file = `Extracts/Alwafa_Test/json/page-001-${pad}.canonical.json`;
  const data = JSON.parse(readFileSync(file, 'utf8'));
  console.log(`Offer ${i}:`, {
    ar: data.product?.title_ar,
    en: data.product?.title_en,
    brand: data.product?.brand_text,
    price: data.prices?.offer_price,
    orig: data.prices?.original_price,
    size: data.content?.size_text
  });
}
process.exit(0);

