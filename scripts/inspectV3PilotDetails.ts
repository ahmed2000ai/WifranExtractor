import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { decodeV3PageExtractionToOfferCards } from '../src/shared/schemas/leafletPageExtractionV3Schema';
import { decomposeV3OfferCard } from '../src/main/ocr/offerV3DecompositionEngine';
import { adaptV3DecompositionToOfflineMatching } from '../src/main/db/v3MatchingInputAdapter';

const REPO_ROOT = resolve(__dirname, '..');

function inspectCrop(slotId: string, retailer: string, leafletId: string, pageNumber: number, sourceOfferId: string) {
  const raw = JSON.parse(readFileSync(join(REPO_ROOT, `Extracts/pilot_v3_005e/responses/${slotId}.raw.json`), 'utf8'));
  const dec = decodeV3PageExtractionToOfferCards(raw.parsedResponse, {
    leafletId,
    pageNumber,
    sourceOfferIdPrefix: slotId,
    explicitSingleOfferId: sourceOfferId,
    retailerName: retailer,
    locationScope: 'national',
    tolerateOmittedNullableFields: true
  });
  const decomp = decomposeV3OfferCard(dec.cards[0]);
  const ad = adaptV3DecompositionToOfflineMatching(decomp, { storageEnvironment: 'DEVELOPMENT_TEST' });
  console.log(`\n=== ${slotId} ===`);
  console.log('raw offers[0]:', JSON.stringify({
    assortment_status: raw.parsedResponse.offers[0].assortment_status,
    is_enumerated_list_complete: raw.parsedResponse.offers[0].is_enumerated_list_complete,
    each_size_value: raw.parsedResponse.offers[0].each_size_value,
    each_size_unit: raw.parsedResponse.offers[0].each_size_unit,
    sub_items: raw.parsedResponse.offers[0].sub_items,
    evidence_conflicts: raw.parsedResponse.offers[0].evidence_conflicts
  }));
  console.log('decomp:', { decomposed: decomp.decomposed, mode: decomp.parent_offer_retention_mode, rejection_reasons: decomp.rejection_reasons, conflict_codes: decomp.conflict_codes });
  console.log('adapter unresolvedChildren:', JSON.stringify(ad.unresolvedChildren));
  console.log('adapter matchableChildren count:', ad.matchableChildren.length);
  console.log('adapter parentPublicationAssessment (with leaflet dates):', JSON.stringify(ad.parentPublicationAssessment));
}

inspectCrop('pilot_crop_01_baskin_robbins', 'Panda', 'panda-national-national-2026-10-20', 2, 'Panda_Test_p002_007');
inspectCrop('pilot_crop_04_al_khair_plyms', 'Panda', 'panda-national-national-2026-10-20', 1, 'Panda_Test_p001_007');
inspectCrop('pilot_crop_05_abu_kass', 'BinDawood', 'bin-dawood-national-national-2026-10-20', 4, 'BNDW_Test_p004_001');

// Summarize legacy canonicals on the 4 pilot pages
const pages = [
  { name: 'Panda_p002', dir: 'Extracts/Panda_Test/json', prefix: 'page-002-' },
  { name: 'BNDW_p004', dir: 'Extracts/BNDW_Test/json', prefix: 'page-004-' },
  { name: 'Noori_p001', dir: 'Extracts/noori-supermarket-229798534-jeddah/json', prefix: 'page-001-' },
  { name: 'Alwafa_p001', dir: 'Extracts/Alwafa_Test/json', prefix: 'page-001-' }
];

console.log('\n=== LEGACY CANONICALS ON 4 PILOT PAGES ===');
let totalLegacy = 0;
let multiProductCardsInLegacy = 0;
for (const p of pages) {
  const dirAbs = join(REPO_ROOT, p.dir);
  const files = readdirSync(dirAbs).filter((f) => f.startsWith(p.prefix) && f.endsWith('.canonical.json')).sort();
  totalLegacy += files.length;
  let slashCount = 0;
  let englishOnArabicNoori = 0;
  for (const f of files) {
    const c = JSON.parse(readFileSync(join(dirAbs, f), 'utf8'));
    const en = c.product?.title_en || '';
    if (en.includes('/')) slashCount++;
    if (p.name === 'Noori_p001' && en.trim().length > 0) englishOnArabicNoori++;
  }
  multiProductCardsInLegacy += slashCount;
  console.log(`${p.name}: ${files.length} canonicals, titles_with_slash=${slashCount}, english_on_arabic_only=${englishOnArabicNoori}`);
}
console.log(`Total legacy page canonicals: ${totalLegacy}, total slash multi-product titles: ${multiProductCardsInLegacy}`);

