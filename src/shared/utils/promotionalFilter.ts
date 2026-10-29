import type { OcrExtractedItem } from '../types/ocr'
import { VALIDATION_CODES } from '../schemas/validationCodes'

export type PromotionalFilterDecision = {
  isNonProductPromotionalArea: boolean
  confidence: 'high' | 'medium' | 'low'
  reasonCode: string | null
  reasons: string[]
}

function normalizeText(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    // Convert Arabic numerals to Western digits for easier matching
    .replace(/[٠-٩]/g, d => '0123456789'['٠١٢٣٤٥٦٧٨٩'.indexOf(d)])
}

const PROMO_KEYWORDS_AR = [
  'عروض', 'توفير', 'وفر', 'عيد', 'العيد', 'تزين عيدك', 'هنا التوفير', 'تسوق',
  'مهرجان', 'احتفال', 'خصومات', 'تخفيضات', 'عرض خاص', 'برعاية'
]

const PROMO_KEYWORDS_EN = [
  'offers', 'savings', 'save', 'festival', 'eid', 'special offer', 'promotion',
  'promo', 'deal', 'deals', 'valid from', 'valid until', 'sponsored by'
]

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
  'يناير', 'فبراير', 'مارس', 'ابريل', 'مايو', 'يونيو', 'يوليو', 'اغسطس', 'سبتمبر', 'اكتوبر', 'نوفمبر', 'ديسمبر'
]

