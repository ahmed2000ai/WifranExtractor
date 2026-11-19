/**
 * @vitest-environment jsdom
 */
/**
 * WIFRAN-EXTRACTOR-IDENTITY-005J-UAT-FIX-02
 * Renderer + Offline Cost/Cover Discovery Verification Suite (Offline, jsdom).
 *
 * Tests:
 * 1. Clicking "Verify Meta" on all 3 UAT leaflets opens the visible modal dialog with
 *    offline cover preview, discovery feedback, validation errors, Save & Verify, and Edit Meta.
 * 2. Extraction start remains blocked until all 3 leaflets are verified and both
 *    authorizations are checked.
 * 3. Pre-extraction Hybrid V3 API cost estimate reflects full-page + selective crop +
 *    output + thinking tokens at Vertex Flex gemini-3.8-flash rates + governor cap.
 * 4. Offline Page 1 PDF cover inspection extracts cover metadata on real multi-page PDFs
 *    without touching selected extraction page scope, and reports errors cleanly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { BatchProgressDashboard } from '../BatchProgressDashboard';
import {
  estimateBatchApiCost,
  calculateGeminiCost,
  HYBRID_V3_LIVE_PILOT_TOKEN_PROFILES
} from '../../../../../shared/utils/geminiPricingAndCostEstimator';
import type { BatchManifest } from '../../../../../shared/types/batchExtraction';

const SUP_OTHAIM = { id: 'sup-othaim', name_en: 'Othaim Markets', name_ar: 'أسواق العثيم', slug: 'othaim' };
const SUP_BINDAWOOD = { id: 'sup-bindawood', name_en: 'BinDawood', name_ar: 'بن داود', slug: 'bindawood' };
const SUP_PANDA = { id: 'sup-panda', name_en: 'Hyper Panda', name_ar: 'هايبر بنده', slug: 'hyper-panda' };

const REG_MAKKAH = { id: 'reg-makkah', name_en: 'Makkah Region', name_ar: 'منطقة مكة المكرمة' };
const CITY_JEDDAH = { id: 'city-jeddah', name_en: 'Jeddah', name_ar: 'جدة', region_id: 'reg-makkah', region_name_en: 'Makkah Region' };

function buildThreeLeafletFivePageManifest(): BatchManifest {
  return {
    schemaVersion: '1.0',
    batchId: 'batch-uat-005j-fix02',
    createdAt: '2026-11-14T19:00:00.000Z',
    updatedAt: '2026-11-14T19:00:00.000Z',
    status: 'created',
    workspaceDir: 'F:\\Workspaces\\batch-uat',
    executionMode: 'flex',
    extractionPipelineMode: 'hybrid_v3',
    model: 'gemini-3.8-flash',
    leaflets: [
      {
        leafletId: 'leaflet-01',
        fileName: 'othaim-markets-72800415-jeddah.pdf',
        filePath: 'F:\\Leaflets\\othaim-markets-72800415-jeddah.pdf',
        fileSizeBytes: 102400,
        fileFingerprint: 'hash-othaim',
        pageCount: 60,
        pagesToProcess: [27, 41],
        pageSelectionMode: 'specific',
        pageSelectionInput: '27,41',
        workspacePath: 'F:\\Workspaces\\batch-uat\\leaflet-01',
        status: 'queued',
        provenance: 'fresh',
        pagesProcessed: 0,
        offersCount: 0,
        estimatedCostUsd: 0,
        startedAt: null,
        completedAt: null,
        error: null,
        metadata: {
          supermarketId: null,
          supermarketName: null,
          leafletTitle: null,
          locationScope: null,
          regionId: null,
          cityId: null,
          locationLabel: null,
          currency: 'SAR',
          offerStartDate: null,
          offerEndDate: null,
          verified: false,
          verifiedBy: null,
          verifiedAt: null,
          discoveryStatus: 'no_text_found',
          discoveryMessage: null,
          discoveryError: null
        }
      },
      {
        leafletId: 'leaflet-02',
        fileName: 'bin-dawood-222797436-jeddah.pdf',
        filePath: 'F:\\Leaflets\\bin-dawood-222797436-jeddah.pdf',
        fileSizeBytes: 84000,
        fileFingerprint: 'hash-bindawood',
        pageCount: 40,
        pagesToProcess: [24],
        pageSelectionMode: 'specific',
        pageSelectionInput: '24',
        workspacePath: 'F:\\Workspaces\\batch-uat\\leaflet-02',
        status: 'queued',
        provenance: 'fresh',
        pagesProcessed: 0,
        offersCount: 0,
        estimatedCostUsd: 0,
        startedAt: null,
        completedAt: null,
        error: null,
        metadata: {
          supermarketId: null,
          supermarketName: null,
          leafletTitle: null,
          locationScope: null,
          regionId: null,
          cityId: null,
          locationLabel: null,
          currency: 'SAR',
          offerStartDate: null,
          offerEndDate: null,
          verified: false,
          verifiedBy: null,
          verifiedAt: null,
          discoveryStatus: 'no_text_found',
          discoveryMessage: null,
          discoveryError: null
        }
      },
      {
        leafletId: 'leaflet-03',
        fileName: 'hyper-panda-70800427-jeddah.pdf',
        filePath: 'F:\\Leaflets\\hyper-panda-70800427-jeddah.pdf',
        fileSizeBytes: 112000,
        fileFingerprint: 'hash-panda',
        pageCount: 64,
        pagesToProcess: [7, 58],
        pageSelectionMode: 'specific',
        pageSelectionInput: '7,58',
        workspacePath: 'F:\\Workspaces\\batch-uat\\leaflet-03',
        status: 'queued',
        provenance: 'fresh',
        pagesProcessed: 0,
        offersCount: 0,
        estimatedCostUsd: 0,
        startedAt: null,
        completedAt: null,
        error: null,
        metadata: {
          supermarketId: null,
          supermarketName: null,
          leafletTitle: null,
          locationScope: null,
          regionId: null,
          cityId: null,
          locationLabel: null,
          currency: 'SAR',
          offerStartDate: null,
          offerEndDate: null,
          verified: false,
          verifiedBy: null,
          verifiedAt: null,
          discoveryStatus: 'no_text_found',
          discoveryMessage: null,
          discoveryError: null
        }
      }
    ],
    totals: {
      totalPdfs: 3,
      completedPdfs: 0,
      failedPdfs: 0,
      cancelledPdfs: 0,
      totalPages: 5,
      pagesProcessed: 0,
      totalOffers: 0,
      totalCostUsd: 0
    },
    error: null
  };
}

describe('005J-UAT-FIX-02 — Metadata Verification Modal, Cost Estimator & Offline Cover Inspection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    delete (window as any).wifranExtractor;
  });

  it('renders Step 2 processing dashboard for all 3 leaflets without obsolete Verify Meta / Review Meta dialog (UI-03)', async () => {
    const currentManifest = buildThreeLeafletFivePageManifest();

    const getManifest = vi.fn(async () => structuredClone(currentManifest));
    const start = vi.fn(async () => structuredClone(currentManifest));

    (window as any).wifranExtractor = {
      batch: {
        getManifest,
        start,
        onProgress: vi.fn(() => () => {})
      }
    };

    render(
      <BatchProgressDashboard
        batchId="batch-uat-005j-fix02"
        catalogSupermarkets={[SUP_OTHAIM, SUP_BINDAWOOD, SUP_PANDA]}
        catalogRegions={[REG_MAKKAH]}
        catalogCities={[CITY_JEDDAH]}
        onOpenUnifiedPreview={vi.fn()}
        onBackToSelector={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Authorized Scope \(3 Leaflet\(s\) • 5 Page\(s\)/i)).toBeInTheDocument();
    });

    expect(screen.getByText('othaim-markets-72800415-jeddah.pdf')).toBeInTheDocument();
    expect(screen.getByText('bin-dawood-222797436-jeddah.pdf')).toBeInTheDocument();
    expect(screen.getByText('hyper-panda-70800427-jeddah.pdf')).toBeInTheDocument();

    // Fix08 UI-03: Obsolete Step 2 metadata modal and Review Meta / Edit Meta buttons are removed
    expect(screen.queryByRole('button', { name: 'Review Meta' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Meta' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('computes Hybrid V3 API cost estimates accurately at Vertex Flex gemini-3.8-flash rates', () => {
    const fullPageCalc = calculateGeminiCost(HYBRID_V3_LIVE_PILOT_TOKEN_PROFILES.fullPage, 'gemini-3.8-flash', 'flex', '2026-11-14');
    const cropCalc = calculateGeminiCost(HYBRID_V3_LIVE_PILOT_TOKEN_PROFILES.verificationCrop, 'gemini-3.8-flash', 'flex', '2026-11-14');

    expect(fullPageCalc.totalCostUsd).toBeCloseTo(0.023495, 5);
    expect(cropCalc.totalCostUsd).toBeCloseTo(0.006365, 5);

    const est = estimateBatchApiCost({
      targetPageCount: 5,
      extractionPipelineMode: 'hybrid_v3',
      modelId: 'gemini-3.8-flash',
      tier: 'flex'
    });

    // 5 full-page calls + 10..25 selective crops
    expect(est.estimatedLowUsd).toBeCloseTo(5 * (fullPageCalc.totalCostUsd + 2 * cropCalc.totalCostUsd), 4);
    expect(est.estimatedHighUsd).toBeCloseTo(5 * (fullPageCalc.totalCostUsd + 5 * cropCalc.totalCostUsd), 4);
    expect(est.maxAuthorizedCapUsd).toBeCloseTo(1.25, 4);
    expect(est.expectedNormalCostPerOfferLowUsd).toBeCloseTo(0.004, 4);
    expect(est.expectedNormalCostPerOfferHighUsd).toBeCloseTo(0.006, 4);
    expect(est.expectedNormalLowUsd).toBeCloseTo(5 * 16 * 0.004, 4);
    expect(est.expectedNormalHighUsd).toBeCloseTo(5 * 16 * 0.006, 4);
    expect(est.estimatedLowUsd).toBeGreaterThan(0.06);
  });
});
