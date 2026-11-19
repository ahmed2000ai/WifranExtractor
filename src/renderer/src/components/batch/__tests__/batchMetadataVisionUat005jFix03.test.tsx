/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BatchProgressDashboard } from '../BatchProgressDashboard';
import type { BatchManifest } from '../../../../../shared/types/batchExtraction';

const SUP_OTHAIM = {
  id: 'c2cc16c2-0002-4444-b000-c00000000002',
  name_en: 'Othaim Markets',
  name_ar: 'أسواق العثيم',
  slug: 'othaim'
};
const REG_MAKKAH = { id: 'reg-makkah', name_en: 'Makkah Region', name_ar: 'منطقة مكة المكرمة', slug: 'makkah' };
const CITY_JEDDAH = {
  id: 'city-jeddah',
  name_en: 'Jeddah',
  name_ar: 'جدة',
  slug: 'jeddah',
  region_id: 'reg-makkah',
  region_name_en: 'Makkah Region'
};

function makeInitialManifest(): BatchManifest {
  return {
    schemaVersion: '1.0',
    batchId: 'batch-uat-005j-fix03-ui',
    createdAt: '2026-11-15T00:00:00.000Z',
    updatedAt: '2026-11-15T00:00:00.000Z',
    status: 'created',
    workspaceDir: 'F:/tmp/batch-fix03',
    executionMode: 'flex',
    extractionPipelineMode: 'hybrid_v3',
    model: 'gemini-3.8-flash',
    totals: {
      totalPdfs: 1,
      completedPdfs: 0,
      failedPdfs: 0,
      cancelledPdfs: 0,
      totalPages: 2,
      pagesProcessed: 0,
      totalOffers: 0,
      totalCostUsd: 0
    },
    approvedScope: {
      hybridV3Authorized: false,
      hybridV3LiveAuthorized: false,
      totalTargetPages: 2,
      pagesByLeafletId: { 'l-othaim': [27, 41] },
      authorizedAt: '2026-11-15T00:00:00.000Z'
    },
    leaflets: [
      {
        leafletId: 'l-othaim',
        fileName: 'othaim-markets-72800415-jeddah.pdf',
        filePath: 'F:/tmp/othaim-markets-72800415-jeddah.pdf',
        fileSizeBytes: 1024000,
        fileFingerprint: 'fp-othaim',
        pageCount: 61,
        pagesToProcess: [27, 41],
        pageSelectionMode: 'specific',
        pagesProcessed: 0,
        offersCount: 0,
        estimatedCostUsd: 0,
        status: 'queued',
        workspacePath: 'F:/tmp/ws-othaim',
        provenance: 'fresh',
        metadata: {
          // Simulate stale filename slug in legacy manifest — UI must strip it
          leafletTitle: 'othaim-markets-72800415-jeddah',
          verified: false,
          discoveryStatus: 'no_text_found',
          discoveryMessage: 'Scanned PDF pages 1, 27, 41 contain raster images (0 embedded text chars).'
        }
      }
    ]
  };
}

describe('005J-UAT-FIX-03 — Targeted AI Vision Metadata Discovery UI Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Step 2 processing dashboard with Hybrid V3 label and omits obsolete Verify Leaflet Metadata modal (UI-03)', async () => {
    let liveManifest = makeInitialManifest();

    const discoverVisionMock = vi.fn(async (input: any) => {
      expect(input.explicitVisionAuthorization).toBe(true);
      liveManifest = {
        ...liveManifest,
        leaflets: [
          {
            ...liveManifest.leaflets[0],
            metadata: {
              ...liveManifest.leaflets[0].metadata,
              supermarketId: SUP_OTHAIM.id,
              supermarketName: 'Othaim Markets',
              leafletTitle: 'موسم العثيم',
              offerStartDate: '2026-11-10',
              offerEndDate: '2026-11-16',
              currency: 'SAR',
              locationScope: null,
              verified: false,
              discoverySource: 'targeted_vision',
              discoveryStatus: 'partial',
              discoveryMessage:
                'AI Vision inspected pages [1, 27, 41] (2 call(s), $0.0041) -> Proposed: Retailer (p.1), Validity (p.1), Title (p.1). Conflicting validity dates found — confirm carefully.',
              conflictingValidity: [
                {
                  startDate: '2026-11-11',
                  endDate: '2026-11-17',
                  rawPrintedText: 'Offers Valid From Wednesday 11 Nov To Tuesday 17 Nov 2026',
                  sourcePage: 41
                }
              ],
              evidenceByField: {
                retailer: { field: 'retailer', sourcePage: 1, method: 'targeted_vision', evidenceText: 'أسواق العثيم' },
                validity: { field: 'validity', sourcePage: 1, method: 'targeted_vision', evidenceText: '10-16 Nov' },
                title: { field: 'title', sourcePage: 1, method: 'targeted_vision', evidenceText: 'موسم العثيم' }
              },
              visionCostUsd: 0.0041,
              visionRequestsUsed: 2,
              visionCacheHit: false,
              visionTargetPages: [1, 27, 41]
            }
          }
        ]
      };
      return liveManifest;
    });

    const updateMetadataMock = vi.fn(async (input: any) => {
      liveManifest = {
        ...liveManifest,
        leaflets: [
          {
            ...liveManifest.leaflets[0],
            metadata: {
              ...liveManifest.leaflets[0].metadata,
              ...input.metadata,
              verified: true
            }
          }
        ]
      };
      return liveManifest;
    });

    (window as any).wifranExtractor = {
      batch: {
        getManifest: vi.fn(async () => liveManifest),
        getSummary: vi.fn(async () => ({
          batchId: liveManifest.batchId,
          totalOffers: 0,
          totalLeaflets: 1,
          verifiedLeaflets: liveManifest.leaflets[0].metadata.verified ? 1 : 0,
          matchedOffers: 0,
          unmatchedOffers: 0
        })),
        onProgress: vi.fn(() => () => {}),
        getCoverPreview: vi.fn(async () => ({ ok: true, dataUrl: 'data:image/png;base64,iVBORw0KGgo=' })),
        getMetadataVisionCostEstimate: vi.fn(async () => ({
          ok: true,
          targetPages: [1, 27, 41],
          estimate: {
            modelId: 'gemini-3.8-flash',
            tier: 'flex',
            targetImageCount: 2,
            unitCallCostUsd: 0.0022,
            estimatedLowUsd: 0.0022,
            estimatedHighUsd: 0.0044,
            maxAuthorizedCapUsd: 0.025,
            includesOutputAndThinkingTokens: true
          }
        })),
        discoverLeafletMetadataWithVision: discoverVisionMock,
        updateLeafletMetadata: updateMetadataMock
      }
    };

    render(
      <BatchProgressDashboard
        batchId={liveManifest.batchId}
        catalogSupermarkets={[SUP_OTHAIM]}
        catalogRegions={[REG_MAKKAH]}
        catalogCities={[CITY_JEDDAH]}
        onOpenUnifiedPreview={() => {}}
        onBackToSelector={() => {}}
      />
    );

    expect(
      await screen.findByText('othaim-markets-72800415-jeddah.pdf')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review Meta' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Meta' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(discoverVisionMock).not.toHaveBeenCalled();
    expect(updateMetadataMock).not.toHaveBeenCalled();
  });
});
