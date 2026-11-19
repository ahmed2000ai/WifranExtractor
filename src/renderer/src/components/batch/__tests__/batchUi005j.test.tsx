/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MultiPdfSelector, evaluateSelectedFilePages } from '../MultiPdfSelector'
import { ProductMatchingReview } from '../ProductMatchingReview'
import type { SelectedPdfFile } from '../../../../../shared/types/importForm'
import type { UnifiedBatchOffer } from '../../../../../shared/types/batchExtraction'
import type { MatchingRunManifest } from '../../../../../shared/types/catalogMatching'

function makeOffer(overrides: Partial<UnifiedBatchOffer> & { batchOfferKey: string; leafletId: string; sourceOfferId: string }): UnifiedBatchOffer {
  return {
    batchId: 'batch_ui_001',
    sourceFileName: 'leaflet.pdf',
    sourcePdfPath: '/tmp/leaflet.pdf',
    sourceFileFingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    sourcePage: 2,
    canonicalSourceId: overrides.sourceOfferId,
    supermarketId: 'sup-panda',
    supermarketName: 'Panda',
    locationScope: 'national',
    locationLabel: 'National',
    cityId: null,
    regionId: null,
    offerStartDate: '2026-11-10',
    offerEndDate: '2026-11-25',
    currency: 'SAR',
    leafletTitle: 'Weekly Deals',
    metadataVerified: true,
    titleAr: 'حليب المراعي طازج 1 لتر',
    titleEn: 'Almarai Fresh Milk 1L',
    brand: 'Almarai',
    brandAr: 'المراعي',
    brandEn: 'Almarai',
    brandConfidence: 'high',
    variantOrFlavor: 'Full Fat',
    category: 'Dairy',
    promoPrice: 10.5,
    originalPrice: 13.5,
    discountPercent: 22,
    promoNotes: null,
    sizeOrWeight: '1L',
    each_size_value: 1,
    each_size_unit: 'L',
    inner_pack_count: 1,
    sale_unit_type: 'each',
    total_content_value: 1,
    total_content_unit: 'L',
    free_units_text: null,
    customer_limit: null,
    offerCardCropPath: '/tmp/offer_card.webp',
    productThumbCropPath: '/tmp/thumb.webp',
    originalPageImagePath: '/tmp/page2.png',
    status: 'extracted',
    confidence: 'high',
    quarantineReasons: [],
    operatorEdited: false,
    ...overrides
  }
}

