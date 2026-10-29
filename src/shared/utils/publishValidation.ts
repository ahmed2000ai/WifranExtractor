
export type PublishValidationInput = {
  supermarketId: string | null
  locationScope: 'national' | 'region' | 'city' | null
  cityId: string | null
  regionId: string | null
  offerStartDate: string | null
  offerEndDate: string | null
  titleAr: string | null
  titleEn: string | null
  offerPrice: number | null
  imagePath?: string | null
  imageUrl?: string | null
  storagePath?: string | null
  rowStatus?: string | null
  skipReason?: string | null
  duplicateOfferId?: string | null
}

export function validateCanPublishOffer(input: PublishValidationInput): {
  canPublish: boolean
  blockingErrors: Array<{
    code: string
    fieldName?: string | null
    message: string
  }>
  warnings: Array<{
    code: string
    fieldName?: string | null
    message: string
  }>
} {
  const blockingErrors: Array<{ code: string; fieldName?: string | null; message: string }> = []
  const warnings: Array<{ code: string; fieldName?: string | null; message: string }> = []

  // Skip checks
  if (input.rowStatus === 'skipped' || input.rowStatus === 'duplicate') {
    blockingErrors.push({ code: 'DUPLICATE_OFFER_DETECTED', message: 'Row is skipped or duplicate.' })
  }
  
  if (input.skipReason === 'NON_PRODUCT_PROMOTIONAL_AREA') {
    blockingErrors.push({ code: 'NON_PRODUCT_PROMOTIONAL_AREA', message: 'Row is a promotional area.' })
  }

  // Supermarket
  if (!input.supermarketId) {
    blockingErrors.push({ code: 'UNRESOLVED_SUPERMARKET', fieldName: 'supermarketId', message: 'Supermarket ID is missing.' })
  }

  // Location Scope
  if (!input.locationScope || !['national', 'region', 'city'].includes(input.locationScope)) {
    blockingErrors.push({ code: 'INVALID_LOCATION_SCOPE', fieldName: 'locationScope', message: 'Location scope must be national, region, or city.' })
  } else {
    if (input.locationScope === 'national') {
      if (input.cityId || input.regionId) {
        blockingErrors.push({ code: 'INVALID_LOCATION_SCOPE_COMBINATION', fieldName: 'locationScope', message: 'National scope should not have city or region.' })
      }
    } else if (input.locationScope === 'region') {
      if (!input.regionId) {
        blockingErrors.push({ code: 'REGION_REQUIRED_FOR_REGION_SCOPE', fieldName: 'regionId', message: 'Region scope requires a region ID.' })
      }
      if (input.cityId) {
        blockingErrors.push({ code: 'INVALID_LOCATION_SCOPE_COMBINATION', fieldName: 'cityId', message: 'Region scope should not have a city ID.' })
      }
    } else if (input.locationScope === 'city') {
      if (!input.cityId) {
        blockingErrors.push({ code: 'CITY_REQUIRED_FOR_CITY_SCOPE', fieldName: 'cityId', message: 'City scope requires a city ID.' })
      }
    }
  }

  // Dates
  if (!input.offerEndDate) {
    blockingErrors.push({ code: 'INVALID_OFFER_END_DATE', fieldName: 'offerEndDate', message: 'Offer end date is required.' })
  } else {
    const endDate = new Date(input.offerEndDate)
    if (isNaN(endDate.getTime())) {
      blockingErrors.push({ code: 'INVALID_OFFER_END_DATE', fieldName: 'offerEndDate', message: 'Offer end date is invalid.' })
    } else {
      // Check if expired
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      if (endDate < today) {
        blockingErrors.push({ code: 'EXPIRED_OFFER_END_DATE', fieldName: 'offerEndDate', message: 'Offer end date has expired.' })
      }
    }
  }

  if (input.offerStartDate) {
    const startDate = new Date(input.offerStartDate)
    if (isNaN(startDate.getTime())) {
      blockingErrors.push({ code: 'INVALID_OFFER_START_DATE', fieldName: 'offerStartDate', message: 'Offer start date is invalid.' })
    }
  }

  // Price
  if (input.offerPrice === null || input.offerPrice <= 0 || isNaN(input.offerPrice)) {
    blockingErrors.push({ code: 'MISSING_VALID_OFFER_PRICE', fieldName: 'offerPrice', message: 'Offer price must be greater than 0.' })
  }

  // Title
  if (!input.titleAr && !input.titleEn) {
    blockingErrors.push({ code: 'MISSING_TITLE', fieldName: 'title', message: 'Offer must have a title (Arabic or English).' })
  } else {
    const combinedTitle = `${input.titleAr || ''} ${input.titleEn || ''}`.toLowerCase().trim()
    const isIsolatedPromoText = combinedTitle === 'or' || combinedTitle === 'أو' || combinedTitle.includes('selected branches') || combinedTitle.includes('فروع محددة') || combinedTitle.match(/^(\d+[\+\-x\*]\d+)$/)
    if (isIsolatedPromoText) {
      blockingErrors.push({ code: 'ISOLATED_PRICE_WITHOUT_PRODUCT', fieldName: 'title', message: 'Title appears to be an isolated leaflet fragment.' })
    }
  }

  const canPublish = blockingErrors.length === 0

  return {
    canPublish,
    blockingErrors,
    warnings
  }
}