export function classifyPromotionalArea(item: OcrExtractedItem): PromotionalFilterDecision {
  const combinedTextRaw = [
    item.product_name_ar, item.product_name_en, item.description_ar, item.description_en,
    item.discount_text, item.notes_ar, item.notes_en, item.brand_name_ar, item.brand_name_en
  ].filter(Boolean).join(' ')
  
  const combinedText = normalizeText(combinedTextRaw)

  let isDateBadgeOnly = false
  let isLogoOrSponsorOnly = false
  let isCampaignSloganOnly = false
  let isGenericDiscountOnly = false

  const reasons: string[] = []

  // Check 1: Date Badge Only
  // Heuristic: Has a month name, a dash or 'until' / 'from', numbers, but very short text overall
  const hasMonth = MONTHS.some(m => combinedText.includes(m))
  const isShortText = combinedText.length < 50
  if (hasMonth && isShortText && (combinedText.includes('-') || combinedText.includes('to') || combinedText.includes('until') || combinedText.includes('من') || combinedText.includes('الى'))) {
    // Looks like "May 27 - June 02"
    if (!item.offer_price && !item.pack_size_value) {
      isDateBadgeOnly = true
      reasons.push('Contains only date/validity information without product specifics')
    }
  }

  // Check 2: Logo / Sponsor Only
  if (isShortText && (combinedText.includes('sponsored by') || combinedText.includes('برعاية'))) {
    if (!item.offer_price && !item.pack_size_value && !item.product_name_ar && !item.product_name_en) {
      isLogoOrSponsorOnly = true
      reasons.push('Contains only sponsor or logo information')
    }
  }

  // Check 3: Campaign Slogans without Product
  const hasPromoKeywords = PROMO_KEYWORDS_AR.some(kw => combinedText.includes(kw)) || PROMO_KEYWORDS_EN.some(kw => combinedText.includes(kw))
  
  // A real product name shouldn't just be "عروض" or "offers"
  const isJustPromoAr = item.product_name_ar ? PROMO_KEYWORDS_AR.some(kw => item.product_name_ar!.includes(kw) && item.product_name_ar!.length <= kw.length + 5) : false
  const isJustPromoEn = item.product_name_en ? PROMO_KEYWORDS_EN.some(kw => item.product_name_en!.toLowerCase().includes(kw) && item.product_name_en!.length <= kw.length + 5) : false

  const hasProductEvidence = Boolean(
    (item.pack_size_value !== null && Number(item.pack_size_value) > 0) ||
    (item.product_name_ar && !isJustPromoAr) ||
    (item.product_name_en && !isJustPromoEn) ||
    (item.offer_price !== null && Number(item.offer_price) > 0 && Number(item.offer_price) !== 1)
  )

  if (hasPromoKeywords && !hasProductEvidence) {
    // If it's a generic 1+1
    if (combinedText.includes('1+1') || combinedText.includes('2+1') || combinedText.includes('2+2') || combinedText.includes('مجانا')) {
      isGenericDiscountOnly = true
      reasons.push('Contains generic discount text (e.g. 1+1) but no product specifics')
    } else {
      isCampaignSloganOnly = true
      reasons.push('Contains campaign slogans without specific product evidence')
    }
  }

  // Check 4: Isolated Price without Product
  const isPriceOnly = (item.offer_price || item.original_price) && !item.product_name_ar && !item.product_name_en && !item.pack_size_value
  if (isPriceOnly) {
    reasons.push('Isolated price without product context')
    return { isNonProductPromotionalArea: true, confidence: 'high', reasonCode: VALIDATION_CODES.ISOLATED_PRICE_WITHOUT_PRODUCT, reasons }
  }

  // Check 5: SKU / Item Code Only
  const isSKUOnly = (item as any).source_reference && !item.offer_price && !item.product_name_ar && !item.product_name_en
  if (isSKUOnly && !hasProductEvidence) {
    reasons.push('Isolated SKU/item code')
    return { isNonProductPromotionalArea: true, confidence: 'high', reasonCode: VALIDATION_CODES.SKU_ONLY_ROW, reasons }
  }

  // Check 6: Branch / Unit Notes Only
  const hasBranchNoteOnly = (combinedText.includes('selected branches') || combinedText.includes('فروع محددة') || combinedText.includes('per kg') || combinedText.includes('للكيلو'))
  if (hasBranchNoteOnly && !item.offer_price && !item.product_name_ar && !item.product_name_en && !hasProductEvidence) {
    reasons.push('Isolated branch or unit note')
    return { isNonProductPromotionalArea: true, confidence: 'high', reasonCode: VALIDATION_CODES.BRANCH_NOTE_ONLY_ROW, reasons }
  }

  // Check 7: No Product Name or Price
  const hasNoProductData = !item.product_name_ar && !item.product_name_en && !item.offer_price && !item.original_price
  if (hasNoProductData && !isDateBadgeOnly && !isLogoOrSponsorOnly && !isCampaignSloganOnly && !isGenericDiscountOnly) {
    reasons.push('Row lacks product name and pricing completely')
    // We treat this as a likely promo/banner
    return {
      isNonProductPromotionalArea: true,
      confidence: 'medium',
      reasonCode: VALIDATION_CODES.PROMO_NO_PRODUCT_NAME_OR_PRICE,
      reasons
    }
  }

  // Check 8: Bounding Box
  let isBannerLike = false
  if (item.bounding_box) {
    const bb = item.bounding_box
    if (bb.width > 0 && bb.height > 0) {
      const ratio = bb.width / bb.height
      if (ratio > 4 && !hasProductEvidence) {
        isBannerLike = true
        reasons.push('Bounding box dimensions resemble a wide banner')
      }
    }
  }

  // Decisions
  if (isDateBadgeOnly) return { isNonProductPromotionalArea: true, confidence: 'high', reasonCode: VALIDATION_CODES.PROMO_DATE_BADGE_ONLY, reasons }
  if (isLogoOrSponsorOnly) return { isNonProductPromotionalArea: true, confidence: 'high', reasonCode: VALIDATION_CODES.PROMO_LOGO_OR_SPONSOR_ONLY, reasons }
  if (isGenericDiscountOnly) return { isNonProductPromotionalArea: true, confidence: 'high', reasonCode: VALIDATION_CODES.PROMO_GENERIC_DISCOUNT_ONLY, reasons }
  if (isCampaignSloganOnly) return { isNonProductPromotionalArea: true, confidence: 'high', reasonCode: VALIDATION_CODES.PROMO_CAMPAIGN_SLOGAN_ONLY, reasons }
  if (isBannerLike) return { isNonProductPromotionalArea: true, confidence: 'medium', reasonCode: VALIDATION_CODES.PROMO_BANNER_LIKE_BOUNDING_BOX, reasons }

  // If there are some promo keywords and a very small price (like 1) but no pack size, maybe it's a weird banner
  if (hasPromoKeywords && item.offer_price === 1 && !item.pack_size_value) {
    reasons.push('Ambiguous promo text with dummy price 1')
    return {
      isNonProductPromotionalArea: false,
      confidence: 'low',
      reasonCode: VALIDATION_CODES.POSSIBLE_NON_PRODUCT_PROMOTIONAL_AREA,
      reasons
    }
  }

  return {
    isNonProductPromotionalArea: false,
    confidence: 'high',
    reasonCode: null,
    reasons: []
  }
}

export function isLikelyNonProductPromotionalArea(item: OcrExtractedItem): boolean {
  return classifyPromotionalArea(item).isNonProductPromotionalArea
}

export function getPromotionalAreaReason(item: OcrExtractedItem): string | null {
  const decision = classifyPromotionalArea(item)
  return decision.isNonProductPromotionalArea ? decision.reasonCode : null
}
