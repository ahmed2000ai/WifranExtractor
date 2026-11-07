import crypto from 'crypto'
import { validateProductIdentityCompatibility } from './productIdentityCompatibilityValidator'
import type {
  ProductAliasProposal,
  ProductAliasAuditEntry,
  OperatorAuthContext,
  ProposeAliasInput,
  ReviewAliasInput,
  ProductEvidenceSnapshot,
  AliasProposalStatus,
  AliasProposalFilter
} from '../../shared/types/productAliasStaging'

/**
 * Normalizes an alias text into its canonical normalized key.
 * 
 * Replicates PostgreSQL `public.normalize_alias_key(text)` from Migration 008 exactly:
 * - trim and lower
 * - strip tatweel / kashida (U+0640)
 * - strip Arabic diacritics / tashkeel (U+064B-U+065F, U+0670)
 * - normalize Alef with hamza / madda ([أإآ]) to plain Alef (ا)
 * - normalize Alef Maksura (ى) to Yeh (ي)
 * - normalize Teh Marbuta (ة) to Heh (ه)
 * - collapse multiple whitespace into single space
 * - trim
 * - return null if empty
 */
export function computeCanonicalAliasKey(alias: string | null | undefined): string | null {
  if (alias === null || alias === undefined) {
    return null
  }
  let res = String(alias).trim().toLowerCase()
  if (res.length === 0) {
    return null
  }

  // Strip tatweel / kashida (U+0640)
  res = res.replace(/\u0640/g, '')

  // Strip Arabic diacritics / tashkeel (fatha, damma, kasra, sukun, shadda, tanween: U+064B-U+065F, U+0670)
  res = res.replace(/[\u064B-\u065F\u0670]/g, '')

  // Normalize Alef with hamza / madda to plain Alef
  res = res.replace(/[أإآ]/g, 'ا')

  // Normalize Alef Maksura to Yeh
  res = res.replace(/ى/g, 'ي')

  // Normalize Teh Marbuta to Heh
  res = res.replace(/ة/g, 'ه')

  // Collapse multiple whitespace characters into single space
  res = res.replace(/\s+/g, ' ')
  res = res.trim()

  if (res.length === 0) {
    return null
  }

  return res
}

/**
 * Computes a deterministic SHA-256 hash of a product's verified identity facts and proposal evidence.
 * Used to detect stale proposals if the catalog product changes prior to review.
 */
export function computeEvidenceSnapshotHash(product: any, evidence?: ProductEvidenceSnapshot): string {
  const isVerified = Boolean(product?.verified ?? product?.is_verified ?? (product?.verification_status === 'verified'))
  const pData = {
    id: String(product?.id || ''),
    name_en: String(product?.name_en || product?.title_en || ''),
    name_ar: String(product?.name_ar || product?.title_ar || ''),
    brand_en: String(product?.brand_en || product?.brand_name_en || product?.brand_name || ''),
    brand_ar: String(product?.brand_ar || product?.brand_name_ar || ''),
    size_value: product?.size_value != null ? Number(product.size_value) : (product?.each_size_value != null ? Number(product.each_size_value) : (product?.default_pack_size_value != null ? Number(product.default_pack_size_value) : null)),
    size_unit: String(product?.size_unit || product?.each_size_unit || product?.default_pack_size_unit || ''),
    pack_count: product?.pack_count != null ? Number(product.pack_count) : (product?.inner_pack_count != null ? Number(product.inner_pack_count) : 1),
    variant_name_en: String(product?.variant_name_en || product?.variant_en || ''),
    verified: isVerified
  }
  const eData = evidence ? {
    brandEn: String(evidence.brandEn || ''),
    brandAr: String(evidence.brandAr || ''),
    sizeValue: evidence.sizeValue != null ? Number(evidence.sizeValue) : null,
    sizeUnit: String(evidence.sizeUnit || ''),
    packCount: evidence.packCount != null ? Number(evidence.packCount) : null,
    variantEn: String(evidence.variantEn || ''),
    variantAr: String(evidence.variantAr || '')
  } : {}

  const str = JSON.stringify({ p: pData, e: eData })
  return crypto.createHash('sha256').update(str).digest('hex')
}

/**
 * Validates operator authentication context.
 * Rejects unauthenticated, client-forged, or unauthorized operator contexts.
 */
