/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MultiPdfSelector } from '../MultiPdfSelector';
import { UnifiedBatchPreview } from '../UnifiedBatchPreview';
import { ProductMatchingReview } from '../ProductMatchingReview';
import type { SelectedPdfFile } from '../../../../../shared/types/importForm';
import type { UnifiedBatchOffer, UnifiedBatchSummary } from '../../../../../shared/types/batchExtraction';

describe('WIFRAN-005J-UAT-FIX-06 — Consolidated Authorization, Auto-Accepted Badges & Hidden Optional Fields UI', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('consolidates cost estimate, spending cap, and Start Extraction in Batch Setup without extra authorization screen', () => {
    const file: SelectedPdfFile = {
      path: 'C:/tmp/othaim.pdf',
      name: 'othaim-markets-72800415-jeddah.pdf',
      extension: '.pdf',
      sizeBytes: 2048,
      pageCount: 50,
      pageSelectionMode: 'specific',
      pageSelectionInput: '27, 41',
      selectedPages: [27, 41]
    };

    const onStart = vi.fn();
    render(
      <MultiPdfSelector
        selectedFiles={[file]}
        onFilesChange={vi.fn()}
        onStartExtraction={onStart}
        isExtracting={false}
        extractionPipelineMode="hybrid_v3"
      />
    );

    expect(screen.getByText(/Estimated Total Cost/i)).toBeInTheDocument();
    const capInput = screen.getByLabelText(/Maximum Authorized Spending Cap \(USD\)/i) as HTMLInputElement;
    expect(Number(capInput.value)).toBeGreaterThan(0);

    fireEvent.change(capInput, { target: { value: '0.2500' } });
    const startBtn = screen.getByRole('button', { name: /Start Processing \(1 Leaflet, 2 Pages\)/i });
    fireEvent.click(startBtn);

    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        approvedMaxBudgetUsd: 0.25,
        targetDatabaseContext: 'PRODUCTION_UI'
      })
    );
  });

  it('Step 3A renders Auto Accepted vs Needs Review badges, National (assumed), and hides Title/SAR Currency inside Optional Details', async () => {
    const summary: UnifiedBatchSummary = {
      batchId: 'batch-fix06-step3',
      status: 'completed',
      createdAt: '2026-11-15T00:00:00Z',
      updatedAt: '2026-11-15T00:00:00Z',
      supermarketsRepresented: ['Noori Supermarket', 'Danube'],
      totalOffers: 0,
      totals: {
        totalPdfs: 2,
        completedPdfs: 2,
        failedPdfs: 0,
        cancelledPdfs: 0,
        totalPages: 2,
        pagesProcessed: 2,
        totalOffers: 0,
        totalCostUsd: 0.04
      },
      leaflets: [
        {
          leafletId: 'leaflet-001',
          fileName: 'noori.pdf',
          filePath: 'C:/tmp/noori.pdf',
          fileSizeBytes: 1024,
          fileFingerprint: 'fp-1',
          pageCount: 20,
          pagesToProcess: [1],
          pageSelectionMode: 'specific',
          pagesProcessed: 1,
          offersCount: 0,
          estimatedCostUsd: 0.02,
          status: 'completed',
          workspacePath: 'C:/tmp/ws-1',
          provenance: 'fresh',
          metadata: {
            supermarketId: 'sup-noori',
            supermarketName: 'Noori Supermarket',
            offerStartDate: '2026-11-11',
            offerEndDate: '2026-11-17',
            currency: 'SAR',
            locationScope: 'national',
            locationSlug: 'national',
            locationLabel: 'National — Saudi Arabia (assumed)',
            scopeSource: 'default_national',
            verified: false,
            metadataStatus: 'auto_accepted'
          }
        },
        {
          leafletId: 'leaflet-002',
          fileName: 'danube-usd.pdf',
          filePath: 'C:/tmp/danube.pdf',
          fileSizeBytes: 1024,
          fileFingerprint: 'fp-2',
          pageCount: 20,
          pagesToProcess: [1],
          pageSelectionMode: 'specific',
          pagesProcessed: 1,
          offersCount: 0,
          estimatedCostUsd: 0.02,
          status: 'completed',
          workspacePath: 'C:/tmp/ws-2',
          provenance: 'fresh',
          metadata: {
            supermarketId: 'sup-danube',
            supermarketName: 'Danube',
            offerStartDate: '2026-11-11',
            offerEndDate: '2026-11-17',
            currency: 'USD',
            currencyConflict: true,
            locationScope: 'national',
            scopeSource: 'default_national',
            verified: false,
            metadataStatus: 'needs_review',
            metadataStatusReasons: ['Printed currency (USD) contradicts SAR default — confirm manually.']
          }
        }
      ]
    };

    (window as any).wifranExtractor = {
      batch: {
        getSummary: vi.fn(async () => summary),
        getUnifiedOffers: vi.fn(async () => []),
        updateLeafletMetadata: vi.fn()
      }
    };

    render(
      <UnifiedBatchPreview
        batchId="batch-fix06-step3"
        onBack={vi.fn()}
        catalogSupermarkets={[{ id: 'sup-noori', name_en: 'Noori Supermarket' }]}
      />
    );

    expect(await screen.findByText(/✓ Auto Accepted/i)).toBeInTheDocument();
    expect(screen.getAllByText(/National \(assumed\)/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/⚠ Needs Review/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Printed currency \(USD\) contradicts SAR default/i)).toBeInTheDocument();
    expect(screen.getByText(/1 \/ 2 Ready/i)).toBeInTheDocument();

    // Opening editor on auto-accepted Noori tucks Title & SAR Currency inside <details>Optional Metadata Details</details>
    fireEvent.click(screen.getByRole('button', { name: 'Edit Metadata' }));
    expect(screen.getByText(/Optional Metadata Details/i)).toBeInTheDocument();
  });

  it('Step 4 ProductMatchingReview unblocks Publish Preflight for auto_accepted leaflets and still blocks needs_review leaflets', async () => {
    const baseOffer: UnifiedBatchOffer = {
      batchOfferKey: 'b:l1:p1:o1',
      batchId: 'b-fix06-step4',
      leafletId: 'leaflet-001',
      sourceFileName: 'noori.pdf',
      sourcePdfPath: 'C:/tmp/noori.pdf',
      sourcePage: 1,
      sourceOfferId: 'doc_1:p1:o1',
      supermarketId: 'sup-noori',
      supermarketName: 'Noori Supermarket',
      locationScope: 'national',
      locationLabel: 'National — Saudi Arabia (assumed)',
      scopeSource: 'default_national',
      cityId: null,
      regionId: null,
      offerStartDate: '2026-11-11',
      offerEndDate: '2026-11-17',
      currency: 'SAR',
      metadataVerified: false,
      metadataStatus: 'auto_accepted',
      titleAr: 'حليب طازج',
      titleEn: 'Fresh Milk 1L',
      brand: 'Almarai',
      brandAr: 'المراعي',
      brandEn: 'Almarai',
      promoPrice: 9.95,
      originalPrice: 12.5,
      discountPercent: 20,
      promoNotes: null,
      sizeOrWeight: '1L',
      each_size_value: 1,
      each_size_unit: 'l',
      inner_pack_count: 1,
      sale_unit_type: 'each',
      total_content_value: 1,
      total_content_unit: 'l',
      free_units_text: null,
      customer_limit: null,
      offerCardCropPath: null,
      productThumbCropPath: null,
      status: 'extracted',
      confidence: 'high'
    };

    const manifestPayload = {
      schemaVersion: '1.0',
      batchId: 'b-fix06-step4',
      runId: 'm-1',
      createdAt: '2026-11-15T00:00:00Z',
      updatedAt: '2026-11-15T00:00:00Z',
      status: 'completed',
      matchingDatabaseContext: 'DEVELOPMENT_TEST',
      model: 'gemini-3.8-flash',
      thinkingLevel: 'MEDIUM',
      executionMode: 'flex',
      brandSummaries: {},
      proposals: {},
      temporaryProducts: {},
      totals: {
        totalExtractedOffers: 1,
        uniqueIdentitiesCount: 1,
        cacheMatchesCount: 1,
        deterministicMatchesCount: 0,
        geminiEvaluatedCount: 0,
        proposedExistingCount: 1,
        proposedTemporaryCount: 0,
        unresolvedCount: 0,
        validationWarningsCount: 0,
        actualCostUsd: 0,
        estimatedCostUsd: 0,
        geminiRequestsCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0
      }
    };

    const matchingApiMock = {
      getStatus: vi.fn(async () => manifestPayload),
      estimate: vi.fn(async () => null),
      getRetryFailedSummary: vi.fn(async () => null),
      onProgress: vi.fn(() => () => {}),
      start: vi.fn(async () => manifestPayload),
      retryFailedOnly: vi.fn(async () => manifestPayload),
      pause: vi.fn(async () => ({ message: 'paused' })),
      cancel: vi.fn(async () => ({ message: 'cancelled' })),
      saveDecision: vi.fn(async () => manifestPayload),
      publishApproved: vi.fn(async () => ({ preflightReady: true }))
    };

    (window as any).wifranExtractor = {
      matching: matchingApiMock
    };

    const { rerender } = render(
      <ProductMatchingReview
        batchId="b-fix06-step4"
        offers={[baseOffer]}
        onBack={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.queryByText(/Step 4 Publication Blocked: One or more leaflets/i)).not.toBeInTheDocument();
    });

    // Switching to needs_review MUST re-enable the Step 4 Metadata Block warning
    rerender(
      <ProductMatchingReview
        batchId="b-fix06-step4"
        offers={[{ ...baseOffer, metadataStatus: 'needs_review' }]}
        onBack={vi.fn()}
      />
    );

    expect(
      await screen.findByText(/Step 4 Publication Blocked: One or more leaflets/i)
    ).toBeInTheDocument();
  });
});
