/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { ExtractionCostSummaryCard } from '../ExtractionCostSummaryCard';
import { BatchProgressDashboard } from '../BatchProgressDashboard';
import { UnifiedBatchPreview } from '../UnifiedBatchPreview';
import { ProductMatchingReview } from '../ProductMatchingReview';
import { MultiPdfSelector } from '../MultiPdfSelector';
import type { BatchExtractionCostSummary } from '../../../../../shared/types/costAccounting';
import type { BatchManifest, UnifiedBatchSummary } from '../../../../../shared/types/batchExtraction';

function buildSampleCostSummary(
  overrides: Partial<BatchExtractionCostSummary> = {}
): BatchExtractionCostSummary {
  return {
    schemaVersion: 'wifran.gemini_cost_summary/1.0',
    batchId: 'batch-ui-cost-001',
    latestRunId: 'run-2',
    totalMeasuredCostUsd: 0.0595,
    categoryBreakdown: {
      b1_full_page: 0.0428,
      b2_selective_crop: 0.0085,
      catalog_matching: 0.0042,
      metadata_discovery: 0.0025,
      other_gemini: 0.0015
    },
    failedAndRetriedInformational: {
      callsCount: 1,
      measuredCostUsd: 0.0328,
      unknownCostCallsCount: 0
    },
    pagesAttempted: 2,
    pagesCompleted: 1,
    offersExtracted: 16,
    totalApiCalls: 5,
    cacheHitCallsCount: 1,
    failedOrRetriedApiCalls: 1,
    unknownCostRequestsCount: 0,
    hasUnconfirmedCosts: false,
    totalInputTokens: 12500,
    totalOutputTokens: 18500,
    totalThinkingTokens: 6400,
    totalCachedInputTokens: 0,
    avgCostPerExtractedOfferUsd: 0.00371875,
    avgCostPerCompletedPageUsd: 0.0595,
    priorSessionsCostUsd: 0.0328,
    latestSessionCostUsd: 0.0267,
    maxAuthorizedSpendingUsd: 0.5,
    unallocatedSharedOrFailedCostUsd: 0.0328,
    perLeaflet: [
      {
        leafletId: 'lf-alnokhbah',
        fileName: 'alnokhbah-markets-1.pdf',
        pagesAttempted: 2,
        pagesCompleted: 1,
        offersExtracted: 16,
        apiCallsCount: 5,
        failedOrRetriedCallsCount: 1,
        unknownCostCallsCount: 0,
        measuredCostUsd: 0.0595,
        priorSessionsCostUsd: 0.0328,
        latestSessionCostUsd: 0.0267,
        categoryBreakdown: {
          b1_full_page: 0.0428,
          b2_selective_crop: 0.0085,
          catalog_matching: 0.0042,
          metadata_discovery: 0.0025,
          other_gemini: 0.0015
        }
      }
    ],
    perPage: [],
    measurementNote: 'Calculated locally from API-reported token usage and applicable pricing schedule; final Google billing may differ.',
    updatedAt: '2026-11-16T14:00:00.000Z',
    ...overrides
  };
}

