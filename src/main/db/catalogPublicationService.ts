/**
 * Catalog Publication Service
 * Milestone: WIFRAN-EXTRACTOR-CATALOG-MATCH-001
 *
 * Implements transactionally safe, idempotent publication of approved catalog matches:
 * - Preflight validation (environment, schema readiness, identity completeness)
 * - Reuse permanent IDs for approved existing products
 * - Let PostgreSQL generate permanent bigint product IDs for approved new temporary groups
 * - Map temporary IDs to permanent IDs idempotently
 * - Fully tested and verified in DEVELOPMENT
 * - Strict production guard: Blocks production publication if required schema dependencies are absent
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import {
  CatalogPublicationPreflightResult,
  CatalogPublicationResult,
  MatchingRunManifest,
  OfferPublicationAssessment
} from '../../shared/types/catalogMatching'
import { UnifiedBatchOffer, OfferBatchPublicationState } from '../../shared/types/batchExtraction'
import {
  createGuardedPgClient,
  DEVELOPMENT_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  type DatabaseContext
} from './databaseEnvironmentResolver'
import { VerifiedMatchCacheService } from './verifiedMatchCacheService'
import {
  arePackConfigsStrictlyCompatible,
  validateImageSafetyWithPackageSafeguards
} from '../../shared/utils/sizeCompatibility'
import { evaluateIdentitySufficiency, resolveQuantityAndPromoSemantics } from './productIdentityPolicy'
import {
  assessOfferPublicationOutcome,
  computeStableSourceOfferId,
  sanitizePublicConsumerImageUrl
} from '../../shared/utils/nonCatalogPublicationPolicy'
import { classifyOfferReviewTriage } from '../../shared/utils/reviewTriageClassifier'
import { computeDocumentIdFromFingerprint } from '../../shared/utils/sourceIdentityAndDuplicateUtils'
import { buildOfferImageStoragePath } from '../storage/storagePathBuilder'
import {
  assessSchemaCompatibility,
  type SchemaCompatibilityReport,
  type SqlQueryable
} from './schemaCompatibilityService'
import {
  buildCandidateSnapshotFromUnifiedOffer,
  reconcileOffersAgainstDatabase,
  type PrePublicationReconciliationSummary
} from './prePublicationDuplicateReconciler'
import {
  computeDefaultPublishIdempotencyKey,
  computePublishPayloadFingerprint,
  recordJournalMutation
} from './publicationJournalAndUndoService'
import {
  createGuardedStorageAdapter,
  stageContentAddressedUpload,
  type StorageLifecycleAdapter
} from '../storage/stagedStorageLifecycleService'
import { toAsciiSlug } from '../../shared/utils/supermarketCandidateUtils'

export type UploadOfferImageFn = (input: {
  localImagePath: string
  storageBucket: string
  storagePath: string
  contentType?: string
}) => Promise<{ imageUrl: string; storagePath: string }>

export const PRIVATE_EVIDENCE_BUCKET = 'offer-images'
export const PUBLIC_PRODUCT_IMAGES_BUCKET = 'product-images'
export const PUBLIC_OFFER_DISPLAY_IMAGES_BUCKET = 'offer-display-images'

async function validateEvidenceBucketRoutingOrThrow(
  adapter: StorageLifecycleAdapter,
  evidenceBucket: string
): Promise<void> {
  if (
    evidenceBucket === PUBLIC_PRODUCT_IMAGES_BUCKET ||
    evidenceBucket === PUBLIC_OFFER_DISPLAY_IMAGES_BUCKET
  ) {
    throw new Error(
      `EVIDENCE_IMAGE_WRONG_BUCKET: Private leaflet evidence crops must target private bucket "${PRIVATE_EVIDENCE_BUCKET}", not public consumer bucket "${evidenceBucket}".`
    )
  }
  if (adapter.bucketExists && !(await adapter.bucketExists(evidenceBucket))) {
    throw new Error(
      `EVIDENCE_IMAGE_BUCKET_MISSING: Required private evidence bucket "${evidenceBucket}" does not exist.`
    )
  }
  if (adapter.getBucketVisibility) {
    const isPublic = await adapter.getBucketVisibility(evidenceBucket)
    if (isPublic === true) {
      throw new Error(
        `EVIDENCE_IMAGE_BUCKET_MUST_BE_PRIVATE: Evidence bucket "${evidenceBucket}" must remain private (public=false).`
      )
    }
  }
}

async function validateConsumerBucketRoutingOrThrow(
  adapter: StorageLifecycleAdapter,
  targetBucket: string,
  expectedBucket: typeof PUBLIC_PRODUCT_IMAGES_BUCKET | typeof PUBLIC_OFFER_DISPLAY_IMAGES_BUCKET
): Promise<void> {
  if (targetBucket !== expectedBucket) {
    throw new Error(
      `CONSUMER_IMAGE_WRONG_BUCKET: Consumer image must target public bucket "${expectedBucket}", got "${targetBucket}".`
    )
  }
  if (adapter.bucketExists && !(await adapter.bucketExists(targetBucket))) {
    throw new Error(
      `CONSUMER_IMAGE_BUCKET_MISSING: Required public consumer bucket "${targetBucket}" does not exist.`
    )
  }
  if (adapter.getBucketVisibility) {
    const isPublic = await adapter.getBucketVisibility(targetBucket)
    if (isPublic !== true) {
      throw new Error(
        `CONSUMER_IMAGE_BUCKET_NOT_PUBLIC: Consumer bucket "${targetBucket}" must be public (public=true), actual=${String(isPublic)}.`
      )
    }
  }
}

function validateConsumerPublicUrlOrThrow(params: {
  publicUrl: string
  bucket: string
  expectedBucket: typeof PUBLIC_PRODUCT_IMAGES_BUCKET | typeof PUBLIC_OFFER_DISPLAY_IMAGES_BUCKET
  context: DatabaseContext
}): string {
  const { publicUrl, bucket, expectedBucket, context } = params
  if (bucket !== expectedBucket) {
    throw new Error(
      `CONSUMER_IMAGE_WRONG_BUCKET: Consumer DB image write attempted against bucket "${bucket}" instead of "${expectedBucket}".`
    )
  }
  const cleanUrl = (publicUrl || '').trim()
  if (!cleanUrl) {
    throw new Error(`CONSUMER_IMAGE_URL_INVALID: Empty publicUrl returned for bucket "${expectedBucket}".`)
  }
  const lower = cleanUrl.toLowerCase()
  if (
    lower.includes(`/${PRIVATE_EVIDENCE_BUCKET}/`) ||
    lower.includes('/sign/') ||
    lower.includes('token=') ||
    lower.includes('sig=') ||
    lower.includes('_crop.') ||
    lower.includes('offer_card_crop') ||
    lower.includes('product_thumb_crop')
  ) {
    throw new Error(
      `CONSUMER_IMAGE_URL_FORBIDDEN: Generated consumer URL "${cleanUrl}" references a private/crop/signed asset.`
    )
  }
  if (!lower.includes(`/${expectedBucket.toLowerCase()}/`)) {
    throw new Error(
      `CONSUMER_IMAGE_URL_BUCKET_MISMATCH: Expected "${expectedBucket}" in public URL, got "${cleanUrl}".`
    )
  }
  if (/\.supabase\.co\b/i.test(cleanUrl)) {
    const envName = context === 'PRODUCTION_UI' ? 'PRODUCTION' : 'DEVELOPMENT_TEST'
    const sanitized = sanitizePublicConsumerImageUrl(cleanUrl, envName)
    if (!sanitized) {
      throw new Error(
        `CONSUMER_IMAGE_CONTRACT_VIOLATION: Supabase URL "${cleanUrl}" failed public consumer contract check for ${context}.`
      )
    }
    return sanitized
  }
  return cleanUrl
}

function buildNormalizedCandidateSnapshot(
  offer: UnifiedBatchOffer,
  assessment: OfferPublicationAssessment,
  targetProductId: string | number | null
) {
  const isCatalogLinked = targetProductId !== null && targetProductId !== undefined
  const catalogMatchStatus = isCatalogLinked ? 'verified_linked' : assessment.catalogMatchStatus
  const isKgBasis = (offer.sale_unit_type || '').toLowerCase() === 'kg'
  const safeInnerPackCount =
    isKgBasis
      ? null
      : offer.inner_pack_count && Number(offer.inner_pack_count) > 0
        ? Math.trunc(Number(offer.inner_pack_count))
        : null
  const promoMechanic =
    offer.promotion_mechanic ||
    (offer.canonical as any)?.promotion?.mechanic ||
    'price_cut'
  const loyaltyRequirement =
    (offer.canonical as any)?.eligibility?.loyalty?.requirement || 'none'
  const isLoyaltyRequired = loyaltyRequirement === 'required'
  const qtyLimitVal =
    offer.customer_limit != null && Number.isFinite(Number(offer.customer_limit))
      ? Math.trunc(Number(offer.customer_limit))
      : null
  const numericProdId =
    targetProductId != null && Number.isFinite(Number(targetProductId))
      ? Number(targetProductId)
      : null

  return buildCandidateSnapshotFromUnifiedOffer(
    offer,
    numericProdId,
    assessment.perUnitPricing,
    catalogMatchStatus,
    {
      saleUnitType: offer.sale_unit_type || 'piece',
      innerPackCount: safeInnerPackCount,
      eachSizeValue: offer.each_size_value ?? null,
      eachSizeUnit: offer.each_size_unit ?? null,
      isLoyaltyRequired,
      promoMechanic,
      quantityLimitValue: qtyLimitVal
    }
  )
}

/**
 * Strictly verifies that the target database's check constraint on public.offer_display_images
 * supports the requested source_kind (e.g. 'promotional_leaflet_crop', 'leaflet_crop').
 * 
 * STRICT PROVENANCE ENFORCEMENT:
 * - Leaflet crops must NEVER be silently mislabeled as 'generated_illustration'.
 * - If the target schema does not support 'promotional_leaflet_crop', fails closed with
 *   an explicit SCHEMA_MIGRATION_REQUIRED error before any storage upload or image association.
 */
