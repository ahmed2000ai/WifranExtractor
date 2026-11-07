/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { ImageEnrichmentWorkflow } from '../ImageEnrichmentWorkflow'
import type {
  ExportHybridImageRefsResult,
  CsvValidationSummary,
  UploadProductImagesResult
} from '../../../../../shared/types/productImageEnrichment'

describe('ImageEnrichmentWorkflow UI Component (WIFRAN-07J)', () => {
  const mockExportResult: ExportHybridImageRefsResult = {
    csvContent: '\uFEFFImage_Ref,item_name\nP1,Almarai Milk 1L\nO123,Flashlight',
    count: 2,
    pCount: 1,
    oCount: 1,
    groupedOffersCount: 0,
    rows: [
      { imageRef: 'P1', itemName: 'Almarai Milk 1L', kind: 'product', productId: 1 },
      { imageRef: 'O123', itemName: 'Flashlight', kind: 'offer', offerId: '123' }
    ],
    products: [{ id: 1, item_name: 'Almarai Milk 1L' }],
    offers: [{ id: '123', item_name: 'Flashlight', visual_subject_key: 'generic:flashlight' }]
  }

  const mockValidationValid: CsvValidationSummary = {
    ok: true,
    totalRows: 2,
    validRowsCount: 2,
    blankSkippedCount: 0,
    alreadyHasImageCount: 0,
    errorCount: 0,
    rows: [
      {
        rowNumber: 1,
        imageRef: 'P1',
        productId: 1,
        targetKind: 'product',
        productName: 'Almarai Milk 1L',
        imageUrl: 'https://images.example.com/milk.jpg',
        status: 'valid'
      },
      {
        rowNumber: 2,
        imageRef: 'O123',
        offerId: '123',
        targetKind: 'offer',
        productName: 'Flashlight',
        imageUrl: 'https://images.example.com/flashlight.jpg',
        status: 'valid'
      }
    ],
    errors: []
  }

  const mockValidationWithErrors: CsvValidationSummary = {
    ok: false,
    totalRows: 1,
    validRowsCount: 0,
    blankSkippedCount: 0,
    alreadyHasImageCount: 0,
    errorCount: 1,
    rows: [
      {
        rowNumber: 1,
        imageRef: 'P999',
        productId: 999,
        targetKind: 'product',
        imageUrl: 'https://images.example.com/notfound.jpg',
        status: 'unknown_product',
        issueMessage: 'Product ID 999 does not exist in database'
      }
    ],
    errors: ['Row 1: Product ID 999 does not exist in database']
  }

  const mockUploadResult: UploadProductImagesResult = {
    totalRows: 2,
    uploadedCount: 1,
    reusedCount: 1,
    skippedCount: 0,
    failedCount: 0,
    success: 2,
    skipped: 0,
    errors: 0,
    results: [
      {
        imageRef: 'P1',
        productId: 1,
        targetKind: 'product',
        status: 'uploaded',
        publicUrl: 'https://swratbmclahjyekouned.supabase.co/storage/v1/object/public/product-images/1/hash1.webp',
        storagePath: '1/hash1.webp'
      },
      {
        imageRef: 'O123',
        offerId: '123',
        targetKind: 'offer',
        status: 'reused',
        publicUrl: 'https://swratbmclahjyekouned.supabase.co/storage/v1/object/public/offer-display-images/123/hash1.webp',
        storagePath: '123/hash1.webp'
      }
    ]
  }

  let exportImageCsvSpy: any
  let saveExportedCsvDialogSpy: any
  let validateImageCsvSpy: any
  let uploadProductImagesSpy: any
  let onUploadProgressSpy: any

  beforeEach(() => {
    exportImageCsvSpy = vi.fn().mockResolvedValue(mockExportResult)
    saveExportedCsvDialogSpy = vi.fn().mockResolvedValue({
      canceled: false,
      filePath: 'F:/Work/AI Projects/wifran-offers-extractor/exports/wifran_v2_hybrid_image_refs_for_search.csv'
    })
    validateImageCsvSpy = vi.fn().mockResolvedValue(mockValidationValid)
    uploadProductImagesSpy = vi.fn().mockResolvedValue(mockUploadResult)
    onUploadProgressSpy = vi.fn().mockImplementation(() => () => {})

    // Mock window.wifranExtractor
    ;(window as any).wifranExtractor = {
      catalog: {
        exportImageCsv: exportImageCsvSpy,
        saveExportedCsvDialog: saveExportedCsvDialogSpy,
        validateImageCsv: validateImageCsvSpy,
        uploadProductImages: uploadProductImagesSpy,
        onUploadProgress: onUploadProgressSpy
      }
    }
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders the clean two-section layout for Step 1 and Step 3', () => {
    render(<ImageEnrichmentWorkflow />)

    expect(screen.getByText('Step 1: Export Hybrid Image Search CSV')).toBeInTheDocument()
    expect(screen.getByText('Step 3: Import Approved Image Candidates')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Export Image Search CSV/i })).toBeInTheDocument()
    expect(screen.getByText(/Expected 2-column format:/i)).toBeInTheDocument()
    expect(screen.getAllByText('Image_Ref,image_url').length).toBeGreaterThan(0)
  })

  it('executes Step 1 Export, calls save dialog, and displays breakdown summary', async () => {
    render(<ImageEnrichmentWorkflow />)

    const exportBtn = screen.getByRole('button', { name: /Export Image Search CSV/i })
    fireEvent.click(exportBtn)

    await waitFor(() => {
      expect(exportImageCsvSpy).toHaveBeenCalledWith({ includeUnresolvedOffers: true })
    })

    await waitFor(() => {
      expect(saveExportedCsvDialogSpy).toHaveBeenCalledWith({
        defaultFileName: 'wifran_v2_hybrid_image_refs_for_search.csv',
        csvContent: mockExportResult.csvContent
      })
    })

    // Expect success card
    await waitFor(() => {
      expect(screen.getByText(/Export Complete & Saved Successfully/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/Saved to:/i)).toBeInTheDocument()
    expect(screen.getByText('Total Search Refs')).toBeInTheDocument()
    expect(screen.getByText('Verified Products (P)')).toBeInTheDocument()
    expect(screen.getByText('Visual Offers (O)')).toBeInTheDocument()
  })

  it('executes Step 3 read-only offline validation and renders preview metrics', async () => {
    render(<ImageEnrichmentWorkflow />)

    const file = new File(['Image_Ref,image_url\nP1,https://images.example.com/milk.jpg'], 'candidates.csv', {
      type: 'text/csv'
    })

    const input = document.getElementById('step3-csv-file-input') as HTMLInputElement
    expect(input).toBeInTheDocument()

    // Trigger file change
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(validateImageCsvSpy).toHaveBeenCalled()
    })

    // Assert summary cards render
    await waitFor(() => {
      expect(screen.getByText('Total Rows in CSV')).toBeInTheDocument()
      expect(screen.getByText('Valid Rows to Fetch')).toBeInTheDocument()
    })

    // Upload button must be disabled until operator checkbox is checked
    const uploadBtn = screen.getByRole('button', { name: /Upload Product Images to DB/i })
    expect(uploadBtn).toBeDisabled()
  })

  it('keeps upload button strictly disabled when validation fails with errors', async () => {
    validateImageCsvSpy.mockResolvedValueOnce(mockValidationWithErrors)

    render(<ImageEnrichmentWorkflow />)

    const file = new File(['Image_Ref,image_url\nP999,https://images.example.com/notfound.jpg'], 'bad.csv', {
      type: 'text/csv'
    })
    const input = document.getElementById('step3-csv-file-input') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText(/Validation Blockers/i)).toBeInTheDocument()
    })

    const checkbox = document.getElementById('operator-image-review-checkbox') as HTMLInputElement
    // Operator checkbox is disabled when validation fails
    expect(checkbox).toBeDisabled()

    const uploadBtn = screen.getByRole('button', { name: /Upload Product Images to DB/i })
    expect(uploadBtn).toBeDisabled()
  })

  it('executes Step 3 upload when valid and authorized, displaying report and reset', async () => {
    render(<ImageEnrichmentWorkflow />)

    const file = new File(['Image_Ref,image_url\nP1,https://example.com/1.jpg\nO123,https://example.com/2.jpg'], 'approved.csv', {
      type: 'text/csv'
    })
    const input = document.getElementById('step3-csv-file-input') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText('Valid Rows to Fetch')).toBeInTheDocument()
    })

    // Check operator review checkbox
    const checkbox = document.getElementById('operator-image-review-checkbox') as HTMLInputElement
    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(true)

    // Upload button should now be enabled
    const uploadBtn = screen.getByRole('button', { name: /Upload Product Images to DB/i })
    expect(uploadBtn).not.toBeDisabled()

    // Click upload
    fireEvent.click(uploadBtn)

    await waitFor(() => {
      expect(uploadProductImagesSpy).toHaveBeenCalledWith({
        csvContent: expect.any(String),
        operatorConfirmedReview: true,
        reviewedBy: 'operator',
        rightsBasis: 'operator_manual_verified'
      })
    })

    // Final report is displayed
    await waitFor(() => {
      expect(screen.getByText(/Batch Image Upload & Deduplication Report/i)).toBeInTheDocument()
      expect(screen.getByText('Newly Uploaded')).toBeInTheDocument()
      expect(screen.getByText('Reused (Dedup)')).toBeInTheDocument()
    })

    // Reset button clears state
    const resetBtn = screen.getByRole('button', { name: /Reset & Import Another Batch/i })
    fireEvent.click(resetBtn)

    expect(screen.queryByText(/Batch Image Upload & Deduplication Report/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Drop completed Step 2 CSV file here/i)).toBeInTheDocument()
  })
})
