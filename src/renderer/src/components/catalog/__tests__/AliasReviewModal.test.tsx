/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { AliasReviewModal } from '../AliasReviewModal'
import type {
  ProductAliasProposal,
  OperatorAuthContext
} from '../../../../../shared/types/productAliasStaging'

describe('AliasReviewModal (Milestone 2E Operator Review Component)', () => {
  afterEach(() => {
    cleanup()
  })

  const baseProposal: ProductAliasProposal = {
    id: 'prop-ui-001',
    aliasText: 'Al Safi Full Cream Milk 12x1L',
    canonicalNormalizedKey: 'al safi full cream milk 12x1l',
    proposedProductId: '101',
    language: 'en',
    compatibilityResult: {
      isCompatible: true,
      reasons: ['Product identity and attributes verified compatible.']
    },
    proposalOrigin: 'operator',
    status: 'pending_review',
    proposingOperatorId: 'op_proposer',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    auditTrail: []
  }

  const baseTargetProduct = {
    id: 101,
    name_en: 'Al Safi Long Life Full Cream Milk',
    name_ar: 'حليب الصافي طويل الأجل كامل الدسم',
    brand_name_en: 'Al Safi',
    size_value: 1,
    size_unit: 'L',
    inner_pack_count: 12,
    verification_status: 'verified',
    verified: true
  }

  const authorizedAuth: OperatorAuthContext = {
    operatorId: 'lead_operator',
    role: 'catalog_operator',
    isServerVerified: true
  }

  const offlineAuth: OperatorAuthContext = {
    operatorId: 'local_user',
    role: 'catalog_operator',
    isServerVerified: false
  }

  it('renders modal with proposed alias, canonical normalized key, and target product facts', () => {
    render(
      <AliasReviewModal
        isOpen={true}
        proposal={baseProposal}
        targetProduct={baseTargetProduct}
        authContext={authorizedAuth}
        onClose={vi.fn()}
        onReviewSubmit={vi.fn()}
      />
    )

    expect(screen.getByText('Product Alias Staging & Review')).toBeInTheDocument()
    expect(screen.getByText('Al Safi Full Cream Milk 12x1L')).toBeInTheDocument()
    expect(screen.getByText('al safi full cream milk 12x1l')).toBeInTheDocument()
    expect(screen.getByText('Al Safi Long Life Full Cream Milk')).toBeInTheDocument()
    expect(screen.getByText('✓ Verified Identity')).toBeInTheDocument()
    expect(screen.getByText('✓ Product identity is compatible with candidate evidence.')).toBeInTheDocument()
  })

  it('displays offline/unauthenticated warning and disables approve button when not server verified', () => {
    render(
      <AliasReviewModal
        isOpen={true}
        proposal={baseProposal}
        targetProduct={baseTargetProduct}
        authContext={offlineAuth}
        onClose={vi.fn()}
        onReviewSubmit={vi.fn()}
      />
    )

    expect(screen.getByText('⚠️ Offline / Unauthenticated Mode')).toBeInTheDocument()
    const approveBtn = screen.getByRole('button', { name: 'Approve Alias' })
    expect(approveBtn).toBeDisabled()
  })

  it('enables approve button when operator is server-verified and identity is compatible without conflicts', () => {
    render(
      <AliasReviewModal
        isOpen={true}
        proposal={baseProposal}
        targetProduct={baseTargetProduct}
        authContext={authorizedAuth}
        onClose={vi.fn()}
        onReviewSubmit={vi.fn()}
      />
    )

    const approveBtn = screen.getByRole('button', { name: 'Approve Alias' })
    expect(approveBtn).not.toBeDisabled()
  })

  it('disables approve button when target product is unverified', () => {
    render(
      <AliasReviewModal
        isOpen={true}
        proposal={baseProposal}
        targetProduct={{ ...baseTargetProduct, verification_status: 'unverified', verified: false }}
        authContext={authorizedAuth}
        onClose={vi.fn()}
        onReviewSubmit={vi.fn()}
      />
    )

    expect(screen.getByText('⚠️ Unverified Product')).toBeInTheDocument()
    const approveBtn = screen.getByRole('button', { name: 'Approve Alias' })
    expect(approveBtn).toBeDisabled()
  })

  it('disables approve button and displays warning when proposal has conflicts', () => {
    render(
      <AliasReviewModal
        isOpen={true}
        proposal={{ ...baseProposal, status: 'conflict_needs_review' }}
        targetProduct={baseTargetProduct}
        conflictingCandidates={[{ id: 999, name_en: 'Conflicting Product', brand_name_en: 'Other Brand' }]}
        authContext={authorizedAuth}
        onClose={vi.fn()}
        onReviewSubmit={vi.fn()}
      />
    )

    expect(screen.getByText('⚠️ Conflicting Catalog Candidates Detected')).toBeInTheDocument()
    const approveBtn = screen.getByRole('button', { name: 'Approve Alias' })
    expect(approveBtn).toBeDisabled()
  })

  it('submits review decision with operator reason', async () => {
    const onReviewSubmitMock = vi.fn().mockResolvedValue(undefined)
    const onCloseMock = vi.fn()

    render(
      <AliasReviewModal
        isOpen={true}
        proposal={baseProposal}
        targetProduct={baseTargetProduct}
        authContext={authorizedAuth}
        onClose={onCloseMock}
        onReviewSubmit={onReviewSubmitMock}
      />
    )

    const textarea = screen.getByPlaceholderText('Enter rationale for approval or rejection...')
    fireEvent.change(textarea, { target: { value: 'Verified against source leaflet' } })

    const approveBtn = screen.getByRole('button', { name: 'Approve Alias' })
    fireEvent.click(approveBtn)

    expect(onReviewSubmitMock).toHaveBeenCalledWith('approved', 'Verified against source leaflet')
  })
})