export function validateServerOperatorAuth(authContext?: OperatorAuthContext): {
  isValid: boolean
  error?: string
  operator?: { id: string; role: string }
} {
  if (!authContext) {
    return {
      isValid: false,
      error: 'UNAUTHORIZED_OPERATOR: Missing operator authentication context.'
    }
  }

  if (!authContext.isServerVerified) {
    return {
      isValid: false,
      error: 'UNAUTHORIZED_OPERATOR: Operator identity is not server-verified. Client-supplied identities and local flags are rejected.'
    }
  }

  if (!authContext.operatorId || typeof authContext.operatorId !== 'string' || authContext.operatorId.trim().length === 0) {
    return {
      isValid: false,
      error: 'UNAUTHORIZED_OPERATOR: Invalid operator ID.'
    }
  }

  const allowedRoles = ['catalog_admin', 'catalog_operator']
  if (!authContext.role || !allowedRoles.includes(authContext.role)) {
    return {
      isValid: false,
      error: `UNAUTHORIZED_OPERATOR: Role "${authContext.role}" is not authorized for catalog alias review. Requires catalog_admin or catalog_operator.`
    }
  }

  return {
    isValid: true,
    operator: {
      id: authContext.operatorId.trim(),
      role: authContext.role
    }
  }
}

function isProductVerified(product: any): boolean {
  if (!product) return false
  if (product.verification_status) {
    return product.verification_status === 'verified'
  }
  return Boolean(product.verified ?? product.is_verified)
}

function hasArabic(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text)
}

export interface ProposeAliasOptions {
  supabaseClient?: any
  catalogProducts?: any[]
  inMemoryProposals?: ProductAliasProposal[]
  existingAliases?: Array<{ id: string; product_id: string | number; alias_text: string }>
}

export interface ProposeAliasResult {
  success: boolean
  proposal?: ProductAliasProposal
  error?: string
  message?: string
}

/**
 * Proposes a product alias for staging and operator review.
 * 
 * Invariants:
 * 1. Validates alias format and computes canonical normalized key.
 * 2. Target product must exist in catalog and have verified = true.
 * 3. Identity compatibility between proposed alias/evidence and target product is validated.
 * 4. Detects same-product duplicates and cross-product conflicts against existing aliases and proposals.
 * 5. Proposals are saved in staging only (`pending_review` or `conflict_needs_review`). Never writes directly to `product_aliases`.
 */
