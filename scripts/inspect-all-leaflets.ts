import * as fs from 'fs';
import * as path from 'path';

const base = 'Extracts';
const dirs = fs.readdirSync(base);
console.log('=== INSPECTING ALL LEAFLET PACKAGES IN EXTRACTS ===');
for (const d of dirs) {
  const mPath = path.join(base, d, 'manifest.json');
  if (fs.existsSync(mPath)) {
    try {
      const m = JSON.parse(fs.readFileSync(mPath, 'utf8'));
      console.log(JSON.stringify({
        folder: d,
        pdf: m.pdf_file_name,
        supermarketId: m.supermarket?.id || null,
        supermarketCode: m.leaflet_filename_metadata?.supermarket_code || null,
        locationScope: m.location?.location_scope || null,
        valid_from: m.offer_dates?.valid_from || null,
        valid_to: m.offer_dates?.valid_to || null,
        extraction_status: m.extraction_status,
        db_status: m.db_update_status,
        page_count: m.page_count
      }));
    } catch (e: any) {
      console.log(d, 'ERROR:', e.message);
    }
  } else {
    console.log(d, 'NO manifest.json');
  }
}

