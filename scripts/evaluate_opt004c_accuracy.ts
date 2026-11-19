import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const cwd = process.cwd();
const opt004cDir = join(cwd, 'temp/benchmark_runs/OPT-004C');
const historicalDir = join(cwd, 'temp/benchmark_runs');

function computeIoU(b1: number[] | null | undefined, b2: number[] | null | undefined): number {
  if (!b1 || !b2 || b1.length !== 4 || b2.length !== 4) return 0;
  const [y1min, x1min, y1max, x1max] = b1;
  const [y2min, x2min, y2max, x2max] = b2;

  const yInterMin = Math.max(y1min, y2min);
  const xInterMin = Math.max(x1min, x2min);
  const yInterMax = Math.min(y1max, y2max);
  const xInterMax = Math.min(x1max, x2max);

  if (yInterMax <= yInterMin || xInterMax <= xInterMin) return 0;

  const interArea = (yInterMax - yInterMin) * (xInterMax - xInterMin);
  const area1 = (y1max - y1min) * (x1max - x1min);
  const area2 = (y2max - y2min) * (x2max - x2min);
  const unionArea = area1 + area2 - interArea;

  return unionArea > 0 ? interArea / unionArea : 0;
}

function computeUnionBox(components?: any): number[] | null {
  if (!components) return null;
  const boxes = [
    components.product_graphic_box,
    components.promo_price_box,
    components.title_text_box,
    components.original_price_box,
    components.unit_and_size_badge_box
  ].filter((b): b is number[] => Boolean(b && b.length === 4));

  if (boxes.length === 0) return null;

  let ymin = 1000, xmin = 1000, ymax = 0, xmax = 0;
  for (const b of boxes) {
    if (b[0] < ymin) ymin = b[0];
    if (b[1] < xmin) xmin = b[1];
    if (b[2] > ymax) ymax = b[2];
    if (b[3] > xmax) xmax = b[3];
  }
  return [ymin, xmin, ymax, xmax];
}

function evaluateRun(pageId: string, groundTruth: any[], run: any, runLabel: string) {
  if (!run || !run.decodedCanonicalOffers) {
    console.log(`\n=== ${pageId} — ${runLabel} === (NOT AVAILABLE / UNATTEMPTED)`);
    return;
  }

  const cands: any[] = run.decodedCanonicalOffers;
  console.log(`\n======================================================`);
  console.log(`${pageId} — ${runLabel}`);
  console.log(`Offers: ${cands.length} extracted / ${groundTruth.length} ground truth`);
  console.log(`Tokens: prompt=${run.promptTokens}, cand=${run.candidatesTokens}, thoughts=${run.thoughtsTokens}, total=${run.totalTokens}`);
  console.log(`Cost: $${run.costUsd?.toFixed(6)}, Latency: ${(run.requestDurationMs / 1000).toFixed(1)}s`);
  console.log(`------------------------------------------------------`);

  let matchedCount = 0;
  let priceMatches = 0;
  let origPriceMatches = 0;
  let brandMatches = 0;

  const ious = {
    union: [] as number[],
    graphic: [] as number[],
    promoPrice: [] as number[],
    origPrice: [] as number[],
    title: [] as number[],
    unitBadge: [] as number[]
  };

  for (let i = 0; i < groundTruth.length; i++) {
    const ref = groundTruth[i];
    const refUnion = computeUnionBox(ref.components);

    // Find best candidate
    let bestCand: any = null;
    let bestScore = -1;

    for (const cand of cands) {
      const candUnion = computeUnionBox(cand.components);
      const uIou = computeIoU(refUnion, candUnion);
      let score = uIou * 2;
      if (cand.promo_price === ref.promo_price) score += 1;
      if (ref.english_title && cand.english_title && (
        cand.english_title.toLowerCase().includes(ref.english_title.toLowerCase().slice(0, 5)) ||
        ref.english_title.toLowerCase().includes(cand.english_title.toLowerCase().slice(0, 5))
      )) {
        score += 1.5;
      }
      if (score > bestScore) {
        bestScore = score;
        bestCand = cand;
      }
    }

    if (bestScore > 0.6 && bestCand) {
      matchedCount++;
      const pMatch = bestCand.promo_price === ref.promo_price;
      const opMatch = bestCand.original_price === ref.original_price;
      const bMatch = bestCand.brand === ref.brand;

      if (pMatch) priceMatches++;
      if (opMatch) origPriceMatches++;
      if (bMatch) brandMatches++;

      const uIou = computeIoU(refUnion, computeUnionBox(bestCand.components));
      const gIou = computeIoU(ref.components?.product_graphic_box, bestCand.components?.product_graphic_box);
      const pIou = computeIoU(ref.components?.promo_price_box, bestCand.components?.promo_price_box);
      const oIou = computeIoU(ref.components?.original_price_box, bestCand.components?.original_price_box);
      const tIou = computeIoU(ref.components?.title_text_box, bestCand.components?.title_text_box);
      const ubIou = computeIoU(ref.components?.unit_and_size_badge_box, bestCand.components?.unit_and_size_badge_box);

      ious.union.push(uIou);
      if (ref.components?.product_graphic_box) ious.graphic.push(gIou);
      if (ref.components?.promo_price_box) ious.promoPrice.push(pIou);
      if (ref.components?.original_price_box) ious.origPrice.push(oIou);
      if (ref.components?.title_text_box) ious.title.push(tIou);
      if (ref.components?.unit_and_size_badge_box) ious.unitBadge.push(ubIou);

      console.log(`Offer #${ref.offer_number || (i + 1)}: [P: ${bestCand.promo_price} vs ${ref.promo_price}] [B: "${bestCand.brand}" vs "${ref.brand}"] [IoU Union: ${(uIou * 100).toFixed(1)}%, G: ${(gIou * 100).toFixed(1)}%, P: ${(pIou * 100).toFixed(1)}%, T: ${(tIou * 100).toFixed(1)}%]`);
    } else {
      console.log(`Offer #${ref.offer_number || (i + 1)}: MISSED / DROPPED (${ref.english_title || ref.arabic_title})`);
    }
  }

  const avg = (arr: number[]) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length * 100).toFixed(1) + '%' : 'N/A';

  console.log(`------------------------------------------------------`);
  console.log(`Detection: ${matchedCount}/${groundTruth.length} matched | Missed: ${groundTruth.length - matchedCount} | Invented: ${Math.max(0, cands.length - matchedCount)}`);
  console.log(`Price Matches: ${priceMatches}/${groundTruth.length} | Orig Price Matches: ${origPriceMatches}/${groundTruth.length} | Brand Matches: ${brandMatches}/${groundTruth.length}`);
  console.log(`Mean IoU: Union=${avg(ious.union)}, Graphic=${avg(ious.graphic)}, PromoPrice=${avg(ious.promoPrice)}, OrigPrice=${avg(ious.origPrice)}, Title=${avg(ious.title)}, UnitBadge=${avg(ious.unitBadge)}`);
}

