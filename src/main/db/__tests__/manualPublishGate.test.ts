import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { sharedPageFirstPipelineService } from '../../page-first/pageFirstPipelineService';
import { buildPrePublishSummary, markPrePublishOpened, markPrePublishApproved } from '../../prepublish/prePublishApprovalService';
import { syncPreparedOffers } from '../offerSyncService';
import { persistImportTracking } from '../importTrackingService';
import { saveExtractionManifest } from '../../extraction/extractionManifestService';
import { LeafletMetadataService } from '../../metadata/leafletMetadataService';
import { LeafletMetadataCacheService } from '../../metadata/leafletMetadataCacheService';
import type { ExtractionManifest } from '../../../shared/types/extractionManifest';

const PANDA_SUPERMARKET_ID = 'c2cc16c2-0001-4444-b000-c00000000001';

// Spy on database interactions
const dbCallTracker = {
  fromCalls: [] as string[],
  insertCalls: 0,
  updateCalls: 0,
  uploadCalls: 0
};

vi.mock('../supabaseAdminClient', () => ({
  getSupabaseAdminClient: () => ({
    from: (table: string) => {
      dbCallTracker.fromCalls.push(table);
      return {
        insert: (_data: any) => {
          dbCallTracker.insertCalls++;
          return {
            select: () => ({
              single: async () => ({ data: { id: 'mock-db-id', status: 'completed' }, error: null })
            })
          };
        },
        update: (_data: any) => {
          dbCallTracker.updateCalls++;
          return {
            eq: async () => ({ data: [], error: null })
          };
        },
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { id: 'mock-db-id' }, error: null }),
            limit: async () => ({ data: [], error: null })
          })
        })
      };
    },
    storage: {
      from: () => ({
        upload: async () => {
          dbCallTracker.uploadCalls++;
          return { data: { path: 'mock-path' }, error: null };
        },
        getPublicUrl: () => ({ data: { publicUrl: 'https://mock.storage/image.jpg' } })
      })
    }
  })
}));

vi.mock('../../storage/offerImageStorageService', () => ({
  uploadOfferImage: async () => {
    dbCallTracker.uploadCalls++;
    return { imageUrl: 'https://mock.storage/image.jpg', storagePath: 'offers/mock.jpg' };
  }
}));

