/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MetadataCompletionModal } from '../MetadataCompletionModal'
import type { StagedLeafletHeader, StagedLeafletDraft } from '../../../../../shared/types/productImageEnrichment'

describe('MetadataCompletionModal (WIFRAN-07J Step 2 Import Fallback)', () => {
  const mockHeader: StagedLeafletHeader = {
    supermarketId: null,
    region: null,
    validFrom: null,
    validTo: null,
    headerModifiedByOperator: false
  }

  const mockDraft: StagedLeafletDraft = {
    schemaVersion: 'wifran.staged.draft/1.0',
    jobDir: '/test/job',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    header: {
      supermarketId: 'sm-test-id',
      region: 'Western Region',
      validFrom: '2026-11-01',
      validTo: '2026-11-07',
      headerModifiedByOperator: true
    },
    items: []
  }

  beforeEach(() => {
    window.wifranExtractor = {
      productEnrichment: {
        getSupermarketsAndRegions: vi.fn().mockResolvedValue({
          supermarkets: [
            { id: 'sm-panda-1', name_en: 'Panda', name_ar: 'بنده', slug: 'panda' },
            { id: 'sm-danube-1', name_en: 'Danube', name_ar: 'الدانوب', slug: 'danube' }
          ],
          regions: [
            { id: 'reg-jeddah-1', name_en: 'Jeddah', name_ar: 'جدة', slug: 'jeddah' },
            { id: 'reg-riyadh-1', name_en: 'Riyadh', name_ar: 'الرياض', slug: 'riyadh' }
          ]
        }),
        resolveSupermarket: vi.fn().mockResolvedValue({
          id: 'sm-new-resolved-1',
          name_en: 'Al Ahlam Hypermarket',
          name_ar: 'أسواق الأحلام',
          slug: 'al-ahlam',
          isNew: true
        }),
        resolveRegion: vi.fn().mockResolvedValue({
          id: 'reg-new-resolved-1',
          name_en: 'Neom Province',
          name_ar: 'منطقة نيوم',
          slug: 'neom',
          isNew: true
        }),
        updateHeader: vi.fn().mockResolvedValue(mockDraft)
      } as any
    } as any
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders modal with missing field alerts and validation warnings', async () => {
    const handleClose = vi.fn()
    const handleSave = vi.fn()

    render(
      <MetadataCompletionModal
        jobDir="/test/job"
        currentHeader={mockHeader}
        missingFields={['supermarket', 'validFrom']}
        validationWarnings={['Supermarket (SMN) is missing.', 'Start Date (SD) is missing.']}
        onClose={handleClose}
        onSave={handleSave}
      />
    )

    expect(screen.getByTestId('metadata-completion-modal')).toBeInTheDocument()
    expect(screen.getByText('Complete Leaflet Metadata')).toBeInTheDocument()
    expect(screen.getByText('Supermarket (SMN) is missing.')).toBeInTheDocument()
    expect(screen.getByText('Start Date (SD) is missing.')).toBeInTheDocument()

    // Wait for dropdowns to be populated
    await waitFor(() => {
      expect(screen.getByText('Panda (بنده)')).toBeInTheDocument()
      expect(screen.getByText('Jeddah (جدة)')).toBeInTheDocument()
    })
  })

  it('switches to custom text input when ➕ Add New option is selected and saves resolved entities', async () => {
    const handleClose = vi.fn()
    const handleSave = vi.fn()

    render(
      <MetadataCompletionModal
        jobDir="/test/job"
        currentHeader={mockHeader}
        missingFields={['supermarket', 'region', 'validFrom', 'validTo']}
        onClose={handleClose}
        onSave={handleSave}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('modal-supermarket-select')).toBeInTheDocument()
    })

    const smSelect = screen.getByTestId('modal-supermarket-select') as HTMLSelectElement
    const smOptions = Array.from(smSelect.options)
    expect(smOptions[smOptions.length - 1]?.value).toBe('__ADD_NEW__')
    expect(smOptions[smOptions.length - 1]?.textContent).toBe('New supermarket...')

    // Select Add New Supermarket
    fireEvent.change(smSelect, {
      target: { value: '__ADD_NEW__' }
    })
    const customSmInput = screen.getByTestId('modal-custom-supermarket-input')
    expect(customSmInput).toBeInTheDocument()
    fireEvent.change(customSmInput, { target: { value: 'Al Ahlam Hypermarket' } })

    // Select Add New Region
    fireEvent.change(screen.getByTestId('modal-region-select'), {
      target: { value: '__ADD_NEW__' }
    })
    const customRegInput = screen.getByTestId('modal-custom-region-input')
    expect(customRegInput).toBeInTheDocument()
    fireEvent.change(customRegInput, { target: { value: 'Neom Province' } })

    // Fill Dates
    fireEvent.change(screen.getByTestId('modal-valid-from-input'), {
      target: { value: '2026-11-01' }
    })
    fireEvent.change(screen.getByTestId('modal-valid-to-input'), {
      target: { value: '2026-11-07' }
    })

    // Submit form
    fireEvent.click(screen.getByTestId('modal-save-metadata-btn'))

    await waitFor(() => {
      expect(window.wifranExtractor.productEnrichment.resolveSupermarket).toHaveBeenCalledWith('Al Ahlam Hypermarket')
      expect(window.wifranExtractor.productEnrichment.resolveRegion).toHaveBeenCalledWith('Neom Province')
      expect(window.wifranExtractor.productEnrichment.updateHeader).toHaveBeenCalledWith('/test/job', {
        supermarketId: 'sm-new-resolved-1',
        region: 'Neom Province',
        validFrom: '2026-11-01',
        validTo: '2026-11-07'
      })
      expect(handleSave).toHaveBeenCalledWith(mockDraft)
      expect(handleClose).toHaveBeenCalled()
    })
  })

  it('validates date order (end date must be >= start date)', async () => {
    const handleClose = vi.fn()
    const handleSave = vi.fn()

    render(
      <MetadataCompletionModal
        jobDir="/test/job"
        currentHeader={{ ...mockHeader, supermarketId: 'sm-panda-1', region: 'Jeddah' }}
        onClose={handleClose}
        onSave={handleSave}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('modal-supermarket-select')).toBeInTheDocument()
    })

    // End date earlier than start date
    fireEvent.change(screen.getByTestId('modal-valid-from-input'), {
      target: { value: '2026-11-10' }
    })
    fireEvent.change(screen.getByTestId('modal-valid-to-input'), {
      target: { value: '2026-11-05' }
    })

    fireEvent.click(screen.getByTestId('modal-save-metadata-btn'))

    expect(screen.getByText('End Date (2026-11-05) cannot be earlier than Start Date (2026-11-10).')).toBeInTheDocument()
    expect(window.wifranExtractor.productEnrichment.updateHeader).not.toHaveBeenCalled()
  })

  it('renders modal in confirmation mode when all fields are valid with no missing fields or warnings', async () => {
    const handleClose = vi.fn()
    const handleSave = vi.fn()

    render(
      <MetadataCompletionModal
        jobDir="/test/job"
        currentHeader={{
          supermarketId: 'sm-panda-1',
          region: 'Jeddah',
          validFrom: '2026-11-01',
          validTo: '2026-11-07',
          headerModifiedByOperator: false
        }}
        missingFields={[]}
        validationWarnings={[]}
        onClose={handleClose}
        onSave={handleSave}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('metadata-completion-modal')).toBeInTheDocument()
    })

    // Header & Info banner
    expect(screen.getByText('Confirm Leaflet Metadata')).toBeInTheDocument()
    expect(screen.getByText('Review & Confirm Leaflet Metadata')).toBeInTheDocument()
    expect(
      screen.getByText(/Review and confirm the discovered or operator-entered Supermarket, Region\/Scope, and Offer Validity Dates below before publishing to the database./i)
    ).toBeInTheDocument()

    // Submit button label
    const submitBtn = screen.getByTestId('modal-save-metadata-btn')
    expect(submitBtn).toHaveTextContent('Confirm & Apply Metadata')

    // Click confirm & apply
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(window.wifranExtractor.productEnrichment.updateHeader).toHaveBeenCalledWith('/test/job', {
        supermarketId: 'sm-panda-1',
        region: 'Jeddah',
        validFrom: '2026-11-01',
        validTo: '2026-11-07'
      })
      expect(handleSave).toHaveBeenCalledWith(mockDraft)
      expect(handleClose).toHaveBeenCalled()
    })
  })
})

