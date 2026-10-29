import {
  PreparedOfferPayload,
  OfferPreparationIssue
} from '../../shared/types/offerPayload'
import {
  calculateDiscountAmount,
  calculateDiscountPercentage,
  calculateUnitPrice,
  calculateDataQualityScore
} from '../../shared/utils/offerCalculations'
import { validateCanPublishOffer } from '../../shared/utils/publishValidation'

export function buildPreparedOfferPayload(input: {
  normalizedData: any
  supermarketId: string
  locationScope: 'national' | 'region' | 'city'
  cityId: string | null
  regionId: string | null
  sourceId: string | null
  leafletId?: string | null
  offerStartDate: string
  offerEndDate: string
  defaultOfferStatus: 'draft' | 'needs_review' | 'published'
  importDefaultStatus: 'published' | 'needs_review'
  allowNeedsReviewFallback: boolean
  publishWarningsAllowed: boolean
  dataQualityNeedsReviewThreshold: number
  requireImageForDraft: boolean
}): {
  payload: PreparedOfferPayload | null
  issues: OfferPreparationIssue[]
} {
  const issues: OfferPreparationIssue[] = []
  
  const { normalizedData } = input
  const offer = normalizedData.offer || normalizedData.original || {}
  const matched = normalizedData.matched || {}
  
  // Extract fields
  const titleAr = offer.title_ar || offer.product_name_ar || null
  const titleEn = offer.title_en || offer.product_name_en || null
  const offerPrice = offer.offer_price ? Number(offer.offer_price) : null
  const originalPrice = offer.original_price ? Number(offer.original_price) : null
  
  const sourcePageNumber = normalizedData.source?.page_number || 1
  const sourceReference = normalizedData.source?.row_id || null
  const sourceItemNumber = normalizedData.source_item_number || null

  // Required Field Validations (Blocking)
  if (!input.supermarketId) {
    issues.push({ severity: 'error', code: 'MISSING_SUPERMARKET_ID', message: 'Supermarket ID is required.' })
  }
  if (!input.cityId && !input.regionId) {
    issues.push({ severity: 'error', code: 'MISSING_LOCATION', message: 'Either City or Region is required.' })
  }
  if (!titleAr && !titleEn) {
    issues.push({ severity: 'error', code: 'MISSING_TITLE', message: 'At least one title (AR or EN) is required.' })
  } else {
    const combinedTitle = `${titleAr || ''} ${titleEn || ''}`.toLowerCase().trim()
    const isIsolatedPromoText = combinedTitle === 'or' || combinedTitle === 'أو' || combinedTitle.includes('selected branches') || combinedTitle.includes('فروع محددة') || combinedTitle.match(/^(\d+[\+\-x\*]\d+)$/)
    if (isIsolatedPromoText) {
      issues.push({ severity: 'error', code: 'PRODUCT_BLOCK_ASSOCIATION_UNCERTAIN', message: 'Title appears to be an isolated leaflet fragment (e.g. Or/Branch Note/Badge)' })
    }
  }
  if (offerPrice === null || offerPrice <= 0 || isNaN(offerPrice)) {
    issues.push({ severity: 'error', code: 'MISSING_VALID_OFFER_PRICE', message: 'Offer price must be greater than 0.' })
  }
  if (!input.offerEndDate) {
    issues.push({ severity: 'error', code: 'MISSING_OFFER_END_DATE', message: 'Offer end date is required.' })
  }

  // Calculate Math
  let discountAmount: number | null = null
  let discountPercentage: number | null = null
  if (offerPrice !== null && originalPrice !== null) {
    if (originalPrice < offerPrice) {
      issues.push({ severity: 'warning', code: 'INVALID_ORIGINAL_PRICE', message: 'Original price is lower than offer price.' })
    } else {
      discountAmount = calculateDiscountAmount(offerPrice, originalPrice)
      discountPercentage = calculateDiscountPercentage(offerPrice, originalPrice)
    }
  }

  const packSizeValue = offer.pack_size_value ? Number(offer.pack_size_value) : null
  const packSizeUnit = offer.pack_size_unit || null
  const packQuantity = offer.pack_quantity ? Number(offer.pack_quantity) : null
  
  const unitPrice = calculateUnitPrice({ offerPrice, packSizeValue, packQuantity })
  const unitPriceUnit = unitPrice !== null ? packSizeUnit : null

  // Evaluate images (crop or already uploaded)
  // MVP: we haven't uploaded images to Supabase yet, so imageUrl is going to be null or a local placeholder if available
  // The system says: "Do not upload cropped images to Supabase Storage yet."
  // The system says: "If image is missing and REQUIRE_IMAGE_FOR_DRAFT = false: status = needs_review"
  // The system says: "If image is missing and REQUIRE_IMAGE_FOR_DRAFT = true: return error or block payload"
  const localImageAvailable = !!normalizedData.image?.localImagePath

  if (!localImageAvailable) {
    if (input.requireImageForDraft) {
      issues.push({ severity: 'error', code: 'OFFER_IMAGE_MISSING', message: 'Offer image is missing and required for draft.' })
    } else {
      issues.push({ severity: 'warning', code: 'OFFER_IMAGE_MISSING', message: 'Offer image is missing.' })
    }
  }

  // Calculate Data Quality
  const dataQualityScore = calculateDataQualityScore({
    hasTitle: !!(titleAr || titleEn),
    hasValidOfferPrice: offerPrice !== null && offerPrice > 0,
    hasValidOriginalPrice: originalPrice !== null && originalPrice >= (offerPrice || 0),
    hasBrand: !!matched.brand_id,
    hasCategory: !!matched.category_id,
    hasProduct: !!matched.product_id,
    hasValidPackData: !!packSizeValue || !!packQuantity,
    hasImage: localImageAvailable,
    confidenceAcceptable: true, // We assume acceptable if not skipped
    hasWarnings: issues.some(i => i.severity === 'warning'),
    hasErrors: issues.some(i => i.severity === 'error')
  })

  // Run Publishing Validation
  const pubVal = validateCanPublishOffer({
    supermarketId: input.supermarketId,
    locationScope: input.locationScope,
    cityId: input.cityId,
    regionId: input.regionId,
    offerStartDate: input.offerStartDate,
    offerEndDate: input.offerEndDate,
    titleAr,
    titleEn,
    offerPrice,
    imagePath: null, // MVP: image is uploaded later
    rowStatus: 'valid', // Assuming valid if no blocking parsing errors
    skipReason: matched.skip_reason || offer.skip_reason || null
  })

  // Append new issues from publishing validation
  for (const err of pubVal.blockingErrors) {
    if (!issues.some(i => i.code === err.code)) {
      issues.push({ severity: 'error', code: err.code, fieldName: err.fieldName, message: err.message })
    }
  }

  // Pull in any blocking errors or warnings from the Canonical Offer Quality metadata (if present)
  // This ensures deterministic check results from earlier pipeline stages are strictly enforced.
  const canonicalQuality = normalizedData.canonical?.quality || normalizedData.quality
  if (canonicalQuality) {
    if (Array.isArray(canonicalQuality.blocking_errors)) {
      for (const err of canonicalQuality.blocking_errors) {
        if (!issues.some(i => i.code === err.code)) {
          issues.push({ severity: 'error', code: err.code, message: err.message })
        }
      }
    }
    if (Array.isArray(canonicalQuality.non_blocking_warnings)) {
      for (const warn of canonicalQuality.non_blocking_warnings) {
        if (!issues.some(i => i.code === warn.code)) {
          issues.push({ severity: 'warning', code: warn.code, message: warn.message })
        }
      }
    }
    if (canonicalQuality.publish_decision === 'skip_or_quarantine') {
      issues.push({ severity: 'error', code: 'PUBLISH_DECISION_SKIP_OR_QUARANTINE', message: 'Publish decision from extraction pipeline is skip_or_quarantine.' })
    }
  }

  // If there are blocking errors, we do not return a payload
  if (issues.some(i => i.severity === 'error')) {
    return { payload: null, issues }
  }

  // Evaluate Status
  let status: 'draft' | 'needs_review' | 'published' = input.importDefaultStatus || 'published'

  if (status === 'published') {
    if (!pubVal.canPublish) {
      if (input.allowNeedsReviewFallback) {
        status = 'needs_review'
      } else {
        // Technically this shouldn't happen because blockingErrors already returned null above
        // But if there's some other reason canPublish is false, we error out
        return { payload: null, issues }
      }
    } else {
      // It can publish, but what about warnings?
      const hasWarnings = issues.some(i => i.severity === 'warning')
      if (hasWarnings && !input.publishWarningsAllowed) {
        if (input.allowNeedsReviewFallback) {
          status = 'needs_review'
        } else {
          return { payload: null, issues }
        }
      }
    }
  } else if (status === 'needs_review') {
    // If they explicitly wanted needs_review, it just stays needs_review
  } else {
    // fallback to draft if somehow selected
    status = 'draft'
  }

  const payload: PreparedOfferPayload = {
    product_id: matched.product_id || null,
    supermarket_id: input.supermarketId,
    location_scope: input.locationScope,
    city_id: input.cityId,
    region_id: input.regionId,
    category_id: matched.category_id || null,
    brand_id: matched.brand_id || null,

    title_ar: titleAr,
    title_en: titleEn,

    offer_price: offerPrice!,
    original_price: originalPrice,
    discount_amount: discountAmount,
    discount_percentage: discountPercentage,

    pack_size_value: packSizeValue,
    pack_size_unit: packSizeUnit,
    pack_quantity: packQuantity,
    unit_price: unitPrice,
    unit_price_unit: unitPriceUnit,

    offer_start_date: input.offerStartDate,
    offer_end_date: input.offerEndDate,
    status,

    image_url: null, // No uploaded image yet per rules
    image_path: null,
    image_bucket: null,
    image_source_type: 'external_tool',
    source_id: input.sourceId,
    source_page_number: sourcePageNumber,
    source_item_number: sourceItemNumber,
    source_reference: sourceReference,
    external_image_id: input.leafletId && sourceItemNumber ? `${input.leafletId}-${sourceItemNumber}` : null,
    offer_source_id: input.sourceId,

    deal_score: offer.deal_score ? Number(offer.deal_score) : null,
    deal_label: offer.deal_label || null,
    data_quality_score: dataQualityScore,

    is_loyalty_required: offer.is_loyalty_required || false,
    loyalty_notes_ar: offer.loyalty_notes_ar || null,
    loyalty_notes_en: offer.loyalty_notes_en || null,

    quantity_limit: offer.quantity_limit || null,
    notes_ar: offer.notes_ar || null,
    notes_en: offer.notes_en || null
  }

  return { payload, issues }
}
