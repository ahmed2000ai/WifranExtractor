import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { sharedPageFirstPipelineService, resolvePageImagePath } from '../pageFirstPipelineService';
import { executePageFirstOcr } from '../../ocr/pageFirstOcrService';
import type { PageFirstProgressEvent } from '../pageFirstPipelineService';

describe('HOTFIX: Test Current Page Page-First Pipeline Wiring & Diagnostics', () => {
  const createdDirs: string[] = [];
  let testWorkspace: string;

  const mockAnnotation = {
    schema_version: 1,
    page_number: 1,
    page_classification: 'offer_page' as const,
    offers: [
      {
        temporary_offer_id: 'page1_off_01',
        region_hint: 'top_left' as const,
        product: {
          title_ar: 'تونة قودي خفيفة 185 جرام',
          title_en: 'Goody Light Meat Tuna 185g',
          brand_text: 'Goody',
          description_ar: null,
          description_en: null,
          item_domain: 'grocery' as const,
          variant_names: []
        },
        price_candidates: [
          {
            raw_text: '7.95',
            normalized_value: 7.95,
            currency: 'SAR' as const,
            role: 'current_offer_price' as const,
            is_crossed_out: false,
            confidence: 'high' as const,
            evidence_text: '7.95'
          }
        ],
        selected_prices: {
          offer_price: 7.95,
          original_price: 11.5,
          currency: 'SAR' as const,
          offer_price_raw_text: '7.95',
          original_price_raw_text: '11.50',
          confidence: 'high' as const
        },
        content: {
          size_text: '185g',
          each_size_value: 185,
          each_size_unit: 'gram' as const,
          pack_quantity: 1,
          bundle_quantity: null,
          total_content_value: 185,
          total_content_unit: 'gram' as const
        },
        price_basis: { basis: 'each' as const, raw_text: 'للحبة' },
        promotion: { mechanic: 'standard_price' as const, raw_text: null, condition_text: null },
        evidence: {
          title_texts: ['تونة قودي خفيفة 185 جرام'],
          description_texts: [],
          current_price_texts: ['7.95'],
          original_price_texts: ['11.50'],
          size_content_texts: ['185g'],
          promotion_texts: [],
          final_evidence_summary: 'تونة قودي 7.95'
        },
        confidence: {
          overall: 'high' as const,
          product_identity: 'high' as const,
          current_price: 'high' as const,
          original_price: 'high' as const,
          size_content: 'high' as const,
          promotion: 'high' as const
        },
        warnings: []
      }
    ],
    uncertain_regions: [],
    page_summary: {
      independent_offer_count: 1,
      independent_current_price_anchor_count: 1,
      offers_with_original_price_count: 1,
      offers_with_size_or_content_count: 1,
      bundle_or_multi_buy_count: 0,
      low_confidence_offer_count: 0,
      final_completeness_check_performed: true
    }
  };

  const mockOcrBlocks = [
    {
      id: 'b_title',
      pageNumber: 1,
      text: 'تونة قودي خفيفة 185 جرام Goody Light Meat Tuna',
      normalizedText: 'تونة قودي خفيفة 185 جرام goody light meat tuna',
      boundingBox: { x: 50, y: 50, width: 250, height: 40 },
      confidence: 0.95,
      isPriceCandidate: false
    },
    {
      id: 'b_price',
      pageNumber: 1,
      text: '7.95 SAR',
      normalizedText: '7.95 sar',
      boundingBox: { x: 50, y: 100, width: 80, height: 30 },
      confidence: 0.98,
      isPriceCandidate: true
    }
  ];

  const mockOcrResponse = {
    document_annotation: mockAnnotation,
    pages: [{ blocks: mockOcrBlocks }],
    usage_info: {
      pages_processed: 1
    }
  };

  const mockTrustedContext = {
    leafletId: 'leaflet-danube-2026',
    supermarketId: 'sm-danube',
    supermarketSlug: 'danube',
    locationScope: 'national' as const,
    cityId: null,
    regionId: null,
    offerStartDate: '2026-10-01',
    offerEndDate: '2026-10-15'
  };

  beforeEach(async () => {
    testWorkspace = path.join(process.cwd(), 'tmp', `test-page-first-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    createdDirs.push(testWorkspace);

    fs.mkdirSync(path.join(testWorkspace, 'pages'), { recursive: true });
    fs.mkdirSync(path.join(testWorkspace, 'metadata'), { recursive: true });

    // Create realistic rendered page image (pdf2pic naming format: page.1.png)
    await sharp({
      create: { width: 600, height: 800, channels: 3, background: { r: 255, g: 255, b: 255 } }
    }).png().toFile(path.join(testWorkspace, 'pages', 'page.1.png'));

    // Base manifest
    const initialManifest: any = {
      manifest_version: '2.0.0',
      extraction_folder_path: testWorkspace,
      supermarket: { id: 'sm-danube', slug: 'danube', name_en: 'Danube', name_ar: 'الدانوب' },
      location: { location_scope: 'national', location_slug: 'national', city_id: null, region_id: null, label: 'National' },
      validity: { start_date: '2026-10-01', end_date: '2026-10-15' },
      paths: {
        pages_dir: path.join(testWorkspace, 'pages'),
        crops_dir: path.join(testWorkspace, 'crops'),
        json_dir: path.join(testWorkspace, 'json'),
        reports_dir: path.join(testWorkspace, 'reports')
      },
      page_count: 1,
      rendered_pages: [
        { page_number: 1, image_path: path.join(testWorkspace, 'pages', 'page.1.png'), width: 600, height: 800 }
      ],
      pre_publish_preview: {
        status: 'not_opened',
        opened_at: null,
        approved_at: null,
        approved_by: null,
        summary: {
          publish_count: 0,
          publish_but_exclude_from_comparison_count: 0,
          skip_or_quarantine_count: 0,
          warning_count: 0,
          blocking_error_count: 0
        }
      }
    };
    fs.writeFileSync(path.join(testWorkspace, 'extraction_manifest.json'), JSON.stringify(initialManifest, null, 2), 'utf8');
    fs.writeFileSync(path.join(testWorkspace, 'metadata', 'metadata.json'), JSON.stringify(initialManifest, null, 2), 'utf8');
  });

  afterAll(() => {
    for (const d of createdDirs) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    createdDirs.length = 0;
  });

  it('Resolves page image path for pdf2pic dot format (page.1.png) and dash format', () => {
    const dotPath = resolvePageImagePath(testWorkspace, 1);
    expect(dotPath).toBeDefined();
    expect(fs.existsSync(dotPath!)).toBe(true);
    expect(path.basename(dotPath!)).toBe('page.1.png');

    // Create alternative dash format (page-001.png) in a different dir
    const altDir = path.join(process.cwd(), 'tmp', `test-alt-${Date.now()}`);
    createdDirs.push(altDir);
    fs.mkdirSync(path.join(altDir, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(altDir, 'pages', 'page-001.png'), 'fake-png');

    const dashPath = resolvePageImagePath(altDir, 1);
    expect(dashPath).toBeDefined();
    expect(fs.existsSync(dashPath!)).toBe(true);
    expect(path.basename(dashPath!)).toBe('page-001.png');
  });

  it('Reaches the real page-first service for Test Current Page in pilot mode without early return', async () => {
    const progressEvents: PageFirstProgressEvent[] = [];
    const logEvents: any[] = [];

    const result = await sharedPageFirstPipelineService.runPipeline({
      packageDir: testWorkspace,
      pdfBaseName: 'test-leaflet',
      pages: [1],
      trustedContext: mockTrustedContext,
      rolloutMode: 'pilot', // Pilot mode must NOT abort or return early
      onProgress: (p) => progressEvents.push(p),
      onLog: (l) => logEvents.push(l),
      mockPageResponses: new Map([[1, mockOcrResponse]]) // Injected offline mock response to prevent live network call
    });

    // 1. Result summary verification
    expect(result.ok).toBe(true);
    expect(result.totalPages).toBe(1);
    expect(result.completedPages).toBe(1);
    expect(result.offersDetected).toBe(1);
    expect(result.offersLinked).toBe(1);
    expect(result.cropsGenerated).toBe(1);

    // 2. Progression verification: Primary OCR progresses 0/1 -> 1/1
    const ocrRunningEvent = progressEvents.find(p => p.stage === 'ocr_running');
    expect(ocrRunningEvent).toBeDefined();
    expect(ocrRunningEvent?.primaryCompletedPages).toBe(0);
    expect(ocrRunningEvent?.totalPages).toBe(1);

    const linkingEvent = progressEvents.find(p => p.stage === 'linking');
    expect(linkingEvent).toBeDefined();
    expect(linkingEvent?.primaryCompletedPages).toBe(1);
    expect(linkingEvent?.totalPages).toBe(1);

    // 3. Log events emitted in order
    const logCodes = logEvents.map(e => e.code);
    expect(logCodes).toContain('PAGE_FIRST_TEST_START');
    expect(logCodes).toContain('PAGE_FIRST_REQUEST_QUEUED');
    expect(logCodes).toContain('MISTRAL_OCR_REQUEST_START');
    expect(logCodes).toContain('MISTRAL_OCR_REQUEST_SUCCESS');
    expect(logCodes).toContain('PAGE_FIRST_ANNOTATION_PARSED');
    expect(logCodes).toContain('PAGE_FIRST_EVIDENCE_LINKED');
    expect(logCodes).toContain('PAGE_FIRST_CROPS_GENERATED');
    expect(logCodes).toContain('PAGE_FIRST_TEST_COMPLETE');

    // 5. Workspace artifacts persisted under expected directories
    const rawRespPath = path.join(testWorkspace, 'metadata', 'page-first-ocr', 'page-001', 'raw-response.json');
    const annotationPath = path.join(testWorkspace, 'metadata', 'page-first-ocr', 'page-001', 'annotation.json');
    const blocksPath = path.join(testWorkspace, 'metadata', 'page-first-ocr', 'page-001', 'blocks.json');
    const linksPath = path.join(testWorkspace, 'metadata', 'page-offer-links', 'page-001.json');
    const compPath = path.join(testWorkspace, 'metadata', 'page-completeness', 'page-001.json');
    const cropsPath = path.join(testWorkspace, 'metadata', 'automatic-crops', 'page-001.json');
    const previewSummaryPath = path.join(testWorkspace, 'metadata', 'reports', 'pre-publish-preview-summary.json');
    const canonicalPath = path.join(testWorkspace, 'json', 'page-001-001.canonical.json');

    expect(fs.existsSync(rawRespPath)).toBe(true);
    expect(fs.existsSync(annotationPath)).toBe(true);
    expect(fs.existsSync(blocksPath)).toBe(true);
    expect(fs.existsSync(linksPath)).toBe(true);
    expect(fs.existsSync(compPath)).toBe(true);
    expect(fs.existsSync(cropsPath)).toBe(true);
    expect(fs.existsSync(previewSummaryPath)).toBe(true);
    expect(fs.existsSync(canonicalPath)).toBe(true);

    // 6. Verify Pre-Publish Preview summary content
    const summaryData = JSON.parse(fs.readFileSync(previewSummaryPath, 'utf8'));
    expect(summaryData.counts.total_items).toBe(1);
    expect(summaryData.counts.publish).toBe(1);
    expect(summaryData.items.length).toBe(1);
    expect(summaryData.items[0].source_page_number).toBe(1);
  });

  it('Surfaces visible error when page image is missing', async () => {
    // Workspace with missing page 2
    const logEvents: any[] = [];
    const progressEvents: PageFirstProgressEvent[] = [];

    await expect(
      sharedPageFirstPipelineService.runPipeline({
        packageDir: testWorkspace,
        pdfBaseName: 'test-leaflet',
        pages: [2], // Page 2 does not exist
        trustedContext: mockTrustedContext,
        rolloutMode: 'pilot',
        onProgress: (p) => progressEvents.push(p),
        onLog: (l) => logEvents.push(l)
      })
    ).rejects.toThrow(/page image missing for page 2/i);

    const failLog = logEvents.find(l => l.code === 'MISTRAL_OCR_REQUEST_FAILED');
    expect(failLog).toBeDefined();
    expect(failLog?.message).toMatch(/page image missing for page 2/i);

    const failProgress = progressEvents.find(p => p.stage === 'failed');
    expect(failProgress).toBeDefined();
  });

  it('Surfaces visible error when MISTRAL_API_KEY is missing without mock', async () => {
    const originalKey = process.env.MISTRAL_API_KEY;
    delete process.env.MISTRAL_API_KEY;

    const logEvents: any[] = [];

    try {
      await expect(
        executePageFirstOcr({
          pageNumber: 1,
          renderedImagePath: path.join(testWorkspace, 'pages', 'page.1.png'),
          packageDir: testWorkspace,
          onLog: (l) => logEvents.push(l)
        })
      ).rejects.toThrow(/Mistral API key missing/i);

      const failLog = logEvents.find(l => l.code === 'MISTRAL_OCR_REQUEST_FAILED');
      expect(failLog).toBeDefined();
      expect(failLog?.message).toMatch(/Mistral API key missing/i);
    } finally {
      if (originalKey) {
        process.env.MISTRAL_API_KEY = originalKey;
      }
    }
  });

  it('Surfaces visible error when OCR schema validation fails', async () => {
    const invalidSchemaResponse = {
      document_annotation: {
        // Missing required schema_version, offers, page_classification
        invalid: true
      },
      pages: [{ blocks: mockOcrBlocks }]
    };

    const logEvents: any[] = [];

    const result = await executePageFirstOcr({
      pageNumber: 1,
      renderedImagePath: path.join(testWorkspace, 'pages', 'page.1.png'),
      packageDir: testWorkspace,
      mockResponse: invalidSchemaResponse,
      onLog: (l) => logEvents.push(l)
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/OCR schema validation failed/i);

    const failLog = logEvents.find(l => l.code === 'MISTRAL_OCR_REQUEST_FAILED');
    expect(failLog).toBeDefined();
    expect(failLog?.message).toMatch(/OCR schema validation failed/i);
  });
});
