/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MultiPdfSelector } from '../MultiPdfSelector';
import { ProductMatchingReview } from '../ProductMatchingReview';
import { SettingsPage } from '../../../pages/SettingsPage';
import type { SelectedPdfFile } from '../../../../../shared/types/importForm';
import type { MatchingRunManifest } from '../../../../../shared/types/catalogMatching';

vi.mock('../../../hooks/useConfigStatus', () => ({
  useConfigStatus: () => ({
    configStatus: {
      databaseEnvironment: {
        isValidatedProduction: true,
        displayBadge: 'Database: PRODUCTION (Verified)',
        projectRef: 'mock-prod-ref'
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
      supermarkets: [{ id: 'sup-1', name_en: 'Othaim Markets', slug: 'othaim' }],
      regions: [{ id: 'reg-1', name_en: 'Makkah', slug: 'makkah' }],
      cities: [],
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

describe('WIFRAN-EXTRACTOR-IDENTITY-005J-UAT-FIX-08 — UI Cleanup, Duplicate Prevention, Reconciliation & Recovery (TEST-A)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (window as any).wifranExtractor;
  });

  it('MultiPdfSelector hides Standard Rev1, surfaces pre-extraction cache reuse & payable cost savings, and forwards forceReextract (UI-01, DUP-01G, UI-06)', async () => {
    const inspectDuplicatesMock = vi.fn(async (input: { forceReextract?: boolean }) => ({
      totalSelectedPages: 2,
      totalReusedPages: input.forceReextract ? 0 : 1,
      totalPayablePages: input.forceReextract ? 2 : 1,
      adjustedEstimatedLowUsd: input.forceReextract ? 0.006 : 0.003,
      adjustedEstimatedHighUsd: input.forceReextract ? 0.012 : 0.006,
      matches: [
        {
          fileName: 'othaim.pdf',
          filePath: 'C:/tmp/othaim.pdf',
          reusedPages: input.forceReextract ? [] : [27],
          payablePages: input.forceReextract ? [27, 41] : [41],
          matchedFilenameHistory: true,
          previousBatchIds: ['batch-prev-1']
        }
      ]
    }));

    (window as any).wifranExtractor = {
      batch: {
        inspectDuplicates: inspectDuplicatesMock
      }
    };

    const files: SelectedPdfFile[] = [
      {
        path: 'C:/tmp/othaim.pdf',
        name: 'othaim.pdf',
        extension: '.pdf',
        sizeBytes: 4096,
        pageCount: 50,
        pageSelectionMode: 'specific',
        pageSelectionInput: '27, 41',
        selectedPages: [27, 41]
      }
    ];

    const onStartExtraction = vi.fn();
    render(
      <MultiPdfSelector
        selectedFiles={files}
        onFilesChange={vi.fn()}
        onStartExtraction={onStartExtraction}
        isExtracting={false}
        extractionPipelineMode="hybrid_v3"
      />
    );

    expect(screen.queryByText(/Standard Rev1/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Legacy Crop-First/i)).not.toBeInTheDocument();

    expect(
      await screen.findByText(/Pre-Extraction Duplicate & Artifact Cache Detected: 1 of 2 selected page\(s\) will reuse \$0\.00 verified local artifacts/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Payable Pages: 1/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Start Processing/i }));
    expect(onStartExtraction).toHaveBeenCalledWith(
      expect.objectContaining({
        approvedMaxBudgetUsd: expect.any(Number),
        targetDatabaseContext: 'PRODUCTION_UI',
        forceReextract: false
      })
    );

    const forceCheckbox = screen.getByLabelText(/Force Re-extraction \(bypass local cache\)/i);
    fireEvent.click(forceCheckbox);

    await waitFor(() => {
      expect(inspectDuplicatesMock).toHaveBeenCalledWith(
        expect.objectContaining({ forceReextract: true })
      );
    });

    fireEvent.click(screen.getByRole('button', { name: /Start Processing/i }));
    expect(onStartExtraction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        forceReextract: true
      })
    );
  });

  it('SettingsPage Advanced tab exposes schema parity, publication history, guarded Undo Last Publish, and Retry Storage Cleanup (UI-04, UI-05, REV-01..03)', async () => {
    const verifySchemaReadinessMock = vi.fn(async (ctx: string) => ({
      context: ctx,
      compatible: true,
      hasMigration009: true,
      hasMigration010: true,
      hasSourceOfferUniqueIndex: true,
      hasConsumerView: true,
      missingDependencies: []
    }));

    const getPublicationHistoryMock = vi.fn(async () => [
      {
        publishOperationId: 'op-rev-001',
        batchId: 'batch-100',
        status: 'committed',
        insertedOffersCount: 2,
        updatedOffersCount: 0,
        unchangedNoopCount: 0,
        createdProductsCount: 1,
        startedAt: '2026-11-15T10:00:00Z'
      },
      {
        publishOperationId: 'op-pending-000',
        batchId: 'batch-099',
        status: 'undo_cleanup_pending',
        insertedOffersCount: 1,
        updatedOffersCount: 0,
        unchangedNoopCount: 0,
        createdProductsCount: 0,
        startedAt: '2026-11-14T10:00:00Z'
      }
    ]);

    const previewUndoLastPublishMock = vi.fn(async () => ({
      canUndo: true,
      blockedReasons: [],
      targetOperation: {
        publishOperationId: 'op-rev-001',
        batchId: 'batch-100',
        status: 'committed'
      },
      affectedCounts: {
        offersToDelete: 2,
        offersToRestore: 0,
        productsToDelete: 1,
        exclusiveStorageObjectsToDelete: 2,
        reusedStorageObjectsPreserved: 1
      }
    }));

    const undoLastPublishMock = vi.fn(async () => ({
      success: true,
      status: 'reverted',
      revertedMutationsCount: 3,
      storageCleanup: {
        deletedCount: 2,
        preservedSharedCount: 1,
        failedCount: 0
      }
    }));

    const retryUndoStorageCleanupMock = vi.fn(async () => ({
      success: true,
      status: 'reverted',
      storageCleanup: {
        deletedCount: 1,
        preservedSharedCount: 0,
        failedCount: 0
      }
    }));

    const getDetailsMock = vi.fn(async ({ publishOperationId }: { publishOperationId: string }) => ({
      operation: { publishOperationId },
      mutations: [{ id: 1 }, { id: 2 }],
      skips: [],
      storageOperations: [{ id: 10 }]
    }));

    (window as any).wifranExtractor = {
      config: {
        verifySchemaReadiness: verifySchemaReadinessMock
      },
      matching: {
        getPublicationHistory: getPublicationHistoryMock,
        previewUndoLastPublish: previewUndoLastPublishMock,
        undoLastPublish: undoLastPublishMock,
        retryUndoStorageCleanup: retryUndoStorageCleanupMock,
        getPublicationOperationDetails: getDetailsMock
      }
    };

    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: /Advanced \(Publication History & Recovery\)/i }));

    expect(await screen.findByText(/COMPATIBLE \(009 \+ 010 Verified\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Offers Delete: 2/i)).toBeInTheDocument();
    expect(screen.getByText(/Shared Kept: 1/i)).toBeInTheDocument();

    // Retry cleanup action for undo_cleanup_pending row in DEVELOPMENT_TEST
    fireEvent.click(screen.getByRole('button', { name: /Retry Storage Cleanup/i }));
    await waitFor(() => {
      expect(retryUndoStorageCleanupMock).toHaveBeenCalledWith(
        expect.objectContaining({
          context: 'DEVELOPMENT_TEST',
          publishOperationId: 'op-pending-000',
          operatorAuthorizedProductionPublish: false
        })
      );
    });

    // Switch to PRODUCTION_UI -> Undo blocked until owner checkbox checked
    fireEvent.change(screen.getByLabelText(/Target Recovery Database Context/i), {
      target: { value: 'PRODUCTION_UI' }
    });

    await waitFor(() => {
      expect(verifySchemaReadinessMock).toHaveBeenCalledWith('PRODUCTION_UI');
    });

    const undoTriggerBtn = screen.getByRole('button', { name: /Undo Last Publish\.\.\./i });
    expect(undoTriggerBtn).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/Authorize Production Rollback \/ Cleanup/i));
    expect(undoTriggerBtn).toBeEnabled();
    fireEvent.click(undoTriggerBtn);

    const confirmUndoBtn = screen.getByRole('button', { name: /Confirm Undo Last Publish/i });
    expect(confirmUndoBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Audit Reason for Undo Last Publish/i), {
      target: { value: 'Incorrect price tier verified in QA' }
    });
    expect(confirmUndoBtn).toBeEnabled();
    fireEvent.click(confirmUndoBtn);

    await waitFor(() => {
      expect(undoLastPublishMock).toHaveBeenCalledWith(
        expect.objectContaining({
          context: 'PRODUCTION_UI',
          publishOperationId: 'op-rev-001',
          reason: 'Incorrect price tier verified in QA',
          operatorAuthorizedProductionPublish: true
        })
      );
    });
  });

  it('ProductMatchingReview surfaces Pre-Publication Database Reconciliation diffs, update/conflict approvals, and Production authorization gate (DUP-02E, PUB-05)', async () => {
    const manifest: MatchingRunManifest = {
      schemaVersion: '1.0',
      batchId: 'batch-prod-recon',
      runId: 'run_prod_recon',
      createdAt: '2026-11-15T00:00:00Z',
      updatedAt: '2026-11-15T00:00:00Z',
      status: 'completed',
      matchingDatabaseContext: 'PRODUCTION_UI',
      model: 'gemini-3.8-flash',
      thinkingLevel: 'MEDIUM',
      executionMode: 'flex',
      brandSummaries: {},
      proposals: {},
      temporaryProducts: {},
      totals: {
        totalExtractedOffers: 3,
        uniqueIdentitiesCount: 3,
        cacheMatchesCount: 0,
        deterministicMatchesCount: 2,
        geminiEvaluatedCount: 1,
        proposedExistingCount: 2,
        proposedTemporaryCount: 1,
        unresolvedCount: 0,
        validationWarningsCount: 0,
        actualCostUsd: 0.002,
        estimatedCostUsd: 0.002,
        geminiRequestsCount: 1,
        inputTokens: 100,
        outputTokens: 50,
        thinkingTokens: 0
      }
    };

    const publishApprovedMock = vi.fn(async ({ preflightOnly }: { preflightOnly?: boolean }) => ({
      preflight: {
        preflightReady: true,
        blockingReasons: [],
        existingProductMatchesCount: 2,
        temporaryGroupsCount: 1,
        reconciliationSummary: {
          newCount: 1,
          alreadyPublishedCount: 1,
          updateCandidateCount: 1,
          duplicateConflictCount: 1,
          entries: [
            {
              sourceOfferId: 'doc_1:p001:i001:s01',
              classification: 'update_candidate',
              reason: 'Price changed since previous publish',
              fieldDiffs: [{ field: 'promoPrice', before: 12.5, after: 10.95 }]
            },
            {
              sourceOfferId: 'doc_1:p001:i002:s01',
              classification: 'duplicate_conflict',
              reason: 'Equivalent offer already exists under another source_offer_id'
            }
          ]
        }
      },
      publishResult: preflightOnly
        ? undefined
        : {
            success: true,
            publishOperationId: 'op-prod-009',
            insertedOffersCount: 2,
            updatedOffersCount: 1,
            createdProductsCount: 0,
            noop: false
          }
    }));

    (window as any).wifranExtractor = {
      matching: {
        getStatus: vi.fn(async () => manifest),
        estimate: vi.fn(async () => null),
        getRetryFailedSummary: vi.fn(async () => null),
        onProgress: vi.fn(() => () => {}),
        start: vi.fn(async () => manifest),
        retryFailedOnly: vi.fn(async () => manifest),
        pause: vi.fn(async () => ({ message: 'paused' })),
        cancel: vi.fn(async () => ({ message: 'cancelled' })),
        saveDecision: vi.fn(async () => manifest),
        publishApproved: publishApprovedMock
      }
    };

    render(
      <ProductMatchingReview
        batchId="batch-prod-recon"
        offers={[]}
        onBack={vi.fn()}
      />
    );

    const reconcileBtn = await screen.findByRole('button', { name: /Preflight & Reconcile DB/i });
    const publishBtn = screen.getByRole('button', { name: /Publish \d+ Ready Offers/i });

    // Manifest has matchingDatabaseContext = PRODUCTION_UI -> auto-selects PRODUCTION_UI target
    await waitFor(() => {
      expect(screen.getByLabelText(/Authorize Production DB Publish/i)).toBeInTheDocument();
    });
    expect(publishBtn).toBeDisabled();

    fireEvent.click(reconcileBtn);

    expect(
      await screen.findByText(/Pre-Publication Database Reconciliation \(PRODUCTION_UI\)/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/New: 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Already Published \(No-Op\): 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Updates: 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Conflicts: 1/i)).toBeInTheDocument();
    expect(screen.getByText(/promoPrice: 12.5 → 10.95/i)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Approve Update/i));
    fireEvent.click(screen.getByLabelText(/Override Logical Conflict/i));
    fireEvent.click(screen.getByLabelText(/Authorize Production DB Publish/i));

    expect(publishBtn).toBeEnabled();
    fireEvent.click(publishBtn);

    await waitFor(() => {
      expect(publishApprovedMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          batchId: 'batch-prod-recon',
          targetContext: 'PRODUCTION_UI',
          operatorAuthorizedProductionPublish: true,
          enforceUpdateApproval: true,
          approvedUpdateSourceIds: ['doc_1:p001:i001:s01'],
          overrideConflictSourceIds: ['doc_1:p001:i002:s01'],
          preflightOnly: false
        })
      );
    });
  });
});
