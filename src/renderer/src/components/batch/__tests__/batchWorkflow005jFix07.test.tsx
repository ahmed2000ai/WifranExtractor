/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { BatchWorkflowStepper } from '../BatchWorkflowStepper';
import { MultiPdfSelector } from '../MultiPdfSelector';
import { BatchProgressDashboard } from '../BatchProgressDashboard';
import { UnifiedBatchPreview } from '../UnifiedBatchPreview';
import { ProductMatchingReview } from '../ProductMatchingReview';
import type { SelectedPdfFile } from '../../../../../shared/types/importForm';
import type { BatchManifest, UnifiedBatchOffer, UnifiedBatchSummary } from '../../../../../shared/types/batchExtraction';
import type { MatchingRunManifest } from '../../../../../shared/types/catalogMatching';

describe('WIFRAN-005J-UAT-FIX-07 — UI 4-Step Consolidation, Automatic Stage Indicators, Triage & Edit Rematch', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders 4-step stepper and Step 1 MultiPdfSelector with itemized cost breakdown, Reference DB selector, and Start Processing', () => {
    const files: SelectedPdfFile[] = [
      {
        path: 'C:/tmp/carrefour.pdf',
        name: 'carrefour.pdf',
        extension: '.pdf',
        sizeBytes: 2048,
        pageCount: 30,
        pageSelectionMode: 'specific',
        pageSelectionInput: '12, 15',
        selectedPages: [12, 15]
      },
      {
        path: 'C:/tmp/othaim.pdf',
        name: 'othaim.pdf',
        extension: '.pdf',
        sizeBytes: 2048,
        pageCount: 50,
        pageSelectionMode: 'specific',
        pageSelectionInput: '27, 41',
        selectedPages: [27, 41]
      },
      {
        path: 'C:/tmp/lulu.pdf',
        name: 'lulu.pdf',
        extension: '.pdf',
        sizeBytes: 2048,
        pageCount: 20,
        pageSelectionMode: 'specific',
        pageSelectionInput: '3, 5',
        selectedPages: [3, 5]
      }
    ];

    const onStart = vi.fn();
    render(
      <MultiPdfSelector
        selectedFiles={files}
        onFilesChange={vi.fn()}
        onStartExtraction={onStart}
        isExtracting={false}
        extractionPipelineMode="hybrid_v3"
      />
    );

    expect(screen.getByText(/1\. Batch Setup/i)).toBeInTheDocument();
    expect(screen.getByText(/2\. Processing/i)).toBeInTheDocument();
    expect(screen.getByText(/3\. Review/i)).toBeInTheDocument();
    expect(screen.getByText(/4\. Publication/i)).toBeInTheDocument();
    expect(screen.queryByText(/5\./)).not.toBeInTheDocument();

    expect(screen.getByText(/Full-Page Extraction/i)).toBeInTheDocument();
    expect(screen.getByText(/Selective Crop Verification/i)).toBeInTheDocument();
    expect(screen.getByText(/Catalog Matching \(Gemini\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Estimated Total Cost/i)).toBeInTheDocument();

    const dbSelect = screen.getByLabelText(/Reference Matching DB Context/i) as HTMLSelectElement;
    fireEvent.change(dbSelect, { target: { value: 'DEVELOPMENT_TEST' } });

    const startBtn = screen.getByRole('button', { name: /Start Processing \(3 Leaflets, 6 Pages\)/i });
    fireEvent.click(startBtn);

    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        targetDatabaseContext: 'DEVELOPMENT_TEST'
      })
    );
  });

  it('Step 2 BatchProgressDashboard displays individual stage indicators and failure banner without discarding extraction', async () => {
    const manifest: BatchManifest = {
      schemaVersion: '1.0',
      batchId: 'batch-fix07-step2',
      createdAt: '2026-11-15T00:00:00Z',
      updatedAt: '2026-11-15T00:00:00Z',
      status: 'completed',
      workspaceDir: 'C:/tmp/b-step2',
      executionMode: 'flex',
      extractionPipelineMode: 'hybrid_v3',
      model: 'gemini-3.8-flash',
      processingStages: {
        extraction: 'completed',
        metadata: 'completed',
        crops: 'completed',
        matching: 'failed'
      },
      matchingSummary: {
        status: 'failed',
        databaseContext: 'DEVELOPMENT_TEST',
        actualCostUsd: 0,
        existingMatchesCount: 0,
        temporaryGroupsCount: 0,
        unresolvedCount: 4,
        error: 'Simulated DB timeout'
      },
      leaflets: [
        {
          leafletId: 'leaflet-001',
          fileName: 'carrefour.pdf',
          filePath: 'C:/tmp/carrefour.pdf',
          fileSizeBytes: 1024,
          fileFingerprint: 'fp-carrefour',
          pageCount: 30,
          pagesToProcess: [12, 15],
          pageSelectionMode: 'specific',
          pagesProcessed: 2,
          offersCount: 4,
          estimatedCostUsd: 0.01,
          status: 'completed',
          workspacePath: 'C:/tmp/ws-carrefour',
          provenance: 'fresh',
          metadata: { verified: false, metadataStatus: 'auto_accepted' }
        }
      ],
      totals: {
        totalPdfs: 1,
        completedPdfs: 1,
        failedPdfs: 0,
        cancelledPdfs: 0,
        totalPages: 2,
        pagesProcessed: 2,
        totalOffers: 4,
        totalCostUsd: 0.01
      }
    };

    (window as any).wifranExtractor = {
      batch: {
        getManifest: vi.fn(async () => manifest),
        onProgress: vi.fn(() => () => {})
      }
    };

    const onOpenPreview = vi.fn();
    render(
      <BatchProgressDashboard
        batchId="batch-fix07-step2"
        onOpenUnifiedPreview={onOpenPreview}
        onBackToSelector={vi.fn()}
      />
    );

    expect(await screen.findByText(/1\. Extraction/i)).toBeInTheDocument();
    expect(screen.getByText(/2\. Metadata Discovery/i)).toBeInTheDocument();
    expect(screen.getByText(/3\. Offer & Product Crops/i)).toBeInTheDocument();
    expect(screen.getByText(/4\. Cross-Leaflet Matching/i)).toBeInTheDocument();
    expect(screen.getByText(/completed extractions and crops are preserved/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Step 3: Consolidated Review/i }));
    expect(onOpenPreview).toHaveBeenCalledTimes(1);
  });

  it('Step 3 UnifiedBatchPreview enforces Ready/NeedsReview/Blocked triage, safe bulk approval guard, cross-retailer groups, and edit rematch notice', async () => {
    const readyOffer: UnifiedBatchOffer = {
      batchOfferKey: 'b7:l1:p12:o1',
      batchId: 'batch-fix07-step3',
      leafletId: 'l1',
      sourceFileName: 'carrefour.pdf',
      sourcePdfPath: 'C:/tmp/carrefour.pdf',
      sourcePage: 12,
      sourceOfferId: 'o1',
      supermarketId: 'sup-carrefour',
      supermarketName: 'Carrefour',
      locationScope: 'national',
      locationLabel: 'National — Saudi Arabia (assumed)',
      cityId: null,
      regionId: null,
      offerStartDate: '2026-11-11',
      offerEndDate: '2026-11-17',
      currency: 'SAR',
      metadataVerified: false,
      metadataStatus: 'auto_accepted',
      titleAr: 'أرز صن وايت 5 كجم',
      titleEn: 'Sunwhite Calrose Rice 5kg',
      brand: 'Sunwhite',
      brandAr: 'صن وايت',
      brandEn: 'Sunwhite',
      promoPrice: 34.95,
      originalPrice: 42.0,
      discountPercent: 17,
      promoNotes: null,
      sizeOrWeight: '5kg',
      each_size_value: 5,
      each_size_unit: 'kg',
      inner_pack_count: 1,
      sale_unit_type: 'each',
      total_content_value: 5,
      total_content_unit: 'kg',
      free_units_text: null,
      customer_limit: null,
      productThumbCropPath: null,
      offerCardCropPath: null,
      status: 'extracted',
      confidence: 'high',
      quarantineReasons: []
    };

    const blockedOffer: UnifiedBatchOffer = {
      ...readyOffer,
      batchOfferKey: 'b7:l2:p3:o2',
      leafletId: 'l2',
      sourceFileName: 'lulu.pdf',
      sourcePage: 3,
      sourceOfferId: 'o2',
      supermarketId: 'sup-lulu',
      supermarketName: 'LuLu Hypermarket',
      titleEn: 'Blocked Bad Item',
      quarantineReasons: ['INV_PRICE_INVERSION']
    };

    const summary: UnifiedBatchSummary = {
      batchId: 'batch-fix07-step3',
      status: 'completed',
      createdAt: '2026-11-15T00:00:00Z',
      updatedAt: '2026-11-15T00:00:00Z',
      supermarketsRepresented: ['Carrefour', 'LuLu Hypermarket'],
      totalOffers: 2,
      approvedScope: {
        hybridV3Authorized: true,
        hybridV3LiveAuthorized: false,
        pagesByLeafletId: { l1: [12], l2: [3] },
        totalTargetPages: 2,
        approvedMaxBudgetUsd: 0.25,
        autoRunCatalogMatching: true,
        targetDatabaseContext: 'DEVELOPMENT_TEST',
        authorizedAt: '2026-11-15T00:00:00Z'
      },
      totals: {
        totalPdfs: 2,
        completedPdfs: 2,
        failedPdfs: 0,
        cancelledPdfs: 0,
        totalPages: 2,
        pagesProcessed: 2,
        totalOffers: 2,
        totalCostUsd: 0.015
      },
      leaflets: [
        {
          leafletId: 'l1',
          fileName: 'carrefour.pdf',
          filePath: 'C:/tmp/carrefour.pdf',
          fileSizeBytes: 1000,
          fileFingerprint: 'fp1',
          pageCount: 30,
          pagesToProcess: [12],
          pageSelectionMode: 'specific',
          pagesProcessed: 1,
          offersCount: 1,
          estimatedCostUsd: 0.008,
          status: 'completed',
          workspacePath: 'C:/tmp/ws1',
          provenance: 'fresh',
          metadata: {
            supermarketId: 'sup-carrefour',
            supermarketName: 'Carrefour',
            offerStartDate: '2026-11-11',
            offerEndDate: '2026-11-17',
            currency: 'SAR',
            locationScope: 'national',
            scopeSource: 'default_national',
            verified: false,
            metadataStatus: 'auto_accepted'
          }
        }
      ]
    };

    const matchingManifest: MatchingRunManifest = {
      schemaVersion: '1.0',
      batchId: 'batch-fix07-step3',
      runId: 'run_7',
      createdAt: '2026-11-15T00:00:00Z',
      updatedAt: '2026-11-15T00:00:00Z',
      status: 'completed',
      matchingDatabaseContext: 'DEVELOPMENT_TEST',
      model: 'gemini-3.8-flash',
      thinkingLevel: 'MEDIUM',
      executionMode: 'flex',
      brandSummaries: {},
      proposals: {
        'b7:l1:p12:o1': {
          batchOfferKey: 'b7:l1:p12:o1',
          sourceOfferId: 'o1',
          sourcePage: 12,
          leafletId: 'l1',
          supermarketName: 'Carrefour',
          decision: 'existing',
          matchedProductId: 'prod_rice_5kg',
          matchedProduct: {
            id: 'prod_rice_5kg',
            nameEn: 'Sunwhite Calrose Rice 5kg',
            nameAr: 'أرز صن وايت 5 كجم',
            brand: 'Sunwhite',
            variant: null,
            sizeValue: 5,
            sizeUnit: 'kg',
            packCount: 1
          },
          matchedDatabaseContext: 'DEVELOPMENT_TEST',
          temporaryId: null,
          confidence: 'high',
          matchMethod: 'deterministic',
          validationIssues: [],
          operatorDecision: 'proposed',
          updatedAt: '2026-11-15T00:00:00Z'
        },
        'b7:l2:p3:o2': {
          batchOfferKey: 'b7:l2:p3:o2',
          sourceOfferId: 'o2',
          sourcePage: 3,
          leafletId: 'l2',
          supermarketName: 'LuLu Hypermarket',
          decision: 'unresolved',
          matchedProductId: null,
          temporaryId: null,
          confidence: 'low',
          matchMethod: 'deterministic',
          validationIssues: [],
          operatorDecision: 'proposed',
          updatedAt: '2026-11-15T00:00:00Z'
        }
      },
      temporaryProducts: {},
      totals: {
        totalExtractedOffers: 2,
        uniqueIdentitiesCount: 2,
        cacheMatchesCount: 0,
        deterministicMatchesCount: 1,
        geminiEvaluatedCount: 0,
        proposedExistingCount: 1,
        proposedTemporaryCount: 0,
        unresolvedCount: 1,
        validationWarningsCount: 0,
        actualCostUsd: 0,
        estimatedCostUsd: 0,
        geminiRequestsCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0
      }
    };

    const saveDecisionMock = vi.fn(async (input: any) => ({
      ...matchingManifest,
      proposals: {
        ...matchingManifest.proposals,
        [input.batchOfferKey]: {
          ...matchingManifest.proposals[input.batchOfferKey],
          operatorDecision: 'approved' as const
        }
      }
    }));

    const updateOfferFieldsMock = vi.fn(async (input: any) => ({
      ...readyOffer,
      each_size_value: input.patch.each_size_value,
      rematchOutcome: 'needs_review' as const,
      rematchMessage: 'Prior match invalidated after identity edit; marked Needs Review.'
    }));

    (window as any).wifranExtractor = {
      batch: {
        getSummary: vi.fn(async () => summary),
        getUnifiedOffers: vi.fn(async () => [readyOffer, blockedOffer]),
        updateOfferFields: updateOfferFieldsMock
      },
      matching: {
        getStatus: vi.fn(async () => matchingManifest),
        saveDecision: saveDecisionMock
      }
    };

    render(<UnifiedBatchPreview batchId="batch-fix07-step3" onBack={vi.fn()} />);

    expect(await screen.findByText(/Step 3 — Consolidated Operator Review/i)).toBeInTheDocument();

    // Triage filter shows Ready (1), Needs Review (0), Blocked (1)
    expect(screen.getByRole('button', { name: /✓ Ready \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /⛔ Blocked \(Deferred\) \(1\)/i })).toBeInTheDocument();

    // Bulk approve ONLY touches Ready item, NEVER blocked item!
    fireEvent.click(screen.getByRole('button', { name: /Approve Safe Ready Matches \(1\)/i }));
    await waitFor(() => {
      expect(saveDecisionMock).toHaveBeenCalledTimes(1);
      expect(saveDecisionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          batchOfferKey: 'b7:l1:p12:o1',
          decision: 'approved'
        })
      );
    });

    // Cross-Retailer Product Groups inline tab renders grouped SKU
    fireEvent.click(screen.getByRole('button', { name: /Cross-Retailer Product Groups/i }));
    expect(screen.getByText(/Verified Catalog Product Groups/i)).toBeInTheDocument();
    expect(screen.getByText(/Catalog ID: prod_rice_5kg/i)).toBeInTheDocument();

    // Switch back to Offers tab and inspect/edit offer -> surfaces rematch notification!
    fireEvent.click(screen.getByRole('button', { name: /Offers & Exceptions/i }));
    const inspectBtns = screen.getAllByRole('button', { name: 'Inspect' });
    fireEvent.click(inspectBtns[0]);
    fireEvent.click(screen.getByRole('button', { name: /Save & Revalidate Corrections/i }));

    expect(
      await screen.findByText(/Prior match invalidated after identity edit; marked Needs Review/i)
    ).toBeInTheDocument();
  });

  it('BatchWorkflowStepper renders strictly 4 steps and Step 4 ProductMatchingReview shows preflight readiness & DB guard', async () => {
    render(<BatchWorkflowStepper currentStep={4} />);
    expect(screen.getByText(/4\. Publication/i)).toBeInTheDocument();
    expect(screen.queryByText(/5\./)).not.toBeInTheDocument();
    cleanup();

    const mManifest: MatchingRunManifest = {
      schemaVersion: '1.0',
      batchId: 'b-step4-preflight',
      runId: 'run_4',
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
        cacheMatchesCount: 0,
        deterministicMatchesCount: 0,
        geminiEvaluatedCount: 0,
        proposedExistingCount: 0,
        proposedTemporaryCount: 0,
        unresolvedCount: 1,
        validationWarningsCount: 0,
        actualCostUsd: 0,
        estimatedCostUsd: 0,
        geminiRequestsCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0
      }
    };

    (window as any).wifranExtractor = {
      matching: {
        getStatus: vi.fn(async () => mManifest),
        estimate: vi.fn(async () => null),
        getRetryFailedSummary: vi.fn(async () => null),
        onProgress: vi.fn(() => () => {}),
        start: vi.fn(async () => mManifest),
        retryFailedOnly: vi.fn(async () => mManifest),
        pause: vi.fn(async () => ({ message: 'paused' })),
        cancel: vi.fn(async () => ({ message: 'cancelled' })),
        saveDecision: vi.fn(async () => mManifest),
        publishApproved: vi.fn(async () => ({ preflightReady: true }))
      }
    };

    render(<ProductMatchingReview batchId="b-step4-preflight" offers={[]} onBack={vi.fn()} />);

    expect(await screen.findByText(/Step 4 — Publication & Product Reconciliation/i)).toBeInTheDocument();
    expect(screen.getByText(/Ready to Publish Now:/i)).toBeInTheDocument();
    expect(screen.getByText(/Blocked \/ Excluded:/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Publish 0 Ready Offers/i })).toBeDisabled();
  });
});