async function assertSupportedDisplayImageSourceKind(
  client: SqlQueryable,
  requestedSourceKind: string,
  cache?: Map<string, boolean>
): Promise<string> {
  const legacyAllowed = ['generated_illustration', 'generic_library', 'licensed_stock']
  if (legacyAllowed.includes(requestedSourceKind)) {
    return requestedSourceKind
  }

  if (cache && cache.has(requestedSourceKind) && cache.get(requestedSourceKind) === true) {
    return requestedSourceKind
  }

  try {
    const res = await client.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE conname = 'offer_display_images_source_kind_check'
       LIMIT 1`
    )
    if (res.rows.length > 0 && res.rows[0].def.includes(requestedSourceKind)) {
      if (cache) cache.set(requestedSourceKind, true)
      return requestedSourceKind
    }
  } catch (err: any) {
    throw new Error(
      `SCHEMA_INSPECTION_FAILED: Failed checking constraint offer_display_images_source_kind_check: ${err?.message || err}`
    )
  }

  throw new Error(
    `SCHEMA_MIGRATION_REQUIRED: Target database check constraint "offer_display_images_source_kind_check" does not support source_kind '${requestedSourceKind}'. Deploy Migration 012 before publishing leaflet-derived crops. Silent fallback to generated_illustration is prohibited.`
  )
}

/**
 * Checks whether an image crop file has an associated derived tier metadata file
 * with a visible package weight conflict or replacement-required flag.
 */
export function checkImageFilePackageConflict(
  imagePath: string | null | undefined,
  offerSizeVal: number | null | undefined,
  offerSizeUnit: string | null | undefined,
  offerPackCount: number | null | undefined
): { blocked: boolean; reason?: string } {
  if (!imagePath || !fs.existsSync(imagePath)) return { blocked: false }
  const metaPath = path.join(path.dirname(imagePath), 'derived_tier_crop_meta.json')
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
      const decision = validateImageSafetyWithPackageSafeguards({
        printedLabel: meta.visiblePackageWeightLabel,
        advertisedSizeValue: offerSizeVal != null ? Number(offerSizeVal) : null,
        advertisedSizeUnit: offerSizeUnit,
        advertisedPackCount: offerPackCount || 1
      })
      if (meta.visiblePackageSizeConflict === true || decision.hasConflict === true || meta.requiresReplacementImage === true) {
        return {
          blocked: true,
          reason: meta.confirmationBlockedReason || decision.reason || 'Visible packaging label conflicts with advertised offer size'
        }
      }
    } catch {
      // ignore JSON parse errors
    }
  }
  return { blocked: false }
}

export class CatalogPublicationService {
  private cacheService: VerifiedMatchCacheService

  constructor(cacheService?: VerifiedMatchCacheService) {
    this.cacheService = cacheService || new VerifiedMatchCacheService()
  }

  /**
   * Preflight assessment before publication.
   */
  public async assessPublicationPreflight(params: {
    manifest: MatchingRunManifest
    offers: UnifiedBatchOffer[]
    context: DatabaseContext
    referenceDateIso?: string | null
    enforceMetadataVerification?: boolean
    pgClient?: SqlQueryable
    allowIsolatedTestDb?: boolean
    operatorAuthorizedProductionPublish?: boolean
    storageBucket?: string
    evidenceBucket?: string
    productImagesBucket?: string
    offerDisplayImagesBucket?: string
    bucketChecker?: (bucket: string) => Promise<boolean>
    runDatabaseReconciliation?: boolean
  }): Promise<CatalogPublicationPreflightResult> {
    const {
      manifest,
      offers,
      context,
      referenceDateIso = null,
      enforceMetadataVerification = false
    } = params
    const blockingReasons: string[] = []
    const schemaWarnings: string[] = []

    let existingProductMatchesCount = 0
    let newProductsToCreateCount = 0
    let unresolvedCount = 0
    let approvedNonCatalogCount = 0
    let eligibleNonCatalogCount = 0
    let quarantinedOffersCount = 0
    let incompleteOrFailedRequestsCount = 0
    let missingAttributesCount = 0
    const eligibleOfferKeys: string[] = []
    const deferredOfferKeys: string[] = []
    const alreadyPublishedOfferKeys: string[] = []
    const deferredOfferReasons: Record<string, string[]> = {}
    const nonCatalogAssessmentByOffer: Record<string, OfferPublicationAssessment> = {}

    if (params.productImagesBucket && params.productImagesBucket !== PUBLIC_PRODUCT_IMAGES_BUCKET) {
      blockingReasons.push(
        `CONSUMER_IMAGE_WRONG_BUCKET: productImagesBucket must be "${PUBLIC_PRODUCT_IMAGES_BUCKET}", got "${params.productImagesBucket}".`
      )
    }
    if (params.offerDisplayImagesBucket && params.offerDisplayImagesBucket !== PUBLIC_OFFER_DISPLAY_IMAGES_BUCKET) {
      blockingReasons.push(
        `CONSUMER_IMAGE_WRONG_BUCKET: offerDisplayImagesBucket must be "${PUBLIC_OFFER_DISPLAY_IMAGES_BUCKET}", got "${params.offerDisplayImagesBucket}".`
      )
    }
    if (params.bucketChecker) {
      const needsProductBucket = offers.some((o) => Boolean(o.consumerProductImagePath))
      const needsDisplayBucket = offers.some((o) => Boolean(o.consumerDisplayImagePath))
      if (needsProductBucket && !(await params.bucketChecker(params.productImagesBucket || PUBLIC_PRODUCT_IMAGES_BUCKET))) {
        blockingReasons.push(
          `CONSUMER_IMAGE_BUCKET_MISSING: Required public bucket "${params.productImagesBucket || PUBLIC_PRODUCT_IMAGES_BUCKET}" does not exist.`
        )
      }
      if (needsDisplayBucket && !(await params.bucketChecker(params.offerDisplayImagesBucket || PUBLIC_OFFER_DISPLAY_IMAGES_BUCKET))) {
        blockingReasons.push(
          `CONSUMER_IMAGE_BUCKET_MISSING: Required public bucket "${params.offerDisplayImagesBucket || PUBLIC_OFFER_DISPLAY_IMAGES_BUCKET}" does not exist.`
        )
      }
    }

    // Fail closed if offers require promotional_leaflet_crop display images but target database does not support it
    if (params.pgClient) {
      const needsLeafletCropDisplay = offers.some((o) => {
        const isNonCatalogAssortmentOrDisplay =
          o.imageSubjectScope === 'representative_assortment' ||
          manifest.nonCatalogApprovals?.[o.batchOfferKey]?.decision === 'approved'
        const hasDisplayImage =
          Boolean(o.consumerDisplayImagePath) ||
          (isNonCatalogAssortmentOrDisplay && Boolean(o.consumerProductImagePath))
        const sourceKind = (o as any).approvedConsumerImageSourceKind || 'promotional_leaflet_crop'
        return hasDisplayImage && (sourceKind === 'promotional_leaflet_crop' || sourceKind === 'leaflet_crop')
      })
      if (needsLeafletCropDisplay) {
        try {
          const res = await params.pgClient.query<{ def: string }>(
            `SELECT pg_get_constraintdef(oid) AS def
             FROM pg_constraint
             WHERE conname = 'offer_display_images_source_kind_check'
             LIMIT 1`
          )
          if (res.rows.length === 0 || !res.rows[0].def.includes('promotional_leaflet_crop')) {
            blockingReasons.push(
              `SCHEMA_MIGRATION_REQUIRED: Target database check constraint "offer_display_images_source_kind_check" does not support source_kind 'promotional_leaflet_crop'. Deploy Migration 012 before publishing leaflet-derived crops.`
            )
          }
        } catch {
          // If query fails, let publication handle fail-closed assertion
        }
      }
    }

    // Execution safety gate: never allow publication when any request failed, is uncertain, cancelled, or in-flight
    if (manifest.requests) {
      const nonCompletedRequests = Object.values(manifest.requests).filter(
        (req) => req.executionStatus !== 'completed' || !req.validated
      )
      incompleteOrFailedRequestsCount = nonCompletedRequests.length
      if (nonCompletedRequests.length > 0) {
        blockingReasons.push(
          `INCOMPLETE_MATCHING_EXECUTION: ${nonCompletedRequests.length} Gemini matching request(s) have not completed & validated cleanly (${nonCompletedRequests.map((r) => `${r.requestKey}:${r.executionStatus}`).join(', ')}). Resolve or retry failed requests before publication.`
        )
      }
    }

    const seenSourceOfferIds = new Map<string, string>()

    // Analyze proposals & offer-level selective publication eligibility
    for (const offer of offers) {
      const proposal = manifest.proposals[offer.batchOfferKey]
      const approval = manifest.nonCatalogApprovals?.[offer.batchOfferKey]
      const tempId = proposal?.decision === 'temporary' ? proposal.temporaryId : null
      const tempGroup = tempId ? manifest.temporaryProducts[tempId] : null

      const computedSourceOfferId = computeStableSourceOfferId(offer)
      const prevOfferKey = seenSourceOfferIds.get(computedSourceOfferId)
      if (prevOfferKey) {
        blockingReasons.push(
          `DUPLICATE_SOURCE_OFFER_ID: Collision detected for source_offer_id "${computedSourceOfferId}" between offers (${prevOfferKey} and ${offer.batchOfferKey}).`
        )
      } else {
        seenSourceOfferIds.set(computedSourceOfferId, offer.batchOfferKey)
      }

      const assessment = assessOfferPublicationOutcome({
        offer,
        proposal,
        temporaryProducts: manifest.temporaryProducts,
        approval
      })
      nonCatalogAssessmentByOffer[offer.batchOfferKey] = assessment

      // Already-published offers that have not been modified since publish stay Published & skipped automatically
      const directPubState =
        offer.publicationState || (manifest as any)?.publishedOffers?.[offer.batchOfferKey]
      const suffixPubState =
        !directPubState && (manifest as any)?.publishedOffers
          ? (Object.entries((manifest as any).publishedOffers as Record<string, any>).find(
              ([k]) => {
                const kParts = k.split(':')
                const offerParts = offer.batchOfferKey.split(':')
                return (
                  kParts.length >= 4 &&
                  offerParts.length >= 4 &&
                  kParts[1] === offerParts[1] &&
                  kParts[2] === offerParts[2] &&
                  kParts[3] === offerParts[3]
                )
              }
            )?.[1] as OfferBatchPublicationState | undefined)
          : undefined

      const publishedState = directPubState || suffixPubState
      const isAlreadyPublishedSkip =
        publishedState?.state === 'published' &&
        !publishedState.needsUpdateReview

      if (isAlreadyPublishedSkip) {
        alreadyPublishedOfferKeys.push(offer.batchOfferKey)
        continue
      }

      const triage = classifyOfferReviewTriage({
        offer,
        proposal,
        temporaryProducts: manifest.temporaryProducts,
        approval,
        targetDatabaseContext: context
      })

      const isExplicitlyApprovedByOperator =
        approval?.decision === 'approved' ||
        (proposal?.decision === 'existing' && proposal.operatorDecision === 'approved') ||
        Boolean(tempGroup && tempGroup.operatorDecision === 'approved')

      const isTargetedForPublication =
        approval?.decision === 'approved' ||
        (proposal?.decision === 'existing' && Boolean(proposal.matchedProductId) && proposal.operatorDecision !== 'rejected') ||
        Boolean(tempGroup && tempGroup.operatorDecision === 'approved')

      const isMetadataAccepted =
        offer.metadataStatus === 'operator_verified' ||
        offer.metadataStatus === 'auto_accepted' ||
        (offer.metadataStatus === undefined && offer.metadataVerified === true)
      const isExplicitlyUnverified =
        offer.metadataStatus === 'needs_review' ||
        (offer.metadataStatus === undefined && offer.metadataVerified === false)

      // Leaflet-wide metadata verification & date/scope validity: blocks affected offers until leaflet metadata is corrected
      if (isTargetedForPublication && (enforceMetadataVerification || isExplicitlyUnverified)) {
        if (isExplicitlyUnverified || (enforceMetadataVerification && !isMetadataAccepted)) {
          blockingReasons.push(
            `UNVERIFIED_LEAFLET_METADATA: Offer ${offer.batchOfferKey} (${offer.sourceFileName}) lacks verified or auto-accepted retailer/scope/date metadata.`
          )
        }
        if (!offer.supermarketId || !offer.locationScope) {
          blockingReasons.push(
            `MISSING_RETAILER_OR_SCOPE_METADATA: Offer ${offer.batchOfferKey} must specify verified retailer and locationScope ('national' | 'region' | 'city').`
          )
        } else if (offer.locationScope === 'city' && !offer.cityId) {
          blockingReasons.push(
            `MISSING_CITY_ID: Offer ${offer.batchOfferKey} has locationScope='city' without verified cityId.`
          )
        } else if (offer.locationScope === 'region' && !offer.regionId) {
          blockingReasons.push(
            `MISSING_REGION_ID: Offer ${offer.batchOfferKey} has locationScope='region' without verified regionId.`
          )
        }
        if (!offer.offerStartDate || !offer.offerEndDate) {
          blockingReasons.push(
            `MISSING_VALIDITY_DATES: Offer ${offer.batchOfferKey} requires verified offerStartDate and offerEndDate.`
          )
        } else {
          if (
            !/^\d{4}-\d{2}-\d{2}$/.test(offer.offerStartDate) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(offer.offerEndDate) ||
            offer.offerStartDate > offer.offerEndDate
          ) {
            blockingReasons.push(
              `INVALID_VALIDITY_DATES: Offer ${offer.batchOfferKey} has invalid validity range (${offer.offerStartDate} to ${offer.offerEndDate}).`
            )
          }
          if (
            /^\d{4}-\d{2}-\d{2}$/.test(offer.offerEndDate) &&
            referenceDateIso &&
            offer.offerEndDate < referenceDateIso
          ) {
            blockingReasons.push(
              `EXPIRED_OFFER_DATES: Offer ${offer.batchOfferKey} ended on ${offer.offerEndDate} (< ${referenceDateIso}) and cannot publish into an active feed.`
            )
          }
        }
      }

      // Deferred Temporary Product: defer ONLY when missing group, rejected, or blocked by triage/quarantine
      if (
        proposal?.decision === 'temporary' &&
        (!tempGroup || tempGroup.operatorDecision === 'rejected' || triage.category !== 'ready' || assessment.outcome === 'quarantined')
      ) {
        unresolvedCount++
        if (tempGroup?.operatorDecision === 'rejected' || triage.category === 'blocked') {
          quarantinedOffersCount++
        }
        deferredOfferKeys.push(offer.batchOfferKey)
        deferredOfferReasons[offer.batchOfferKey] =
          triage.reasons.length > 0
            ? triage.reasons
            : [`Provisional product ${proposal.temporaryId || 'group'} requires review before publication.`]
        continue
      }

      if (assessment.outcome === 'catalog_linked') {
        if (proposal?.decision === 'existing' && proposal.matchedProductId) {
          const matchDbContext = proposal.matchedDatabaseContext ?? manifest.matchingDatabaseContext
          if (context === 'DEVELOPMENT_TEST' && matchDbContext === 'PRODUCTION_UI') {
            blockingReasons.push(
              `CATALOG_ENVIRONMENT_MISMATCH: Offer ${offer.batchOfferKey} was matched against PRODUCTION_UI catalog product #${proposal.matchedProductId} and cannot be published into DEVELOPMENT_TEST without matching against DEVELOPMENT_TEST.`
            )
            continue
          }
          if (proposal.operatorDecision === 'rejected' || triage.category === 'blocked') {
            quarantinedOffersCount++
            deferredOfferKeys.push(offer.batchOfferKey)
            deferredOfferReasons[offer.batchOfferKey] = triage.reasons
            if (isExplicitlyApprovedByOperator && assessment.quarantineReasons.length > 0) {
              blockingReasons.push(
                `OFFER_QUARANTINED_CRITICAL_FACTS: Offer ${offer.batchOfferKey} failed critical publication validation (${assessment.quarantineReasons.join(', ')}).`
              )
            }
            continue
          }
          existingProductMatchesCount++
          eligibleOfferKeys.push(offer.batchOfferKey)
        } else if (proposal?.decision === 'temporary' && proposal.temporaryId) {
          if (triage.category === 'blocked') {
            quarantinedOffersCount++
            deferredOfferKeys.push(offer.batchOfferKey)
            deferredOfferReasons[offer.batchOfferKey] = triage.reasons
            continue
          }
          newProductsToCreateCount++
          eligibleOfferKeys.push(offer.batchOfferKey)
        }
        continue
      }

      unresolvedCount++
      if (assessment.isEligibleForNonCatalogPublication) {
        eligibleNonCatalogCount++
      }

      if (assessment.outcome === 'approved_non_catalog') {
        if (triage.category === 'blocked') {
          quarantinedOffersCount++
          deferredOfferKeys.push(offer.batchOfferKey)
          deferredOfferReasons[offer.batchOfferKey] = triage.reasons
          continue
        }
        approvedNonCatalogCount++
        eligibleOfferKeys.push(offer.batchOfferKey)
      } else {
        if (assessment.quarantineReasons.length > 0 || triage.category === 'blocked') {
          quarantinedOffersCount++
        }
        deferredOfferKeys.push(offer.batchOfferKey)
        deferredOfferReasons[offer.batchOfferKey] =
          triage.reasons.length > 0 ? triage.reasons : ['Unresolved or deferred offer awaiting operator resolution.']

        // Fail closed ONLY if operator explicitly targeted/approved an offer despite critical validation failures
        if (isExplicitlyApprovedByOperator && assessment.quarantineReasons.length > 0) {
          blockingReasons.push(
            `OFFER_QUARANTINED_CRITICAL_FACTS: Offer ${offer.batchOfferKey} failed critical publication validation (${assessment.quarantineReasons.join(', ')}).`
          )
        }
      }
    }

    // Check temporary products readiness & identity sufficiency for all publish-eligible groups
    const eligibleOfferSet = new Set(eligibleOfferKeys)
    const eligibleTempIds = new Set<string>()
    for (const offer of offers) {
      if (!eligibleOfferSet.has(offer.batchOfferKey)) continue
      const p = manifest.proposals?.[offer.batchOfferKey]
      if (p?.decision === 'temporary' && p.temporaryId) {
        eligibleTempIds.add(p.temporaryId)
      }
    }
    for (const tempGroup of Object.values(manifest.temporaryProducts)) {
      if (tempGroup.operatorDecision === 'approved' || eligibleTempIds.has(tempGroup.temporaryId)) {
        if (!tempGroup.productNameEn && !tempGroup.productNameAr) {
          missingAttributesCount++
          blockingReasons.push(
            `Temporary product ${tempGroup.temporaryId} is missing both English and Arabic product names.`
          )
        }
        const sufficiency = evaluateIdentitySufficiency({
          brandKey: tempGroup.brandKey,
          brandNameAr: tempGroup.brandNameAr,
          brandNameEn: tempGroup.brandNameEn,
          brandStatus: 'known',
          productNameAr: tempGroup.productNameAr,
          productNameEn: tempGroup.productNameEn,
          variantOrFlavor: tempGroup.variantOrFlavor,
          fatContent: tempGroup.fatContent,
          eachSizeValue: tempGroup.eachSizeValue,
          eachSizeUnit: tempGroup.eachSizeUnit,
          innerPackCount: tempGroup.innerPackCount,
          manufacturerPackCount: tempGroup.innerPackCount,
          saleUnitType: tempGroup.saleUnitType,
          productForm: tempGroup.productForm
        })
        if (!sufficiency.isSufficient) {
          missingAttributesCount++
          blockingReasons.push(
            `Temporary product ${tempGroup.temporaryId} failed identity sufficiency preflight: ${sufficiency.reasons.join(' ')}`
          )
        }
      }
    }

    // Schema dependency and owner authorization check (PUB-02, MIG-04)
    let schemaDependenciesMet = true
    let schemaReport: SchemaCompatibilityReport | undefined
    const isOwnerAuthorized =
      params.operatorAuthorizedProductionPublish === true ||
      process.env.WIFRAN_PRODUCTION_PUBLICATION_AUTHORIZED === '1'

    if (context === 'PRODUCTION_UI') {
      if (!params.pgClient && !isOwnerAuthorized) {
        schemaDependenciesMet = false
        blockingReasons.push(
          'PRODUCTION_PUBLICATION_BLOCKED: Production database (swratbmclahjyekouned) requires verified migration parity (Migrations 009 & 010) and explicit owner authorization (WIFRAN_PRODUCTION_PUBLICATION_AUTHORIZED=1 or explicit production publish confirmation).'
        )
        schemaWarnings.push(
          'Explicit owner authorization for production publication is not present.'
        )
      } else {
        schemaReport = await assessSchemaCompatibility({
          context,
          pgClient: params.pgClient,
          requiredBucket: params.storageBucket,
          bucketChecker: params.bucketChecker,
          allowIsolatedTestDb: params.allowIsolatedTestDb
        })
        if (!schemaReport.compatible) {
          schemaDependenciesMet = false
          blockingReasons.push(
            `PRODUCTION_PUBLICATION_BLOCKED: ${schemaReport.blockingReasons.join(' | ')}`
          )
          schemaWarnings.push(...schemaReport.missingDependencies)
        } else if (!isOwnerAuthorized) {
          schemaDependenciesMet = false
          blockingReasons.push(
            'PRODUCTION_PUBLICATION_BLOCKED: Schema compatibility passed, but explicit owner/operator authorization for PRODUCTION_UI publication is missing.'
          )
          schemaWarnings.push('Explicit owner authorization for production publication is not present.')
        }
      }
    } else if (params.pgClient) {
      schemaReport = await assessSchemaCompatibility({
        context,
        pgClient: params.pgClient,
        requiredBucket: params.storageBucket,
        bucketChecker: params.bucketChecker,
        allowIsolatedTestDb: params.allowIsolatedTestDb
      })
      if (!schemaReport.compatible) {
        schemaWarnings.push(...schemaReport.missingDependencies)
      }
    }

    // Optional live/isolated DB duplicate & diff classification for pre-pub summary (DUP-02A..E)
    let reconciliationSummary: PrePublicationReconciliationSummary | null = null
    if (params.pgClient || params.runDatabaseReconciliation) {
      let reconcilerClient: SqlQueryable | null = params.pgClient || null
      let shouldCloseReconciler = false
      try {
        if (!reconcilerClient && !(context === 'PRODUCTION_UI' && !schemaDependenciesMet)) {
          const pg = createGuardedPgClient(context)
          await pg.connect()
          reconcilerClient = pg
          shouldCloseReconciler = true
        }
        if (reconcilerClient) {
          const eligibleKeySetForRecon = new Set(eligibleOfferKeys)
          const candSnapshots = offers
            .map((offer) => {
              if (!eligibleKeySetForRecon.has(offer.batchOfferKey)) return null
              const prop = manifest.proposals[offer.batchOfferKey]
              const ass = nonCatalogAssessmentByOffer[offer.batchOfferKey]
              if (!ass || ass.outcome === 'quarantined') return null
              const prodId =
                prop?.decision === 'existing' && prop.matchedProductId
                  ? Number(prop.matchedProductId)
                  : null
              return buildNormalizedCandidateSnapshot(
                offer,
                ass,
                prodId != null && Number.isFinite(prodId) ? prodId : null
              )
            })
            .filter((x): x is NonNullable<typeof x> => Boolean(x))
          reconciliationSummary = await reconcileOffersAgainstDatabase({
            client: reconcilerClient,
            candidates: candSnapshots
          })
          if (reconciliationSummary?.entries) {
            for (const entry of reconciliationSummary.entries) {
              if (entry.classification === 'already_published') {
                const idx = eligibleOfferKeys.indexOf(entry.batchOfferKey)
                if (idx !== -1) {
                  eligibleOfferKeys.splice(idx, 1)
                  if (!alreadyPublishedOfferKeys.includes(entry.batchOfferKey)) {
                    alreadyPublishedOfferKeys.push(entry.batchOfferKey)
                  }
                }
              }
            }
          }
        }
      } catch (err: any) {
        schemaWarnings.push(`Pre-publication DB reconciliation warning: ${err?.message || String(err)}`)
      } finally {
        if (shouldCloseReconciler && reconcilerClient && typeof reconcilerClient.end === 'function') {
          await reconcilerClient.end().catch(() => {})
        }
      }
    }

    return {
      ready: blockingReasons.length === 0,
      databaseContext: context,
      totalOffersToPublish: eligibleOfferKeys.length,
      readyOffersToPublishCount: eligibleOfferKeys.length,
      deferredOffersCount: deferredOfferKeys.length,
      alreadyPublishedOffersCount: alreadyPublishedOfferKeys.length,
      eligibleOfferKeys,
      deferredOfferKeys,
      alreadyPublishedOfferKeys,
      deferredOfferReasons,
      existingProductMatchesCount,
      newProductsToCreateCount,
      unresolvedOffersCount: unresolvedCount,
      approvedNonCatalogCount,
      eligibleNonCatalogCount,
      quarantinedOffersCount,
      nonCatalogAssessmentByOffer,
      incompleteOrFailedRequestsCount,
      missingAttributesCount,
      schemaDependenciesMet,
      schemaWarnings,
      blockingReasons,
      ...(schemaReport ? { schemaReport: schemaReport as unknown as Record<string, unknown> } : {}),
      ...(reconciliationSummary ? { reconciliationSummary } : {})
    }
  }

  /**
   * Publishes approved catalog matches into the targeted database transactionally.
   * STRICT SAFETY RULE: During automated testing and development, context MUST be DEVELOPMENT_TEST.
   */
  public async publishApprovedCatalogBatch(params: {
    manifest: MatchingRunManifest
    offers: UnifiedBatchOffer[]
    context: DatabaseContext
    operatorId: string
    referenceDateIso?: string | null
    enforceMetadataVerification?: boolean
    storageBucket?: string
    evidenceBucket?: string
    productImagesBucket?: string
    offerDisplayImagesBucket?: string
    enableImageUpload?: boolean
    uploadImageFn?: UploadOfferImageFn
    pgClient?: SqlQueryable
    storageAdapter?: StorageLifecycleAdapter
    allowIsolatedTestDb?: boolean
    operatorAuthorizedProductionPublish?: boolean
    idempotencyKey?: string
    approvedUpdateSourceIds?: string[]
    approveAllUpdates?: boolean
    enforceUpdateApproval?: boolean
    overrideConflictSourceIds?: string[]
  }): Promise<CatalogPublicationResult> {
    const {
      manifest,
      offers,
      context,
      operatorId,
      referenceDateIso = null,
      enforceMetadataVerification = false,
      storageBucket = process.env.SUPABASE_STORAGE_BUCKET || PRIVATE_EVIDENCE_BUCKET,
      evidenceBucket = params.evidenceBucket || storageBucket,
      productImagesBucket = params.productImagesBucket || PUBLIC_PRODUCT_IMAGES_BUCKET,
      offerDisplayImagesBucket = params.offerDisplayImagesBucket || PUBLIC_OFFER_DISPLAY_IMAGES_BUCKET,
      enableImageUpload = true,
      uploadImageFn
    } = params

    const preflight = await this.assessPublicationPreflight({
      manifest,
      offers,
      context,
      referenceDateIso,
      enforceMetadataVerification,
      pgClient: params.pgClient,
      allowIsolatedTestDb: params.allowIsolatedTestDb,
      operatorAuthorizedProductionPublish: params.operatorAuthorizedProductionPublish,
      storageBucket: evidenceBucket,
      evidenceBucket,
      productImagesBucket: params.productImagesBucket,
      offerDisplayImagesBucket: params.offerDisplayImagesBucket,
      bucketChecker: params.storageAdapter?.bucketExists
    })

    if (
      context === 'PRODUCTION_UI' &&
      preflight.blockingReasons.some((r) => r.includes('PRODUCTION_PUBLICATION_BLOCKED'))
    ) {
      throw new Error(
        preflight.blockingReasons.find((r) => r.includes('PRODUCTION_PUBLICATION_BLOCKED')) ||
          'PRODUCTION_PUBLICATION_BLOCKED'
      )
    }

    if (!preflight.ready) {
      return {
        success: false,
        databaseContext: context,
        createdProductsCount: 0,
        publishedOffersCount: 0,
        publishedNonCatalogOffersCount: 0,
        upgradedFromNonCatalogCount: 0,
        quarantinedOffersCount: preflight.quarantinedOffersCount || 0,
        skippedUnapprovedNonCatalogCount: 0,
        createdProductMap: {},
        publishedOfferIds: [],
        publishedBatchOfferKeys: [],
        deferredBatchOfferKeys: preflight.deferredOfferKeys || [],
        alreadyPublishedBatchOfferKeys: preflight.alreadyPublishedOfferKeys || [],
        errors: preflight.blockingReasons
      }
    }

    const eligibleOfferKeySet = new Set(preflight.eligibleOfferKeys || [])
    const deferredOfferKeySet = new Set(preflight.deferredOfferKeys || [])
    const alreadyPublishedKeySet = new Set(preflight.alreadyPublishedOfferKeys || [])

    // If there are zero eligible offers and one or more offers are already published, return a clean noop
    if (eligibleOfferKeySet.size === 0 && alreadyPublishedKeySet.size > 0) {
      return {
        success: true,
        databaseContext: context,
        createdProductsCount: 0,
        publishedOffersCount: 0,
        publishedNonCatalogOffersCount: 0,
        upgradedFromNonCatalogCount: 0,
        quarantinedOffersCount: preflight.quarantinedOffersCount || 0,
        skippedUnapprovedNonCatalogCount: 0,
        createdProductMap: {},
        publishedOfferIds: [],
        publishedBatchOfferKeys: [],
        deferredBatchOfferKeys: preflight.deferredOfferKeys || [],
        alreadyPublishedBatchOfferKeys: preflight.alreadyPublishedOfferKeys || [],
        errors: [],
        reconciliationSummary: preflight.reconciliationSummary
      }
    }

    // Stage content-addressed storage uploads BEFORE opening DB transaction (STORAGE-02)
    // Strictly separate:
    //  1) Private evidence leaflet crops (`offerCardCropPath`, `productThumbCropPath`) -> `offer-images` (private)
    //  2) Approved consumer product images (`consumerProductImagePath`) -> `product-images` (public)
    //  3) Approved consumer offer display images (`consumerDisplayImagePath`) -> `offer-display-images` (public)
    const stagedEvidenceCardByKey = new Map<string, Awaited<ReturnType<typeof stageContentAddressedUpload>>>()
    const stagedEvidenceThumbByKey = new Map<string, Awaited<ReturnType<typeof stageContentAddressedUpload>>>()
    const stagedConsumerProductByKey = new Map<string, Awaited<ReturnType<typeof stageContentAddressedUpload>>>()
    const stagedConsumerDisplayByKey = new Map<string, Awaited<ReturnType<typeof stageContentAddressedUpload>>>()
    const supportedSourceKindCache = new Map<string, boolean>()
    const exclusiveStagedForRollback: Array<{ bucket: string; objectPath: string }> = []

    const resolvedAdapter: StorageLifecycleAdapter | null =
      params.storageAdapter ||
      (enableImageUpload && !uploadImageFn
        ? (() => {
            try {
              return createGuardedStorageAdapter(context)
            } catch {
              return null
            }
          })()
        : null)

    if (enableImageUpload && resolvedAdapter) {
      try {
        for (const offer of offers) {
          if (!eligibleOfferKeySet.has(offer.batchOfferKey)) continue
          const ass = preflight.nonCatalogAssessmentByOffer?.[offer.batchOfferKey]
          if (!ass || ass.outcome === 'quarantined') continue

          const hasEvidenceCard = Boolean(offer.offerCardCropPath && fs.existsSync(offer.offerCardCropPath))
          const imgScope =
            offer.imageSubjectScope ||
            (ass.outcome === 'catalog_linked' ? 'product_package' : 'unverified')
          const hasEvidenceThumb = Boolean(
            imgScope === 'product_package' && offer.productThumbCropPath && fs.existsSync(offer.productThumbCropPath)
          )

          if (hasEvidenceCard || hasEvidenceThumb) {
            await validateEvidenceBucketRoutingOrThrow(resolvedAdapter, evidenceBucket)
          }

          if (hasEvidenceCard && offer.offerCardCropPath) {
            const stagedEvidenceCard = await stageContentAddressedUpload({
              adapter: resolvedAdapter,
              bucket: evidenceBucket,
              localFilePath: offer.offerCardCropPath,
              scopePrefix: 'offers',
              extension: 'webp'
            })
            if (stagedEvidenceCard) {
              stagedEvidenceCardByKey.set(offer.batchOfferKey, stagedEvidenceCard)
              if (stagedEvidenceCard.ownershipMode === 'exclusive_created') {
                exclusiveStagedForRollback.push({
                  bucket: stagedEvidenceCard.bucket,
                  objectPath: stagedEvidenceCard.objectPath
                })
              }
            }
          }

          if (hasEvidenceThumb && offer.productThumbCropPath) {
            const stagedEvidenceThumb = await stageContentAddressedUpload({
              adapter: resolvedAdapter,
              bucket: evidenceBucket,
              localFilePath: offer.productThumbCropPath,
              scopePrefix: 'products',
              extension: 'webp'
            })
            if (stagedEvidenceThumb) {
              stagedEvidenceThumbByKey.set(offer.batchOfferKey, stagedEvidenceThumb)
              if (stagedEvidenceThumb.ownershipMode === 'exclusive_created') {
                exclusiveStagedForRollback.push({
                  bucket: stagedEvidenceThumb.bucket,
                  objectPath: stagedEvidenceThumb.objectPath
                })
              }
            }
          }

          const isNonCatalogAssortmentOrDisplay =
            ass.outcome !== 'catalog_linked' || imgScope === 'representative_assortment'
          const effectiveDisplayImagePath =
            offer.consumerDisplayImagePath && fs.existsSync(offer.consumerDisplayImagePath)
              ? offer.consumerDisplayImagePath
              : isNonCatalogAssortmentOrDisplay &&
                  offer.consumerProductImagePath &&
                  offer.consumerImageApprovalStatus !== 'rejected' &&
                  offer.consumerImageApprovalStatus !== 'invalidated_identity_changed' &&
                  offer.consumerProductImagePath !== offer.offerCardCropPath &&
                  !offer.consumerProductImagePath.toLowerCase().includes('offer_card_crop') &&
                  fs.existsSync(offer.consumerProductImagePath)
                ? offer.consumerProductImagePath
                : null

          if (effectiveDisplayImagePath) {
            const displayConflict = checkImageFilePackageConflict(
              effectiveDisplayImagePath,
              offer.each_size_value,
              offer.each_size_unit,
              offer.inner_pack_count
            )
            if (!displayConflict.blocked) {
              await validateConsumerBucketRoutingOrThrow(
                resolvedAdapter,
                offerDisplayImagesBucket,
                PUBLIC_OFFER_DISPLAY_IMAGES_BUCKET
              )
              const stagedDisplay = await stageContentAddressedUpload({
                adapter: resolvedAdapter,
                bucket: offerDisplayImagesBucket,
                localFilePath: effectiveDisplayImagePath,
                scopePrefix: 'offers',
                extension: 'webp'
              })
              if (stagedDisplay) {
                if (stagedDisplay.ownershipMode === 'exclusive_created') {
                  exclusiveStagedForRollback.push({
                    bucket: stagedDisplay.bucket,
                    objectPath: stagedDisplay.objectPath
                  })
                }
                stagedDisplay.publicUrl = validateConsumerPublicUrlOrThrow({
                  publicUrl: stagedDisplay.publicUrl,
                  bucket: stagedDisplay.bucket,
                  expectedBucket: PUBLIC_OFFER_DISPLAY_IMAGES_BUCKET,
                  context
                })
                stagedConsumerDisplayByKey.set(offer.batchOfferKey, stagedDisplay)
              }
            }
          }

          if (
            ass.outcome === 'catalog_linked' &&
            imgScope === 'product_package' &&
            offer.consumerProductImagePath &&
            offer.consumerImageApprovalStatus !== 'rejected' &&
            offer.consumerImageApprovalStatus !== 'invalidated_identity_changed' &&
            offer.consumerProductImagePath !== offer.offerCardCropPath &&
            !offer.consumerProductImagePath.toLowerCase().includes('offer_card_crop') &&
            fs.existsSync(offer.consumerProductImagePath)
          ) {
            const productImgConflict = checkImageFilePackageConflict(
              offer.consumerProductImagePath,
              offer.each_size_value,
              offer.each_size_unit,
              offer.inner_pack_count
            )
            if (!productImgConflict.blocked) {
              await validateConsumerBucketRoutingOrThrow(
                resolvedAdapter,
                productImagesBucket,
                PUBLIC_PRODUCT_IMAGES_BUCKET
              )
              const stagedProductImg = await stageContentAddressedUpload({
                adapter: resolvedAdapter,
                bucket: productImagesBucket,
                localFilePath: offer.consumerProductImagePath,
                scopePrefix: 'products',
                extension: 'webp'
              })
              if (stagedProductImg) {
                if (stagedProductImg.ownershipMode === 'exclusive_created') {
                  exclusiveStagedForRollback.push({
                    bucket: stagedProductImg.bucket,
                    objectPath: stagedProductImg.objectPath
                  })
                }
                stagedProductImg.publicUrl = validateConsumerPublicUrlOrThrow({
                  publicUrl: stagedProductImg.publicUrl,
                  bucket: stagedProductImg.bucket,
                  expectedBucket: PUBLIC_PRODUCT_IMAGES_BUCKET,
                  context
                })
                stagedConsumerProductByKey.set(offer.batchOfferKey, stagedProductImg)
              }
            }
          }
        }
      } catch (stagingErr: any) {
        if (exclusiveStagedForRollback.length > 0) {
          const grouped = new Map<string, string[]>()
          for (const item of exclusiveStagedForRollback) {
            const arr = grouped.get(item.bucket) || []
            arr.push(item.objectPath)
            grouped.set(item.bucket, arr)
          }
          for (const [bkt, paths] of grouped.entries()) {
            await resolvedAdapter.deleteObjects(bkt, paths).catch(() => {})
          }
        }
        throw stagingErr
      }
    }

    const ownedClient = params.pgClient ? null : createGuardedPgClient(context)
    const client: SqlQueryable = params.pgClient || ownedClient!
    if (ownedClient) {
      await ownedClient.connect()
    }

    const createdProductMap: Record<string, string> = {}
    const publishedOfferIds: string[] = []
    const publishedBatchOfferKeys: string[] = []
    const sourceOfferIdByKey: Record<string, string> = {}
    const publishedOfferIdByKey: Record<string, string> = {}
    const productIdByKey: Record<string, string | null> = {}
    let insertedOffersCount = 0
    let updatedOffersCount = 0
    let unchangedNoopCount = 0
    let skippedDuplicatesCount = 0
    let conflictsCount = 0
    let reusedProductsCount = 0
    let publishedNonCatalogOffersCount = 0
    let upgradedFromNonCatalogCount = 0
    let quarantinedOffersCount = 0
    let skippedUnapprovedNonCatalogCount = 0
    const sourceDocIds = Array.from(
      new Set(
        offers
          .map((o) => o.sourceDocumentId || (o.sourceFileFingerprint ? computeDocumentIdFromFingerprint(o.sourceFileFingerprint, o.sourceFileName) : null))
          .filter((x): x is string => Boolean(x))
      )
    )

    const approvedUpdateSet = new Set(params.approvedUpdateSourceIds || [])
    const overrideConflictSet = new Set(params.overrideConflictSourceIds || [])
    const enforceUpdateApproval = Boolean(
      params.enforceUpdateApproval || (params.approvedUpdateSourceIds && params.approvedUpdateSourceIds.length > 0) || params.approveAllUpdates !== undefined
    )

    const eligibleOffersForCommit = offers.filter((o) => eligibleOfferKeySet.has(o.batchOfferKey))
    const leafletSnapshotMap = new Map<string, Record<string, unknown>>()
    for (const o of eligibleOffersForCommit) {
      if (!leafletSnapshotMap.has(o.leafletId)) {
        leafletSnapshotMap.set(o.leafletId, {
          leafletId: o.leafletId,
          sourceDocumentId:
            o.sourceDocumentId ||
            (o.sourceFileFingerprint ? computeDocumentIdFromFingerprint(o.sourceFileFingerprint, o.sourceFileName) : null),
          fileName: o.sourceFileName,
          supermarketId: o.supermarketId ?? null,
          supermarketName: o.supermarketName ?? null,
          offerStartDate: o.offerStartDate ?? null,
          offerEndDate: o.offerEndDate ?? null,
          locationScope: o.locationScope ?? null,
          locationLabel: o.locationLabel ?? null,
          cityId: o.cityId ?? null,
          regionId: o.regionId ?? null,
          currency: o.currency ?? 'SAR',
          leafletTitle: o.leafletTitle ?? null,
          metadataStatus: o.metadataStatus ?? null
        })
      }
    }

    const payloadFingerprint = computePublishPayloadFingerprint({
      batchId: manifest.batchId,
      context,
      approveAllUpdates: Boolean(params.approveAllUpdates),
      approvedUpdateSourceIds: Array.from(approvedUpdateSet).sort(),
      overrideConflictSourceIds: Array.from(overrideConflictSet).sort(),
      eligibleOfferKeys: eligibleOffersForCommit.map((o) => o.batchOfferKey).sort(),
      offers: eligibleOffersForCommit.map((o) => {
        const proposal = manifest.proposals[o.batchOfferKey]
        const nonCat = manifest.nonCatalogApprovals?.[o.batchOfferKey]
        const tempDecision =
          proposal?.decision === 'temporary' && proposal.temporaryId
            ? manifest.temporaryProducts[proposal.temporaryId]?.operatorDecision || null
            : null
        return {
          batchOfferKey: o.batchOfferKey,
          sourceOfferId: computeStableSourceOfferId(o),
          promoPrice: o.promoPrice,
          originalPrice: o.originalPrice,
          titleEn: o.titleEn,
          titleAr: o.titleAr,
          brand: o.brand,
          eachSizeValue: o.each_size_value,
          eachSizeUnit: o.each_size_unit,
          innerPackCount: o.inner_pack_count,
          supermarketId: o.supermarketId,
          locationScope: o.locationScope,
          cityId: o.cityId,
          regionId: o.regionId,
          productId: proposal?.matchedProductId || proposal?.temporaryId || null,
          operatorDecision: proposal?.operatorDecision || null,
          tempDecision,
          nonCatalogDecision: nonCat?.decision || null,
          nonCatalogCategory: nonCat?.category || null,
          offerStartDate: o.offerStartDate,
          offerEndDate: o.offerEndDate
        }
      })
    })
    const effectiveIdempotencyKey =
      params.idempotencyKey?.trim() ||
      computeDefaultPublishIdempotencyKey({
        context,
        batchId: manifest.batchId,
        payloadFingerprint
      })

    let publishOperationId: string | null = null
    let hasJournalTables = false
    let seqNo = 1

    try {
      await client.query('BEGIN')

      const journalCheck = await client.query<{ reg: string | null }>(
        `SELECT to_regclass('public.publication_operations')::text AS reg`
      )
      hasJournalTables = Boolean(journalCheck.rows[0]?.reg)

      if (hasJournalTables) {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`idemp:${effectiveIdempotencyKey}`])
        const existingOpRes = await client.query<Record<string, any>>(
          `SELECT * FROM public.publication_operations WHERE idempotency_key = $1 LIMIT 1`,
          [effectiveIdempotencyKey]
        )
        if (existingOpRes.rows.length > 0) {
          const prevOp = existingOpRes.rows[0]
          if (prevOp.payload_fingerprint !== payloadFingerprint) {
            throw new Error(
              `IDEMPOTENCY_PAYLOAD_MISMATCH: Idempotency key "${effectiveIdempotencyKey}" already exists with a different payload fingerprint.`
            )
          }
          if (prevOp.status === 'in_progress') {
            throw new Error(
              `PUBLICATION_ALREADY_IN_PROGRESS: Operation ${prevOp.publish_operation_id} with key "${effectiveIdempotencyKey}" is currently executing.`
            )
          }
          if (prevOp.status === 'completed' || prevOp.status === 'noop') {
            await client.query('ROLLBACK')
            const mutOffers = await client.query<{ record_pk: string }>(
              `SELECT record_pk FROM public.publication_journal_mutations
               WHERE publish_operation_id = $1 AND table_name = 'offers'`,
              [prevOp.publish_operation_id]
            )
            return {
              success: true,
              databaseContext: context,
              publishOperationId: String(prevOp.publish_operation_id),
              idempotencyKey: effectiveIdempotencyKey,
              idempotentReplay: true,
              noop: prevOp.status === 'noop',
              createdProductsCount: Number(prevOp.created_products_count || 0),
              reusedProductsCount: Number(prevOp.reused_products_count || 0),
              publishedOffersCount: Number(prevOp.inserted_offers_count || 0) + Number(prevOp.updated_offers_count || 0),
              insertedOffersCount: Number(prevOp.inserted_offers_count || 0),
              updatedOffersCount: Number(prevOp.updated_offers_count || 0),
              unchangedNoopCount: Number(prevOp.unchanged_noop_count || 0),
              skippedDuplicatesCount: Number(prevOp.skipped_duplicates_count || 0),
              conflictsCount: Number(prevOp.conflicts_count || 0),
              createdProductMap: {},
              publishedOfferIds: mutOffers.rows.map((r) => String(r.record_pk)),
              storageSummary: {
                uploaded: Number(prevOp.storage_objects_uploaded || 0),
                reused: Number(prevOp.storage_objects_reused || 0),
                bucket: storageBucket
              }
            }
          }
        }

        publishOperationId = crypto.randomUUID()
        const targetRef = params.allowIsolatedTestDb
          ? 'isolated_local_pg'
          : context === 'PRODUCTION_UI'
            ? PRODUCTION_PROJECT_REF
            : DEVELOPMENT_PROJECT_REF

        await client.query(
          `INSERT INTO public.publication_operations (
            publish_operation_id,
            idempotency_key,
            payload_fingerprint,
            target_project_ref,
            environment_context,
            batch_id,
            source_document_ids,
            operator_id,
            status,
            requested_offers_count,
            preflight_summary,
            undo_eligible,
            started_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, 'in_progress', $9, $10::jsonb, false, now())`,
          [
            publishOperationId,
            effectiveIdempotencyKey,
            payloadFingerprint,
            targetRef,
            params.allowIsolatedTestDb ? 'ISOLATED_TEST' : context,
            manifest.batchId,
            JSON.stringify(sourceDocIds),
            operatorId || 'operator',
            eligibleOffersForCommit.length,
            JSON.stringify({
              existingProductMatchesCount: preflight.existingProductMatchesCount,
              newProductsToCreateCount: preflight.newProductsToCreateCount,
              approvedNonCatalogCount: preflight.approvedNonCatalogCount || 0,
              selectivePublication: {
                readyOffersCount: eligibleOfferKeySet.size,
                deferredOffersCount: deferredOfferKeySet.size,
                alreadyPublishedOffersCount: alreadyPublishedKeySet.size,
                eligibleOfferKeys: Array.from(eligibleOfferKeySet),
                deferredOfferKeys: Array.from(deferredOfferKeySet),
                alreadyPublishedOfferKeys: Array.from(alreadyPublishedKeySet)
              },
              leafletMetadataSnapshots: Array.from(leafletSnapshotMap.values())
            })
          ]
        )

        await client.query(`SELECT set_config('wifran.active_publish_operation_id', $1, true)`, [
          publishOperationId
        ])
      }

      // 0. Ensure Referenced Supermarkets Exist in Catalog (handles pending / newly added supermarkets)
      const referencedSupermarketIds = new Set<string>()
      for (const off of eligibleOffersForCommit) {
        if (off.supermarketId && off.supermarketId !== '00000000-0000-4000-a000-000000000000') {
          referencedSupermarketIds.add(off.supermarketId)
        }
      }

      for (const smId of referencedSupermarketIds) {
        const existingSm = await client.query<{ id: string }>(
          `SELECT id FROM public.supermarkets WHERE id = $1 LIMIT 1`,
          [smId]
        )
        if (existingSm.rows.length === 0) {
          const matchingOffer = eligibleOffersForCommit.find((o) => o.supermarketId === smId)
          const nameEn = matchingOffer?.supermarketName || 'Supermarket'
          const nameAr = (matchingOffer as any)?.supermarketNameAr || nameEn
          const slug = toAsciiSlug(nameEn)

          const bySlug = await client.query<{ id: string }>(
            `SELECT id FROM public.supermarkets WHERE slug = $1 OR lower(name_en) = lower($2) LIMIT 1`,
            [slug, nameEn]
          )
          if (bySlug.rows.length > 0) {
            const existingId = String(bySlug.rows[0].id)
            for (const off of offers) {
              if (off.supermarketId === smId) {
                off.supermarketId = existingId
              }
            }
          } else {
            const insertSmRes = await client.query(
              `INSERT INTO public.supermarkets (id, name_en, name_ar, slug)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (id) DO UPDATE SET name_en = EXCLUDED.name_en
               RETURNING *`,
              [smId, nameEn, nameAr, slug]
            )
            if (hasJournalTables && publishOperationId) {
              seqNo = await recordJournalMutation({
                client,
                publishOperationId,
                sequenceNo: seqNo,
                tableName: 'supermarkets',
                recordPk: smId,
                mutationType: 'insert',
                preState: null,
                postState: insertSmRes.rows[0],
                reusedExisting: false,
                metadata: {
                  reason: 'pending_supermarket_catalog_creation',
                  nameEn,
                  nameAr,
                  slug
                }
              })
            }
          }
        }
      }

      // 1. Process Approved Temporary Products (only for eligible offers classified as catalog_linked)
      const catalogLinkedTempIds = new Set<string>()
      for (const offer of offers) {
        if (!eligibleOfferKeySet.has(offer.batchOfferKey)) continue
        const assessment = preflight.nonCatalogAssessmentByOffer?.[offer.batchOfferKey]
        const prop = manifest.proposals[offer.batchOfferKey]
        if (assessment?.outcome === 'catalog_linked' && prop?.decision === 'temporary' && prop.temporaryId) {
          catalogLinkedTempIds.add(prop.temporaryId)
        }
      }

      const publishableTempGroups = Object.values(manifest.temporaryProducts).filter(
        (g) => g.operatorDecision !== 'rejected' && catalogLinkedTempIds.has(g.temporaryId)
      )

      const newlyCreatedProductIds = new Set<string>()
      for (const tempGroup of publishableTempGroups) {
        const isOperatorVerifiedTemp = tempGroup.operatorDecision === 'approved'
        const prodVerificationStatus = isOperatorVerifiedTemp ? 'verified' : 'candidate'
        const prodVerificationBasis = isOperatorVerifiedTemp
          ? 'operator_matching_approval'
          : 'auto_extraction_provisional'
        const prodVerifiedBy = isOperatorVerifiedTemp ? operatorId : null

        const normVariant = (v?: string | null) =>
          (v || '')
            .toLowerCase()
            .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
            .trim()
        const tempVariantNorm = normVariant(tempGroup.variantOrFlavor)
        const tempSaleUnit = (tempGroup.saleUnitType || 'piece').toLowerCase().trim()

        const lockKey = `prod_xact_lock:${(tempGroup.brandNameEn || tempGroup.brandKey).toLowerCase()}:${(tempGroup.productNameEn || tempGroup.productNameAr || '').toLowerCase()}:${tempGroup.eachSizeValue || 'none'}:${(tempGroup.eachSizeUnit || '').toLowerCase()}:${tempGroup.innerPackCount || 1}:${tempSaleUnit}:${tempVariantNorm}`
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [lockKey])

        const existingCheck = await client.query(
          `SELECT * FROM public.products
           WHERE (name_en = $1 OR name_ar = $2)
             AND LOWER(btrim(COALESCE(brand_name, ''))) = LOWER(btrim(COALESCE($3, '')))
             AND COALESCE(is_active, true) = true
             AND COALESCE(verification_status, 'verified') <> 'rejected'
           LIMIT 25`,
          [tempGroup.productNameEn, tempGroup.productNameAr, tempGroup.brandNameEn]
        )

        const exactMatchingExistingRow = existingCheck.rows.find((row: any) => {
          // If row comes from a lightweight test mock without size columns, allow match only if query matched
          const rowHasSizeCols =
            row.each_size_value !== undefined || row.each_size_unit !== undefined
          if (!rowHasSizeCols) return true

          const packCompat = arePackConfigsStrictlyCompatible({
            sizeValue1: tempGroup.eachSizeValue,
            sizeUnit1: tempGroup.eachSizeUnit,
            packCount1: tempGroup.innerPackCount || 1,
            sizeValue2: row.each_size_value != null ? Number(row.each_size_value) : null,
            sizeUnit2: row.each_size_unit ?? null,
            packCount2: row.inner_pack_count != null ? Number(row.inner_pack_count) : 1
          })
          if (!packCompat.isCompatible) return false

          const rowSaleUnit = (row.sale_unit_type || 'piece').toLowerCase().trim()
          if (rowSaleUnit !== tempSaleUnit) return false

          const rowVariantNorm = normVariant(row.variant_or_flavor)
          if (tempVariantNorm !== rowVariantNorm) return false

          return true
        })

        let permanentProductId: string

        if (exactMatchingExistingRow) {
          permanentProductId = String(exactMatchingExistingRow.id)
          reusedProductsCount++
        } else {
          const insertRes = await client.query(
            `INSERT INTO public.products (
              name_en,
              name_ar,
              brand_name,
              variant_or_flavor,
              each_size_value,
              each_size_unit,
              inner_pack_count,
              sale_unit_type,
              verification_status,
              verification_basis,
              verified_by,
              verified_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CASE WHEN $9 = 'verified' THEN now() ELSE NULL END)
            RETURNING *`,
            [
              tempGroup.productNameEn,
              tempGroup.productNameAr,
              tempGroup.brandNameEn,
              tempGroup.variantOrFlavor,
              tempGroup.eachSizeValue,
              tempGroup.eachSizeUnit,
              tempGroup.innerPackCount || 1,
              tempGroup.saleUnitType || 'piece',
              prodVerificationStatus,
              prodVerificationBasis,
              prodVerifiedBy
            ]
          )
          permanentProductId = String(insertRes.rows[0].id)
          newlyCreatedProductIds.add(permanentProductId)
          if (hasJournalTables && publishOperationId) {
            seqNo = await recordJournalMutation({
              client,
              publishOperationId,
              sequenceNo: seqNo,
              tableName: 'products',
              recordPk: permanentProductId,
              mutationType: 'insert',
              preState: null,
              postState: insertRes.rows[0],
              reusedExisting: false,
              metadata: {
                temporaryId: tempGroup.temporaryId,
                verificationStatus: prodVerificationStatus,
                verificationBasis: prodVerificationBasis
              }
            })
          }
        }

        createdProductMap[tempGroup.temporaryId] = permanentProductId

        if (isOperatorVerifiedTemp) {
          this.cacheService.recordVerifiedMatch({
            attrs: {
              brandKey: tempGroup.brandKey,
              brandNameAr: tempGroup.brandNameAr,
              brandNameEn: tempGroup.brandNameEn,
              brandStatus: 'known',
              productNameAr: tempGroup.productNameAr,
              productNameEn: tempGroup.productNameEn,
              variantOrFlavor: tempGroup.variantOrFlavor,
              fatContent: tempGroup.fatContent,
              eachSizeValue: tempGroup.eachSizeValue,
              eachSizeUnit: tempGroup.eachSizeUnit,
              innerPackCount: tempGroup.innerPackCount,
              saleUnitType: tempGroup.saleUnitType,
              productForm: tempGroup.productForm
            },
            approvedProductId: permanentProductId,
            verifiedBy: operatorId
          })
        }
      }

      // Track storage ops to commit once per object per publish_operation_id
      const recordedStorageKeys = new Set<string>()
      const usedStorageBuckets = new Set<string>()
      let storageUploadedCount = 0
      let storageReusedCount = 0

      // 2. Publish Eligible Approved Offers ONLY (with DUP-02 reconciliation + row-level journal capture)
      for (const offer of offers) {
        const proposal = manifest.proposals[offer.batchOfferKey]
        const approval = manifest.nonCatalogApprovals?.[offer.batchOfferKey]
        const assessment =
          preflight.nonCatalogAssessmentByOffer?.[offer.batchOfferKey] ??
          assessOfferPublicationOutcome({
            offer,
            proposal,
            temporaryProducts: manifest.temporaryProducts,
            approval
          })

        const isAlreadyPublished =
          alreadyPublishedKeySet.has(offer.batchOfferKey) ||
          Array.from(alreadyPublishedKeySet).some((k) => {
            const kParts = k.split(':')
            const offerParts = offer.batchOfferKey.split(':')
            return (
              kParts.length >= 4 &&
              offerParts.length >= 4 &&
              kParts[1] === offerParts[1] &&
              kParts[2] === offerParts[2] &&
              kParts[3] === offerParts[3]
            )
          })

        if (isAlreadyPublished) {
          unchangedNoopCount++
          skippedDuplicatesCount++
          continue
        }

        if (!eligibleOfferKeySet.has(offer.batchOfferKey) || assessment.outcome === 'quarantined') {
          if (assessment.isEligibleForNonCatalogPublication || proposal?.decision === 'temporary') {
            skippedUnapprovedNonCatalogCount++
          } else {
            quarantinedOffersCount++
          }
          continue
        }

        let targetProductId: string | null = null

        if (assessment.outcome === 'catalog_linked' && proposal) {
          if (proposal.decision === 'existing' && proposal.matchedProductId) {
            const matchDbContext = proposal.matchedDatabaseContext ?? manifest.matchingDatabaseContext
            if (context === 'DEVELOPMENT_TEST' && matchDbContext === 'PRODUCTION_UI') {
              throw new Error(
                `CATALOG_ENVIRONMENT_MISMATCH: Offer ${offer.batchOfferKey} was matched against PRODUCTION_UI catalog product #${proposal.matchedProductId} and cannot be published into DEVELOPMENT_TEST.`
              )
            }
            targetProductId = proposal.matchedProductId

            const prodCheck = await client.query(
              `SELECT id, name_en, name_ar, brand_name, variant_or_flavor, each_size_value, each_size_unit, inner_pack_count, is_active, verification_status
               FROM public.products WHERE id = $1`,
              [targetProductId]
            )

            if (prodCheck.rows.length === 0) {
              throw new Error(`CATALOG_PRODUCT_NOT_FOUND: Matched catalog product ${targetProductId} does not exist in the database. Publication aborted.`)
            }

            const currentProd = prodCheck.rows[0]
            if (currentProd.is_active === false) {
              throw new Error(`CATALOG_PRODUCT_INACTIVE: Matched catalog product ${targetProductId} is deactivated in the catalog. Reapproval required.`)
            }

            const effectiveMatchedContext = proposal.matchedDatabaseContext ?? manifest.matchingDatabaseContext ?? null
            if (effectiveMatchedContext !== context) {
              const normalizeBrandToken = (s?: string | null): string =>
                (s || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ').trim()
              const expectedBrand = normalizeBrandToken(
                proposal.matchedProduct?.brand || offer.brandEn || offer.brand
              )
              const actualBrand = normalizeBrandToken(currentProd.brand_name)
              if (expectedBrand && actualBrand) {
                const expectedBrandWords = expectedBrand.split(/\s+/).filter((w) => w.length >= 2)
                const actualBrandWords = actualBrand.split(/\s+/).filter((w) => w.length >= 2)
                const brandCompatible =
                  expectedBrand.includes(actualBrand) ||
                  actualBrand.includes(expectedBrand) ||
                  expectedBrandWords.some((w) => actualBrandWords.includes(w))
                if (!brandCompatible) {
                  throw new Error(
                    `CATALOG_PRODUCT_IDENTITY_MISMATCH: Matched product #${targetProductId} brand "${currentProd.brand_name}" does not match expected brand "${proposal.matchedProduct?.brand || offer.brandEn || offer.brand}". Possible PROD vs DEV ID collision.`
                  )
                }
              }

              const extractTitleWords = (s?: string | null): string[] =>
                (s || '')
                  .toLowerCase()
                  .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
                  .trim()
                  .split(/\s+/)
                  .filter((w) => w.length >= 3 && !['wp2', 'test', 'the', 'and', 'with', 'for'].includes(w))
              const expectedTitleEn = (proposal.matchedProduct?.nameEn || offer.titleEn || '').trim().toLowerCase()
              const actualTitleEn = (currentProd.name_en || '').trim().toLowerCase()
              if (expectedTitleEn && actualTitleEn) {
                const expWords = extractTitleWords(expectedTitleEn)
                const actWords = extractTitleWords(actualTitleEn)
                const enOverlap =
                  expectedTitleEn.includes(actualTitleEn) ||
                  actualTitleEn.includes(expectedTitleEn) ||
                  (expWords.length > 0 && actWords.length > 0 && expWords.some((w) => actWords.includes(w)))
                const expArWords = extractTitleWords(proposal.matchedProduct?.nameAr || offer.titleAr)
                const actArWords = extractTitleWords(currentProd.name_ar)
                const arOverlap = expArWords.some((w) => actArWords.includes(w))
                if (!enOverlap && !arOverlap && expWords.length > 0 && actWords.length > 0) {
                  throw new Error(
                    `CATALOG_PRODUCT_IDENTITY_MISMATCH: Catalog product #${targetProductId} ("${currentProd.name_en}") does not match matched product identity ("${proposal.matchedProduct?.nameEn || offer.titleEn}"). Possible PROD vs DEV ID collision.`
                  )
                }
              }
            }

            if (offer.each_size_value !== null && offer.each_size_value !== undefined && currentProd.each_size_value !== null) {
              const pkgSemantics = resolveQuantityAndPromoSemantics(offer)
              const packCompat = arePackConfigsStrictlyCompatible({
                sizeValue1: offer.each_size_value,
                sizeUnit1: offer.each_size_unit,
                packCount1: pkgSemantics.manufacturerPackCount,
                sizeValue2: currentProd.each_size_value,
                sizeUnit2: currentProd.each_size_unit,
                packCount2: currentProd.inner_pack_count || 1
              })

              if (!packCompat.isCompatible) {
                throw new Error(`CATALOG_PRODUCT_IDENTITY_MUTATED: Matched product ${targetProductId} has been modified in the catalog (${packCompat.reason}). Previous match is invalidated; reapproval required.`)
              }
            }
          } else if (proposal.decision === 'temporary' && proposal.temporaryId) {
            targetProductId = createdProductMap[proposal.temporaryId] || null
            if (targetProductId && offer.each_size_value !== null && offer.each_size_value !== undefined) {
              const tempProdCheck = await client.query(
                `SELECT id, each_size_value, each_size_unit, inner_pack_count
                 FROM public.products WHERE id = $1`,
                [targetProductId]
              )
              const resolvedProd = tempProdCheck.rows[0]
              if (resolvedProd && resolvedProd.each_size_value != null) {
                const pkgSemantics = resolveQuantityAndPromoSemantics(offer)
                const packCompat = arePackConfigsStrictlyCompatible({
                  sizeValue1: offer.each_size_value,
                  sizeUnit1: offer.each_size_unit,
                  packCount1: pkgSemantics.manufacturerPackCount,
                  sizeValue2: Number(resolvedProd.each_size_value),
                  sizeUnit2: resolvedProd.each_size_unit,
                  packCount2: resolvedProd.inner_pack_count || 1
                })
                if (!packCompat.isCompatible) {
                  throw new Error(
                    `CATALOG_PRODUCT_IDENTITY_MISMATCH: Temporary group ${proposal.temporaryId} resolved to incompatible product #${targetProductId} (${packCompat.reason}). Publication aborted.`
                  )
                }
              }
            }
          }

          if (!targetProductId) continue
        }

        const sourceOfferId = computeStableSourceOfferId(offer)
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`offer_pub:${sourceOfferId}`])

        const linkedTempGroup =
          proposal?.decision === 'temporary' && proposal.temporaryId
            ? manifest.temporaryProducts?.[proposal.temporaryId] ?? null
            : null
        const isAutoProvisionalTemp =
          proposal?.decision === 'temporary' && linkedTempGroup?.operatorDecision !== 'approved'
        const isCatalogLinked = targetProductId !== null
        const isOperatorVerifiedLink = isCatalogLinked && !isAutoProvisionalTemp
        const catalogMatchStatus = isCatalogLinked
          ? isOperatorVerifiedLink
            ? 'verified_linked'
            : 'candidate_pending_review'
          : assessment.catalogMatchStatus
        const exactIdentityStatus = isOperatorVerifiedLink ? 'verified_sku' : 'unresolved'
        const catalogVerificationBasis = isCatalogLinked
          ? isOperatorVerifiedLink
            ? 'operator_matching_approval'
            : 'auto_extraction_provisional'
          : null
        const catalogVerifiedBy = isOperatorVerifiedLink ? operatorId : null
        const isKgBasis = (offer.sale_unit_type || '').toLowerCase() === 'kg'
        const safeInnerPackCount =
          isKgBasis
            ? null
            : offer.inner_pack_count && Number(offer.inner_pack_count) > 0
            ? Math.trunc(Number(offer.inner_pack_count))
            : null

        const promoMechanic =
          offer.promotion_mechanic ||
          (offer.canonical as any)?.promotion?.mechanic ||
          'price_cut'
        const priceBasis =
          (offer.canonical as any)?.price_terms?.source_reported_price_basis ||
          (isKgBasis ? 'per_kg' : 'per_package')
        const loyaltyRequirement =
          (offer.canonical as any)?.eligibility?.loyalty?.requirement || 'none'
        const isLoyaltyRequired = loyaltyRequirement === 'required'
        const qtyLimitVal =
          offer.customer_limit != null && Number.isFinite(Number(offer.customer_limit))
            ? Math.trunc(Number(offer.customer_limit))
            : null

        // Transactional Pre-Publication Duplicate Reconciliation (DUP-02A..E)
        const candSnapshot = buildNormalizedCandidateSnapshot(offer, assessment, targetProductId)
        const txRecon = await reconcileOffersAgainstDatabase({
          client,
          candidates: [candSnapshot]
        })
        const reconEntry = txRecon.entries[0]

        if (reconEntry?.classification === 'already_published') {
          unchangedNoopCount++
          skippedDuplicatesCount++
          if (hasJournalTables && publishOperationId) {
            await client.query(
              `INSERT INTO public.publication_duplicate_skips (
                publish_operation_id, batch_offer_key, source_offer_id, existing_offer_id, classification, reason, details
              ) VALUES ($1, $2, $3, $4, 'already_published', $5, $6::jsonb)`,
              [
                publishOperationId,
                offer.batchOfferKey,
                sourceOfferId,
                reconEntry.existingOfferId,
                reconEntry.reason,
                JSON.stringify({ fieldDiffs: reconEntry.fieldDiffs })
              ]
            )
          }
          continue
        }

        if (reconEntry?.classification === 'duplicate_conflict' && !overrideConflictSet.has(sourceOfferId)) {
          conflictsCount++
          skippedDuplicatesCount++
          if (hasJournalTables && publishOperationId) {
            await client.query(
              `INSERT INTO public.publication_duplicate_skips (
                publish_operation_id, batch_offer_key, source_offer_id, existing_offer_id, classification, reason, details
              ) VALUES ($1, $2, $3, $4, 'duplicate_conflict', $5, $6::jsonb)`,
              [
                publishOperationId,
                offer.batchOfferKey,
                sourceOfferId,
                reconEntry.existingOfferId,
                reconEntry.reason,
                JSON.stringify({
                  existingSourceOfferId: reconEntry.existingSourceOfferId,
                  fieldDiffs: reconEntry.fieldDiffs
                })
              ]
            )
          }
          continue
        }

        if (
          reconEntry?.classification === 'update_candidate' &&
          enforceUpdateApproval &&
          !params.approveAllUpdates &&
          !approvedUpdateSet.has(sourceOfferId)
        ) {
          skippedDuplicatesCount++
          if (hasJournalTables && publishOperationId) {
            await client.query(
              `INSERT INTO public.publication_duplicate_skips (
                publish_operation_id, batch_offer_key, source_offer_id, existing_offer_id, classification, reason, details
              ) VALUES ($1, $2, $3, $4, 'skipped_policy', $5, $6::jsonb)`,
              [
                publishOperationId,
                offer.batchOfferKey,
                sourceOfferId,
                reconEntry.existingOfferId,
                'Update candidate skipped: explicit update approval not granted.',
                JSON.stringify({ fieldDiffs: reconEntry.fieldDiffs })
              ]
            )
          }
          continue
        }

        const existingOfferRes = await client.query<Record<string, any>>(
          `SELECT * FROM public.offers WHERE source_offer_id = $1 LIMIT 1`,
          [sourceOfferId]
        )

        const scopedAssessments = {
          exact_product_comparison: isCatalogLinked ? 'supported' : 'blocked',
          unit_price_comparison: assessment.perUnitPricing.basisEstablished ? 'supported' : 'blocked'
        }
        const reasonCodes = isCatalogLinked
          ? []
          : [
              'COMPARISON_DISABLED_NO_VERIFIED_SKU',
              'NON_CATALOG_APPROVED',
              ...(assessment.category ? [`NON_CATALOG_${assessment.category.toUpperCase()}`] : [])
            ]
        const imageSubjectScope =
          offer.imageSubjectScope ||
          (isCatalogLinked
            ? 'product_package'
            : assessment.assortmentStatus === 'multiple_variants'
              ? 'representative_assortment'
              : 'unverified')

        let uploadedOfferImageUrl: string | null = null
        let uploadedThumbImageUrl: string | null = null
        const stagedEvidenceCard = stagedEvidenceCardByKey.get(offer.batchOfferKey) || null
        const stagedEvidenceThumb = stagedEvidenceThumbByKey.get(offer.batchOfferKey) || null
        const stagedConsumerProduct = stagedConsumerProductByKey.get(offer.batchOfferKey) || null
        const stagedConsumerDisplay = stagedConsumerDisplayByKey.get(offer.batchOfferKey) || null

        if (stagedConsumerDisplay) {
          uploadedOfferImageUrl = validateConsumerPublicUrlOrThrow({
            publicUrl: stagedConsumerDisplay.publicUrl,
            bucket: stagedConsumerDisplay.bucket,
            expectedBucket: PUBLIC_OFFER_DISPLAY_IMAGES_BUCKET,
            context
          })
        } else if (!resolvedAdapter && enableImageUpload && uploadImageFn && offer.offerCardCropPath && fs.existsSync(offer.offerCardCropPath)) {
          try {
            const storagePath = buildOfferImageStoragePath({
              supermarketSlug: offer.supermarketName || offer.supermarketId || 'retailer',
              coverageScope: offer.locationScope || 'national',
              locationSlug: offer.locationLabel || 'national',
              leafletId: offer.leafletId || 'leaflet',
              itemNumber: sourceOfferId,
              extension: 'webp',
              imageType: 'offer_card'
            })
            const uploaded = await uploadImageFn({
              localImagePath: offer.offerCardCropPath,
              storageBucket,
              storagePath,
              contentType: 'image/webp'
            })
            uploadedOfferImageUrl = uploaded.imageUrl
          } catch {
            // Non-blocking in offline mock flows
          }
        }

        const safeForProductThumb =
          imageSubjectScope === 'product_package' &&
          Boolean(offer.productThumbCropPath && fs.existsSync(offer.productThumbCropPath))
        if (stagedConsumerProduct) {
          uploadedThumbImageUrl = validateConsumerPublicUrlOrThrow({
            publicUrl: stagedConsumerProduct.publicUrl,
            bucket: stagedConsumerProduct.bucket,
            expectedBucket: PUBLIC_PRODUCT_IMAGES_BUCKET,
            context
          })
        } else if (!resolvedAdapter && enableImageUpload && uploadImageFn && safeForProductThumb && offer.productThumbCropPath) {
          const fallbackConflict = checkImageFilePackageConflict(
            offer.productThumbCropPath,
            offer.each_size_value,
            offer.each_size_unit,
            offer.inner_pack_count
          )
          if (!fallbackConflict.blocked) {
            try {
              const thumbStoragePath = buildOfferImageStoragePath({
              supermarketSlug: offer.supermarketName || offer.supermarketId || 'retailer',
              coverageScope: offer.locationScope || 'national',
              locationSlug: offer.locationLabel || 'national',
              leafletId: offer.leafletId || 'leaflet',
              itemNumber: sourceOfferId,
              extension: 'webp',
              imageType: 'product_thumb'
            })
            const uploadedThumb = await uploadImageFn({
              localImagePath: offer.productThumbCropPath,
              storageBucket,
              storagePath: thumbStoragePath,
              contentType: 'image/webp'
            })
            uploadedThumbImageUrl = uploadedThumb.imageUrl
            } catch {
              // Non-blocking
            }
          }
        }

        const sourceDocumentId =
          offer.sourceDocumentId ||
          (offer.sourceFileFingerprint
            ? computeDocumentIdFromFingerprint(offer.sourceFileFingerprint, offer.sourceFileName)
            : null)

        const commonParams = [
          offer.supermarketId,
          offer.cityId ?? null,
          offer.regionId ?? null,
          targetProductId,
          offer.titleAr || null,
          offer.titleEn || null,
          offer.offerStartDate,
          offer.offerEndDate,
          Number(offer.promoPrice),
          offer.originalPrice ?? null,
          assessment.perUnitPricing.unitPrice,
          assessment.perUnitPricing.unitPriceUnit,
          offer.locationScope || 'national',
          sourceOfferId,
          offer.sourcePage ?? null,
          offer.sourceOfferId ?? null,
          offer.leafletId || offer.batchId || null,
          catalogMatchStatus,
          catalogVerificationBasis,
          catalogVerifiedBy,
          exactIdentityStatus,
          assessment.assortmentStatus,
          assessment.itemDomain,
          offer.sale_unit_type || 'piece',
          safeInnerPackCount,
          offer.each_size_value ?? null,
          offer.each_size_unit ?? null,
          offer.total_content_value ?? null,
          offer.total_content_unit ?? null,
          !isKgBasis,
          priceBasis,
          promoMechanic,
          offer.free_units_text || offer.promoNotes || null,
          loyaltyRequirement,
          isLoyaltyRequired,
          offer.customer_limit != null ? String(offer.customer_limit) : null,
          qtyLimitVal,
          imageSubjectScope,
          JSON.stringify(scopedAssessments),
          reasonCodes,
          uploadedOfferImageUrl,
          uploadedThumbImageUrl
        ]

        let savedOfferId: string | null = null

        if (existingOfferRes.rows.length > 0) {
          const existingRow = existingOfferRes.rows[0]
          if (!isCatalogLinked && existingRow.catalog_match_status === 'verified_linked' && existingRow.product_id != null) {
            savedOfferId = String(existingRow.id)
          } else {
            if (isCatalogLinked && existingRow.product_id == null) {
              upgradedFromNonCatalogCount++
            }
            const updateSql = hasJournalTables
              ? `UPDATE public.offers SET
                  supermarket_id = $2,
                  city_id = $3,
                  region_id = $4,
                  product_id = $5::bigint,
                  title_ar = $6,
                  title_en = $7,
                  offer_start_date = $8,
                  offer_end_date = $9,
                  offer_price = $10,
                  original_price = $11,
                  unit_price = $12,
                  unit_price_unit = $13,
                  status = 'published',
                  location_scope = $14,
                  source_offer_id = $15,
                  source_page_number = $16,
                  source_item_number = $17,
                  source_reference = $18,
                  catalog_match_status = $19,
                  catalog_verification_basis = $20,
                  catalog_verified_by = $21,
                  catalog_verified_at = CASE WHEN $5::bigint IS NOT NULL AND $19 = 'verified_linked' THEN COALESCE(catalog_verified_at, now()) ELSE NULL END,
                  exact_identity_status = $22,
                  assortment_status = $23,
                  item_domain = $24,
                  sale_unit_type = $25,
                  inner_pack_count = $26,
                  each_size_value = $27,
                  each_size_unit = $28,
                  total_content_value = $29,
                  total_content_unit = $30,
                  is_indivisible_sale_unit = $31,
                  price_basis = $32,
                  promo_mechanic = $33,
                  bonus_wording = $34,
                  loyalty_requirement = $35,
                  is_loyalty_required = $36,
                  quantity_limit = $37,
                  quantity_limit_value = $38,
                  image_url = COALESCE($42, image_url),
                  thumbnail_url = COALESCE($43, thumbnail_url),
                  image_subject_scope = $39,
                  scoped_assessments = $40::jsonb,
                  reason_codes = $41::text[],
                  source_document_id = COALESCE($44, source_document_id),
                  source_pdf_sha256 = COALESCE($45, source_pdf_sha256),
                  source_page_hash = COALESCE($46, source_page_hash),
                  source_offer_anchor = COALESCE($47, source_offer_anchor),
                  last_publish_operation_id = $48,
                  published_at = COALESCE(published_at, now()),
                  updated_at = now()
                WHERE id = $1
                RETURNING *`
              : `UPDATE public.offers SET
                  supermarket_id = $2,
                  city_id = $3,
                  region_id = $4,
                  product_id = $5::bigint,
                  title_ar = $6,
                  title_en = $7,
                  offer_start_date = $8,
                  offer_end_date = $9,
                  offer_price = $10,
                  original_price = $11,
                  unit_price = $12,
                  unit_price_unit = $13,
                  status = 'published',
                  location_scope = $14,
                  source_offer_id = $15,
                  source_page_number = $16,
                  source_item_number = $17,
                  source_reference = $18,
                  catalog_match_status = $19,
                  catalog_verification_basis = $20,
                  catalog_verified_by = $21,
                  catalog_verified_at = CASE WHEN $5::bigint IS NOT NULL AND $19 = 'verified_linked' THEN COALESCE(catalog_verified_at, now()) ELSE NULL END,
                  exact_identity_status = $22,
                  assortment_status = $23,
                  item_domain = $24,
                  sale_unit_type = $25,
                  inner_pack_count = $26,
                  each_size_value = $27,
                  each_size_unit = $28,
                  total_content_value = $29,
                  total_content_unit = $30,
                  is_indivisible_sale_unit = $31,
                  price_basis = $32,
                  promo_mechanic = $33,
                  bonus_wording = $34,
                  loyalty_requirement = $35,
                  is_loyalty_required = $36,
                  quantity_limit = $37,
                  quantity_limit_value = $38,
                  image_url = COALESCE($42, image_url),
                  thumbnail_url = COALESCE($43, thumbnail_url),
                  image_subject_scope = $39,
                  scoped_assessments = $40::jsonb,
                  reason_codes = $41::text[],
                  published_at = COALESCE(published_at, now()),
                  updated_at = now()
                WHERE id = $1
                RETURNING *`
            const updateParams = hasJournalTables
              ? [
                  existingRow.id,
                  ...commonParams,
                  sourceDocumentId,
                  offer.sourceFileFingerprint ?? null,
                  offer.sourcePageHash ?? null,
                  offer.sourceOfferAnchor ?? null,
                  publishOperationId
                ]
              : [existingRow.id, ...commonParams]

            const updateRes = await client.query(updateSql, updateParams)
            if (updateRes.rows.length > 0) {
              savedOfferId = String(updateRes.rows[0].id)
              updatedOffersCount++
              if (hasJournalTables && publishOperationId) {
                seqNo = await recordJournalMutation({
                  client,
                  publishOperationId,
                  sequenceNo: seqNo,
                  tableName: 'offers',
                  recordPk: savedOfferId,
                  mutationType: 'update',
                  preState: existingRow,
                  postState: updateRes.rows[0],
                  reusedExisting: false,
                  metadata: { batchOfferKey: offer.batchOfferKey, sourceOfferId }
                })
              }
            }
          }
        } else {
          const insertSql = hasJournalTables
            ? `INSERT INTO public.offers (
                supermarket_id, city_id, region_id, product_id,
                title_ar, title_en, offer_start_date, offer_end_date,
                offer_price, original_price, unit_price, unit_price_unit,
                status, location_scope, source_offer_id, source_page_number,
                source_item_number, source_reference, catalog_match_status,
                catalog_verification_basis, catalog_verified_by, catalog_verified_at,
                exact_identity_status, assortment_status, item_domain,
                sale_unit_type, inner_pack_count, each_size_value, each_size_unit,
                total_content_value, total_content_unit, is_indivisible_sale_unit,
                price_basis, promo_mechanic, bonus_wording, loyalty_requirement,
                is_loyalty_required, quantity_limit, quantity_limit_value,
                image_url, thumbnail_url, image_subject_scope,
                scoped_assessments, reason_codes,
                source_document_id, source_pdf_sha256, source_page_hash,
                source_offer_anchor, last_publish_operation_id,
                published_at, created_at, updated_at
              ) VALUES (
                $1, $2, $3, $4::bigint, $5, $6, $7, $8, $9, $10, $11, $12,
                'published', $13, $14, $15, $16, $17, $18, $19, $20,
                CASE WHEN $4::bigint IS NOT NULL AND $18 = 'verified_linked' THEN now() ELSE NULL END,
                $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
                $31, $32, $33, $34, $35, $36, $37,
                $41, $42,
                $38, $39::jsonb, $40::text[],
                $43, $44, $45, $46, $47,
                now(), now(), now()
              )
              RETURNING *`
            : `INSERT INTO public.offers (
                supermarket_id, city_id, region_id, product_id,
                title_ar, title_en, offer_start_date, offer_end_date,
                offer_price, original_price, unit_price, unit_price_unit,
                status, location_scope, source_offer_id, source_page_number,
                source_item_number, source_reference, catalog_match_status,
                catalog_verification_basis, catalog_verified_by, catalog_verified_at,
                exact_identity_status, assortment_status, item_domain,
                sale_unit_type, inner_pack_count, each_size_value, each_size_unit,
                total_content_value, total_content_unit, is_indivisible_sale_unit,
                price_basis, promo_mechanic, bonus_wording, loyalty_requirement,
                is_loyalty_required, quantity_limit, quantity_limit_value,
                image_url, thumbnail_url, image_subject_scope,
                scoped_assessments, reason_codes,
                published_at, created_at, updated_at
              ) VALUES (
                $1, $2, $3, $4::bigint, $5, $6, $7, $8, $9, $10, $11, $12,
                'published', $13, $14, $15, $16, $17, $18, $19, $20,
                CASE WHEN $4::bigint IS NOT NULL AND $18 = 'verified_linked' THEN now() ELSE NULL END,
                $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
                $31, $32, $33, $34, $35, $36, $37,
                $41, $42,
                $38, $39::jsonb, $40::text[],
                now(), now(), now()
              )
              RETURNING *`
          const insertParams = hasJournalTables
            ? [
                ...commonParams,
                sourceDocumentId,
                offer.sourceFileFingerprint ?? null,
                offer.sourcePageHash ?? null,
                offer.sourceOfferAnchor ?? null,
                publishOperationId
              ]
            : commonParams
          const insertRes = await client.query(insertSql, insertParams)
          if (insertRes.rows.length > 0) {
            savedOfferId = String(insertRes.rows[0].id)
            insertedOffersCount++
            if (hasJournalTables && publishOperationId) {
              seqNo = await recordJournalMutation({
                client,
                publishOperationId,
                sequenceNo: seqNo,
                tableName: 'offers',
                recordPk: savedOfferId,
                mutationType: 'insert',
                preState: null,
                postState: insertRes.rows[0],
                reusedExisting: false,
                metadata: { batchOfferKey: offer.batchOfferKey, sourceOfferId }
              })
            }
          }
        }

        // Record staged content-addressed storage operations (private evidence in `offer-images` + public consumer assets in `product-images` / `offer-display-images`)
        if (savedOfferId && hasJournalTables && publishOperationId) {
          const allStagedForOffer = [
            stagedEvidenceCard,
            stagedEvidenceThumb,
            stagedConsumerProduct,
            stagedConsumerDisplay
          ].filter((x): x is NonNullable<typeof x> => Boolean(x))

          for (const stagedObj of allStagedForOffer) {
            usedStorageBuckets.add(stagedObj.bucket)
            const storeKey = `${stagedObj.bucket}/${stagedObj.objectPath}`
            if (!recordedStorageKeys.has(storeKey)) {
              recordedStorageKeys.add(storeKey)
              if (stagedObj.ownershipMode === 'exclusive_created') {
                storageUploadedCount++
              } else {
                storageReusedCount++
              }
              await client.query(
                `INSERT INTO public.publication_storage_operations (
                  publish_operation_id, bucket, object_path, content_sha256,
                  ownership_mode, storage_state, linked_offer_id, linked_product_id
                ) VALUES ($1, $2, $3, $4, $5, 'committed', $6, $7)
                ON CONFLICT (publish_operation_id, bucket, object_path) DO NOTHING`,
                [
                  publishOperationId,
                  stagedObj.bucket,
                  stagedObj.objectPath,
                  stagedObj.contentSha256,
                  stagedObj.ownershipMode,
                  savedOfferId,
                  targetProductId ? Number(targetProductId) : null
                ]
              )
            }
          }

          // Consumer product image (`public.product_images`) -> STRICTLY `product-images` public bucket
          if (stagedConsumerProduct && targetProductId && isCatalogLinked) {
            const safeProductUrl = validateConsumerPublicUrlOrThrow({
              publicUrl: stagedConsumerProduct.publicUrl,
              bucket: stagedConsumerProduct.bucket,
              expectedBucket: PUBLIC_PRODUCT_IMAGES_BUCKET,
              context
            })
            const existingPrimaryPi = await client.query(
              `SELECT id FROM public.product_images WHERE product_id = $1 AND role = 'primary' AND approval_status = 'approved' LIMIT 1`,
              [Number(targetProductId)]
            )
            if (existingPrimaryPi.rows.length === 0) {
              const rightsBasis = offer.approvedConsumerImageRightsBasis || 'operator_manual_verified'
              const piRes = await client.query(
                `INSERT INTO public.product_images (
                  product_id, role, storage_bucket, storage_object_path, public_url,
                  mime_type, byte_size, content_sha256, source_url, normalized_source_url,
                  approval_status, rights_basis, reviewed_by
                ) VALUES ($1, 'primary', $2, $3, $4, $5, $6, $7, $4, $4, 'approved', $8, $9)
                ON CONFLICT DO NOTHING
                RETURNING *`,
                [
                  Number(targetProductId),
                  stagedConsumerProduct.bucket,
                  stagedConsumerProduct.objectPath,
                  safeProductUrl,
                  stagedConsumerProduct.contentType || 'image/webp',
                  stagedConsumerProduct.byteSize || 1024,
                  stagedConsumerProduct.contentSha256,
                  rightsBasis,
                  operatorId || 'operator'
                ]
              )
              if (piRes.rows.length > 0) {
                seqNo = await recordJournalMutation({
                  client,
                  publishOperationId,
                  sequenceNo: seqNo,
                  tableName: 'product_images',
                  recordPk: String(piRes.rows[0].id),
                  mutationType: 'insert',
                  preState: null,
                  postState: piRes.rows[0]
                })

                const prodPreRes = await client.query(
                  `SELECT * FROM public.products WHERE id = $1 LIMIT 1`,
                  [Number(targetProductId)]
                )
                if (prodPreRes.rows.length > 0 && !prodPreRes.rows[0].default_image_url) {
                  const prodPostRes = await client.query(
                    `UPDATE public.products SET default_image_url = $2 WHERE id = $1 RETURNING *`,
                    [Number(targetProductId), safeProductUrl]
                  )
                  if (prodPostRes.rows.length > 0) {
                    seqNo = await recordJournalMutation({
                      client,
                      publishOperationId,
                      sequenceNo: seqNo,
                      tableName: 'products',
                      recordPk: String(targetProductId),
                      mutationType: 'update',
                      preState: prodPreRes.rows[0],
                      postState: prodPostRes.rows[0]
                    })
                  }
                }
              }
            }
          }

          // Consumer offer display image (`public.offer_display_images`) -> STRICTLY `offer-display-images` public bucket
          if (stagedConsumerDisplay) {
            const safeDisplayUrl = validateConsumerPublicUrlOrThrow({
              publicUrl: stagedConsumerDisplay.publicUrl,
              bucket: stagedConsumerDisplay.bucket,
              expectedBucket: PUBLIC_OFFER_DISPLAY_IMAGES_BUCKET,
              context
            })
            const odiPreRes = await client.query(
              `SELECT * FROM public.offer_display_images WHERE offer_id = $1 AND approval_status = 'approved' LIMIT 1`,
              [savedOfferId]
            )
            if (odiPreRes.rows.length === 0) {
              const rightsBasis = (offer as any).approvedConsumerImageRightsBasis || 'operator_manual_verified'
              const rawSourceKind = (offer as any).approvedConsumerImageSourceKind || 'promotional_leaflet_crop'
              const sourceKind = await assertSupportedDisplayImageSourceKind(client, rawSourceKind, supportedSourceKindCache)
              const odiRes = await client.query(
                `INSERT INTO public.offer_display_images (
                  offer_id, storage_bucket, storage_object_path, public_url,
                  mime_type, byte_size, content_sha256, source_kind, visual_subject_key,
                  approval_status, rights_basis, reviewed_by
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'approved', $10, $11)
                RETURNING *`,
                [
                  savedOfferId,
                  stagedConsumerDisplay.bucket,
                  stagedConsumerDisplay.objectPath,
                  safeDisplayUrl,
                  stagedConsumerDisplay.contentType || 'image/webp',
                  stagedConsumerDisplay.byteSize || 1024,
                  stagedConsumerDisplay.contentSha256,
                  sourceKind,
                  sourceOfferId,
                  rightsBasis,
                  operatorId || 'operator'
                ]
              )
              if (odiRes.rows.length > 0) {
                seqNo = await recordJournalMutation({
                  client,
                  publishOperationId,
                  sequenceNo: seqNo,
                  tableName: 'offer_display_images',
                  recordPk: String(odiRes.rows[0].id),
                  mutationType: 'insert',
                  preState: null,
                  postState: odiRes.rows[0]
                })
              }
            }
          }
        }

        if (savedOfferId) {
          publishedOfferIds.push(savedOfferId)
          publishedBatchOfferKeys.push(offer.batchOfferKey)
          sourceOfferIdByKey[offer.batchOfferKey] = sourceOfferId
          publishedOfferIdByKey[offer.batchOfferKey] = savedOfferId
          productIdByKey[offer.batchOfferKey] = targetProductId
          if (!isCatalogLinked) {
            publishedNonCatalogOffersCount++
          }
        }
      }

      const isNoopOperation =
        insertedOffersCount === 0 &&
        updatedOffersCount === 0 &&
        newlyCreatedProductIds.size === 0

      if (hasJournalTables && publishOperationId) {
        await client.query(
          `UPDATE public.publication_operations
           SET status = $2,
               inserted_offers_count = $3,
               updated_offers_count = $4,
               unchanged_noop_count = $5,
               skipped_duplicates_count = $6,
               conflicts_count = $7,
               created_products_count = $8,
               reused_products_count = $9,
               storage_objects_uploaded = $10,
               storage_objects_reused = $11,
               storage_summary = $12::jsonb,
               undo_eligible = $13,
               completed_at = now(),
               updated_at = now()
           WHERE publish_operation_id = $1`,
          [
            publishOperationId,
            isNoopOperation ? 'noop' : 'completed',
            insertedOffersCount,
            updatedOffersCount,
            unchangedNoopCount,
            skippedDuplicatesCount,
            conflictsCount,
            newlyCreatedProductIds.size,
            reusedProductsCount,
            storageUploadedCount,
            storageReusedCount,
            JSON.stringify({
              uploaded: storageUploadedCount,
              reused: storageReusedCount,
              bucket: Array.from(usedStorageBuckets)[0] || evidenceBucket,
              buckets: Array.from(usedStorageBuckets)
            }),
            !isNoopOperation
          ]
        )
      }

      await client.query('COMMIT')

      return {
        success: true,
        databaseContext: context,
        publishOperationId,
        idempotencyKey: effectiveIdempotencyKey,
        idempotentReplay: false,
        noop: isNoopOperation,
        createdProductsCount: newlyCreatedProductIds.size,
        reusedProductsCount,
        publishedOffersCount: publishedOfferIds.length,
        insertedOffersCount,
        updatedOffersCount,
        unchangedNoopCount,
        skippedDuplicatesCount,
        conflictsCount,
        publishedNonCatalogOffersCount,
        upgradedFromNonCatalogCount,
        quarantinedOffersCount,
        skippedUnapprovedNonCatalogCount,
        createdProductMap,
        publishedOfferIds,
        publishedBatchOfferKeys,
        deferredBatchOfferKeys: Array.from(deferredOfferKeySet),
        alreadyPublishedBatchOfferKeys: Array.from(alreadyPublishedKeySet),
        sourceOfferIdByKey,
        publishedOfferIdByKey,
        productIdByKey,
        storageSummary: {
          uploaded: storageUploadedCount,
          reused: storageReusedCount,
          bucket: Array.from(usedStorageBuckets)[0] || evidenceBucket,
          buckets: Array.from(usedStorageBuckets)
        }
      }
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {})
      // Cleanup any newly uploaded uncommitted exclusive objects so rollback leaves zero orphan storage blobs
      if (resolvedAdapter && exclusiveStagedForRollback.length > 0) {
        const grouped = new Map<string, string[]>()
        for (const item of exclusiveStagedForRollback) {
          const arr = grouped.get(item.bucket) || []
          arr.push(item.objectPath)
          grouped.set(item.bucket, arr)
        }
        for (const [bkt, paths] of grouped.entries()) {
          await resolvedAdapter.deleteObjects(bkt, paths).catch(() => {})
        }
      }
      throw new Error(`[CatalogPublicationService] Transaction rolled back due to error: ${err.message}`)
    } finally {
      if (ownedClient) {
        await ownedClient.end().catch(() => {})
      }
    }
  }
}
