const fs = require('fs');
const path = require('path');

const dirs = [
  'Extracts/noori-supermarket-229798534-jeddah',
  'Extracts/dukan-849797163-jeddah',
  'Extracts/Alwafa_Test',
  'Extracts/PAND-JEDC-150726',
  'Extracts/OTHM-JEDC-150726',
  'Extracts/BNDW-JEDC-150726'
];

for (const d of dirs) {
  const full = path.resolve(process.cwd(), d);
  if (!fs.existsSync(full)) continue;
  
  // Look for staged-draft.json or raw_extracted or canonical
  const draftPath = path.join(full, 'staged-draft.json');
  if (fs.existsSync(draftPath)) {
    const data = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
    console.log(`\n=== ${d} (${data.items?.length || 0} items) ===`);
    (data.items || []).forEach((it, idx) => {
      console.log(`  ${idx+1}. [${it.brand || 'NO_BRAND'}] ${it.titleEn || ''} / ${it.titleAr || ''} (size: ${it.each_size_value} ${it.each_size_unit}, pack: ${it.inner_pack_count})`);
    });
  } else {
    // Check for json folder
    const jsonDir = path.join(full, 'json');
    if (fs.existsSync(jsonDir)) {
      const files = fs.readdirSync(jsonDir).filter(f => f.endsWith('.json'));
      console.log(`\n=== ${d} (${files.length} json files) ===`);
      files.slice(0, 10).forEach(f => {
        try {
          const item = JSON.parse(fs.readFileSync(path.join(jsonDir, f), 'utf8'));
          console.log(`  [${item.brand || item.brand_en || 'NO_BRAND'}] ${item.title_en || item.titleEn || ''} / ${item.title_ar || item.titleAr || ''}`);
        } catch {}
      });
    }
  }
}

