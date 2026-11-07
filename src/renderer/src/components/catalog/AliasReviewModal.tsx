import React, { useState } from 'react'
import type {
  ProductAliasProposal,
  OperatorAuthContext
} from '../../../../shared/types/productAliasStaging'

export interface AliasReviewModalProps {
  proposal: ProductAliasProposal | null
  targetProduct: {
    id: string | number
    name_en?: string
    name_ar?: string
    brand_name_en?: string
    brand_name_ar?: string
    size_value?: number
    size_unit?: string
    inner_pack_count?: number
    variant_name_en?: string
    variant_name_ar?: string
    verification_status?: string
    verified?: boolean
  } | null
  conflictingCandidates?: Array<{
    id: string | number
    name_en?: string
    name_ar?: string
    brand_name_en?: string
  }>
  authContext: OperatorAuthContext
  isOpen: boolean
  onClose: () => void
  onReviewSubmit: (decision: 'approved' | 'rejected', reason: string) => Promise<void>
}

export const AliasReviewModal: React.FC<AliasReviewModalProps> = ({
  proposal,
  targetProduct,
  conflictingCandidates = [],
  authContext,
  isOpen,
  onClose,
  onReviewSubmit
}) => {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  if (!isOpen || !proposal) return null

  const isServerVerified = Boolean(authContext?.isServerVerified)
  const isOperatorAuthorized =
    isServerVerified && ['catalog_admin', 'catalog_operator'].includes(authContext?.role)
  const isTargetVerified = Boolean(
    targetProduct?.verification_status === 'verified' ||
      targetProduct?.verified === true
  )
  const isCompatible = proposal.compatibilityResult?.isCompatible ?? false
  const hasConflicts =
    conflictingCandidates.length > 0 || proposal.status === 'conflict_needs_review'
  const isPending =
    proposal.status === 'pending_review' || proposal.status === 'conflict_needs_review'

  const canApprove =
    isOperatorAuthorized && isTargetVerified && isCompatible && !hasConflicts && isPending

  const handleAction = async (decision: 'approved' | 'rejected') => {
    try {
      setSubmitting(true)
      setSubmitError(null)
      await onReviewSubmit(decision, reason.trim())
      onClose()
    } catch (err: any) {
      setSubmitError(err.message || 'An error occurred during review submission.')
    } finally {
      setSubmitting(false)
    }
  }

  const getStatusBadge = () => {
    switch (proposal.status) {
      case 'approved':
        return <span className="px-2 py-1 text-xs font-semibold rounded bg-green-100 text-green-800">Approved</span>
      case 'rejected':
        return <span className="px-2 py-1 text-xs font-semibold rounded bg-red-100 text-red-800">Rejected</span>
      case 'conflict_needs_review':
        return <span className="px-2 py-1 text-xs font-semibold rounded bg-amber-100 text-amber-800">Conflict / Needs Review</span>
      case 'superseded':
        return <span className="px-2 py-1 text-xs font-semibold rounded bg-gray-200 text-gray-700">Superseded</span>
      default:
        return <span className="px-2 py-1 text-xs font-semibold rounded bg-blue-100 text-blue-800">Pending Review</span>
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden text-gray-900">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
          <div>
            <h2 className="text-lg font-bold text-gray-800">Product Alias Staging & Review</h2>
            <p className="text-xs text-gray-500">Proposal ID: {proposal.id}</p>
          </div>
          <div className="flex items-center gap-3">
            {getStatusBadge()}
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 font-bold text-lg"
              aria-label="Close"
            >
              &times;
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-4 text-sm">
          {/* Server Auth Warning Banner */}
          {!isServerVerified && (
            <div className="p-3 bg-amber-50 border-l-4 border-amber-500 text-amber-900 text-xs rounded">
              <p className="font-semibold">⚠️ Offline / Unauthenticated Mode</p>
              <p>
                Server-verified operator authentication is unavailable in this desktop client.
                Direct database writes and live alias approvals are disabled.
              </p>
            </div>
          )}

          {/* Alias Details */}
          <div className="bg-gray-50 p-3 rounded border border-gray-200">
            <h3 className="font-semibold text-xs text-gray-500 uppercase tracking-wider mb-2">
              Proposed Alias
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-gray-500 text-xs block">Raw Alias Text:</span>
                <span className="font-semibold text-base">{proposal.aliasText}</span>
              </div>
              <div>
                <span className="text-gray-500 text-xs block">Canonical Normalized Key:</span>
                <code className="text-xs bg-gray-200 px-1 py-0.5 rounded text-indigo-700">
                  {proposal.canonicalNormalizedKey}
                </code>
              </div>
            </div>
          </div>

          {/* Target Product Details */}
          <div className="bg-gray-50 p-3 rounded border border-gray-200">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold text-xs text-gray-500 uppercase tracking-wider">
                Target Catalog Product (ID: {proposal.proposedProductId})
              </h3>
              {isTargetVerified ? (
                <span className="text-xs font-semibold text-green-700 bg-green-50 px-2 py-0.5 rounded border border-green-200">
                  ✓ Verified Identity
                </span>
              ) : (
                <span className="text-xs font-semibold text-red-700 bg-red-50 px-2 py-0.5 rounded border border-red-200">
                  ⚠️ Unverified Product
                </span>
              )}
            </div>

            {targetProduct ? (
              <div className="space-y-1">
                <p>
                  <strong className="text-gray-600">EN:</strong> {targetProduct.name_en || '—'}
                </p>
                <p>
                  <strong className="text-gray-600">AR:</strong> {targetProduct.name_ar || '—'}
                </p>
                <div className="grid grid-cols-3 gap-2 text-xs pt-1 border-t border-gray-200 mt-2">
                  <div>
                    <span className="text-gray-500">Brand:</span>{' '}
                    <span className="font-medium">
                      {targetProduct.brand_name_en || targetProduct.brand_name_ar || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Size / Unit:</span>{' '}
                    <span className="font-medium">
                      {targetProduct.size_value ? `${targetProduct.size_value} ${targetProduct.size_unit || ''}` : '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Pack Count:</span>{' '}
                    <span className="font-medium">
                      {targetProduct.inner_pack_count ? `${targetProduct.inner_pack_count}x` : '1x'}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-red-600 italic">Target product data not available.</p>
            )}
          </div>

          {/* Compatibility Breakdown */}
          <div className="bg-gray-50 p-3 rounded border border-gray-200">
            <h3 className="font-semibold text-xs text-gray-500 uppercase tracking-wider mb-1">
              Identity Compatibility
            </h3>
            {isCompatible ? (
              <p className="text-xs text-green-700 font-medium">✓ Product identity is compatible with candidate evidence.</p>
            ) : (
              <div className="text-xs text-red-700">
                <p className="font-semibold">⚠️ Product identity incompatibility detected:</p>
                <ul className="list-disc list-inside mt-1">
                  {proposal.compatibilityResult?.reasons?.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Conflicting Candidates */}
          {conflictingCandidates.length > 0 && (
            <div className="bg-red-50 p-3 rounded border border-red-200 text-xs text-red-950">
              <h3 className="font-semibold uppercase tracking-wider mb-1 text-red-800">
                ⚠️ Conflicting Catalog Candidates Detected
              </h3>
              <p className="mb-2">
                This alias key is claimed by or conflicts with other catalog products:
              </p>
              <ul className="space-y-1">
                {conflictingCandidates.map((c) => (
                  <li key={c.id} className="font-medium">
                    • Product ID {c.id}: {c.name_en || c.name_ar} ({c.brand_name_en || 'Unknown Brand'})
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Decision Safeguard Advisory */}
          <div className="bg-blue-50 border-l-4 border-blue-400 p-2 text-xs text-blue-900">
            <strong className="font-semibold">Verification Rule:</strong> Operators must independently
            verify exact product identity. Candidate ranking scores or algorithmic suggestions are NOT
            grounds for alias approval.
          </div>

          {/* Reason Input */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Review Reason / Audit Note:
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Enter rationale for approval or rejection..."
              rows={2}
              className="w-full text-xs p-2 border border-gray-300 rounded focus:ring-1 focus:ring-indigo-500"
              disabled={submitting || !isPending}
            />
          </div>

          {submitError && (
            <div className="p-2 bg-red-100 border border-red-300 text-red-800 text-xs rounded">
              {submitError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 flex justify-between items-center">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-gray-700 bg-gray-200 hover:bg-gray-300 rounded"
            disabled={submitting}
          >
            Cancel
          </button>

          <div className="flex gap-2">
            <button
              onClick={() => handleAction('rejected')}
              disabled={submitting || !isOperatorAuthorized || !isPending}
              className="px-3 py-1.5 text-xs text-white bg-red-600 hover:bg-red-700 rounded disabled:opacity-50"
              title={!isOperatorAuthorized ? 'Requires server-verified operator authorization' : undefined}
            >
              Reject Alias
            </button>
            <button
              onClick={() => handleAction('approved')}
              disabled={submitting || !canApprove}
              className="px-3 py-1.5 text-xs text-white bg-green-600 hover:bg-green-700 rounded disabled:opacity-50"
              title={
                !canApprove
                  ? !isOperatorAuthorized
                    ? 'Requires server-verified operator authorization'
                    : !isTargetVerified
                    ? 'Target product is not verified'
                    : !isCompatible
                    ? 'Identity incompatible'
                    : hasConflicts
                    ? 'Has unresolved conflicts'
                    : 'Not in pending state'
                  : undefined
              }
            >
              Approve Alias
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

