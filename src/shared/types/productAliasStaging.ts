/**
 * Types and interfaces for Milestone 2E: Authenticated Product Alias Staging & Review.
 * 
 * Provides staging data structures, audit trail types, and operator authentication context
 * for controlled, offline-verified catalog alias management.
 */

export type AliasProposalStatus =
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'conflict_needs_review'
  | 'superseded'

export type AliasProposalOrigin = 'operator' | 'extraction_suggestion' | 'system'

export type AliasLanguage = 'ar' | 'en' | 'mixed' | 'unknown'

export type AliasAuditAction =
  | 'proposed'
  | 'reviewed'
  | 'approved'
  | 'rejected'
  | 'conflict_flagged'
  | 'superseded'
  | 'revalidated'

export interface ProductAliasAuditEntry {
  id: string
  proposalId: string
  action: AliasAuditAction
  actorId: string
  actorRole: string
  previousStatus?: AliasProposalStatus
  newStatus: AliasProposalStatus
  reason?: string
  timestamp: string
  signatureVerified: boolean
  metadata?: Record<string, unknown>
}

export interface ProductEvidenceSnapshot {
  brandEn?: string
  brandAr?: string
  sizeValue?: number
  sizeUnit?: string
  packCount?: number
  variantEn?: string
  variantAr?: string
  titleEn?: string
  titleAr?: string
}

export interface ProductAliasProposal {
  id: string
  aliasText: string
  canonicalNormalizedKey: string
  proposedProductId: string // BigInt represented as string for lossless precision
  language: AliasLanguage
  sourceOfferId?: string
  sourceCatalogEvidence?: ProductEvidenceSnapshot
  identityEvidenceHash?: string
  compatibilityResult: {
    isCompatible: boolean
    reasons: string[]
    warnings?: string[]
  }
  proposalOrigin: AliasProposalOrigin
  status: AliasProposalStatus
  proposingOperatorId: string
  reviewingOperatorId?: string
  reviewDecision?: 'approved' | 'rejected' | 'conflict_flagged'
  reviewReason?: string
  reviewedAt?: string
  createdAt: string
  updatedAt: string
  auditTrail: ProductAliasAuditEntry[]
}

export interface OperatorAuthContext {
  operatorId: string
  role: 'catalog_admin' | 'catalog_operator' | 'viewer' | string
  sessionToken?: string
  serverSignature?: string
  isServerVerified: boolean
}

export interface ProposeAliasInput {
  aliasText: string
  proposedProductId: string | number
  language?: AliasLanguage
  sourceOfferId?: string
  sourceEvidence?: ProductEvidenceSnapshot
  proposalOrigin?: AliasProposalOrigin
  proposingOperatorId: string
}

export interface ReviewAliasInput {
  proposalId: string
  decision: 'approved' | 'rejected'
  reason?: string
  authContext: OperatorAuthContext
}

export interface AliasProposalFilter {
  status?: AliasProposalStatus
  productId?: string | number
  searchKey?: string
}