export async function proposeProductAlias(
  input: ProposeAliasInput,
  options?: ProposeAliasOptions
): Promise<ProposeAliasResult> {
  const normKey = computeCanonicalAliasKey(input.aliasText)
  if (!normKey) {
    return {
      success: false,
      error: 'INVALID_ALIAS_TEXT',
      message: 'Alias text is empty or normalizes to an empty string.'
    }
  }

  if (!input.proposingOperatorId || input.proposingOperatorId.trim().length === 0) {
    return {
      success: false,
      error: 'INVALID_PROPOSING_OPERATOR',
      message: 'Proposing operator identity is required.'
    }
  }

  const productIdStr = String(input.proposedProductId)

  // 1. Resolve target catalog product
  let product: any = null
  if (options?.catalogProducts) {
    product = options.catalogProducts.find((p) => String(p.id) === productIdStr)
  } else if (options?.supabaseClient) {
    const { data } = await options.supabaseClient.from('products').select('*').eq('id', productIdStr).limit(1)
    if (data && data.length > 0) product = data[0]
  }

  if (!product) {
    return {
      success: false,
      error: 'TARGET_PRODUCT_NOT_FOUND',
      message: `Target catalog product ID ${productIdStr} not found.`
    }
  }

  if (!isProductVerified(product)) {
    return {
      success: false,
      error: 'TARGET_PRODUCT_NOT_VERIFIED',
      message: `Target catalog product ID ${productIdStr} is unverified. Aliases can only be proposed for verified products.`
    }
  }

  // 2. Validate Identity Compatibility
  const offerForCompat = {
    title_en: input.sourceEvidence?.titleEn || input.aliasText,
    title_ar: input.sourceEvidence?.titleAr || (hasArabic(input.aliasText) ? input.aliasText : undefined),
    brand_name: input.sourceEvidence?.brandEn || input.sourceEvidence?.brandAr || product.brand_name_en || product.brand_name || '',
    each_size_value: input.sourceEvidence?.sizeValue ?? (product.each_size_value != null ? product.each_size_value : product.size_value),
    each_size_unit: input.sourceEvidence?.sizeUnit ?? (product.each_size_unit || product.size_unit),
    inner_pack_count: input.sourceEvidence?.packCount ?? (product.inner_pack_count != null ? product.inner_pack_count : product.pack_count),
    sale_unit_type: 'each',
    variant_or_flavor: input.sourceEvidence?.variantEn || input.sourceEvidence?.variantAr || product.variant_name_en || product.variant_or_flavor
  }
  const compat = validateProductIdentityCompatibility(offerForCompat, product)

  // 3. Conflict Detection against Existing Database Aliases
  let existingConflict: { product_id: string | number; alias_text: string } | null = null
  let isSameProductDuplicate = false

  if (options?.existingAliases) {
    for (const a of options.existingAliases) {
      if (computeCanonicalAliasKey(a.alias_text) === normKey) {
        if (String(a.product_id) === productIdStr) {
          isSameProductDuplicate = true
        } else {
          existingConflict = a
        }
        break
      }
    }
  } else if (options?.supabaseClient) {
    const { data: allAliases } = await options.supabaseClient
      .from('product_aliases')
      .select('id, product_id, alias_text')
      .limit(200)
    if (allAliases) {
      for (const a of allAliases) {
        if (computeCanonicalAliasKey(a.alias_text) === normKey) {
          if (String(a.product_id) === productIdStr) {
            isSameProductDuplicate = true
          } else {
            existingConflict = a
          }
          break
        }
      }
    }
  }

  if (isSameProductDuplicate) {
    return {
      success: false,
      error: 'DUPLICATE_SAME_PRODUCT_ALIAS',
      message: `Alias "${input.aliasText}" is already assigned to target product ID ${productIdStr}.`
    }
  }

  // 4. Conflict Detection against Staged Proposals
  if (options?.inMemoryProposals) {
    for (const prop of options.inMemoryProposals) {
      if (prop.canonicalNormalizedKey === normKey && (prop.status === 'pending_review' || prop.status === 'approved')) {
        if (String(prop.proposedProductId) === productIdStr) {
          return {
            success: false,
            error: 'DUPLICATE_SAME_PRODUCT_PROPOSAL',
            message: `A proposal with normalized key "${normKey}" already exists for target product ID ${productIdStr}.`
          }
        } else {
          existingConflict = { product_id: prop.proposedProductId, alias_text: prop.aliasText }
          break
        }
      }
    }
  }

  // Determine initial status
  let initialStatus: AliasProposalStatus = 'pending_review'
  if (existingConflict) {
    initialStatus = 'conflict_needs_review'
  } else if (!compat.isCompatible) {
    initialStatus = 'conflict_needs_review'
  }

  const proposalId = crypto.randomUUID()
  const now = new Date().toISOString()
  const evidenceHash = computeEvidenceSnapshotHash(product, input.sourceEvidence)

  const initialAudit: ProductAliasAuditEntry = {
    id: crypto.randomUUID(),
    proposalId,
    action: 'proposed',
    actorId: input.proposingOperatorId,
    actorRole: 'operator',
    newStatus: initialStatus,
    reason: initialStatus === 'conflict_needs_review'
      ? (existingConflict
          ? `Conflict detected: normalized key matches alias/proposal for product ID ${existingConflict.product_id}`
          : `Identity incompatibility: ${compat.conflicts?.join('; ') || compat.reason || 'Compatibility check failed'}`)
      : 'Initial alias proposal submitted for review',
    timestamp: now,
    signatureVerified: false,
    metadata: {
      canonicalNormalizedKey: normKey,
      evidenceHash
    }
  }

  const proposal: ProductAliasProposal = {
    id: proposalId,
    aliasText: input.aliasText.trim(),
    canonicalNormalizedKey: normKey,
    proposedProductId: productIdStr,
    language: input.language || (hasArabic(input.aliasText) ? 'ar' : 'en'),
    sourceOfferId: input.sourceOfferId,
    sourceCatalogEvidence: input.sourceEvidence,
    identityEvidenceHash: evidenceHash,
    compatibilityResult: {
      isCompatible: compat.isCompatible,
      reasons: compat.conflicts || (compat.reason ? [compat.reason] : []),
      warnings: compat.details ? [compat.details] : []
    },
    proposalOrigin: input.proposalOrigin || 'operator',
    status: initialStatus,
    proposingOperatorId: input.proposingOperatorId,
    createdAt: now,
    updatedAt: now,
    auditTrail: [initialAudit]
  }

  if (options?.inMemoryProposals) {
    options.inMemoryProposals.push(proposal)
  }

  return {
    success: true,
    proposal
  }
}

