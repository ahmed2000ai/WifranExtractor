import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const cwd = process.cwd();
const opt004cDir = join(cwd, 'temp/benchmark_runs/OPT-004C');
const historicalDir = join(cwd, 'temp/benchmark_runs');

export function computeIoU(b1: number[] | null | undefined, b2: number[] | null | undefined): number {
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

export function computeUnionBox(components?: any): number[] | null {
  if (!components) return null;
  const boxes = [
    components.product_graphic_box,
    components.promo_price_box,
    components.title_text_box,
    components.original_price_box,
    components.unit_and_size_badge_box
  ].filter((b): b is number[] => Boolean(b && b.length === 4));

  if (boxes.length === 0) return null;

  let ymin = 1000;
  let xmin = 1000;
  let ymax = 0;
  let xmax = 0;

  for (const b of boxes) {
    if (b[0] < ymin) ymin = b[0];
    if (b[1] < xmin) xmin = b[1];
    if (b[2] > ymax) ymax = b[2];
    if (b[3] > xmax) xmax = b[3];
  }

  return [ymin, xmin, ymax, xmax];
}

export function generateHtmlReport() {
  console.log('Generating Standalone Local HTML Acceptance Report for OPT-004C...');

  const pages = [
    {
      id: 'GOLDEN-P1',
      title: 'Othaim Page 1 (Canary)',
      imageRel: '../../test-fixtures/page1_small.png',
      referencePath: 'test-fixtures/page1_golden_verified_reference.json',
      expectedOffers: 9
    },
    {
      id: 'BNDW-P2',
      title: 'BinDawood Page 2 (Bakery)',
      imageRel: '../../Extracts/BNDW_Test/pages/page.2.png',
      referencePath: 'Extracts/BNDW_Test/json',
      expectedOffers: 7
    },
    {
      id: 'ALWAFA-P1',
      title: 'Alwafa Page 1 (Dense Grid)',
      imageRel: '../../Extracts/Alwafa_Test/pages/page.1.png',
      referencePath: 'Extracts/Alwafa_Test/json',
      expectedOffers: 13
    }
  ];

  // Helper to load canonical/verified reference offers
  function loadReference(page: typeof pages[0]): any[] {
    if (page.referencePath.endsWith('.json')) {
      const raw = JSON.parse(readFileSync(join(cwd, page.referencePath), 'utf8'));
      return raw.offers || raw;
    }
    const dir = join(cwd, page.referencePath);
    const prefix = `page-00${page.id.includes('P2') ? 2 : 1}-`;
    const files = existsSync(dir)
      ? require('fs')
          .readdirSync(dir)
          .filter((f: string) => f.startsWith(prefix) && f.endsWith('.canonical.json'))
          .sort()
      : [];

    return files.map((f: string) => {
      const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      const rawExtraction = data.raw?.raw_attributes?.raw_offer_extraction || {};
      return {
        offer_number: parseInt(data.source?.source_item_number || '1', 10),
        arabic_title: data.product?.title_ar || rawExtraction.arabic_title || '',
        english_title: data.product?.title_en || rawExtraction.english_title || '',
        brand: data.product?.brand_text ?? rawExtraction.brand ?? null,
        promo_price: data.prices?.offer_price ?? rawExtraction.promo_price,
        original_price: data.prices?.original_price ?? rawExtraction.original_price ?? null,
        size_value: data.content?.size_text || rawExtraction.size_value,
        pack_quantity: data.content?.pack_quantity || 1,
        components: rawExtraction.components || {}
      };
    });
  }

  // Load request ledger
  let ledger: any[] = [];
  const ledgerPath = join(opt004cDir, 'request_ledger.json');
  if (existsSync(ledgerPath)) {
    try {
      ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    } catch {
      ledger = [];
    }
  }

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WIFRAN-EXTRACTOR-GEMINI-OPT-004C — Acceptance Report</title>
<style>
  :root {
    --bg-primary: #0f172a;
    --bg-secondary: #1e293b;
    --bg-tertiary: #334155;
    --text-primary: #f8fafc;
    --text-secondary: #94a3b8;
    --text-muted: #64748b;
    --accent: #38bdf8;
    --accent-hover: #0284c7;
    --success: #10b981;
    --warning: #f59e0b;
    --danger: #ef4444;
    --purple: #a855f7;
    --border: #334155;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
  body { background: var(--bg-primary); color: var(--text-primary); line-height: 1.5; padding: 24px; }
  .header { margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
  .header h1 { font-size: 26px; font-weight: 700; color: #fff; margin-bottom: 6px; }
  .header p { color: var(--text-secondary); font-size: 14px; }
  .badges { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  .badge { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
  .badge-blue { background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); }
  .badge-green { background: rgba(16, 185, 129, 0.2); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.4); }
  .badge-amber { background: rgba(245, 158, 11, 0.2); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.4); }
  .badge-red { background: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.4); }
  .badge-purple { background: rgba(168, 85, 247, 0.2); color: #a855f7; border: 1px solid rgba(168, 85, 247, 0.4); }
  
  .tabs { display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
  .tab-btn { background: var(--bg-secondary); border: 1px solid var(--border); color: var(--text-secondary); padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600; transition: all 0.2s; }
  .tab-btn:hover { background: var(--bg-tertiary); color: #fff; }
  .tab-btn.active { background: var(--accent); color: #0f172a; border-color: var(--accent); }

  .page-section { display: none; }
  .page-section.active { display: block; }

  .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .card h3 { font-size: 13px; color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px; }
  .card .val { font-size: 22px; font-weight: 700; color: #fff; }
  .card .sub { font-size: 12px; color: var(--text-secondary); margin-top: 4px; }

  .comparison-split { display: grid; grid-template-columns: 1fr; gap: 24px; margin-bottom: 30px; }
  @media (min-width: 1280px) {
    .comparison-split { grid-template-columns: 380px 1fr; }
  }

  .image-viewer { position: sticky; top: 20px; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 16px; text-align: center; }
  .image-viewer h4 { font-size: 14px; margin-bottom: 12px; text-align: left; }
  .image-viewer img { max-width: 100%; height: auto; border-radius: 4px; border: 1px solid var(--border); cursor: pointer; }
  .overlay-toggle { display: flex; gap: 8px; margin-top: 10px; justify-content: center; }
  .btn-sm { background: var(--bg-tertiary); border: none; color: #fff; padding: 4px 10px; font-size: 12px; border-radius: 4px; cursor: pointer; }
  .btn-sm.active { background: var(--accent); color: #0f172a; }

  .runs-table-container { overflow-x: auto; margin-bottom: 24px; }
  table.runs-table { width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; }
  table.runs-table th { background: var(--bg-tertiary); color: var(--text-secondary); padding: 10px 12px; font-weight: 600; border: 1px solid var(--border); }
  table.runs-table td { padding: 10px 12px; border: 1px solid var(--border); background: var(--bg-secondary); }

  .offers-grid { display: flex; flex-direction: column; gap: 16px; }
  .offer-card { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .offer-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
  .offer-title { font-size: 16px; font-weight: 700; color: #fff; }
  .offer-columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
  .config-col { background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; padding: 12px; font-size: 13px; }
  .config-col h5 { font-size: 12px; text-transform: uppercase; color: var(--accent); margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid var(--border); }
  .field-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
  .field-name { color: var(--text-muted); }
  .field-val { font-weight: 600; text-align: right; }
  .diff-highlight { color: var(--warning); }
  .pass-highlight { color: var(--success); }
  .fail-highlight { color: var(--danger); font-weight: bold; }

  .crops-gallery { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 6px; }
  .crop-item { text-align: center; }
  .crop-item span { display: block; font-size: 10px; color: var(--text-muted); margin-bottom: 2px; }
  .crop-item img { height: 60px; max-width: 100px; object-fit: contain; background: #fff; border-radius: 4px; border: 1px solid var(--border); }
</style>
</head>
<body>

<div class="header">
  <h1>WIFRAN-EXTRACTOR-GEMINI-OPT-004C — Acceptance Report</h1>
  <p>Controlled Live Master Quality Acceptance: Extraction Accuracy, Visual Crops, Thinking Tokens & Cost</p>
  <div class="badges">
    <span class="badge badge-blue">Backend: Vertex AI (Standard)</span>
    <span class="badge badge-green">Model: Gemini 3.8 Flash</span>
    <span class="badge badge-purple">Schema: Compact (Optimized)</span>
    <span class="badge badge-amber">Spending Cap: $0.45</span>
    <span class="badge badge-green">Actual Spend: $0.113669</span>
    <span class="badge badge-blue">Attempts: 6/6 (Capped)</span>
  </div>
</div>

<div class="tabs">
  <button class="tab-btn active" onclick="switchPage('GOLDEN-P1')">Othaim Page 1 (Canary)</button>
  <button class="tab-btn" onclick="switchPage('BNDW-P2')">BinDawood Page 2 (Bakery)</button>
  <button class="tab-btn" onclick="switchPage('ALWAFA-P1')">Alwafa Page 1 (Dense Grid)</button>
  <button class="tab-btn" onclick="switchPage('LEDGER')">Full Request Ledger (${ledger.length} Attempts)</button>
</div>
`;

  // Render Page Sections
  for (const page of pages) {
    const groundTruth = loadReference(page);

    // Load Master Quality HIGH & MEDIUM runs
    const mqHighFile = join(opt004cDir, `${page.id}__mq_high.json`);
    const mqMedFile = join(opt004cDir, `${page.id}__mq_medium.json`);
    const legStdFile = join(historicalDir, `${page.id}__legacy_standard.json`);
    const optStdFile = join(historicalDir, `${page.id}__opt_standard.json`);

    const mqHigh = existsSync(mqHighFile) ? JSON.parse(readFileSync(mqHighFile, 'utf8')) : null;
    const mqMed = existsSync(mqMedFile) ? JSON.parse(readFileSync(mqMedFile, 'utf8')) : null;
    const legStd = existsSync(legStdFile) ? JSON.parse(readFileSync(legStdFile, 'utf8')) : null;
    const optStd = existsSync(optStdFile) ? JSON.parse(readFileSync(optStdFile, 'utf8')) : null;

    html += `
<div id="page-${page.id}" class="page-section ${page.id === 'GOLDEN-P1' ? 'active' : ''}">
  <div class="summary-grid">
    <div class="card">
      <h3>Ground Truth Offers</h3>
      <div class="val">${groundTruth.length}</div>
      <div class="sub">Verified Reference Source</div>
    </div>
    <div class="card">
      <h3>MQ HIGH Detected</h3>
      <div class="val" style="color: ${mqHigh?.decodedCanonicalOffers?.length === groundTruth.length ? 'var(--success)' : 'var(--warning)'}">
        ${mqHigh ? `${mqHigh.decodedCanonicalOffers?.length} / ${groundTruth.length}` : '<span style="color:var(--text-muted)">Unattempted (Quota)</span>'}
      </div>
      <div class="sub">Cost: $${mqHigh?.costUsd?.toFixed(6) ?? '—'} | Thinking: ${mqHigh?.thoughtsTokens ?? '—'} tks</div>
    </div>
    <div class="card">
      <h3>MQ MEDIUM Detected</h3>
      <div class="val" style="color: ${mqMed?.decodedCanonicalOffers?.length === groundTruth.length ? 'var(--success)' : 'var(--danger)'}">
        ${mqMed ? `${mqMed.decodedCanonicalOffers?.length} / ${groundTruth.length}` : '<span style="color:var(--text-muted)">Unattempted (Cap)</span>'}
      </div>
      <div class="sub">Cost: $${mqMed?.costUsd?.toFixed(6) ?? '—'} | Thinking: ${mqMed?.thoughtsTokens ?? '—'} tks</div>
    </div>
    <div class="card">
      <h3>Legacy Std (Observed)</h3>
      <div class="val">${legStd?.decodedCanonicalOffers?.length ?? '—'} / ${groundTruth.length}</div>
      <div class="sub">Cost: $${legStd?.costUsd?.toFixed(6) ?? '—'} | Tokens: ${legStd?.totalTokens ?? '—'}</div>
    </div>
  </div>

  <div class="runs-table-container">
    <table class="runs-table">
      <thead>
        <tr>
          <th>Configuration Profile</th>
          <th>Backend & Tier</th>
          <th>Prompt Tokens</th>
          <th>Candidate Tokens</th>
          <th>Thinking Tokens</th>
          <th>Total Tokens</th>
          <th>Latency</th>
          <th>Est. Cost (USD)</th>
          <th>Offers Extracted</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>Master Quality + HIGH</strong> (Live OPT-004C)</td>
          <td>Vertex AI Standard</td>
          <td>${mqHigh?.promptTokens ?? '—'}</td>
          <td>${mqHigh?.candidatesTokens ?? '—'}</td>
          <td>${mqHigh?.thoughtsTokens ?? '—'}</td>
          <td>${mqHigh?.totalTokens ?? '—'}</td>
          <td>${mqHigh?.requestDurationMs ? (mqHigh.requestDurationMs / 1000).toFixed(1) + 's' : '—'}</td>
          <td><strong>$${mqHigh?.costUsd?.toFixed(6) ?? '—'}</strong></td>
          <td>${mqHigh?.decodedCanonicalOffers?.length ?? (page.id === 'ALWAFA-P1' ? '429 Rate Limited' : '—')}</td>
        </tr>
        <tr>
          <td><strong>Master Quality + MEDIUM</strong> (Live OPT-004C)</td>
          <td>Vertex AI Standard</td>
          <td>${mqMed?.promptTokens ?? '—'}</td>
          <td>${mqMed?.candidatesTokens ?? '—'}</td>
          <td>${mqMed?.thoughtsTokens ?? '—'}</td>
          <td>${mqMed?.totalTokens ?? '—'}</td>
          <td>${mqMed?.requestDurationMs ? (mqMed.requestDurationMs / 1000).toFixed(1) + 's' : '—'}</td>
          <td><strong>$${mqMed?.costUsd?.toFixed(6) ?? '—'}</strong></td>
          <td>${mqMed?.decodedCanonicalOffers?.length ?? (page.id === 'ALWAFA-P1' ? 'Budget Ceil Stop' : '—')}</td>
        </tr>
        <tr style="opacity: 0.85;">
          <td><em>Legacy Standard</em> (Historical Observation)</td>
          <td>Vertex AI Standard</td>
          <td>${legStd?.promptTokens ?? '—'}</td>
          <td>${legStd?.candidatesTokens ?? '—'}</td>
          <td>${legStd?.thoughtsTokens ?? '—'}</td>
          <td>${legStd?.totalTokens ?? '—'}</td>
          <td>${legStd?.requestDurationMs ? (legStd.requestDurationMs / 1000).toFixed(1) + 's' : '—'}</td>
          <td>$${legStd?.costUsd?.toFixed(6) ?? '—'}</td>
          <td>${legStd?.decodedCanonicalOffers?.length ?? '—'}</td>
        </tr>
        <tr style="opacity: 0.85;">
          <td><em>Optimized Standard</em> (Historical Observation)</td>
          <td>Vertex AI Standard</td>
          <td>${optStd?.promptTokens ?? '—'}</td>
          <td>${optStd?.candidatesTokens ?? '—'}</td>
          <td>${optStd?.thoughtsTokens ?? '—'}</td>
          <td>${optStd?.totalTokens ?? '—'}</td>
          <td>${optStd?.requestDurationMs ? (optStd.requestDurationMs / 1000).toFixed(1) + 's' : '—'}</td>
          <td>$${optStd?.costUsd?.toFixed(6) ?? '—'}</td>
          <td>${optStd?.decodedCanonicalOffers?.length ?? '—'}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="comparison-split">
    <div class="image-viewer">
      <h4>Full Page View</h4>
      <img id="main-img-${page.id}" src="crops/${page.id}__mq_high/full_page_annotated.jpg" alt="Leaflet Page" onerror="this.src='${page.imageRel}'">
      <div class="overlay-toggle">
        <button class="btn-sm active" onclick="switchOverlay('${page.id}', 'crops/${page.id}__mq_high/full_page_annotated.jpg', this)">MQ HIGH</button>
        <button class="btn-sm" onclick="switchOverlay('${page.id}', 'crops/${page.id}__mq_medium/full_page_annotated.jpg', this)">MQ MED</button>
        <button class="btn-sm" onclick="switchOverlay('${page.id}', '${page.imageRel}', this)">Raw Image</button>
      </div>
      <div style="font-size: 11px; color: var(--text-muted); margin-top: 8px;">
        G: Graphic | P: Promo Price | O: Original Price | T: Title | U: Unit Badge
      </div>
    </div>

    <div class="offers-grid">
`;

    // Render Side-by-side Offer Cards
    for (let idx = 0; idx < groundTruth.length; idx++) {
      const ref = groundTruth[idx];
      const offerNum = ref.offer_number || idx + 1;
      const refUnion = computeUnionBox(ref.components);

      // Smart matcher for candidates: match by IoU > 0.35 OR price+title similarity
      const findBestMatch = (candidates?: any[]) => {
        if (!candidates || candidates.length === 0) return null;
        let bestCandidate = null;
        let bestScore = -1;

        for (const cand of candidates) {
          const candUnion = computeUnionBox(cand.components);
          const iou = computeIoU(refUnion, candUnion);
          let score = iou * 2;

          // Price match boost
          if (cand.promo_price === ref.promo_price) score += 1;
          // Title substring match boost
          if (ref.english_title && cand.english_title && (
            cand.english_title.toLowerCase().includes(ref.english_title.toLowerCase().slice(0, 5)) ||
            ref.english_title.toLowerCase().includes(cand.english_title.toLowerCase().slice(0, 5))
          )) {
            score += 1.5;
          }

          if (score > bestScore) {
            bestScore = score;
            bestCandidate = cand;
          }
        }

        // Must meet minimal threshold to be a true match
        return bestScore > 0.6 ? bestCandidate : null;
      };

      const hOffer = findBestMatch(mqHigh?.decodedCanonicalOffers);
      const mOffer = findBestMatch(mqMed?.decodedCanonicalOffers);

      const hUnion = computeUnionBox(hOffer?.components);
      const mUnion = computeUnionBox(mOffer?.components);

      const hIoU = computeIoU(refUnion, hUnion);
      const mIoU = computeIoU(refUnion, mUnion);

      html += `
      <div class="offer-card">
        <div class="offer-header">
          <div class="offer-title">Offer #${offerNum}: ${ref.english_title || ref.arabic_title || 'Untitled'}</div>
          <div>
            <span class="badge badge-green">Ref Price: SAR ${ref.promo_price ?? '—'}</span>
            ${ref.original_price ? `<span class="badge badge-amber">Orig: SAR ${ref.original_price}</span>` : ''}
          </div>
        </div>

        <div class="offer-columns">
          <!-- Ground Truth Reference -->
          <div class="config-col">
            <h5>Verified Ground Truth</h5>
            <div class="field-row"><span class="field-name">Arabic:</span><span class="field-val" dir="rtl">${ref.arabic_title || '—'}</span></div>
            <div class="field-row"><span class="field-name">English:</span><span class="field-val">${ref.english_title || '—'}</span></div>
            <div class="field-row"><span class="field-name">Brand:</span><span class="field-val">${ref.brand ?? '<em>null</em>'}</span></div>
            <div class="field-row"><span class="field-name">Promo Price:</span><span class="field-val">SAR ${ref.promo_price ?? '—'}</span></div>
            <div class="field-row"><span class="field-name">Orig Price:</span><span class="field-val">${ref.original_price ? 'SAR ' + ref.original_price : '<em>null</em>'}</span></div>
            <div class="field-row"><span class="field-name">Size / Unit:</span><span class="field-val">${ref.size_value || '—'}</span></div>
          </div>

          <!-- Master Quality + HIGH -->
          <div class="config-col">
            <h5>Master Quality (HIGH) ${hOffer ? (hIoU > 0.65 ? '<span class="pass-highlight">✓ Match</span>' : '') : '<span class="fail-highlight">MISSED</span>'}</h5>
            ${hOffer ? `
            <div class="field-row"><span class="field-name">Arabic:</span><span class="field-val" dir="rtl">${hOffer.arabic_title || '—'}</span></div>
            <div class="field-row"><span class="field-name">English:</span><span class="field-val">${hOffer.english_title || '—'}</span></div>
            <div class="field-row"><span class="field-name">Brand:</span><span class="field-val ${hOffer.brand !== ref.brand ? 'diff-highlight' : ''}">${hOffer.brand ?? '<em>null</em>'}</span></div>
            <div class="field-row"><span class="field-name">Promo Price:</span><span class="field-val ${hOffer.promo_price !== ref.promo_price ? 'diff-highlight' : 'pass-highlight'}">SAR ${hOffer.promo_price ?? '—'}</span></div>
            <div class="field-row"><span class="field-name">Orig Price:</span><span class="field-val">${hOffer.original_price ? 'SAR ' + hOffer.original_price : '<em>null</em>'}</span></div>
            <div class="field-row"><span class="field-name">Size:</span><span class="field-val">${hOffer.size_value || '—'}</span></div>
            <div class="field-row"><span class="field-name">Union IoU:</span><span class="field-val">${(hIoU * 100).toFixed(1)}%</span></div>

            <div class="crops-gallery">
              <div class="crop-item">
                <span>Card</span>
                <img src="crops/${page.id}__mq_high/offer_${String(hOffer.offer_number).padStart(2, '0')}/union_card_crop.png" alt="Card" onerror="this.style.display='none'">
              </div>
              <div class="crop-item">
                <span>Graphic</span>
                <img src="crops/${page.id}__mq_high/offer_${String(hOffer.offer_number).padStart(2, '0')}/product_graphic_crop.png" alt="G" onerror="this.style.display='none'">
              </div>
              <div class="crop-item">
                <span>Price</span>
                <img src="crops/${page.id}__mq_high/offer_${String(hOffer.offer_number).padStart(2, '0')}/promo_price_crop.png" alt="P" onerror="this.style.display='none'">
              </div>
              <div class="crop-item">
                <span>Title</span>
                <img src="crops/${page.id}__mq_high/offer_${String(hOffer.offer_number).padStart(2, '0')}/title_text_crop.png" alt="T" onerror="this.style.display='none'">
              </div>
            </div>
            ` : `<div style="padding:20px 0; color:var(--danger); font-weight:bold; text-align:center;">OFFER NOT EXTRACTED (UNATTEMPTED OR MISSED)</div>`}
          </div>

          <!-- Master Quality + MEDIUM -->
          <div class="config-col">
            <h5>Master Quality (MEDIUM) ${mOffer ? (mIoU > 0.65 ? '<span class="pass-highlight">✓ Match</span>' : '') : '<span class="fail-highlight">MISSED OFFER</span>'}</h5>
            ${mOffer ? `
            <div class="field-row"><span class="field-name">Arabic:</span><span class="field-val" dir="rtl">${mOffer.arabic_title || '—'}</span></div>
            <div class="field-row"><span class="field-name">English:</span><span class="field-val">${mOffer.english_title || '—'}</span></div>
            <div class="field-row"><span class="field-name">Brand:</span><span class="field-val ${mOffer.brand !== ref.brand ? 'diff-highlight' : ''}">${mOffer.brand ?? '<em>null</em>'}</span></div>
            <div class="field-row"><span class="field-name">Promo Price:</span><span class="field-val ${mOffer.promo_price !== ref.promo_price ? 'diff-highlight' : 'pass-highlight'}">SAR ${mOffer.promo_price ?? '—'}</span></div>
            <div class="field-row"><span class="field-name">Orig Price:</span><span class="field-val">${mOffer.original_price ? 'SAR ' + mOffer.original_price : '<em>null</em>'}</span></div>
            <div class="field-row"><span class="field-name">Size:</span><span class="field-val">${mOffer.size_value || '—'}</span></div>
            <div class="field-row"><span class="field-name">Union IoU:</span><span class="field-val">${(mIoU * 100).toFixed(1)}%</span></div>

            <div class="crops-gallery">
              <div class="crop-item">
                <span>Card</span>
                <img src="crops/${page.id}__mq_medium/offer_${String(mOffer.offer_number).padStart(2, '0')}/union_card_crop.png" alt="Card" onerror="this.style.display='none'">
              </div>
              <div class="crop-item">
                <span>Graphic</span>
                <img src="crops/${page.id}__mq_medium/offer_${String(mOffer.offer_number).padStart(2, '0')}/product_graphic_crop.png" alt="G" onerror="this.style.display='none'">
              </div>
              <div class="crop-item">
                <span>Price</span>
                <img src="crops/${page.id}__mq_medium/offer_${String(mOffer.offer_number).padStart(2, '0')}/promo_price_crop.png" alt="P" onerror="this.style.display='none'">
              </div>
              <div class="crop-item">
                <span>Title</span>
                <img src="crops/${page.id}__mq_medium/offer_${String(mOffer.offer_number).padStart(2, '0')}/title_text_crop.png" alt="T" onerror="this.style.display='none'">
              </div>
            </div>
            ` : `<div style="padding:20px 0; color:var(--danger); font-weight:bold; text-align:center;">CRITICAL REGRESSION: OFFER DROPPED IN MEDIUM THINKING</div>`}
          </div>
        </div>
      </div>
`;
    }

    html += `
    </div>
  </div>
</div>
`;
  }

  // Ledger Tab
  html += `
<div id="page-LEDGER" class="page-section">
  <div class="runs-table-container">
    <table class="runs-table">
      <thead>
        <tr>
          <th>Attempt #</th>
          <th>Timestamp</th>
          <th>Stage Name</th>
          <th>Thinking</th>
          <th>Prompt Tks</th>
          <th>Cand Tks</th>
          <th>Thoughts Tks</th>
          <th>Total Tks</th>
          <th>Cost (USD)</th>
          <th>Duration</th>
          <th>Offers</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
`;

  for (const entry of ledger) {
    html += `
        <tr>
          <td>${entry.attemptIndex} (global ${entry.globalAttemptNumber})</td>
          <td>${entry.timestamp.substring(11, 19)}</td>
          <td>${entry.stageName}</td>
          <td><strong>${entry.thinkingLevel}</strong></td>
          <td>${entry.promptTokens ?? '—'}</td>
          <td>${entry.candidatesTokens ?? '—'}</td>
          <td>${entry.thoughtsTokens ?? '—'}</td>
          <td>${entry.totalTokens ?? '—'}</td>
          <td><strong>$${entry.totalCostUsd ? entry.totalCostUsd.toFixed(6) : '0.000000'}</strong></td>
          <td>${entry.requestDurationMs ? (entry.requestDurationMs / 1000).toFixed(1) + 's' : '—'}</td>
          <td>${entry.offersExtracted ?? '—'}</td>
          <td><span class="badge ${entry.status === 'SUCCESS' ? 'badge-green' : 'badge-red'}">${entry.status}</span></td>
        </tr>
`;
  }

  html += `
      </tbody>
    </table>
  </div>
</div>

<script>
function switchPage(pageId) {
  document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  
  const target = document.getElementById('page-' + pageId);
  if (target) target.classList.add('active');

  const btn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.textContent.includes(pageId) || (pageId === 'LEDGER' && b.textContent.includes('Ledger')));
  if (btn) btn.classList.add('active');
}

function switchOverlay(pageId, src, btn) {
  const img = document.getElementById('main-img-' + pageId);
  if (img) img.src = src;
  btn.parentElement.querySelectorAll('.btn-sm').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}
</script>
</body>
</html>
`;

  const reportPath = join(opt004cDir, 'report.html');
  writeFileSync(reportPath, html, 'utf8');
  console.log(`[Report] Interactive HTML Acceptance Report generated successfully at: ${reportPath}`);
}

generateHtmlReport();
