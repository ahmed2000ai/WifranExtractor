/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ImportPage } from '../../../pages/ImportPage';
import { UnifiedBatchPreview } from '../UnifiedBatchPreview';
import { ProductMatchingReview } from '../ProductMatchingReview';
import type { BatchManifest, UnifiedBatchOffer } from '../../../../../shared/types/batchExtraction';
import type { MatchingRunManifest } from '../../../../../shared/types/catalogMatching';

vi.mock('../../../hooks/useConfigStatus', () => ({
  useConfigStatus: () => ({
    configStatus: {
      databaseEnvironment: {
        isValidatedProduction: false,
        displayBadge: 'Database: DEVELOPMENT_TEST (Isolated Test)',
        projectRef: 'gykrbpykjhpyrdrinkuk'
      },
      supabase: {
        url: { configured: true, required: true },
        anonKey: { configured: true, required: true },
        serviceRoleKey: { configured: true, required: true },
        storageBucket: { configured: true, required: true }
      },
      mistral: {
        apiKey: { configured: true, required: true },
        ocrModel: { configured: true, required: true },
        ocrEndpoint: { configured: true, required: true }
      },
      ocr: {
        chunkSize: 2,
        maxConcurrentRequests: 1,
        maxRetries: 2,
        requestTimeoutMs: 60000,
        rateLimitMode: 'free_tier_safe',
        requestsPerSecondLimit: 1,
        minRequestIntervalMs: 1000,
        tokensPerMinuteLimit: 100000,
        tpmSafetyRatio: 0.8
      },
      pdf: { renderDpi: 150 },
      images: { cropPaddingPercent: 5, outputFormat: 'webp', outputQuality: 85 },
      importBehavior: {
        defaultOfferDurationDays: 7,
        defaultOfferStatus: 'published',
        importDefaultStatus: 'published',
        allowNeedsReviewFallback: false,
        publishWarningsAllowed: false,
        lowConfidenceThreshold: 0.7,
        dataQualityNeedsReviewThreshold: 0.7,
        skipDuplicateOffers: true,
        autoCreateBrands: false,
        autoCreateProducts: false,
        autoCreateCategories: false,
        requireImageForDraft: false
      },
      debug: { saveIntermediateFiles: false, logLevel: 'info' },
      validation: { ok: true, errors: [], warnings: [] }
    },
    loading: false,
    error: null,
    refresh: vi.fn()
  })
}));

vi.mock('../../../hooks/useReferenceData', () => ({
  useReferenceData: () => ({
    data: {
      supermarkets: [{ id: 'sup-cf', name_en: 'Carrefour', slug: 'carrefour' }],
      regions: [{ id: 'reg-1', name_en: 'Makkah', slug: 'makkah' }],
      cities: [{ id: 'city-1', name_en: 'Jeddah', slug: 'jeddah', region_id: 'reg-1' }],
      supermarketRegions: [],
      categories: [],
      brands: [],
      units: []
    },
    loading: false,
    error: null,
    reload: vi.fn()
  })
}));

vi.mock('../../../hooks/useAppHealth', () => ({
  useAppHealth: () => ({
    health: {
      status: 'ok',
      version: '1.0.0',
      geminiConfigured: true
    },
    loading: false,
    refresh: vi.fn()
  })
}));

vi.mock('../../../context/PipelineContext', () => ({
  usePipelineContext: () => ({
    importForm: {
      formState: {
        pdfFile: null,
        supermarketId: 'sup-cf',
        location: {
          scope: 'national',
          regionId: '',
          cityId: ''
        },
        offerStartDate: '2026-11-11',
        offerEndDate: '2026-11-17',
        pageSelection: {
          mode: 'all',
          selectedPages: [],
          normalizedString: ''
        }
      },
      validation: { valid: true, isValid: true, errors: [] },
      setSupermarketId: vi.fn(),
      setLocation: vi.fn(),
      setOfferStartDate: vi.fn(),
      setOfferEndDate: vi.fn(),
      setPageSelectionMode: vi.fn(),
      setSpecificPageSelection: vi.fn(),
      restorePageSelection: vi.fn(),
      selectPdf: vi.fn(),
      setPdfFile: vi.fn(),
      canStart: false,
      configStatus: null
    },
    streamingPdfRender: {
      running: false,
      state: { workspacePath: null, pages: [] },
      pages: [],
      firstPageReady: false,
      latestEvent: null,
      error: null,
      startRender: vi.fn()
    },
    ocrTest: { running: false, result: null, error: null },
    ocrPipeline: { running: false, result: null, error: null, runPipeline: vi.fn() },
    imageCropping: { running: false, result: null, error: null, cropRows: vi.fn() },
    cropAndItemOcr: { running: false, result: null, error: null },
    pageFirstPipeline: { running: false, result: null, error: null },
    importTracking: { saving: false, result: null, error: null, persist: vi.fn() },
    entityMatching: { result: null, error: null },
    offerPreparation: { result: null, error: null },
    offerSync: { result: null, error: null }
  })
}));