describe('Manual DB Publishing Gate (HOTFIX Verification)', () => {
  const createdDirs: string[] = [];
  const createdFingerprints: string[] = [];
  let testWorkspace: string;
  let testPdfFingerprint: string;

  const mockAnnotation = {
    schema_version: 1,
    page_number: 1,
    page_classification: 'offer_page' as const,
    offers: [
      {
        temporary_offer_id: 'page1_off_01',
        region_hint: 'top_left' as const,
        product: {
          title_ar: 'حليب المراعي 1 لتر',
          title_en: 'Almarai Milk 1L',
          brand_text: 'Almarai',
          description_ar: null,
          description_en: null,
          item_domain: 'grocery' as const,
          variant_names: []
        },
        price_candidates: [
          {
            raw_text: '5.50',
            normalized_value: 5.5,
            currency: 'SAR' as const,
            role: 'current_offer_price' as const,
            is_crossed_out: false,
            confidence: 'high' as const,
            evidence_text: '5.50'
          }
        ],
        selected_prices: {
          offer_price: 5.5,
          original_price: 7.0,
          currency: 'SAR' as const,
          offer_price_raw_text: '5.50',
          original_price_raw_text: '7.00',
          confidence: 'high' as const
        },
        content: {
          size_text: '1L',
          each_size_value: 1,
          each_size_unit: 'liter' as const,
          pack_quantity: 1,
          bundle_quantity: null,
          total_content_value: 1,
          total_content_unit: 'liter' as const
        },
        price_basis: { basis: 'each' as const, raw_text: 'للحبة' },
        promotion: { mechanic: 'standard_price' as const, raw_text: null, condition_text: null },
        evidence: {
          title_texts: ['حليب المراعي 1 لتر'],
          description_texts: [],
          current_price_texts: ['5.50'],
          original_price_texts: ['7.00'],
          size_content_texts: ['1L'],
          promotion_texts: [],
          final_evidence_summary: 'حليب المراعي 1 لتر 5.50'
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
      id: 'b1',
      pageNumber: 1,
      text: 'حليب المراعي 1 لتر Almarai Milk 1L',
      normalizedText: 'حليب المراعي 1 لتر almarai milk 1l',
      boundingBox: { x: 50, y: 50, width: 200, height: 40 },
      confidence: 0.95,
      isPriceCandidate: false
    },
    {
      id: 'b2',
      pageNumber: 1,
      text: '5.50 SAR',
      normalizedText: '5.50 sar',
      boundingBox: { x: 50, y: 100, width: 80, height: 30 },
      confidence: 0.98,
      isPriceCandidate: true
    }
  ];

  const mockPageResponse = {
    document_annotation: mockAnnotation,
    pages: [{ blocks: mockOcrBlocks }]
  };

  beforeEach(async () => {
    dbCallTracker.fromCalls = [];
    dbCallTracker.insertCalls = 0;
    dbCallTracker.updateCalls = 0;
    dbCallTracker.uploadCalls = 0;

    testWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'wifran-manual-gate-'));
    createdDirs.push(testWorkspace);

    // Create fresh workspace with pages
    fs.mkdirSync(path.join(testWorkspace, 'pages'), { recursive: true });
    fs.mkdirSync(path.join(testWorkspace, 'metadata'), { recursive: true });

    // Create source PDF on disk so authoritative SHA-256 content identity resolution works end-to-end
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([400, 600]);
    const pdfBytes = Buffer.from(await pdfDoc.save());
    fs.writeFileSync(path.join(testWorkspace, 'original.pdf'), pdfBytes);
    testPdfFingerprint = new LeafletMetadataCacheService().computeFingerprint(pdfBytes);
    createdFingerprints.push(testPdfFingerprint);

    // Create dummy rendered page images
    await sharp({
      create: { width: 400, height: 400, channels: 3, background: { r: 250, g: 250, b: 250 } }
    }).jpeg().toFile(path.join(testWorkspace, 'pages', 'page-1.jpg'));

    await sharp({
      create: { width: 400, height: 400, channels: 3, background: { r: 250, g: 250, b: 250 } }
    }).jpeg().toFile(path.join(testWorkspace, 'pages', 'page-2.jpg'));

    // Base manifest
    const initialManifest: any = {
      manifest_version: '2.0.0',
      extraction_folder_path: testWorkspace,
      supermarket: { id: PANDA_SUPERMARKET_ID, slug: 'panda', name_en: 'Panda', name_ar: 'بندا' },
      location: { location_scope: 'national', location_slug: 'national', city_id: null, region_id: null, label: 'National' },
      validity: { start_date: '2026-10-01', end_date: '2026-10-15' },
      paths: {
        pages_dir: path.join(testWorkspace, 'pages'),
        crops_dir: path.join(testWorkspace, 'crops'),
        json_dir: path.join(testWorkspace, 'json'),
        reports_dir: path.join(testWorkspace, 'reports')
      },
      page_count: 2,
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
      },
      db_update_status: 'not_started'
    };

    await saveExtractionManifest(testWorkspace, initialManifest as ExtractionManifest);
  });

  afterAll(() => {
    const cacheService = new LeafletMetadataCacheService();
    for (const fp of createdFingerprints) {
      try {
        cacheService.invalidate(fp);
      } catch {
        // ignore cleanup errors
      }
    }
    for (const dir of createdDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  });

  it('1. Test Current Page performs NO database writes', async () => {
    const mockMap = new Map<number, any>();
    mockMap.set(1, mockPageResponse);

    const result = await sharedPageFirstPipelineService.runPipeline({
      packageDir: testWorkspace,
      pdfBaseName: 'test-leaflet',
      pages: [1],
      trustedContext: {
        supermarketId: 'sm-panda',
        supermarketSlug: 'panda',
        locationScope: 'national',
        cityId: null,
        regionId: null,
        offerStartDate: '2026-10-01',
        offerEndDate: '2026-10-15',
        leafletId: 'leaflet-123'
      },
      mockPageResponses: mockMap
    });

    expect(result.ok).toBe(true);
    expect(result.completedPages).toBe(1);

    // CRITICAL ASSERTION: Zero Supabase writes or storage uploads
    expect(dbCallTracker.fromCalls.length).toBe(0);
    expect(dbCallTracker.insertCalls).toBe(0);
    expect(dbCallTracker.updateCalls).toBe(0);
    expect(dbCallTracker.uploadCalls).toBe(0);
  });

  it('2. Process Entire Leaflet performs NO database writes', async () => {
    const mockMap = new Map<number, any>();
    mockMap.set(1, mockPageResponse);
    mockMap.set(2, {
      document_annotation: { ...mockAnnotation, page_number: 2 },
      pages: [{ blocks: mockOcrBlocks }]
    });

    const result = await sharedPageFirstPipelineService.runPipeline({
      packageDir: testWorkspace,
      pdfBaseName: 'test-leaflet',
      pages: [1, 2],
      trustedContext: {
        supermarketId: 'sm-panda',
        supermarketSlug: 'panda',
        locationScope: 'national',
        cityId: null,
        regionId: null,
        offerStartDate: '2026-10-01',
        offerEndDate: '2026-10-15',
        leafletId: 'leaflet-123'
      },
      mockPageResponses: mockMap
    });

    expect(result.ok).toBe(true);
    expect(result.completedPages).toBe(2);

    // CRITICAL ASSERTION: Zero Supabase writes or storage uploads
    expect(dbCallTracker.fromCalls.length).toBe(0);
    expect(dbCallTracker.insertCalls).toBe(0);
    expect(dbCallTracker.updateCalls).toBe(0);
    expect(dbCallTracker.uploadCalls).toBe(0);
  });

  it('3. Opening Pre-Publish Preview performs NO database writes', async () => {
    // Run extraction first
    const mockMap = new Map<number, any>();
    mockMap.set(1, mockPageResponse);
    await sharedPageFirstPipelineService.runPipeline({
      packageDir: testWorkspace,
      pdfBaseName: 'test-leaflet',
      pages: [1],
      trustedContext: {
        supermarketId: 'sm-panda',
        supermarketSlug: 'panda',
        locationScope: 'national',
        cityId: null,
        regionId: null,
        offerStartDate: '2026-10-01',
        offerEndDate: '2026-10-15',
        leafletId: 'leaflet-123'
      },
      mockPageResponses: mockMap
    });

    // Operator opens Pre-Publish Preview
    const summary = await buildPrePublishSummary(testWorkspace);
    await markPrePublishOpened(testWorkspace);

    expect(summary.supermarket_name).toBe('Panda');
    expect(summary.counts.total_items).toBeGreaterThanOrEqual(1);

    // Verify manifest state updated locally to 'opened'
    const manifest = JSON.parse(fs.readFileSync(path.join(testWorkspace, 'extraction_manifest.json'), 'utf-8'));
    expect(manifest.pre_publish_preview?.status).toBe('opened');

    // CRITICAL ASSERTION: Zero Supabase writes or storage uploads occurred
    expect(dbCallTracker.fromCalls.length).toBe(0);
    expect(dbCallTracker.insertCalls).toBe(0);
    expect(dbCallTracker.updateCalls).toBe(0);
    expect(dbCallTracker.uploadCalls).toBe(0);
  });

  it('4. Canceling the publish confirmation performs NO database writes', async () => {
    // Run extraction and open preview
    const mockMap = new Map<number, any>();
    mockMap.set(1, mockPageResponse);
    await sharedPageFirstPipelineService.runPipeline({
      packageDir: testWorkspace,
      pdfBaseName: 'test-leaflet',
      pages: [1],
      trustedContext: {
        supermarketId: 'sm-panda',
        supermarketSlug: 'panda',
        locationScope: 'national',
        cityId: null,
        regionId: null,
        offerStartDate: '2026-10-01',
        offerEndDate: '2026-10-15',
        leafletId: 'leaflet-123'
      },
      mockPageResponses: mockMap
    });

    await buildPrePublishSummary(testWorkspace);
    await markPrePublishOpened(testWorkspace);

    // Operator presses Cancel in UI modal -> markPrePublishApproved is NEVER called
    // Manifest status remains 'opened' (NOT approved)
    const manifest = JSON.parse(fs.readFileSync(path.join(testWorkspace, 'extraction_manifest.json'), 'utf-8'));
    expect(manifest.pre_publish_preview?.status).toBe('opened');

    // Any attempt to call DB sync or persist tracking must be BLOCKED
    await expect(syncPreparedOffers({
      supermarketId: 'sm-panda',
      locationScope: 'national',
      locationSlug: 'national',
      cityId: null,
      regionId: null,
      offerStartDate: '2026-10-01',
      offerEndDate: '2026-10-15',
      storageBucket: 'offers',
      rows: [],
      options: {
        requireImageForDraft: false,
        defaultOfferStatus: 'published',
        importDefaultStatus: 'published',
        allowNeedsReviewFallback: true,
        publishWarningsAllowed: true,
        extractionPackagePath: testWorkspace
      }
    })).rejects.toThrow('DB publish blocked: Pre-Publish Preview approval is required.');

    const persistResult = await persistImportTracking({
      metadata: {
        supermarketId: 'sm-panda',
        locationScope: 'national',
        cityId: null,
        regionId: null,
        supermarketLabel: 'Panda',
        locationLabel: 'National',
        offerStartDate: '2026-10-01',
        offerEndDate: '2026-10-15',
        originalFileName: 'test.pdf',
        workspacePath: testWorkspace,
        leafletId: 'leaflet-123'
      },
      ocr: {
        totalExtractedItems: 1,
        totalNormalizedRows: 1,
        validRowCount: 1,
        warningRowCount: 0,
        errorRowCount: 0,
        skippedRowCount: 0,
        skippedPromotionalRowCount: 0,
        normalizedRows: []
      },
      crops: null
    });

    expect(persistResult.ok).toBe(false);
    expect(persistResult.error?.code).toBe('PUBLISH_APPROVAL_REQUIRED');

    // CRITICAL ASSERTION: Zero database writes occurred after cancel
    expect(dbCallTracker.fromCalls.length).toBe(0);
    expect(dbCallTracker.insertCalls).toBe(0);
    expect(dbCallTracker.updateCalls).toBe(0);
    expect(dbCallTracker.uploadCalls).toBe(0);
  });

  it('5. DB writes occur ONLY after explicit Publish approval AND authoritative metadata confirmation', async () => {
    // Run extraction
    const mockMap = new Map<number, any>();
    mockMap.set(1, mockPageResponse);
    await sharedPageFirstPipelineService.runPipeline({
      packageDir: testWorkspace,
      pdfBaseName: 'test-leaflet',
      pages: [1],
      trustedContext: {
        supermarketId: PANDA_SUPERMARKET_ID,
        supermarketSlug: 'panda',
        locationScope: 'national',
        cityId: null,
        regionId: null,
        offerStartDate: '2026-10-01',
        offerEndDate: '2026-10-15',
        leafletId: testPdfFingerprint
      },
      mockPageResponses: mockMap
    });

    const summary = await buildPrePublishSummary(testWorkspace);
    await markPrePublishOpened(testWorkspace);

    // ZERO writes prior to explicit approval
    expect(dbCallTracker.insertCalls).toBe(0);

    // Operator explicitly clicks Publish to Database and confirms in dialog
    await markPrePublishApproved(testWorkspace, summary.counts);

    // Verify manifest status is now approved
    const manifest = JSON.parse(fs.readFileSync(path.join(testWorkspace, 'extraction_manifest.json'), 'utf-8'));
    expect(manifest.pre_publish_preview?.status).toBe('approved');
    expect(manifest.pre_publish_preview?.approved_at).toBeTruthy();

    const localImgPath = path.join(testWorkspace, 'pages', 'page-1.jpg');
    const baseSyncInput = {
      supermarketId: PANDA_SUPERMARKET_ID,
      locationScope: 'national' as const,
      locationSlug: 'national',
      cityId: null,
      regionId: null,
      offerStartDate: '2026-10-01',
      offerEndDate: '2026-10-15',
      leafletId: testPdfFingerprint,
      storageBucket: 'offers',
      rows: [
        {
          rowId: 'row-1',
          pageNumber: 1,
          status: 'prepared' as const,
          normalizedData: {},
          localImagePath: localImgPath,
          preparedPayload: {
            supermarket_id: PANDA_SUPERMARKET_ID,
            coverage_scope: 'national',
            city_id: 'c1',
            offer_start_date: '2026-10-01',
            offer_end_date: '2026-10-15',
            title_ar: 'حليب المراعي 1 لتر',
            title_en: 'Almarai Milk 1L',
            offer_price: 5.5,
            original_price: 7.0,
            currency: 'SAR',
            item_domain: 'grocery',
            source_page_number: 1,
            source_item_number: '001',
            image_source_type: 'local',
            status: 'published'
          }
        }
      ],
      options: {
        requireImageForDraft: false,
        defaultOfferStatus: 'published' as const,
        importDefaultStatus: 'published' as const,
        allowNeedsReviewFallback: true,
        publishWarningsAllowed: true,
        extractionPackagePath: testWorkspace,
        requirePrePublishApproval: true
      }
    };

    // Unconfirmed metadata MUST STILL BLOCK publishing even after Pre-Publish Preview approval
    await expect(syncPreparedOffers(baseSyncInput)).rejects.toThrow(/DB publish blocked: PUBLISH_BLOCKED/);
    expect(dbCallTracker.insertCalls).toBe(0);
    expect(dbCallTracker.fromCalls.length).toBe(0);

    // Authoritatively confirm leaflet metadata for this PDF SHA-256 fingerprint
    const metadataService = new LeafletMetadataService();
    metadataService.confirmMetadata({
      leafletFingerprint: testPdfFingerprint,
      sourceFileName: 'original.pdf',
      supermarketId: PANDA_SUPERMARKET_ID,
      supermarketSlug: 'panda',
      startDate: '2026-10-01',
      endDate: '2026-10-15',
      locationScope: 'national',
      operatorId: 'operator_test',
      workspacePath: testWorkspace
    });

    // Wrong / mismatched fingerprint MUST remain blocked even after confirming the real PDF
    await expect(
      syncPreparedOffers({
        ...baseSyncInput,
        leafletId: 'f'.repeat(64)
      })
    ).rejects.toThrow(/DB publish blocked: PUBLISH_BLOCKED/i);
    expect(dbCallTracker.insertCalls).toBe(0);

    // Now publishing with valid Pre-Publish approval + valid confirmed metadata proceeds
    const syncResult = await syncPreparedOffers(baseSyncInput);

    expect(syncResult.ok).toBe(true);
    expect(syncResult.publishedRows).toBe(1);

    // DB writes were performed ONLY after explicit operator approval & confirmed metadata
    expect(dbCallTracker.fromCalls).toContain('offers');
    expect(dbCallTracker.insertCalls).toBeGreaterThan(0);
  });
});
