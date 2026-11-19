import { readFileSync } from 'fs';
import { join, resolve } from 'path';

const REPO_ROOT = resolve(__dirname, '..');
const report = JSON.parse(readFileSync(join(REPO_ROOT, 'Extracts/pilot_v3_005e/evaluation_report.json'), 'utf8'));

console.log('=== TRACK D: OPERATIONAL SLOTS ===');
for (const s of report.operationalSlots) {
  console.log(
    `${s.slotId} | ${s.kind} | ${s.durationMs}ms | in=${s.tokens.promptTotal} (txt=${s.tokens.textInputTokens}, img=${s.tokens.imageInputTokens}, pdf=${s.tokens.pdfInputTokens}) out=${s.tokens.outputTokens} think=${s.tokens.thinkingTokens} | cost=$${s.cost.totalCostUsd} | strict=${s.strictSchemaValid} tol=${s.tolerantDecodeValid} | offers=${s.rawOffersCount}`
  );
}

console.log('\n=== TRACK A/B/C: 12 CROPS ===');
for (const c of report.cropEvaluations) {
  const fails = Object.entries(c.fieldChecks)
    .filter(([, ok]) => !ok)
    .map(([k]) => k);
  const ex = c.extractedSummary.map((e: any) => ({
    id: e.source_offer_id,
    price: e.promo_price,
    orig: e.original_price,
    curr: e.currency,
    size: `${e.each_size_value}${e.each_size_unit}`,
    pk: e.manufacturer_pack_count,
    mb: e.multibuy_qty,
    bonus: e.bonus,
    lim: e.customer_limit_pcs,
    loy: e.loyalty_required,
    skus: e.sku_codes,
    assort: e.assortment_status,
    comp: e.is_enumerated_list_complete,
    subs: e.sub_items.length,
    decomp: e.decomposed,
    ret: e.retention_mode,
    ch: e.children_count,
    mch: e.matchable_children_count,
    conf: e.normalized_conflicts,
    en: e.title_en
  }));
  console.log(
    `${c.slotId} | strict=${c.strictSchemaValid} tol=${c.tolerantDecodeValid} | offers=${c.extractedOfferCount}/${c.expectedOfferCount} | fieldFails=[${fails.join(',')}] | enLeak=${c.cardEnglishLeak || c.subItemEnglishLeak} | expDecomp=${c.gtExpectations.expected_decomposed} actDecomp=${c.decomposedActually} | ch=${c.totalChildrenEmitted} matchable=${c.totalMatchableChildren} | expQuar=${c.gtExpectations.expected_quarantine}`
  );
  console.log('   EXTRACTED:', JSON.stringify(ex));
  console.log('   LEGACY   :', JSON.stringify(c.legacyBaseline));
}

console.log('\n=== TRACK A/B/C: 4 PAGES ===');
for (const p of report.pageEvaluations) {
  console.log(
    `\nPAGE ${p.slotId} (${p.retailer}) | rawObjs=${p.extractedRawOfferObjects} | matched=${p.matchedAtomicOffersCount}/${p.expectedAtomicOffers} | bboxComplete=${p.bboxCompleteCount}/${p.extractedRawOfferObjects} | arOnlyEnLeak=${p.englishLeakCountOnArabicPage}`
  );
  console.log('   LEGACY PAGE SUMMARY:', JSON.stringify(p.legacyPageSummary.publishDecisionCounts), 'files=', p.legacyPageSummary.canonicalFileCount);
  for (const g of p.gtOfferComparisons) {
    const misses: string[] = [];
    if (!g.matched) misses.push('UNMATCHED');
    if (g.matched && !g.promoPriceExact) misses.push(`price:${g.extractedPromoPrice}!=${g.gtPromoPrice}`);
    if (g.matched && !g.originalPriceExact) misses.push(`orig:${g.extractedOriginalPrice}!=${g.gtOriginalPrice}`);
    if (g.matched && !g.currencyExact) misses.push('curr');
    if (g.matched && !g.sizeExact) misses.push('size');
    if (g.matched && !g.packCountExact) misses.push('pack');
    if (g.matched && !g.multibuyExact) misses.push('multibuy');
    if (g.matched && !g.customerLimitExact) misses.push('limit');
    if (g.matched && !g.loyaltyExact) misses.push('loyalty');
    if (misses.length > 0 || g.conflictsDetected.length > 0 || g.subItemsCount > 1) {
      console.log(
        `   - ${g.cell} (${g.gtTitle}): misses=[${misses.join(',')}] assort=${g.assortmentStatus} comp=${g.isComplete} subs=${g.subItemsCount} conf=[${g.conflictsDetected.join(',')}] skus=${g.skuCodesExtracted.length}`
      );
    }
  }
  console.log('   DECOMPOSITIONS:');
  for (const d of p.decompositions) {
    console.log(
      `   * ${d.source_offer_id}: "${d.title}" @ ${d.promo_price} | ${d.assortment_status} comp=${d.is_enumerated_list_complete} | decomp=${d.decomposed} (${d.basis}) | ret=${d.retention_mode} | act=${d.active_context_outcome}(${d.active_context_category}, [${d.active_context_quarantine_reasons.join(',')}]) | ch=${d.children_count} mch=${d.matchable_children_count} | conf=[${d.conflict_codes.join(',')}]`
    );
  }
}