vi.mock('../../../hooks/usePipelineSummary', () => ({
  usePipelineSummary: () => ({
    stages: []
  })
}));

function makeOffer(overrides: Partial<UnifiedBatchOffer>): UnifiedBatchOffer {
  return {
    batchOfferKey: 'b1:leaflet-001:1:o1',
    batchId: 'b1',
    leafletId: 'leaflet-001',
    sourceDocumentId: 'doc_cf',
    sourceFileName: 'carrefour.pdf',
    sourcePdfPath: '/tmp/carrefour.pdf',
    sourcePage: 1,
    sourceOfferId: 'o1',
    supermarketId: 'sup-cf',
    supermarketName: 'Carrefour',
    locationScope: 'national',
    locationLabel: 'National',
    cityId: null,
    regionId: null,
    offerStartDate: '2026-11-11',
    offerEndDate: '2026-11-17',
    currency: 'SAR',
    metadataVerified: true,
    metadataStatus: 'operator_verified',
    titleAr: 'منتج تجريبي ١ كج',
    titleEn: 'Sample Product 1kg',
    brand: 'SampleBrand',
    brandAr: 'سامبل',
    brandEn: 'SampleBrand',
    promoPrice: 15.5,
    originalPrice: 22.0,
    discountPercent: 30,
    promoNotes: null,
    sizeOrWeight: '1kg',
    each_size_value: 1,
    each_size_unit: 'kg',
    inner_pack_count: 1,
    sale_unit_type: 'piece',
    total_content_value: 1,
    total_content_unit: 'kg',
    free_units_text: null,
    customer_limit: null,
    assortment_status: 'confirmed_single_sku',
    productThumbCropPath: null,
    offerCardCropPath: null,
    conflictCodes: [],
    quarantineReasons: [],
    v3RetentionMode: 'unsplit_single_sku',
    status: 'extracted',
    category: 'grocery',
    confidence: 'high',
    warnings: [],
    blockingErrors: [],
    ...overrides
  };
}

