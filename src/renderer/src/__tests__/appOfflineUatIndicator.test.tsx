/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import App from '../App'
import { LeafletMetadataConfirmationCard } from '../components/metadata/LeafletMetadataConfirmationCard'

function createMockWifranExtractor(isOfflineUat: boolean) {
  const noopUnsub = () => () => {}
  return {
    app: {
      getVersion: vi.fn().mockResolvedValue('1.0.0'),
      getHealth: vi.fn().mockResolvedValue({
        ok: true,
        appVersion: '1.0.0',
        environment: 'development',
        isOfflineUat
      })
    },
    config: {
      getStatus: vi.fn().mockResolvedValue({
        mistral: {
          apiKey: { configured: true, required: true },
          ocrModel: { configured: true, required: true },
          ocrEndpoint: { configured: true, required: true }
        },
        supabase: {
          url: { configured: true, required: true },
          serviceRoleKey: { configured: true, required: true },
          storageBucket: { configured: true, required: true }
        },
        ocr: { chunkSize: 1 },
        pdf: { renderDpi: 150 },
        importBehavior: {
          autoCreateBrands: false,
          autoCreateProducts: false,
          autoCreateCategories: false,
          skipDuplicateOffers: true,
          defaultOfferStatus: 'published',
          importDefaultStatus: 'published',
          allowNeedsReviewFallback: true,
          publishWarningsAllowed: true,
          dataQualityNeedsReviewThreshold: 80,
          requireImageForDraft: false
        }
      })
    },
    reference: {
      loadAll: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          supermarkets: [
            { id: 'c2cc16c2-0001-4444-b000-c00000000001', name_en: 'Panda', name_ar: 'بنده', slug: 'panda', code: 'PAND' }
          ],
          cities: [],
          regions: [],
          supermarketRegions: [],
          categories: [],
          brands: [],
          units: []
        }
      })
    },
    files: { selectPdf: vi.fn() },
    pdf: {
      onPreprocessProgress: vi.fn(noopUnsub),
      onRenderStreamingProgress: vi.fn(noopUnsub),
      preprocess: vi.fn(),
      renderStreaming: vi.fn()
    },
    ocr: {
      onPipelineProgress: vi.fn(noopUnsub),
      onRetryProgress: vi.fn(noopUnsub),
      runPipeline: vi.fn(),
      retryFailedChunks: vi.fn(),
      testSingleChunk: vi.fn()
    },
    image: { onCropProgress: vi.fn(noopUnsub), cropOcrRows: vi.fn() },
    reviewWorkflow: { onProgress: vi.fn(noopUnsub), validateLayouts: vi.fn(), runCropAndItemOcr: vi.fn() },
    pageFirst: {
      onProgress: vi.fn(noopUnsub),
      onQuickTestProgress: vi.fn(noopUnsub),
      onQuickTestLog: vi.fn(noopUnsub),
      processLeaflet: vi.fn(),
      processPage: vi.fn(),
      quickTestPage: vi.fn(),
      resume: vi.fn(),
      rebuildCropsFromOcr: vi.fn()
    },
    metadata: {
      get: vi.fn().mockResolvedValue({ ok: true, data: null }),
      discover: vi.fn(),
      confirm: vi.fn()
    },
    productEnrichment: {
      loadDraft: vi.fn().mockResolvedValue(null),
      initializeDraft: vi.fn()
    },
    extractionPackage: {
      listAvailable: vi.fn().mockResolvedValue({ ok: true, extracts: [] }),
      open: vi.fn(),
      continueExtraction: vi.fn()
    },
    importTracking: { persist: vi.fn() },
    entityMatching: { matchRows: vi.fn() },
    offerPreparation: { prepare: vi.fn() },
    offerSync: { onProgress: vi.fn(noopUnsub), syncPreparedOffers: vi.fn() }
  }
}

describe('Offline UAT Visual Indicators in Root App & Metadata Card', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.title = 'Wifran Offers Extractor'
  })

  afterEach(() => {
    cleanup()
  })

  it('displays OFFLINE UAT — SIMULATED pill, banner, window title, and honest readiness badges when isOfflineUat=true', async () => {
    ;(window as any).wifranExtractor = createMockWifranExtractor(true)

    render(<App />)

    const pill = await screen.findByTestId('offline-uat-pill')
    expect(pill).toHaveTextContent(/OFFLINE UAT — SIMULATED/i)

    const banner = screen.getByTestId('offline-uat-banner')
    expect(banner).toHaveTextContent(/DETERMINISTIC SIMULATION MODE/i)
    expect(banner).toHaveTextContent(/workspaces_uat\//i)

    await waitFor(() => {
      expect(document.title).toBe('Wifran Offers Extractor [OFFLINE UAT - SIMULATED]')
    })

    expect(screen.getByText(/Mode: OFFLINE UAT — SIMULATED/i)).toBeInTheDocument()
  })

  it('omits OFFLINE UAT indicators and keeps standard Ready badges when isOfflineUat=false', async () => {
    ;(window as any).wifranExtractor = createMockWifranExtractor(false)

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText(/Healthy/i)).toBeInTheDocument()
    })

    expect(screen.queryByTestId('offline-uat-pill')).not.toBeInTheDocument()
    expect(screen.queryByTestId('offline-uat-banner')).not.toBeInTheDocument()
    expect(document.title).toBe('Wifran Offers Extractor')
  })

  it('appends (SIMULATED — NO API CHARGE) to AI Vision Budget in LeafletMetadataConfirmationCard when isOfflineUat=true', () => {
    ;(window as any).wifranExtractor = createMockWifranExtractor(true)

    render(
      <LeafletMetadataConfirmationCard
        metadataRecord={{
          leafletFingerprint: 'fp-uat',
          operatorConfirmed: false,
          retailer: null,
          validity: null,
          scanCoverage: {
            analyzedPages: [1, 2],
            unsearchedPages: [6],
            totalPages: 6,
            selectionMode: 'all',
            selectedPages: [1, 2, 3, 4, 5, 6],
            isComplete: false,
            visionBudgetStatus: {
              attemptsUsed: 1,
              authorizedAllowance: 2,
              remainingAttempts: 1,
              budgetExhausted: false,
              canExtend: true,
              hardCeiling: 4
            }
          }
        }}
        catalogSupermarkets={[]}
        onConfirm={vi.fn()}
        isConfirmed={false}
        isOfflineUat={true}
      />
    )

    expect(screen.getByText(/AI Vision Budget: 1\/2 used \(1 remaining\) \(SIMULATED — NO API CHARGE\)/i)).toBeInTheDocument()
  })
})