function runEvaluation() {
  // 1. GOLDEN-P1
  const goldenGt = JSON.parse(readFileSync('test-fixtures/page1_golden_verified_reference.json', 'utf8')).offers;
  const goldenMqHigh = JSON.parse(readFileSync(join(opt004cDir, 'GOLDEN-P1__mq_high.json'), 'utf8'));
  const goldenMqMed = JSON.parse(readFileSync(join(opt004cDir, 'GOLDEN-P1__mq_medium.json'), 'utf8'));
  const goldenLegStd = existsSync(join(historicalDir, 'GOLDEN-P1__legacy_standard.json')) ? JSON.parse(readFileSync(join(historicalDir, 'GOLDEN-P1__legacy_standard.json'), 'utf8')) : null;
  const goldenOptStd = existsSync(join(historicalDir, 'GOLDEN-P1__opt_standard.json')) ? JSON.parse(readFileSync(join(historicalDir, 'GOLDEN-P1__opt_standard.json'), 'utf8')) : null;

  evaluateRun('GOLDEN-P1', goldenGt, goldenMqHigh, 'Master Quality + HIGH');
  evaluateRun('GOLDEN-P1', goldenGt, goldenMqMed, 'Master Quality + MEDIUM');
  evaluateRun('GOLDEN-P1', goldenGt, goldenLegStd, 'Legacy Standard (Historical)');
  evaluateRun('GOLDEN-P1', goldenGt, goldenOptStd, 'Optimized Standard (Historical)');

  // 2. BNDW-P2
  const bndwDir = join(cwd, 'Extracts/BNDW_Test/json');
  const bndwFiles = require('fs').readdirSync(bndwDir).filter((f: string) => f.startsWith('page-002-') && f.endsWith('.canonical.json')).sort();
  const bndwGt = bndwFiles.map((f: string) => {
    const d = JSON.parse(readFileSync(join(bndwDir, f), 'utf8'));
    const r = d.raw?.raw_attributes?.raw_offer_extraction || {};
    return {
      offer_number: parseInt(d.source?.source_item_number || '1', 10),
      arabic_title: d.product?.title_ar || r.arabic_title || '',
      english_title: d.product?.title_en || r.english_title || '',
      brand: d.product?.brand_text ?? r.brand ?? null,
      promo_price: d.prices?.offer_price ?? r.promo_price,
      original_price: d.prices?.original_price ?? r.original_price ?? null,
      size_value: d.content?.size_text || r.size_value,
      pack_quantity: d.content?.pack_quantity || 1,
      components: r.components || {}
    };
  });

  const bndwMqHigh = JSON.parse(readFileSync(join(opt004cDir, 'BNDW-P2__mq_high.json'), 'utf8'));
  const bndwMqMed = JSON.parse(readFileSync(join(opt004cDir, 'BNDW-P2__mq_medium.json'), 'utf8'));
  const bndwLegStd = existsSync(join(historicalDir, 'BNDW-P2__legacy_standard.json')) ? JSON.parse(readFileSync(join(historicalDir, 'BNDW-P2__legacy_standard.json'), 'utf8')) : null;
  const bndwOptStd = existsSync(join(historicalDir, 'BNDW-P2__opt_standard.json')) ? JSON.parse(readFileSync(join(historicalDir, 'BNDW-P2__opt_standard.json'), 'utf8')) : null;

  evaluateRun('BNDW-P2', bndwGt, bndwMqHigh, 'Master Quality + HIGH');
  evaluateRun('BNDW-P2', bndwGt, bndwMqMed, 'Master Quality + MEDIUM');
  evaluateRun('BNDW-P2', bndwGt, bndwLegStd, 'Legacy Standard (Historical)');
  evaluateRun('BNDW-P2', bndwGt, bndwOptStd, 'Optimized Standard (Historical)');
}

runEvaluation();

