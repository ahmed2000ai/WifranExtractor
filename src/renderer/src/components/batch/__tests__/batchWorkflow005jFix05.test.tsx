/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MultiPdfSelector } from '../MultiPdfSelector';
import { BatchProgressDashboard } from '../BatchProgressDashboard';
import { UnifiedBatchPreview } from '../UnifiedBatchPreview';
import type { SelectedPdfFile } from '../../../../../shared/types/importForm';
import type { BatchManifest, UnifiedBatchOffer, UnifiedBatchSummary } from '../../../../../shared/types/batchExtraction';

describe('WIFRAN-005J-UAT-FIX-05 — UI 5-Step Workflow, Hybrid V3 Default, No Pre-Start Blocker & Step 3 Verification', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows Hybrid V3 as Default pipeline and Standard Rev1 as Legacy/Advanced without auto-starting extraction', () => {
    const file: SelectedPdfFile = {
      path: 'C:/tmp/lulu.pdf',
      name: 'lulu-hypermarket-63800343-jeddah.pdf',
      extension: '.pdf',
      sizeBytes: 2048,
      pageCount: 85,
      pageSelectionMode: 'specific',
      pageSelectionInput: '3',
      selectedPages: [3]
    };

    const onPipelineChange = vi.fn();
    render(
      <MultiPdfSelector
        selectedFiles={[file]}
        onFilesChange={vi.fn()}
        onStartExtraction={vi.fn()}
        isExtracting={false}
        onExtractionPipelineModeChange={onPipelineChange}
      />
    );

    expect(screen.getByText(/1\. Batch Setup/i)).toBeInTheDocument();
    expect(screen.getByText(/Hybrid V3/i)).toBeInTheDocument();
    expect(screen.queryByText(/Standard Rev1/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start Processing \(1 Leaflet, 1 Page\)/i })).toBeEnabled();
  });

  it('eliminates redundant intermediate Step 1 authorization checkboxes on BatchProgressDashboard', async () => {
    const manifest: BatchManifest = {
      schemaVersion: '1.0',
      batchId: 'batch-fix05-ui',
      createdAt: '2026-11-15T00:00:00Z',
      updatedAt: '2026-11-15T00:00:00Z',
      status: 'created',
      workspaceDir: 'C:/tmp/b1',
      executionMode: 'flex',
      extractionPipelineMode: 'hybrid_v3',
      model: 'gemini-3.8-flash',
      leaflets: [
        {
          leafletId: 'leaflet-001',
          fileName: 'lulu-hypermarket-63800343-jeddah.pdf',
          filePath: 'C:/tmp/lulu.pdf',
          fileSizeBytes: 1024,
          fileFingerprint: 'fp-lulu',
          pageCount: 85,
          pagesToProcess: [3],
          pageSelectionMode: 'specific',
          pagesProcessed: 0,
          offersCount: 0,
          estimatedCostUsd: 0,
          status: 'queued',
          workspacePath: 'C:/tmp/ws-lulu',
          provenance: 'fresh',
          metadata: { verified: false }
        }
      ],
      totals: {
        totalPdfs: 1,
        completedPdfs: 0,
        failedPdfs: 0,
        cancelledPdfs: 0,
        totalPages: 1,
        pagesProcessed: 0,
        totalOffers: 0,
        totalCostUsd: 0
      }
    };

    const startSpy = vi.fn(async () => ({ ...manifest, status: 'completed' as const }));
    (window as any).wifranExtractor = {
      batch: {
        getManifest: vi.fn(async () => manifest),
        start: startSpy,
        onProgress: vi.fn(() => () => {})
      }
    };

    render(
      <BatchProgressDashboard
        batchId="batch-fix05-ui"
        onOpenUnifiedPreview={vi.fn()}
        onBackToSelector={vi.fn()}
      />
    );

    const startBtn = await screen.findByRole('button', { name: /Start Processing/i });
    expect(screen.queryByText(/Step 1 — Batch Scope, Cost Ceiling & Extraction Authorization/i)).not.toBeInTheDocument();
    expect(startBtn).toBeEnabled();
    expect(startSpy).not.toHaveBeenCalled();

    fireEvent.click(startBtn);
    await waitFor(() => {
      expect(startSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          batchId: 'batch-fix05-ui',
          hybridV3ExplicitAuthorization: true,
          hybridV3FeatureEnabled: true,
          hybridV3ExplicitLiveAuthorization: true
        })
      );
    });
  });

  it('Step 3 Review & Verify renders per-leaflet metadata editor, multi-city evidence alert, ONE DAY ONLY warning, and verifies independently', async () => {
    const summary: UnifiedBatchSummary = {
      batchId: 'batch-step3-ui',
      status: 'completed',
      createdAt: '2026-11-15T00:00:00Z',
      updatedAt: '2026-11-15T00:00:00Z',
      supermarketsRepresented: ['LuLu Hypermarket'],
      totalOffers: 1,
      totals: {
        totalPdfs: 1,
        completedPdfs: 1,
        failedPdfs: 0,
        cancelledPdfs: 0,
        totalPages: 1,
        pagesProcessed: 1,
        totalOffers: 1,
        totalCostUsd: 0.02
      },
      leaflets: [
        {
          leafletId: 'leaflet-001',
          fileName: 'lulu-hypermarket-63800343-jeddah.pdf',
          filePath: 'C:/tmp/lulu.pdf',
          fileSizeBytes: 1024,
          fileFingerprint: 'fp-lulu',
          pageCount: 85,
          pagesToProcess: [3],
          pageSelectionMode: 'specific',
          pagesProcessed: 1,
          offersCount: 1,
          estimatedCostUsd: 0.02,
          status: 'completed',
          workspacePath: 'C:/tmp/ws-lulu',
          provenance: 'fresh',
          metadata: {
            supermarketId: 'sup-lulu',
            supermarketName: 'LuLu Hypermarket',
            leafletTitle: '11.11 DEALS',
            offerStartDate: '2026-11-11',
            offerEndDate: '2026-11-17',
            currency: 'SAR',
            locationScope: null,
            detectedCities: ['Jeddah', 'Makkah', 'Yanbu', 'Tabuk', 'Khamis Mushaith', 'Taif', 'Madinah'],
            geographicNotice: 'Multiple cities printed (Jeddah, Makkah, Yanbu...) — select scope explicitly.',
            verified: false,
            evidenceByField: {
              validity: { field: 'validity', sourcePage: 1, method: 'hybrid_extraction', evidenceText: '11th 17th NOVEMBER 2026' }
            }
          }
        }
      ]
    };

    const offer: UnifiedBatchOffer = {
      batchOfferKey: 'k1',
      batchId: 'batch-step3-ui',
      leafletId: 'leaflet-001',
      sourceFileName: 'lulu-hypermarket-63800343-jeddah.pdf',
      sourcePdfPath: 'C:/tmp/lulu.pdf',
      sourcePage: 3,
      sourceOfferId: 'o_p3_1',
      canonicalSourceId: 'o_p3_1',
      supermarketId: 'sup-lulu',
      supermarketName: 'LuLu Hypermarket',
      locationScope: null,
      locationLabel: null,
      cityId: null,
      regionId: null,
      offerStartDate: '2026-11-11',
      offerEndDate: '2026-11-17',
      metadataVerified: false,
      titleAr: 'زيت زيتون',
      titleEn: 'Olive Oil',
      brand: 'Lulu',
      brandAr: 'لولو',
      brandEn: 'Lulu',
      promoPrice: 19.95,
      originalPrice: 34.95,
      discountPercent: 43,
      promoNotes: 'ONE DAY ONLY exception',
      conflictCodes: ['SINGLE_DAY_OFFER_EXCEPTION'],
      sizeOrWeight: '1L',
      each_size_value: 1,
      each_size_unit: 'l',
      inner_pack_count: 1,
      sale_unit_type: 'piece',
      total_content_value: 1,
      total_content_unit: 'l',
      free_units_text: null,
      customer_limit: null,
      productThumbCropPath: null,
      offerCardCropPath: null,
      status: 'extracted',
      confidence: 'high',
      category: 'grocery'
    };

    const updateLeafletMetadata = vi.fn(async () => ({ ...summary }));
    (window as any).wifranExtractor = {
      batch: {
        getSummary: vi.fn(async () => summary),
        getUnifiedOffers: vi.fn(async () => [offer]),
        updateLeafletMetadata
      }
    };

    render(
      <UnifiedBatchPreview
        batchId="batch-step3-ui"
        onBack={vi.fn()}
        catalogSupermarkets={[{ id: 'sup-lulu', name_en: 'LuLu Hypermarket' }]}
        catalogCities={[{ id: 'city-jeddah', name_en: 'Jeddah', region_id: 'reg-makkah', slug: 'jeddah' }]}
      />
    );

    expect(await screen.findByText(/Step 3 — Consolidated Operator Review/i)).toBeInTheDocument();
    expect(screen.getByText(/Multi-City Scope Evidence: Multiple cities printed/i)).toBeInTheDocument();
    expect(screen.getByText(/⚠ ONE DAY ONLY Exception/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Review & Verify Metadata/i }));
    const startInput = screen.getByLabelText(/Start Date for lulu-hypermarket-63800343-jeddah\.pdf/i) as HTMLInputElement;
    const endInput = screen.getByLabelText(/End Date for lulu-hypermarket-63800343-jeddah\.pdf/i) as HTMLInputElement;
    expect(startInput.value).toBe('2026-11-11');
    expect(endInput.value).toBe('2026-11-17');

    fireEvent.change(screen.getByLabelText(/Geographic Scope for lulu-hypermarket-63800343-jeddah\.pdf/i), {
      target: { value: 'city' }
    });
    fireEvent.change(screen.getByLabelText(/City for lulu-hypermarket-63800343-jeddah\.pdf/i), {
      target: { value: 'city-jeddah' }
    });
    fireEvent.click(screen.getByRole('button', { name: /Save & Verify Metadata/i }));

    await waitFor(() => {
      expect(updateLeafletMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
          batchId: 'batch-step3-ui',
          leafletId: 'leaflet-001',
          verified: true,
          metadata: expect.objectContaining({
            supermarketId: 'sup-lulu',
            locationScope: 'city',
            cityId: 'city-jeddah',
            offerStartDate: '2026-11-11',
            offerEndDate: '2026-11-17'
          })
        })
      );
    });
  });
});