describe('WIFRAN-EXTRACTOR-IDENTITY-005J-FIX — Batch UI & Grouped Review Regression Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('validates per-PDF page selection in Hybrid V3 mode and blocks invalid/empty selections', () => {
    const fileValid: SelectedPdfFile = {
      path: '/tmp/panda.pdf',
      name: 'panda.pdf',
      sizeBytes: 1024,
      extension: '.pdf',
      pageCount: 12,
      pageSelectionMode: 'specific',
      pageSelectionInput: '2, 5'
    }
    const evalValid = evaluateSelectedFilePages(fileValid, 'hybrid_v3')
    expect(evalValid.error).toBeNull()
    expect(evalValid.selectedPages).toEqual([2, 5])

    const fileDup: SelectedPdfFile = {
      ...fileValid,
      pageSelectionInput: '2, 2'
    }
    expect(evaluateSelectedFilePages(fileDup, 'hybrid_v3').error).toMatch(/Duplicate page number/i)

    const fileEmpty: SelectedPdfFile = {
      ...fileValid,
      pageSelectionInput: ''
    }
    expect(evaluateSelectedFilePages(fileEmpty, 'hybrid_v3').error).toMatch(/Enter page numbers/i)

    const onStart = vi.fn()
    render(
      <MultiPdfSelector
        selectedFiles={[
          fileValid,
          { ...fileValid, path: '/tmp/othaim.pdf', name: 'othaim.pdf', pageCount: 10, pageSelectionInput: '1, 3' },
          { ...fileValid, path: '/tmp/danube.pdf', name: 'danube.pdf', pageCount: 8, pageSelectionInput: '4, 9' }
        ]}
        onFilesChange={vi.fn()}
        onStartExtraction={onStart}
        isExtracting={false}
        extractionPipelineMode="hybrid_v3"
      />
    )

    // Out-of-bounds page 9 in 8-page Danube PDF shows error and disables batch creation button
    expect(screen.getByText(/Page 9 is out of bounds/i)).toBeInTheDocument()
    expect(screen.getByText(/Pages Selected \/ Doc Total/i)).toBeInTheDocument()
    const submitBtn = screen.getByRole('button', { name: /Start Processing/i })
    expect(submitBtn).toBeDisabled()
  })

  it('renders Grouped Cross-Retailer View by default, preserves independent retailer rows, opens Crop Modal, and warns on PROD->DEV mismatch', async () => {
    const saveDecisionMock = vi.fn(async (req: any) => ({
      ...manifest,
      proposals: {
        ...manifest.proposals,
        ...(req.batchOfferKey
          ? {
              [req.batchOfferKey]: {
                ...manifest.proposals[req.batchOfferKey],
                operatorDecision: req.decision
              }
            }
          : {})
      }
    }))

    const offers: UnifiedBatchOffer[] = [
      makeOffer({
        batchOfferKey: 'k_panda',
        leafletId: 'leaflet-001',
        sourceOfferId: 'doc_111:p002:i001',
        supermarketId: 'sup-panda',
        supermarketName: 'Panda',
        promoPrice: 10.5,
        locationScope: 'national',
        locationLabel: 'National',
        offerStartDate: '2026-11-10',
        offerEndDate: '2026-11-20',
        sourcePage: 2
      }),
      makeOffer({
        batchOfferKey: 'k_othaim',
        leafletId: 'leaflet-002',
        sourceOfferId: 'doc_222:p003:i001',
        supermarketId: 'sup-othaim',
        supermarketName: 'Othaim',
        promoPrice: 9.95,
        locationScope: 'city',
        locationLabel: 'Riyadh',
        offerStartDate: '2026-11-12',
        offerEndDate: '2026-11-19',
        sourcePage: 3
      }),
      makeOffer({
        batchOfferKey: 'k_danube',
        leafletId: 'leaflet-003',
        sourceOfferId: 'doc_333:p004:i001',
        supermarketId: 'sup-danube',
        supermarketName: 'Danube',
        promoPrice: 11.25,
        locationScope: 'city',
        locationLabel: 'Jeddah',
        offerStartDate: '2026-11-11',
        offerEndDate: '2026-11-18',
        sourcePage: 4
      })
    ]

    const candidate101 = {
      id: '101',
      nameEn: 'Almarai Fresh Milk 1L Full Fat',
      nameAr: 'حليب المراعي طازج 1 لتر',
      brand: 'Almarai',
      variant: 'Full Fat',
      sizeValue: 1,
      sizeUnit: 'L',
      packCount: 1
    }

    const manifest: MatchingRunManifest = {
      schemaVersion: '1.0',
      batchId: 'batch_ui_001',
      runId: 'run_1',
      createdAt: '2026-11-14T00:00:00Z',
      updatedAt: '2026-11-14T00:00:00Z',
      status: 'completed',
      matchingDatabaseContext: 'PRODUCTION_UI',
      model: 'gemini-3.8-flash',
      thinkingLevel: 'MEDIUM',
      executionMode: 'flex',
      brandSummaries: {},
      totals: {
        totalExtractedOffers: 3,
        uniqueIdentitiesCount: 1,
        cacheMatchesCount: 0,
        deterministicMatchesCount: 3,
        geminiEvaluatedCount: 0,
        proposedExistingCount: 3,
        proposedTemporaryCount: 0,
        unresolvedCount: 0,
        validationWarningsCount: 0,
        actualCostUsd: 0,
        estimatedCostUsd: 0,
        geminiRequestsCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0
      },
      proposals: {
        k_panda: {
          batchOfferKey: 'k_panda',
          sourceOfferId: 'doc_111:p002:i001',
          sourcePage: 2,
          leafletId: 'leaflet-001',
          supermarketName: 'Panda',
          decision: 'existing',
          matchedProductId: '101',
          matchedProduct: candidate101,
          matchedDatabaseContext: 'PRODUCTION_UI',
          temporaryId: null,
          confidence: 'high',
          matchMethod: 'deterministic',
          validationIssues: [],
          operatorDecision: 'proposed',
          updatedAt: '2026-11-14T00:00:00Z'
        },
        k_othaim: {
          batchOfferKey: 'k_othaim',
          sourceOfferId: 'doc_222:p003:i001',
          sourcePage: 3,
          leafletId: 'leaflet-002',
          supermarketName: 'Othaim',
          decision: 'existing',
          matchedProductId: '101',
          matchedProduct: candidate101,
          matchedDatabaseContext: 'PRODUCTION_UI',
          temporaryId: null,
          confidence: 'high',
          matchMethod: 'deterministic',
          validationIssues: [],
          operatorDecision: 'proposed',
          updatedAt: '2026-11-14T00:00:00Z'
        },
        k_danube: {
          batchOfferKey: 'k_danube',
          sourceOfferId: 'doc_333:p004:i001',
          sourcePage: 4,
          leafletId: 'leaflet-003',
          supermarketName: 'Danube',
          decision: 'existing',
          matchedProductId: '101',
          matchedProduct: candidate101,
          matchedDatabaseContext: 'PRODUCTION_UI',
          temporaryId: null,
          confidence: 'high',
          matchMethod: 'deterministic',
          validationIssues: [],
          operatorDecision: 'proposed',
          updatedAt: '2026-11-14T00:00:00Z'
        }
      },
      temporaryProducts: {}
    }

    ;(window as any).wifranExtractor = {
      matching: {
        getStatus: vi.fn(async () => manifest),
        estimate: vi.fn(async () => null),
        getRetryFailedSummary: vi.fn(async () => null),
        onProgress: vi.fn(() => () => {}),
        start: vi.fn(async () => manifest),
        retryFailedOnly: vi.fn(async () => manifest),
        pause: vi.fn(async () => ({ message: 'paused' })),
        cancel: vi.fn(async () => ({ message: 'cancelled' })),
        saveDecision: saveDecisionMock,
        publishApproved: vi.fn(async () => ({ preflightReady: true }))
      }
    }

    render(<ProductMatchingReview batchId="batch_ui_001" offers={offers} onBack={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('Catalog #101')).toBeInTheDocument()
    })

    // 1 grouped card showing all 3 retailers with independent price, scope, and dates
    expect(screen.getByText(/3 retailers • 3 offers/i)).toBeInTheDocument()
    expect(screen.getByText('10.5 SAR')).toBeInTheDocument()
    expect(screen.getByText('9.95 SAR')).toBeInTheDocument()
    expect(screen.getByText('11.25 SAR')).toBeInTheDocument()
    expect(screen.getByText('Riyadh')).toBeInTheDocument()
    expect(screen.getByText('Jeddah')).toBeInTheDocument()

    // View Crop button opens Crop Evidence Inspection Modal
    const viewCropButtons = screen.getAllByRole('button', { name: 'View Crop' })
    fireEvent.click(viewCropButtons[0])
    expect(screen.getByText('Offer Card Evidence Crop')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    // Switching publish target to DEVELOPMENT_TEST surfaces PROD->DEV mismatch warning immediately
    const publishSelect = screen.getByDisplayValue(/PRODUCTION_UI \(Schema-Gated Live DB\)/i)
    fireEvent.change(publishSelect, { target: { value: 'DEVELOPMENT_TEST' } })
    expect(screen.getByText(/CATALOG_ENVIRONMENT_MISMATCH/i)).toBeInTheDocument()
    expect(screen.getByText(/Allow Historical Dates \(UAT\)/i)).toBeInTheDocument()

    // Approve All Offers invokes saveDecision for all 3 retailer offers
    fireEvent.click(screen.getByRole('button', { name: 'Approve All Offers' }))
    await waitFor(() => {
      expect(saveDecisionMock).toHaveBeenCalledTimes(3)
    })
  })
})