function makeMatchingManifest(offers: UnifiedBatchOffer[]): MatchingRunManifest {
  return {
    schemaVersion: '1.0',
    batchId: 'b1',
    runId: 'run-ui-008',
    createdAt: '2026-11-15T10:00:00Z',
    updatedAt: '2026-11-15T10:00:00Z',
    status: 'completed',
    matchingDatabaseContext: 'DEVELOPMENT_TEST',
    model: 'gemini-3.8-flash',
    thinkingLevel: 'MEDIUM',
    executionMode: 'flex',
    brandSummaries: {},
    proposals: {
      [offers[0].batchOfferKey]: {
        batchOfferKey: offers[0].batchOfferKey,
        sourceOfferId: offers[0].sourceOfferId,
        sourcePage: 1,
        leafletId: 'leaflet-001',
        supermarketName: 'Carrefour',
        decision: 'existing',
        matchedProductId: '101',
        matchedDatabaseContext: 'DEVELOPMENT_TEST',
        matchedProduct: {
          id: '101',
          nameEn: offers[0].titleEn,
          nameAr: offers[0].titleAr,
          brand: offers[0].brand || 'SampleBrand',
          variant: null,
          sizeValue: 1,
          sizeUnit: 'kg',
          packCount: 1
        },
        temporaryId: null,
        confidence: 'high',
        matchMethod: 'deterministic',
        validationIssues: [],
        operatorDecision: 'approved',
        updatedAt: '2026-11-15T10:00:00Z'
      },
      [offers[1].batchOfferKey]: {
        batchOfferKey: offers[1].batchOfferKey,
        sourceOfferId: offers[1].sourceOfferId,
        sourcePage: 1,
        leafletId: 'leaflet-001',
        supermarketName: 'Carrefour',
        decision: 'unresolved',
        matchedProductId: null,
        matchedProduct: null,
        temporaryId: null,
        confidence: 'low',
        matchMethod: 'deterministic',
        validationIssues: [],
        operatorDecision: 'proposed',
        updatedAt: '2026-11-15T10:00:00Z'
      },
      [offers[2].batchOfferKey]: {
        batchOfferKey: offers[2].batchOfferKey,
        sourceOfferId: offers[2].sourceOfferId,
        sourcePage: 1,
        leafletId: 'leaflet-001',
        supermarketName: 'Carrefour',
        decision: 'unresolved',
        matchedProductId: null,
        matchedProduct: null,
        temporaryId: null,
        confidence: 'low',
        matchMethod: 'deterministic',
        validationIssues: [],
        operatorDecision: 'proposed',
        updatedAt: '2026-11-15T10:00:00Z'
      },
      [offers[3].batchOfferKey]: {
        batchOfferKey: offers[3].batchOfferKey,
        sourceOfferId: offers[3].sourceOfferId,
        sourcePage: 1,
        leafletId: 'leaflet-001',
        supermarketName: 'Carrefour',
        decision: 'existing',
        matchedProductId: '104',
        matchedDatabaseContext: 'DEVELOPMENT_TEST',
        matchedProduct: {
          id: '104',
          nameEn: offers[3].titleEn,
          nameAr: offers[3].titleAr,
          brand: offers[3].brand || 'SampleBrand',
          variant: null,
          sizeValue: 1,
          sizeUnit: 'kg',
          packCount: 1
        },
        temporaryId: null,
        confidence: 'high',
        matchMethod: 'deterministic',
        validationIssues: [],
        operatorDecision: 'approved',
        updatedAt: '2026-11-15T10:00:00Z'
      }
    },
    temporaryProducts: {},
    consumerImageApprovals: {},
    totals: {
      totalExtractedOffers: 4,
      uniqueIdentitiesCount: 4,
      cacheMatchesCount: 2,
      deterministicMatchesCount: 0,
      geminiEvaluatedCount: 0,
      proposedExistingCount: 2,
      proposedTemporaryCount: 0,
      unresolvedCount: 2,
      validationWarningsCount: 0,
      actualCostUsd: 0,
      estimatedCostUsd: 0,
      geminiRequestsCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0
    }
  };
}