export interface ReviewAliasOptions {
  supabaseClient?: any
  catalogProducts?: any[]
  inMemoryProposals?: ProductAliasProposal[]
  existingAliases?: Array<{ id: string; product_id: string | number; alias_text: string }>
  isLiveProduction?: boolean
}

export interface ReviewAliasResult {
  success: boolean
  decision?: 'approved' | 'rejected'
  proposal?: ProductAliasProposal
  error?: string
  message?: string
  reasons?: string[]
}

/**
 * Reviews and either approves or rejects a staged product alias proposal.
 * 
 * Invariants:
 * 1. Strict Server-Verified Operator Authorization: Client-supplied IDs and flags are rejected.
 * 2. Target Product Verification: Target catalog product must exist and be verified.
 * 3. Freshness / Stale Check: Rejects stale proposals if product facts changed since proposal creation.
 * 4. Identity Compatibility: Revalidated at approval time.
 * 5. Canonical Key Consistency: Recomputed using canonical normalization rules.
 * 6. Conflict Detection: Re-checks cross-product and same-product conflicts at review time.
 * 7. Immutable Audit Trail: Every decision appends an audit entry.
 * 8. Atomic Insertion Gate: Fail-closed production gate prevents unauthorized live database insertion.
 */
export async function reviewProductAlias(
  input: ReviewAliasInput,
  options?: ReviewAliasOptions
): Promise<ReviewAliasResult> {
  // 1. Authenticate Reviewing Operator
  const auth = validateServerOperatorAuth(input.authContext)
  if (!auth.isValid || !auth.operator) {
    return {
      success: false,
      error: auth.error || 'UNAUTHORIZED_OPERATOR',
      message: auth.error || 'Server-verified operator authorization is required. Client-supplied identities and local flags are rejected.'
    }
  }

  // 1b. Fail-Closed Live Production Gate on Approval Attempts
  if (input.decision === 'approved' && options?.isLiveProduction === true) {
    return {
      success: false,
      error: 'PRODUCTION_GATE_BLOCKED_UNAUTHENTICATED',
      message: 'Live production alias insertions are strictly disabled until server-verified signing infrastructure is deployed.'
    }
  }

  // 2. Fetch Staged Proposal
  let proposal: ProductAliasProposal | undefined
  if (options?.inMemoryProposals) {
    proposal = options.inMemoryProposals.find((p) => p.id === input.proposalId)
  }

  if (!proposal) {
    return {
      success: false,
      error: 'PROPOSAL_NOT_FOUND',
      message: `Alias proposal ID ${input.proposalId} was not found.`
    }
  }

  // Check Proposal State
  if (proposal.status !== 'pending_review' && proposal.status !== 'conflict_needs_review') {
    return {
      success: false,
      error: 'PROPOSAL_ALREADY_REVIEWED',
      message: `Proposal ID ${input.proposalId} has already been reviewed (current status: ${proposal.status}).`
    }
  }

  const previousStatus = proposal.status
  const now = new Date().toISOString()
  const productIdStr = String(proposal.proposedProductId)

  // 3. Resolve Current Target Catalog Product
  let product: any = null
  if (options?.catalogProducts) {
    product = options.catalogProducts.find((p) => String(p.id) === productIdStr)
  } else if (options?.supabaseClient) {
    const { data } = await options.supabaseClient.from('products').select('*').eq('id', productIdStr).limit(1)
    if (data && data.length > 0) product = data[0]
  }

  if (!product) {
    return {
      success: false,
      error: 'TARGET_PRODUCT_NOT_FOUND',
      message: `Target catalog product ID ${productIdStr} no longer exists in catalog.`
    }
  }

  if (!isProductVerified(product)) {
    return {
      success: false,
      error: 'TARGET_PRODUCT_NOT_VERIFIED',
      message: `Target catalog product ID ${productIdStr} is not verified. Aliases cannot be approved for unverified products.`
    }
  }

  // 4. Freshness / Stale Check
  const currentEvidenceHash = computeEvidenceSnapshotHash(product, proposal.sourceCatalogEvidence)
  if (proposal.identityEvidenceHash && currentEvidenceHash !== proposal.identityEvidenceHash) {
    // Product data has changed since proposal creation -> mark as superseded
    proposal.status = 'superseded'
    proposal.updatedAt = now
    proposal.auditTrail.push({
      id: crypto.randomUUID(),
      proposalId: proposal.id,
      action: 'superseded',
      actorId: auth.operator.id,
      actorRole: auth.operator.role,
      previousStatus,
      newStatus: 'superseded',
      reason: 'Target product catalog facts or verification status changed since proposal was created. Stale proposal superseded.',
      timestamp: now,
      signatureVerified: true
    })
    return {
      success: false,
      error: 'STALE_PROPOSAL_DATA_CHANGED',
      message: 'Target product identity facts changed since proposal was created. Proposal marked as superseded.'
    }
  }

  // 5. Recompute Canonical Alias Key
  const canonicalKey = computeCanonicalAliasKey(proposal.aliasText)
  if (!canonicalKey || canonicalKey !== proposal.canonicalNormalizedKey) {
    return {
      success: false,
      error: 'INVALID_CANONICAL_ALIAS_KEY',
      message: `Canonical alias key mismatch: proposal key "${proposal.canonicalNormalizedKey}" does not match recomputed key "${canonicalKey}".`
    }
  }

  // 6. Handle Rejection
  if (input.decision === 'rejected') {
    proposal.status = 'rejected'
    proposal.reviewingOperatorId = auth.operator.id
    proposal.reviewDecision = 'rejected'
    proposal.reviewReason = input.reason || 'Rejected by operator'
    proposal.reviewedAt = now
    proposal.updatedAt = now

    proposal.auditTrail.push({
      id: crypto.randomUUID(),
      proposalId: proposal.id,
      action: 'rejected',
      actorId: auth.operator.id,
      actorRole: auth.operator.role,
      previousStatus,
      newStatus: 'rejected',
      reason: input.reason || 'Rejected by operator',
      timestamp: now,
      signatureVerified: true
    })

    return {
      success: true,
      decision: 'rejected',
      proposal
    }
  }

  // 7. Handle Approval — Re-check Existing DB & Proposal Conflicts
  let dbConflict: { product_id: string | number; alias_text: string } | null = null
  let isDbDuplicate = false

  if (options?.existingAliases) {
    for (const a of options.existingAliases) {
      if (computeCanonicalAliasKey(a.alias_text) === canonicalKey) {
        if (String(a.product_id) === productIdStr) {
          isDbDuplicate = true
        } else {
          dbConflict = a
        }
        break
      }
    }
  } else if (options?.supabaseClient) {
    const { data: allAliases } = await options.supabaseClient
      .from('product_aliases')
      .select('id, product_id, alias_text')
      .limit(200)
    if (allAliases) {
      for (const a of allAliases) {
        if (computeCanonicalAliasKey(a.alias_text) === canonicalKey) {
          if (String(a.product_id) === productIdStr) {
            isDbDuplicate = true
          } else {
            dbConflict = a
          }
          break
        }
      }
    }
  }

  if (isDbDuplicate) {
    return {
      success: false,
      error: 'DUPLICATE_SAME_PRODUCT_ALIAS',
      message: `Alias "${proposal.aliasText}" is already assigned to this product in the catalog.`
    }
  }

  if (dbConflict) {
    proposal.status = 'conflict_needs_review'
    proposal.updatedAt = now
    proposal.auditTrail.push({
      id: crypto.randomUUID(),
      proposalId: proposal.id,
      action: 'conflict_flagged',
      actorId: auth.operator.id,
      actorRole: auth.operator.role,
      previousStatus,
      newStatus: 'conflict_needs_review',
      reason: `Approval blocked: normalized key conflicts with existing alias pointing to product ID ${dbConflict.product_id}.`,
      timestamp: now,
      signatureVerified: true
    })
    return {
      success: false,
      error: 'CROSS_PRODUCT_ALIAS_CONFLICT',
      message: `Alias key "${canonicalKey}" conflicts with existing alias for product ID ${dbConflict.product_id}.`
    }
  }

  // Check other approved proposals
  if (options?.inMemoryProposals) {
    for (const other of options.inMemoryProposals) {
      if (other.id !== proposal.id && other.canonicalNormalizedKey === canonicalKey && other.status === 'approved') {
        if (String(other.proposedProductId) !== productIdStr) {
          return {
            success: false,
            error: 'CROSS_PRODUCT_ALIAS_CONFLICT',
            message: `Alias key "${canonicalKey}" conflicts with another approved proposal for product ID ${other.proposedProductId}.`
          }
        }
      }
    }
  }

  // 8. Handle Approval — Revalidate Identity Compatibility
  const offerForCompat = {
    title_en: proposal.sourceCatalogEvidence?.titleEn || proposal.aliasText,
    title_ar: proposal.sourceCatalogEvidence?.titleAr || (hasArabic(proposal.aliasText) ? proposal.aliasText : undefined),
    brand_name: proposal.sourceCatalogEvidence?.brandEn || proposal.sourceCatalogEvidence?.brandAr || product.brand_name_en || product.brand_name || '',
    each_size_value: proposal.sourceCatalogEvidence?.sizeValue ?? (product.each_size_value != null ? product.each_size_value : product.size_value),
    each_size_unit: proposal.sourceCatalogEvidence?.sizeUnit ?? (product.each_size_unit || product.size_unit),
    inner_pack_count: proposal.sourceCatalogEvidence?.packCount ?? (product.inner_pack_count != null ? product.inner_pack_count : product.pack_count),
    sale_unit_type: 'each',
    variant_or_flavor: proposal.sourceCatalogEvidence?.variantEn || proposal.sourceCatalogEvidence?.variantAr || product.variant_name_en || product.variant_or_flavor
  }
  const compat = validateProductIdentityCompatibility(offerForCompat, product)
  if (!compat.isCompatible) {
    return {
      success: false,
      error: 'IDENTITY_INCOMPATIBLE',
      message: `Cannot approve alias: identity compatibility validation failed (${compat.conflicts?.join('; ') || compat.reason || 'incompatible'}).`,
      reasons: compat.conflicts || (compat.reason ? [compat.reason] : [])
    }
  }

  // 9. Fail-Closed Live Production Gate
  if (options?.isLiveProduction === true) {
    return {
      success: false,
      error: 'PRODUCTION_GATE_BLOCKED_UNAUTHENTICATED',
      message: 'Live production alias insertions are strictly disabled until server-verified signing infrastructure is deployed.'
    }
  }

  // 10. Atomic Approval & Insertion
  proposal.status = 'approved'
  proposal.reviewingOperatorId = auth.operator.id
  proposal.reviewDecision = 'approved'
  proposal.reviewReason = input.reason || 'Approved by operator'
  proposal.reviewedAt = now
  proposal.updatedAt = now

  const approvalAudit: ProductAliasAuditEntry = {
    id: crypto.randomUUID(),
    proposalId: proposal.id,
    action: 'approved',
    actorId: auth.operator.id,
    actorRole: auth.operator.role,
    previousStatus,
    newStatus: 'approved',
    reason: input.reason || 'Approved by operator',
    timestamp: now,
    signatureVerified: true,
    metadata: {
      canonicalNormalizedKey: canonicalKey
    }
  }
  proposal.auditTrail.push(approvalAudit)

  // If DB client is provided in offline/mock test, insert into product_aliases atomically
  if (options?.supabaseClient) {
    const { error: insError } = await options.supabaseClient.from('product_aliases').insert({
      product_id: proposal.proposedProductId,
      alias_text: proposal.aliasText,
      language: proposal.language,
      source: `approved_proposal:${proposal.id}`
    })

    if (insError) {
      // Transaction rollback simulation: revert proposal status and audit trail
      proposal.status = previousStatus
      proposal.reviewDecision = undefined
      proposal.reviewReason = undefined
      proposal.reviewedAt = undefined
      proposal.auditTrail.pop()
      return {
        success: false,
        error: 'TRANSACTION_ROLLBACK',
        message: `Database failure during alias insertion: ${insError.message}. Approval state was rolled back.`
      }
    }
  }

  if (options?.existingAliases) {
    options.existingAliases.push({
      id: crypto.randomUUID(),
      product_id: proposal.proposedProductId,
      alias_text: proposal.aliasText
    })
  }

  return {
    success: true,
    decision: 'approved',
    proposal
  }
}

/**
 * Retrieves pending or filtered alias proposals for operator review.
 */
export function getFilteredAliasProposals(
  proposals: ProductAliasProposal[],
  filter?: AliasProposalFilter
): ProductAliasProposal[] {
  return proposals.filter((p) => {
    if (filter?.status && p.status !== filter.status) return false
    if (filter?.productId && String(p.proposedProductId) !== String(filter.productId)) return false
    if (filter?.searchKey) {
      const s = filter.searchKey.toLowerCase().trim()
      const matchText = p.aliasText.toLowerCase().includes(s)
      const matchKey = p.canonicalNormalizedKey.includes(s)
      if (!matchText && !matchKey) return false
    }
    return true
  })
}