console.log('\n=== AGGREGATE TRACK A/B/C/D METRICS ===');
const cropFieldTotals: Record<string, { pass: number; total: number }> = {};
for (const c of report.cropEvaluations) {
  for (const [k, v] of Object.entries(c.fieldChecks)) {
    cropFieldTotals[k] = cropFieldTotals[k] || { pass: 0, total: 0 };
    cropFieldTotals[k].total++;
    if (v) cropFieldTotals[k].pass++;
  }
}
console.log('CROP_FIELD_ACCURACY:', JSON.stringify(cropFieldTotals));

const cropActiveOutcomes: Record<string, number> = {};
for (const c of report.cropEvaluations) {
  for (const e of c.extractedSummary) {
    const k = `${e.retention_mode} -> eligible=${e.active_context_eligible} (${e.active_context_category}, reasons=[${e.active_context_quarantine_reasons.join(',')}])`;
    cropActiveOutcomes[k] = (cropActiveOutcomes[k] || 0) + 1;
  }
}
console.log('CROP_CARD_OUTCOMES (13 decoded cards across 12 crops):', JSON.stringify(cropActiveOutcomes));

const allPageGt = report.pageEvaluations.flatMap((p: any) => p.gtOfferComparisons);
const matchedPageGt = allPageGt.filter((g: any) => g.matched);
console.log('PAGE_FIELD_ACCURACY (out of 47 GT atomic offers / 46 matched):', JSON.stringify({
  matched: `${matchedPageGt.length}/${allPageGt.length}`,
  promoPriceExact: `${matchedPageGt.filter((g: any) => g.promoPriceExact).length}/${matchedPageGt.length}`,
  originalPriceExact: `${matchedPageGt.filter((g: any) => g.originalPriceExact).length}/${matchedPageGt.length}`,
  currencyExact: `${matchedPageGt.filter((g: any) => g.currencyExact).length}/${matchedPageGt.length}`,
  sizeExact: `${matchedPageGt.filter((g: any) => g.sizeExact).length}/${matchedPageGt.length}`,
  packCountExact: `${matchedPageGt.filter((g: any) => g.packCountExact).length}/${matchedPageGt.length}`,
  multibuyExact: `${matchedPageGt.filter((g: any) => g.multibuyExact).length}/${matchedPageGt.length}`,
  customerLimitExact: `${matchedPageGt.filter((g: any) => g.customerLimitExact).length}/${matchedPageGt.length}`,
  loyaltyExact: `${matchedPageGt.filter((g: any) => g.loyaltyExact).length}/${matchedPageGt.length}`
}));

const allPageDecomps = report.pageEvaluations.flatMap((p: any) => p.decompositions);
const pageRetentionCounts: Record<string, number> = {};
for (const d of allPageDecomps) {
  pageRetentionCounts[d.retention_mode] = (pageRetentionCounts[d.retention_mode] || 0) + 1;
}
console.log('PAGE_DECOMPOSITION_MODES (43 raw offer objects):', JSON.stringify({
  rawOfferObjects: allPageDecomps.length,
  decomposedObjects: allPageDecomps.filter((d: any) => d.decomposed).length,
  childrenEmitted: allPageDecomps.reduce((s: number, d: any) => s + d.children_count, 0),
  matchableChildren: allPageDecomps.reduce((s: number, d: any) => s + d.matchable_children_count, 0),
  activeEligibleParents: allPageDecomps.filter((d: any) => d.active_context_eligible).length,
  activeQuarantinedParents: allPageDecomps.filter((d: any) => !d.active_context_eligible).length,
  retentionModes: pageRetentionCounts
}));
console.log('TRACK_D_TOKENS:', JSON.stringify(report.trackD_operational.tokens));
console.log('TRACK_D_COST:', JSON.stringify(report.trackD_operational.costUsd));
console.log('TRACK_D_LATENCY_MS:', JSON.stringify(report.trackD_operational.latencyMs));
console.log('TRACK_D_ESTIMATES_100_OFFER:', JSON.stringify(report.trackD_operational.estimatesFor100OfferLeaflet));
