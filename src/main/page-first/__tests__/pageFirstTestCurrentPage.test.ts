import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { sharedPageFirstPipelineService, resolvePageImagePath } from '../pageFirstPipelineService';
import { executePageFirstOcr } from '../../ocr/pageFirstOcrService';
import type { PageFirstProgressEvent } from '../pageFirstPipelineService';

describe('HOTFIX: Test Current Page Page-First Pipeline Wiring & Diagnostics', () => {
  const createdDirs: string[] = [];
  let testWorkspace: string;
  let workspaceSeq = 0;

  // Pinned reference dates & Date-only fake clock ensure timezone- and future-date determinism
  const activeOfferStartDate = '2026-10-10';
  const activeOfferEndDate = '2026-10-17';

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
    offerStartDate: activeOfferStartDate,
    offerEndDate: activeOfferEndDate
  };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T12:00:00.000Z'));
    workspaceSeq += 1;
    testWorkspace = path.join(process.cwd(), 'tmp', `test-page-first-${Date.now()}-${workspaceSeq}-${Math.random().toString(36).slice(2, 6)}`);
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
      validity: { start_date: activeOfferStartDate, end_date: activeOfferEndDate },
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

  afterEach(() => {
    vi.useRealTimers();
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

    // 2. Progression verification: Primary OCR progresses 0/1 -> 1/1 and reaches completed
    const ocrRunningEvent = progressEvents.find(p => p.stage === 'ocr_running');
    expect(ocrRunningEvent).toBeDefined();
    expect(ocrRunningEvent?.primaryCompletedPages).toBe(0);
    expect(ocrRunningEvent?.totalPages).toBe(1);

    const croppingEvent = progressEvents.find(p => p.stage === 'cropping');
    expect(croppingEvent).toBeDefined();
    expect(croppingEvent?.primaryCompletedPages).toBe(1);
    expect(croppingEvent?.completedPages).toBe(0);
    expect(croppingEvent?.totalPages).toBe(1);

    const completedEvent = progressEvents.find(p => p.stage === 'completed' && p.logCode === 'PAGE_FIRST_TEST_COMPLETE');
    expect(completedEvent).toBeDefined();
    expect(completedEvent?.primaryCompletedPages).toBe(1);
    expect(completedEvent?.completedPages).toBe(1);
    expect(completedEvent?.totalPages).toBe(1);

    // 3. Log events emitted in order by the Rev1 Page-First pipeline
    const logCodes = logEvents.map(e => e.code);
    expect(logCodes).toContain('PAGE_FIRST_TEST_START');
    expect(logCodes).toContain('PAGE_FIRST_TEST_COMPLETE');
    expect(logCodes.indexOf('PAGE_FIRST_TEST_START')).toBeLessThan(logCodes.indexOf('PAGE_FIRST_TEST_COMPLETE'));

    // 4. Workspace artifacts persisted under expected Rev1 directories
    const pageStatePath = path.join(testWorkspace, 'metadata', 'page-first-ocr', 'page-state.json');
    const extractionReportJsonPath = path.join(testWorkspace, 'metadata', 'reports', 'page-first-extraction-report.json');
    const extractionReportMdPath = path.join(testWorkspace, 'metadata', 'reports', 'page-first-extraction-report.md');
    const previewSummaryPath = path.join(testWorkspace, 'metadata', 'reports', 'pre-publish-preview-summary.json');
    const canonicalPath = path.join(testWorkspace, 'json', 'page-001-001.canonical.json');

    expect(fs.existsSync(pageStatePath)).toBe(true);
    expect(fs.existsSync(extractionReportJsonPath)).toBe(true);
    expect(fs.existsSync(extractionReportMdPath)).toBe(true);
    expect(fs.existsSync(previewSummaryPath)).toBe(true);
    expect(fs.existsSync(canonicalPath)).toBe(true);

    const pageStates = JSON.parse(fs.readFileSync(pageStatePath, 'utf8'));
    expect(pageStates.length).toBe(1);
    expect(pageStates[0].pageNumber).toBe(1);
    expect(pageStates[0].status).toBe('completed');

    // 5. Verify Pre-Publish Preview summary content
    const summaryData = JSON.parse(fs.readFileSync(previewSummaryPath, 'utf8'));
    expect(summaryData.counts.total_items).toBe(1);
    expect(summaryData.counts.publish).toBe(1);
    expect(summaryData.items.length).toBe(1);
    expect(summaryData.items[0].source_page_number).toBe(1);
  });

  it('Reports accurate selected-page progress and original PDF page numbers when extracting a subset [2, 5] of a 6-page leaflet', async () => {
    const subsetWorkspace = path.join(process.cwd(), 'tmp', `test-page-first-subset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    createdDirs.push(subsetWorkspace);
    fs.mkdirSync(path.join(subsetWorkspace, 'pages'), { recursive: true });
    fs.mkdirSync(path.join(subsetWorkspace, 'metadata'), { recursive: true });

    for (const p of [2, 5]) {
      await sharp({
        create: { width: 600, height: 800, channels: 3, background: { r: 255, g: 255, b: 255 } }
      }).png().toFile(path.join(subsetWorkspace, 'pages', `page.${p}.png`));
    }

    const subsetManifest: any = {
      manifest_version: '2.0.0',
      extraction_folder_path: subsetWorkspace,
      supermarket: { id: 'sm-danube', slug: 'danube', name_en: 'Danube', name_ar: 'الدانوب' },
      location: { location_scope: 'national', location_slug: 'national', city_id: null, region_id: null, label: 'National' },
      validity: { start_date: activeOfferStartDate, end_date: activeOfferEndDate },
      paths: {
        pages_dir: 'pages',
        crops_dir: 'crops',
        json_dir: 'json',
        reports_dir: 'reports'
      },
      page_count: 6,
      processing_selection: {
        pdfFingerprint: 'fp-subset-test-6p',
        totalDocumentPages: 6,
        selectionMode: 'specific',
        selectedPages: [2, 5],
        processingStatus: 'in_progress',
        coverage: 'partial'
      },
      processing_scope: {
        mode: 'selected_pages',
        pages: [2, 5]
      }
    };
    fs.writeFileSync(path.join(subsetWorkspace, 'extraction_manifest.json'), JSON.stringify(subsetManifest, null, 2), 'utf8');

    const progressEvents: PageFirstProgressEvent[] = [];
    const mockSubsetResponses = new Map<number, any>([
      [2, {
        ...mockOcrResponse,
        document_annotation: {
          ...mockAnnotation,
          page_number: 2
        }
      }],
      [5, {
        ...mockOcrResponse,
        document_annotation: {
          ...mockAnnotation,
          page_number: 5,
          offers: [{
            ...mockAnnotation.offers[0],
            temporary_offer_id: 'page5_off_01'
          }]
        }
      }]
    ]);

    const result = await sharedPageFirstPipelineService.runPipeline({
      packageDir: subsetWorkspace,
      pdfBaseName: 'subset-leaflet',
      pages: [2, 5],
      trustedContext: mockTrustedContext,
      rolloutMode: 'pilot',
      onProgress: (p) => progressEvents.push(p),
      mockPageResponses: mockSubsetResponses
    });

    expect(result.ok).toBe(true);
    expect(result.totalPages).toBe(2);
    expect(result.completedPages).toBe(2);
    expect(result.offersDetected).toBe(2);

    // Every emitted progress event must count ONLY the 2 selected pages, not 6 document pages
    expect(progressEvents.length).toBeGreaterThanOrEqual(6);
    expect(progressEvents.every(e => e.totalPages === 2)).toBe(true);

    const ocrEvents = progressEvents.filter(e => e.stage === 'ocr_running');
    expect(ocrEvents.map(e => ({ page: e.currentPage, primary: e.primaryCompletedPages, completed: e.completedPages }))).toEqual([
      { page: 2, primary: 0, completed: 0 },
      { page: 5, primary: 1, completed: 1 }
    ]);

    const croppingEvents = progressEvents.filter(e => e.stage === 'cropping');
    expect(croppingEvents.map(e => ({ page: e.currentPage, primary: e.primaryCompletedPages }))).toEqual([
      { page: 2, primary: 1 },
      { page: 5, primary: 2 }
    ]);

    const finalCompleted = progressEvents.find(e => e.stage === 'completed' && e.logCode === 'PAGE_FIRST_TEST_COMPLETE');
    expect(finalCompleted?.primaryCompletedPages).toBe(2);
    expect(finalCompleted?.completedPages).toBe(2);
    expect(finalCompleted?.totalPages).toBe(2);

    // Original PDF page numbers (2 and 5) preserved everywhere
    expect(result.items.map(i => i.source.source_page_number)).toEqual([2, 5]);
    expect(result.items[0].source.external_image_id).toContain('_p002_');
    expect(result.items[1].source.external_image_id).toContain('_p005_');

    const updatedManifest = JSON.parse(fs.readFileSync(path.join(subsetWorkspace, 'extraction_manifest.json'), 'utf8'));
    expect(updatedManifest.page_first_ocr.total_pages).toBe(2);
    expect(updatedManifest.page_first_ocr.completed_pages).toBe(2);
    expect(updatedManifest.processing_selection.totalDocumentPages).toBe(6);
    expect(updatedManifest.processing_selection.selectedPages).toEqual([2, 5]);
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