describe('Extraction Cost Summary UI & Dual Pre-Run Display', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders prominent EXTRACTION COST SUMMARY with exact mutually exclusive categories and non-additive failed subset', () => {
    const summary = buildSampleCostSummary();
    render(<ExtractionCostSummaryCard costSummary={summary} batchStatus="completed_with_errors" />);

    expect(screen.getByText('EXTRACTION COST SUMMARY')).toBeInTheDocument();
    expect(screen.getByText('TOTAL GEMINI API COST: $0.0595 USD')).toBeInTheDocument();
    expect(screen.getByText('B1 — Full-page extraction')).toBeInTheDocument();
    expect(screen.getByText('B2 — Selective crop analysis')).toBeInTheDocument();
    expect(screen.getByText('AI catalog matching')).toBeInTheDocument();
    expect(screen.getByText('Metadata discovery')).toBeInTheDocument();
    expect(screen.getByText('Other Gemini operations')).toBeInTheDocument();
    expect(screen.getByText('$0.0428 USD')).toBeInTheDocument();
    expect(screen.getByText('$0.0085 USD')).toBeInTheDocument();
    expect(screen.getByText('$0.0042 USD')).toBeInTheDocument();
    expect(screen.getByText('$0.0025 USD')).toBeInTheDocument();
    expect(screen.getByText('$0.0015 USD')).toBeInTheDocument();
    expect(screen.getByText(/non-additive/i)).toBeInTheDocument();
    expect(screen.getByText('$0.0037/offer', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Prior:', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('alnokhbah-markets-1.pdf')).toBeInTheDocument();
  });

  it('displays explicit N/A for avg cost per offer when 0 offers and shows unknown-usage warning banner', () => {
    const failedSummary = buildSampleCostSummary({
      totalMeasuredCostUsd: 0.0328,
      offersExtracted: 0,
      pagesCompleted: 0,
      pagesAttempted: 1,
      avgCostPerExtractedOfferUsd: null,
      avgCostPerCompletedPageUsd: null,
      unknownCostRequestsCount: 1,
      hasUnconfirmedCosts: true
    });
    render(<ExtractionCostSummaryCard costSummary={failedSummary} batchStatus="failed" />);

    expect(screen.getByText('TOTAL GEMINI API COST: $0.0328 USD')).toBeInTheDocument();
    expect(screen.getByText(/N\/A \(0 offers\)/)).toBeInTheDocument();
    expect(screen.getByText(/unavailable_unknown/)).toBeInTheDocument();
    expect(screen.getByText(/TOTAL GEMINI API COST \(MEASURED SUBTOTAL\)/)).toBeInTheDocument();
  });

  it('renders ExtractionCostSummaryCard automatically in Step 2 (BatchProgressDashboard) for failed, cancelled, completed, and reopened runs', async () => {
    const summary = buildSampleCostSummary({ totalMeasuredCostUsd: 0.0328, offersExtracted: 0, pagesCompleted: 0 });
    const failedManifest: BatchManifest = {
      schemaVersion: '1.0',
      batchId: 'batch-ui-cost-001',
      createdAt: '2026-11-16T08:00:00.000Z',
      updatedAt: '2026-11-16T08:05:00.000Z',
      status: 'failed',
      workspaceDir: 'F:\\Work\\test',
      executionMode: 'flex',
      extractionPipelineMode: 'hybrid_v3',
      model: 'gemini-3.8-flash',
      totals: {
        totalPdfs: 1,
        completedPdfs: 0,
        failedPdfs: 1,
        cancelledPdfs: 0,
        totalPages: 2,
        pagesProcessed: 0,
        totalOffers: 0,
        totalCostUsd: 0.0328
      },
      costSummary: summary,
      approvedScope: {
        approvedMaxBudgetUsd: 0.5,
        targetDatabaseContext: 'PRODUCTION_UI',
        autoRunCatalogMatching: true,
        hybridV3Authorized: true,
        hybridV3LiveAuthorized: true,
        totalTargetPages: 2,
        authorizedAt: '2026-11-16T08:00:00.000Z',
        pagesByLeafletId: { 'lf-alnokhbah': [1, 18] }
      },
      leaflets: [
        {
          leafletId: 'lf-alnokhbah',
          fileName: 'alnokhbah-markets-1.pdf',
          filePath: 'F:\\Leaflets\\alnokhbah-markets-1.pdf',
          fileSizeBytes: 1024,
          fileFingerprint: 'fp-alnokhbah-1',
          workspacePath: 'F:\\Extracts\\alnokhbah',
          pageCount: 24,
          pagesToProcess: [1, 18],
          pageSelectionMode: 'specific',
          status: 'failed',
          error: 'MAX_TOKENS',
          pagesProcessed: 0,
          offersCount: 0,
          estimatedCostUsd: 0.0328,
          provenance: 'fresh',
          metadata: {}
        }
      ]
    };

    (window as any).wifranExtractor = {
      batch: {
        getManifest: vi.fn().mockResolvedValue(failedManifest),
        onProgress: vi.fn().mockReturnValue(() => {})
      }
    };

    render(
      <BatchProgressDashboard
        batchId="batch-ui-cost-001"
        onOpenUnifiedPreview={vi.fn()}
        onBackToSelector={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('TOTAL GEMINI API COST: $0.0328 USD')).toBeInTheDocument();
    });
    expect(screen.getByText('EXTRACTION COST SUMMARY')).toBeInTheDocument();
  });

  it('renders ExtractionCostSummaryCard in Step 3 (UnifiedBatchPreview) and Step 4 (ProductMatchingReview)', async () => {
    const summary = buildSampleCostSummary();
    const unifiedSummary: UnifiedBatchSummary = {
      batchId: 'batch-ui-cost-001',
      status: 'completed',
      createdAt: '2026-11-16T08:00:00.000Z',
      updatedAt: '2026-11-16T08:05:00.000Z',
      totals: {
        totalPdfs: 1,
        completedPdfs: 1,
        failedPdfs: 0,
        cancelledPdfs: 0,
        totalPages: 1,
        pagesProcessed: 1,
        totalOffers: 16,
        totalCostUsd: 0.0595
      },
      costSummary: summary,
      leaflets: [],
      supermarketsRepresented: ['Al Nokhbah Markets'],
      totalOffers: 16
    };

    (window as any).wifranExtractor = {
      batch: {
        getSummary: vi.fn().mockResolvedValue(unifiedSummary),
        getUnifiedOffers: vi.fn().mockResolvedValue([]),
        getOffers: vi.fn().mockResolvedValue([])
      },
      matching: {
        getStatus: vi.fn().mockResolvedValue(null),
        estimate: vi.fn().mockResolvedValue(null),
        getRetryFailedSummary: vi.fn().mockResolvedValue(null),
        onProgress: vi.fn().mockReturnValue(() => {})
      },
      db: {
        preflightPublish: vi.fn().mockResolvedValue({ ok: true })
      }
    };

    render(<UnifiedBatchPreview batchId="batch-ui-cost-001" onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('TOTAL GEMINI API COST: $0.0595 USD')).toBeInTheDocument();
    });

    cleanup();

    render(<ProductMatchingReview batchId="batch-ui-cost-001" offers={[]} onBack={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('TOTAL GEMINI API COST: $0.0595 USD')).toBeInTheDocument();
    });
  });

  it('displays separate Expected Normal Cost vs Max Authorized Total Spending Cap in MultiPdfSelector', () => {
    render(
      <MultiPdfSelector
        onStartExtraction={vi.fn()}
        isExtracting={false}
        selectedFiles={[
          {
            name: 'alnokhbah-markets-1.pdf',
            path: 'F:\\Leaflets\\alnokhbah-markets-1.pdf',
            sizeBytes: 1024,
            extension: '.pdf',
            pageCount: 24,
            pageSelectionMode: 'specific',
            pageSelectionInput: '1',
            selectedPages: [1]
          }
        ]}
        onFilesChange={vi.fn()}
      />
    );

    expect(screen.getByText(/Expected Normal Cost/i)).toBeInTheDocument();
    expect(screen.getByText(/Max Authorized Total Spending Cap \(USD\)/i)).toBeInTheDocument();
  });
});
