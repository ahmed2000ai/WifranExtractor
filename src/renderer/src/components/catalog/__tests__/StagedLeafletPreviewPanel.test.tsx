/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { StagedLeafletPreviewPanel } from '../StagedLeafletPreviewPanel'
import type {
  StagedLeafletDraft,
  StagedOfferItem,
  PublishStagedLeafletResult
} from '../../../../../shared/types/productImageEnrichment'

describe('StagedLeafletPreviewPanel (WIFRAN-07J Phase 3)', () => {
  const item1: StagedOfferItem = {
    id: 'offer-1',
    sourceOfferId: 'offer-1',
    imageRef: 'O1',
    pageNumber: 1,
    croppedEvidenceLocalPath: '/crops/offer-1.webp',
    existingDbImageUrl: null,
    candidateImageLocalPath: '/candidates/offer-1.webp',
    selectedImageSource: 'candidate',
    isAiCorrected: false,
    isOperatorModified: false,
    operatorEditedFields: [],
    originalOcr: {
      titleEn: 'Milk 1L',
      titleAr: 'حليب ١ لتر',
      brand: 'Almarai',
      sizeOrWeight: '1L',
      priceBefore: 10,
      priceAfter: 8,
      discountPercent: 20,
      promoNotes: null
    },
    titleEn: 'Milk 1L',
    titleAr: 'حليب ١ لتر',
    brand: 'Almarai',
    sizeOrWeight: '1L',
    priceBefore: 10,
    priceAfter: 8,
    discountPercent: 20,
    promoNotes: null
  }

  const item2: StagedOfferItem = {
    id: 'offer-2',
    sourceOfferId: 'offer-2',
    imageRef: 'O2',
    pageNumber: 1,
    croppedEvidenceLocalPath: '/crops/offer-2.webp',
    candidateImageLocalPath: '/candidates/offer-2.webp',
    selectedImageSource: 'candidate',
    isAiCorrected: true,
    aiCorrected: {
      titleAr: 'لوريال شامبو'
    },
    isOperatorModified: false,
    operatorEditedFields: [],
    originalOcr: {
      titleEn: "L'Oreal Shampoo",
      titleAr: 'رويال شامبو',
      brand: "L'Oreal",
      sizeOrWeight: '400ml',
      priceBefore: 20,
      priceAfter: 15,
      discountPercent: 25,
      promoNotes: null
    },
    titleEn: "L'Oreal Shampoo",
    titleAr: 'لوريال شامبو',
    brand: "L'Oreal",
    sizeOrWeight: '400ml',
    priceBefore: 20,
    priceAfter: 15,
    discountPercent: 25,
    promoNotes: null
  }

  const item3: StagedOfferItem = {
    id: 'offer-3',
    sourceOfferId: 'offer-3',
    imageRef: 'O3',
    pageNumber: 1,
    croppedEvidenceLocalPath: '/crops/offer-3.webp',
    candidateImageLocalPath: '/candidates/offer-3.webp',
    selectedImageSource: 'candidate',
    isAiCorrected: false,
    isOperatorModified: true,
    operatorEditedFields: ['priceBefore', 'discountPercent'],
    originalOcr: {
      titleEn: 'Apple Red',
      titleAr: 'تفاح أحمر',
      brand: null,
      sizeOrWeight: '1kg',
      priceBefore: 10,
      priceAfter: 6,
      discountPercent: 40,
      promoNotes: null
    },
    titleEn: 'Apple Red',
    titleAr: 'تفاح أحمر',
    brand: null,
    sizeOrWeight: '1kg',
    priceBefore: 12,
    priceAfter: 6,
    discountPercent: 50,
    promoNotes: null
  }

  const item4: StagedOfferItem = {
    id: 'offer-4',
    sourceOfferId: 'offer-4',
    imageRef: 'O4',
    pageNumber: 2,
    croppedEvidenceLocalPath: '/crops/offer-4.webp',
    existingDbImageUrl: 'https://example.com/p42.webp',
    candidateImageLocalPath: '/candidates/offer-4.webp',
    selectedImageSource: 'existing_db',
    postCorrectionDbMatch: {
      productId: 42,
      existingImageUrl: 'https://example.com/p42.webp',
      productTitleEn: 'Head & Shoulders Shampoo'
    },
    isAiCorrected: true,
    aiCorrected: {
      titleEn: 'Head & Shoulders Shampoo'
    },
    isOperatorModified: false,
    operatorEditedFields: [],
    originalOcr: {
      titleEn: 'Hed & Sholders',
      titleAr: 'هيد اند شولدرز',
      brand: 'Head & Shoulders',
      sizeOrWeight: '400ml',
      priceBefore: 24,
      priceAfter: 18,
      discountPercent: 25,
      promoNotes: null
    },
    titleEn: 'Head & Shoulders Shampoo',
    titleAr: 'هيد اند شولدرز',
    brand: 'Head & Shoulders',
    sizeOrWeight: '400ml',
    priceBefore: 24,
    priceAfter: 18,
    discountPercent: 25,
    promoNotes: null
  }

  const item5: StagedOfferItem = {
    id: 'offer-5',
    sourceOfferId: 'offer-5',
    imageRef: 'O5',
    pageNumber: 2,
    croppedEvidenceLocalPath: '/crops/offer-5.webp',
    candidateDownloadError: 'HTTP 404 Not Found',
    selectedImageSource: 'none',
    isAiCorrected: false,
    isOperatorModified: false,
    operatorEditedFields: [],
    originalOcr: {
      titleEn: 'Broken Item',
      titleAr: 'منتج غير متوفر',
      brand: null,
      sizeOrWeight: null,
      priceBefore: null,
      priceAfter: 5,
      discountPercent: null,
      promoNotes: null
    },
    titleEn: 'Broken Item',
    titleAr: 'منتج غير متوفر',
    brand: null,
    sizeOrWeight: null,
    priceBefore: null,
    priceAfter: 5,
    discountPercent: null,
    promoNotes: null
  }

  let mockDraft: StagedLeafletDraft
  let loadDraftSpy: any
  let updateOfferFieldSpy: any
  let revertOfferFieldSpy: any
  let replaceConsumerImageSpy: any
  let updateHeaderSpy: any
  let exportStep1CsvSpy: any
  let importStep2CsvSpy: any
  let saveCsvDialogSpy: any
  let publishStagedDraftSpy: any

  const mockPublishResult: PublishStagedLeafletResult = {
    ok: true,
    leafletId: 'test-leaflet-123',
    offersPublishedCount: 5,
    offersSkippedAlreadyPublishedCount: 0,
    productImagesUploadedCount: 2,
    offerDisplayImagesUploadedCount: 1,
    reusedExistingDbImagesCount: 2,
    aliasesLearnedCount: 1,
    purgedShortRefsCount: 1,
    errors: []
  }

  beforeEach(() => {
    mockDraft = {
      schemaVersion: 'wifran.staged.draft/1.0',
      jobDir: 'F:/Work/AI Projects/wifran-offers-extractor/workspaces/job-123',
      leafletHash: 'test-leaflet-123',
      createdAt: '2026-11-04T00:00:00.000Z',
      updatedAt: '2026-11-04T00:00:00.000Z',
      header: {
        supermarketId: 'alwafa',
        region: 'Western',
        validFrom: '2026-11-01',
        validTo: '2026-11-07',
        firstPagePublicUrl: 'https://example.com/p1.webp',
        lastPagePublicUrl: 'https://example.com/pn.webp',
        headerModifiedByOperator: false
      },
      items: [
        JSON.parse(JSON.stringify(item1)),
        JSON.parse(JSON.stringify(item2)),
        JSON.parse(JSON.stringify(item3)),
        JSON.parse(JSON.stringify(item4)),
        JSON.parse(JSON.stringify(item5))
      ]
    }

    loadDraftSpy = vi.fn().mockResolvedValue(mockDraft)
    updateOfferFieldSpy = vi.fn().mockImplementation((_jobDir, offerId, fieldUpdates) => {
      const cloned = JSON.parse(JSON.stringify(mockDraft))
      const target = cloned.items.find((i: any) => i.id === offerId)
      if (target) {
        Object.assign(target, fieldUpdates)
        for (const k of Object.keys(fieldUpdates)) {
          if (!target.operatorEditedFields.includes(k)) {
            target.operatorEditedFields.push(k)
          }
        }
        target.isOperatorModified = true
        // auto-calc discount if priceBefore or priceAfter changed
        if (target.priceBefore != null && target.priceAfter != null && target.priceBefore > target.priceAfter) {
          target.discountPercent = Math.round(((target.priceBefore - target.priceAfter) / target.priceBefore) * 100)
          if (!target.operatorEditedFields.includes('discountPercent')) {
            target.operatorEditedFields.push('discountPercent')
          }
        }
      }
      return Promise.resolve(cloned)
    })

    revertOfferFieldSpy = vi.fn().mockImplementation((_jobDir, offerId, fieldName) => {
      const cloned = JSON.parse(JSON.stringify(mockDraft))
      const target = cloned.items.find((i: any) => i.id === offerId)
      if (target) {
        if (!fieldName) {
          // revert all
          target.priceBefore = target.originalOcr.priceBefore
          target.priceAfter = target.originalOcr.priceAfter
          target.discountPercent = target.originalOcr.discountPercent
          target.titleAr = target.aiCorrected?.titleAr ?? target.originalOcr.titleAr
          target.operatorEditedFields = []
          target.isOperatorModified = false
        } else {
          target[fieldName] = target.originalOcr[fieldName]
          target.operatorEditedFields = target.operatorEditedFields.filter((f: string) => f !== fieldName)
          target.isOperatorModified = target.operatorEditedFields.length > 0
        }
      }
      return Promise.resolve(cloned)
    })

    replaceConsumerImageSpy = vi.fn().mockImplementation((_jobDir, offerId, replacement) => {
      const cloned = JSON.parse(JSON.stringify(mockDraft))
      const target = cloned.items.find((i: any) => i.id === offerId)
      if (target) {
        target.selectedImageSource = replacement.mode
        target.isOperatorModified = true
        if (!target.operatorEditedFields.includes('consumerImage')) {
          target.operatorEditedFields.push('consumerImage')
        }
      }
      return Promise.resolve(cloned)
    })

    updateHeaderSpy = vi.fn().mockResolvedValue(mockDraft)
    exportStep1CsvSpy = vi.fn().mockResolvedValue({ csvContent: 'header\n', exportableCount: 4, draft: mockDraft })
    importStep2CsvSpy = vi.fn().mockResolvedValue({ draft: mockDraft, matchedOffersCount: 5, missingFields: [], validationWarnings: [] })
    saveCsvDialogSpy = vi.fn().mockResolvedValue({ canceled: false, filePath: 'test.csv' })
    const selectCsvDialogSpy = vi.fn().mockResolvedValue({ canceled: false, content: 'Image_Ref,Title_EN\n' })
    publishStagedDraftSpy = vi.fn().mockResolvedValue(mockPublishResult)

    ;(window as any).wifranExtractor = {
      productEnrichment: {
        loadDraft: loadDraftSpy,
        updateOfferField: updateOfferFieldSpy,
        revertOfferField: revertOfferFieldSpy,
        replaceConsumerImage: replaceConsumerImageSpy,
        updateHeader: updateHeaderSpy,
        exportStep1Csv: exportStep1CsvSpy,
        importStep2Csv: importStep2CsvSpy,
        saveCsvDialog: saveCsvDialogSpy,
        selectCsvDialog: selectCsvDialogSpy,
        publishStagedDraft: publishStagedDraftSpy
      }
    }
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // TEST 1: Toggling Image Mode switches rendered image sources across cards
  // --------------------------------------------------------------------------
  it('toggles between Cropped Leaflet Mode and Downloaded Display Mode switching rendered image sources', async () => {
    render(<StagedLeafletPreviewPanel jobDir={mockDraft.jobDir} initialDraft={mockDraft} />)

    // Initial default mode is 'downloaded'
    const card1 = screen.getByTestId('offer-card-offer-1')
    const displayImg = within(card1).getByAltText('Consumer Display')
    expect(displayImg).toHaveAttribute('src', '/candidates/offer-1.webp')

    // Click '✂️ Cropped Leaflet Mode'
    const croppedBtn = screen.getByRole('button', { name: /Cropped Leaflet Mode/i })
    fireEvent.click(croppedBtn)

    // Verify all offer cards now render cropped evidence
    const cropImg = within(card1).getByAltText('Cropped Evidence')
    expect(cropImg).toHaveAttribute('src', '/crops/offer-1.webp')

    // Switch back to '🖼️ Downloaded Display Mode'
    const downloadedBtn = screen.getByRole('button', { name: /Downloaded Display Mode/i })
    fireEvent.click(downloadedBtn)

    const reDisplayImg = within(card1).getByAltText('Consumer Display')
    expect(reDisplayImg).toHaveAttribute('src', '/candidates/offer-1.webp')
  })

  // --------------------------------------------------------------------------
  // TEST 2: 3-Tier Visual Highlighting renders AI Corrected with Orig OCR and Edited by You badges
  // --------------------------------------------------------------------------
  it('renders 3-Tier Visual Highlighting (AI Corrected with original OCR text, and Edited by You)', async () => {
    render(<StagedLeafletPreviewPanel jobDir={mockDraft.jobDir} initialDraft={mockDraft} />)

    // Tier 1: Item 3 was operator edited
    const card3 = screen.getByTestId('offer-card-offer-3')
    expect(within(card3).getByText('Edited by You')).toBeInTheDocument()

    // Tier 2: Item 2 was AI corrected
    const card2 = screen.getByTestId('offer-card-offer-2')
    expect(within(card2).getByText('AI Corrected')).toBeInTheDocument()
    // Original OCR subtext comparison is rendered
    expect(within(card2).getByText(/Orig OCR: رويال شامبو/i)).toBeInTheDocument()

    // Tier 3: Item 5 has candidate download error
    const card5 = screen.getByTestId('offer-card-offer-5')
    expect(within(card5).getByText('Image Failed')).toBeInTheDocument()
  })

  // --------------------------------------------------------------------------
  // TEST 3: Editing Price Before/After updates Discount %, and clicking Revert (↺) restores value
  // --------------------------------------------------------------------------
  it('editing Price Before/After updates Discount % and clicking revert (↺) restores prior value', async () => {
    render(<StagedLeafletPreviewPanel jobDir={mockDraft.jobDir} initialDraft={mockDraft} />)

    const card1 = screen.getByTestId('offer-card-offer-1')
    const priceBeforeInput = within(card1).getByLabelText('Price Before')

    // Update Price Before to 20 (Price After is 8 -> new discount should be 60%)
    fireEvent.change(priceBeforeInput, { target: { value: '20' } })

    await waitFor(() => {
      expect(updateOfferFieldSpy).toHaveBeenCalledWith(
        mockDraft.jobDir,
        'offer-1',
        { priceBefore: 20 }
      )
    })

    // Now test Revert on Item 3 which has operator edited priceBefore
    const card3 = screen.getByTestId('offer-card-offer-3')
    const revertButtons = within(card3).getAllByText(/↺ Revert/i)
    expect(revertButtons.length).toBeGreaterThan(0)

    // Click the first revert button
    fireEvent.click(revertButtons[0])

    await waitFor(() => {
      expect(revertOfferFieldSpy).toHaveBeenCalledWith(
        mockDraft.jobDir,
        'offer-3',
        'priceBefore'
      )
    })

    // Test Revert All Edits on card 3 header
    const revertAllBtn = within(card3).getByRole('button', { name: /Revert All Edits/i })
    fireEvent.click(revertAllBtn)

    await waitFor(() => {
      expect(revertOfferFieldSpy).toHaveBeenCalledWith(
        mockDraft.jobDir,
        'offer-3'
      )
    })
  })

  // --------------------------------------------------------------------------
  // TEST 4: Post-Correction DB Match card allows 1-click toggling between sources
  // --------------------------------------------------------------------------
  it('allows 1-click toggling between existing_db and candidate images on Post-Correction DB Match card', async () => {
    render(<StagedLeafletPreviewPanel jobDir={mockDraft.jobDir} initialDraft={mockDraft} />)

    const card4 = screen.getByTestId('offer-card-offer-4')
    expect(within(card4).getByText(/🔗 Catalog Match Found: P42/i)).toBeInTheDocument()

    // Click 'Use Step 2 Candidate Image'
    const useCandidateBtn = within(card4).getByRole('button', { name: /Use Step 2 Candidate Image/i })
    fireEvent.click(useCandidateBtn)

    await waitFor(() => {
      expect(replaceConsumerImageSpy).toHaveBeenCalledWith(
        mockDraft.jobDir,
        'offer-4',
        {
          mode: 'candidate',
          customUrl: undefined,
          localFilePath: undefined
        }
      )
    })

    // Click 'Use Existing DB Image'
    const useExistingDbBtn = within(card4).getByRole('button', { name: /Use Existing DB Image/i })
    fireEvent.click(useExistingDbBtn)

    await waitFor(() => {
      expect(replaceConsumerImageSpy).toHaveBeenCalledWith(
        mockDraft.jobDir,
        'offer-4',
        {
          mode: 'existing_db',
          customUrl: undefined,
          localFilePath: undefined
        }
      )
    })
  })

  // --------------------------------------------------------------------------
  // TEST 5: Filter pills accurately filter visible cards
  // --------------------------------------------------------------------------
  it('filter pills accurately filter visible cards', async () => {
    render(<StagedLeafletPreviewPanel jobDir={mockDraft.jobDir} initialDraft={mockDraft} />)

    // All (5) are visible initially
    expect(screen.getByTestId('offer-card-offer-1')).toBeInTheDocument()
    expect(screen.getByTestId('offer-card-offer-2')).toBeInTheDocument()
    expect(screen.getByTestId('offer-card-offer-3')).toBeInTheDocument()
    expect(screen.getByTestId('offer-card-offer-4')).toBeInTheDocument()
    expect(screen.getByTestId('offer-card-offer-5')).toBeInTheDocument()

    // Click 'Edited by You (1)'
    const editedByYouFilter = screen.getByRole('button', { name: /Edited by You \(1\)/i })
    fireEvent.click(editedByYouFilter)

    expect(screen.queryByTestId('offer-card-offer-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('offer-card-offer-2')).not.toBeInTheDocument()
    expect(screen.getByTestId('offer-card-offer-3')).toBeInTheDocument()
    expect(screen.queryByTestId('offer-card-offer-4')).not.toBeInTheDocument()
    expect(screen.queryByTestId('offer-card-offer-5')).not.toBeInTheDocument()

    // Click 'AI Corrected (2)' (Item 2 and Item 4 both have isAiCorrected)
    const aiCorrectedFilter = screen.getByRole('button', { name: /AI Corrected/i })
    fireEvent.click(aiCorrectedFilter)

    expect(screen.queryByTestId('offer-card-offer-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('offer-card-offer-2')).toBeInTheDocument()
    expect(screen.queryByTestId('offer-card-offer-3')).not.toBeInTheDocument()
    expect(screen.getByTestId('offer-card-offer-4')).toBeInTheDocument()
    expect(screen.queryByTestId('offer-card-offer-5')).not.toBeInTheDocument()

    // Click 'Image Failed / Missing'
    const imageFailedFilter = screen.getByRole('button', { name: /Image Failed \/ Missing/i })
    fireEvent.click(imageFailedFilter)

    expect(screen.queryByTestId('offer-card-offer-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('offer-card-offer-2')).not.toBeInTheDocument()
    expect(screen.queryByTestId('offer-card-offer-3')).not.toBeInTheDocument()
    expect(screen.queryByTestId('offer-card-offer-4')).not.toBeInTheDocument()
    expect(screen.getByTestId('offer-card-offer-5')).toBeInTheDocument()

    // Click 'All' to restore
    const allFilter = screen.getByRole('button', { name: /All \(5\)/i })
    fireEvent.click(allFilter)

    expect(screen.getByTestId('offer-card-offer-1')).toBeInTheDocument()
    expect(screen.getByTestId('offer-card-offer-2')).toBeInTheDocument()
    expect(screen.getByTestId('offer-card-offer-3')).toBeInTheDocument()
    expect(screen.getByTestId('offer-card-offer-4')).toBeInTheDocument()
    expect(screen.getByTestId('offer-card-offer-5')).toBeInTheDocument()
  })

  // --------------------------------------------------------------------------
  // TEST 6: Publish to DB button gating, confirmation checkbox, and published summary banner
  // --------------------------------------------------------------------------
  it('enforces confirmation checkbox gating for Publish to DB and renders summary banner upon completion', async () => {
    render(<StagedLeafletPreviewPanel jobDir={mockDraft.jobDir} initialDraft={mockDraft} />)

    const publishBtn = screen.getByTestId('staged-publish-db-btn')
    const confirmCheckbox = screen.getByTestId('operator-confirm-publish-checkbox')

    // Initial state: Header is valid, but confirm checkbox is unchecked -> Button disabled
    expect(confirmCheckbox).not.toBeChecked()
    expect(publishBtn).toBeDisabled()

    // Check operator confirmation
    fireEvent.click(confirmCheckbox)
    expect(confirmCheckbox).toBeChecked()
    expect(publishBtn).not.toBeDisabled()

    // Click Publish to DB
    fireEvent.click(publishBtn)

    await waitFor(() => {
      expect(publishStagedDraftSpy).toHaveBeenCalledWith(
        mockDraft.jobDir,
        { operatorConfirmedPublish: true }
      )
    })

    // Verify Published Summary Banner is rendered
    await waitFor(() => {
      const banner = screen.getByTestId('published-summary-banner')
      expect(banner).toBeInTheDocument()
      expect(within(banner).getByText('Leaflet Published to Database Successfully!')).toBeInTheDocument()
      expect(within(banner).getByText('5')).toBeInTheDocument() // 5 offers published
      expect(within(banner).getAllByText('2')).toHaveLength(2) // 2 product images uploaded & 2 reused existing
      expect(within(banner).getAllByText('1')).toHaveLength(3) // 1 offer display image, 1 alias, 1 purged ref
    })

    // Button should now show "Published ✓" and be disabled
    expect(screen.getByRole('button', { name: /Published ✓/i })).toBeDisabled()
  })

  // --------------------------------------------------------------------------
  // TEST 7: Importing Step 2 CSV automatically opens MetadataCompletionModal
  // --------------------------------------------------------------------------
  it('automatically opens MetadataCompletionModal when importing Step 2 CSV', async () => {
    render(<StagedLeafletPreviewPanel jobDir={mockDraft.jobDir} initialDraft={mockDraft} />)

    // Find and click 'Import Step 2 CSV'
    const importBtn = screen.getByRole('button', { name: /Import Step 2 CSV/i })
    fireEvent.click(importBtn)

    await waitFor(() => {
      expect(importStep2CsvSpy).toHaveBeenCalled()
      // MetadataCompletionModal is opened
      expect(screen.getByTestId('metadata-completion-modal')).toBeInTheDocument()
      expect(screen.getByText('Confirm Leaflet Metadata')).toBeInTheDocument()
    })
  })
})