describe('WIFRAN FIX-08 Selective Publication UI Verification', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('Step 1 (ImportPage): shows Partially Published badge, published/remaining summary, and Reopen Deferred & Publish action', async () => {
    const partialBatch: BatchManifest = {
      schemaVersion: '1.0',
      batchId: 'batch-partial-001',
      createdAt: '2026-11-15T10:00:00Z',
      updatedAt: '2026-11-15T11:00:00Z',
      status: 'partially_published',
      workspaceDir: '/tmp/batches/batch-partial-001',
      model: 'gemini-3.8-flash',
      executionMode: 'flex',
      extractionPipelineMode: 'hybrid_v3',
      leaflets: [
        {
          leafletId: 'leaflet-001',
          fileName: 'carrefour-p23.pdf',
          filePath: '/tmp/carrefour-p23.pdf',
          fileSizeBytes: 1000,
          fileFingerprint: 'abc123',
          pageCount: 62,
          pagesProcessed: 1,
          offersCount: 12,
          estimatedCostUsd: 0,
          status: 'completed',
          workspacePath: '/tmp/ws',
          provenance: 'cache',
          metadata: {
            supermarketId: 'sup-cf',
            supermarketName: 'Carrefour',
            locationScope: 'national',
            offerStartDate: '2026-11-11',
            offerEndDate: '2026-11-17',
            verified: true,
            metadataStatus: 'operator_verified'
          }
        }
      ],
      publishedOffers: {
        'batch-partial-001:leaflet-001:23:o1': {
          sourceOfferId: 'doc:p023:o1',
          state: 'published',
          databaseContext: 'DEVELOPMENT_TEST',
          publishOperationId: 'op-1',
          publishedAt: '2026-11-15T11:00:00Z'
        }
      },
      totals: {
        totalPdfs: 1,
        completedPdfs: 1,
        failedPdfs: 0,
        cancelledPdfs: 0,
        totalPages: 1,
        pagesProcessed: 1,
        totalOffers: 12,
        totalCostUsd: 0
      }
    };

    const getSummaryMock = vi.fn(async () => ({
      ...partialBatch,
      supermarketsRepresented: ['Carrefour'],
      totalOffers: 12
    }));
    const getUnifiedOffersMock = vi.fn(async () => []);

    (window as any).wifranExtractor = {
      batch: {
        list: vi.fn(async () => [partialBatch]),
        getSummary: getSummaryMock,
        getUnifiedOffers: getUnifiedOffersMock
      },
      matching: {
        getStatus: vi.fn(async () => null)
      }
    };

    render(<ImportPage />);
    const batchToggle = screen.queryByTestId('mode-batch-leaflets');
    if (batchToggle) fireEvent.click(batchToggle);

    expect(await screen.findByText(/Partially Published/i)).toBeInTheDocument();
    expect(screen.getByText(/\(1 published \/ 11 remaining\)/i)).toBeInTheDocument();
    const reopenBtn = screen.getByRole('button', { name: /Reopen Deferred & Publish/i });
    expect(reopenBtn).toBeEnabled();

    fireEvent.click(reopenBtn);
    await waitFor(() => {
      expect(getSummaryMock).toHaveBeenCalledWith('batch-partial-001');
    });
  });

  it('Step 3 (UnifiedBatchPreview): filters Published and Blocked (Deferred) offers and submits Save & Revalidate Corrections with currency, assortment_status, and confirmConflictResolution', async () => {
    const offers: UnifiedBatchOffer[] = [
      makeOffer({
        batchOfferKey: 'b1:leaflet-001:1:o1',
        sourceOfferId: 'o1',
        titleEn: 'Ready Basmati Rice 1kg'
      }),
      makeOffer({
        batchOfferKey: 'b1:leaflet-001:1:o2',
        sourceOfferId: 'o2',
        titleEn: 'Blocked Canola Oil 1.5L',
        titleAr: 'زيت كانولا ١،٥ مل',
        quarantineReasons: ['EN_AR_WEIGHT_VOLUME_CONFLICT'],
        conflictCodes: ['EN_AR_WEIGHT_VOLUME_CONFLICT'],
        v3RetentionMode: 'quarantined_do_not_publish'
      }),
      makeOffer({
        batchOfferKey: 'b1:leaflet-001:1:o3',
        sourceOfferId: 'o3',
        titleEn: 'Needs Review Pasta 400g'
      }),
      makeOffer({
        batchOfferKey: 'b1:leaflet-001:1:o4',
        sourceOfferId: 'o4',
        titleEn: 'Already Published Milk 1L',
        status: 'published',
        publicationState: {
          sourceOfferId: 'doc:p1:o4',
          state: 'published',
          databaseContext: 'DEVELOPMENT_TEST',
          publishOperationId: 'op-prior-1',
          publishedAt: '2026-11-15T10:05:00Z'
        }
      })
    ];

    const batchSummary: any = {
      schemaVersion: '1.0',
      batchId: 'b1',
      createdAt: '2026-11-15T10:00:00Z',
      updatedAt: '2026-11-15T10:05:00Z',
      status: 'partially_published',
      workspaceDir: '/tmp/batches/b1',
      model: 'gemini-3.8-flash',
      executionMode: 'flex',
      extractionPipelineMode: 'hybrid_v3',
      supermarketsRepresented: ['Carrefour'],
      totalOffers: 4,
      leaflets: [
        {
          leafletId: 'leaflet-001',
          fileName: 'carrefour.pdf',
          filePath: '/tmp/carrefour.pdf',
          fileSizeBytes: 1000,
          fileFingerprint: 'fp1',
          pageCount: 1,
          pagesProcessed: 1,
          offersCount: 4,
          estimatedCostUsd: 0,
          status: 'completed',
          workspacePath: '/tmp/ws',
          metadata: {
            supermarketId: 'sup-cf',
            supermarketName: 'Carrefour',
            locationScope: 'national',
            offerStartDate: '2026-11-11',
            offerEndDate: '2026-11-17',
            currency: 'SAR',
            verified: true,
            metadataStatus: 'operator_verified'
          }
        }
      ],
      totals: {
        totalPdfs: 1,
        completedPdfs: 1,
        failedPdfs: 0,
        cancelledPdfs: 0,
        totalPages: 1,
        pagesProcessed: 1,
        totalOffers: 4,
        totalCostUsd: 0
      }
    };

    const matchingManifest = makeMatchingManifest(offers);
    const updateOfferFieldsMock = vi.fn(async () => offers[1]);

    (window as any).wifranExtractor = {
      batch: {
        getSummary: vi.fn(async () => batchSummary),
        getUnifiedOffers: vi.fn(async () => offers),
        updateOfferFields: updateOfferFieldsMock,
        updateLeafletMetadata: vi.fn(async () => batchSummary)
      },
      matching: {
        getStatus: vi.fn(async () => matchingManifest)
      }
    };

    render(<UnifiedBatchPreview batchId="b1" onBack={vi.fn()} />);

    expect(await screen.findByText(/Ready Basmati Rice 1kg/i)).toBeInTheDocument();

    // Triage filter pills
    const publishedPill = screen.getByRole('button', { name: /Published \(1\)/i });
    const blockedPill = screen.getByRole('button', { name: /Blocked \(Deferred\) \(1\)/i });
    expect(publishedPill).toBeInTheDocument();
    expect(blockedPill).toBeInTheDocument();

    // Filter to Published
    fireEvent.click(publishedPill);
    expect(screen.getByText(/Already Published Milk 1L/i)).toBeInTheDocument();
    expect(screen.queryByText(/Blocked Canola Oil 1.5L/i)).not.toBeInTheDocument();

    // Filter to Blocked (Deferred) and edit + revalidate
    fireEvent.click(blockedPill);
    expect(screen.getByText(/Blocked Canola Oil 1.5L/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Inspect/i }));

    const saveRevalidateBtn = await screen.findByRole('button', { name: /Save & Revalidate Corrections/i });
    expect(saveRevalidateBtn).toBeInTheDocument();

    const confirmCheckbox = screen.getByLabelText(/I verified the card evidence and resolved all extraction conflicts above/i);
    fireEvent.click(confirmCheckbox);
    fireEvent.click(saveRevalidateBtn);

    await waitFor(() => {
      expect(updateOfferFieldsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          batchId: 'b1',
          batchOfferKey: 'b1:leaflet-001:1:o2',
          patch: expect.objectContaining({
            revalidate: true,
            confirmConflictResolution: true,
            assortment_status: 'confirmed_single_sku'
          })
        })
      );
    });
  });

  it('Step 4 (ProductMatchingReview): shows Publish X Ready Offers — Y Deferred, 4-metric breakdown, and disables Publish when 0 Ready', async () => {
    const offers: UnifiedBatchOffer[] = [
      makeOffer({ batchOfferKey: 'b1:leaflet-001:1:o1', sourceOfferId: 'o1', titleEn: 'Ready Offer' }),
      makeOffer({
        batchOfferKey: 'b1:leaflet-001:1:o2',
        sourceOfferId: 'o2',
        titleEn: 'Blocked Offer',
        quarantineReasons: ['EN_AR_WEIGHT_VOLUME_CONFLICT']
      }),
      makeOffer({ batchOfferKey: 'b1:leaflet-001:1:o3', sourceOfferId: 'o3', titleEn: 'Needs Review Offer' }),
      makeOffer({
        batchOfferKey: 'b1:leaflet-001:1:o4',
        sourceOfferId: 'o4',
        titleEn: 'Published Offer',
        status: 'published',
        publicationState: {
          sourceOfferId: 'doc:p1:o4',
          state: 'published',
          databaseContext: 'DEVELOPMENT_TEST',
          publishOperationId: 'op-1',
          publishedAt: '2026-11-15T10:05:00Z'
        }
      })
    ];
    const manifest = makeMatchingManifest(offers);

    (window as any).wifranExtractor = {
      matching: {
        getStatus: vi.fn(async () => manifest),
        estimate: vi.fn(async () => null),
        getRetryFailedSummary: vi.fn(async () => null),
        onProgress: vi.fn(() => () => {}),
        publishApproved: vi.fn(async () => ({}))
      }
    };

    const { rerender } = render(
      <ProductMatchingReview batchId="b1" offers={offers} onBack={vi.fn()} />
    );

    const publishBtn = await screen.findByRole('button', {
      name: /Publish 1 Ready Offers — 2 Deferred \(Dev Test\)/i
    });
    expect(publishBtn).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/Authorize Dev DB Write/i));
    expect(publishBtn).toBeEnabled();

    expect(screen.getByText(/Ready to Publish Now:/i)).toBeInTheDocument();
    expect(screen.getByText(/Deferred \(Needs Review \/ Blocked\):/i)).toBeInTheDocument();
    expect(screen.getByText(/Previously Published \(Skipped\):/i)).toBeInTheDocument();

    // Re-render with 0 Ready offers (only Blocked + Published remain) -> button must remain disabled
    const noReadyOffers = offers.slice(1);
    rerender(<ProductMatchingReview batchId="b1" offers={noReadyOffers} onBack={vi.fn()} />);

    const zeroReadyBtn = await screen.findByRole('button', {
      name: /Publish 0 Ready Offers — 2 Deferred \(Dev Test\)/i
    });
    expect(zeroReadyBtn).toBeDisabled();
  });
});
