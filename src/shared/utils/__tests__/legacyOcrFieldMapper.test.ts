import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeToCanonicalOffer } from '../canonicalOfferNormalizer'
import { extractLegacyQuantityAndSize } from '../legacyOcrFieldMapper'
import { BrandGroupingService } from '../../../main/db/brandGroupingService'
import { TemporaryProductRegistry } from '../../../main/db/temporaryProductRegistry'
import {
  evaluateIdentitySufficiency,
  resolveQuantityAndPromoSemantics
} from '../../../main/db/productIdentityPolicy'
import type { UnifiedBatchOffer } from '../../types/batchExtraction'

function toUnifiedOfferFromLegacy(
  id: string,
  rawJson: Record<string, unknown>,
  extra?: Partial<UnifiedBatchOffer>
): UnifiedBatchOffer {
  const canonical = normalizeToCanonicalOffer({
    rawOcrJson: rawJson,
    source: { sourceItemNumber: id }
  })
  const rawAttrs = (canonical.raw?.raw_attributes || {}) as Record<string, any>

  return {
    batchOfferKey: `test:${id}`,
    batchId: 'test_legacy',
    leafletId: 'Othaim_week24',
    sourceFileName: `${id}.json`,
    sourcePdfPath: '',
    sourcePage: 1,
    sourceOfferId: id,
    canonicalSourceId: id,
    supermarketId: 'othaim',
    supermarketName: 'Al-Othaim',
    locationScope: 'national',
    locationLabel: null,
    cityId: null,
    regionId: null,
    offerStartDate: '2026-11-01',
    offerEndDate: '2026-11-30',
    titleAr: canonical.product.title_ar || '',
    titleEn: canonical.product.title_en || '',
    brand: canonical.product.brand_text,
    brandAr: null,
    brandEn: canonical.product.brand_text,
    variantOrFlavor: rawAttrs.variant || rawAttrs.flavor || null,
    promoPrice: canonical.prices.offer_price,
    originalPrice: canonical.prices.original_price,
    discountPercent: canonical.prices.discount_percentage,
    promoNotes: canonical.promotion.condition_text || canonical.promotion.special_offer,
    sizeOrWeight: canonical.content.size_text,
    each_size_value: canonical.content.each_size_value,
    each_size_unit: canonical.content.each_size_unit,
    inner_pack_count: canonical.content.pack_quantity,
    sale_unit_type: (canonical.content as any).sale_unit_type || null,
    total_content_value: canonical.content.total_content_value,
    total_content_unit: canonical.content.total_content_unit,
    free_units_text: null,
    customer_limit: null,
    productThumbCropPath: null,
    offerCardCropPath: null,
    status: 'extracted',
    confidence: 'medium',
    canonical: canonical as any,
    ...extra
  }
}

describe('legacyOcrFieldMapper - Legacy Quantity & Unit Mapping Correction (WP2 §1)', () => {
  it('maps size + size_unit ("1" + "L") separately from counting unit ("PCS") on othaim-week24_002_004 without fabricating 4x1L', () => {
    const rawPath = join(
      process.cwd(),
      'Extracts',
      'Othaim_week24',
      'json',
      'page-002',
      'othaim-week24_002_004.json'
    )
    const raw = JSON.parse(readFileSync(rawPath, 'utf8'))

    const qty = extractLegacyQuantityAndSize(raw)
    expect(qty.each_size_value).toBe(1)
    expect(qty.each_size_unit).toBe('l')
    expect(qty.size_text).toBe('1L')
    expect(qty.pack_quantity).toBe(4)
    expect(qty.sale_unit_raw).toBe('PCS')
    expect(qty.sale_unit_type).toBe('piece')

    const offer = toUnifiedOfferFromLegacy('othaim-week24_002_004', raw)
    expect(offer.titleEn).toBe('Coca Cola')
    expect(offer.titleAr).toBe('كوكا كولا بلاستيك')
    expect(offer.variantOrFlavor).toBe('Original Taste')
    expect(offer.each_size_value).toBe(1)
    expect(offer.each_size_unit).toBe('l')
    expect(offer.sale_unit_type).toBe('piece')

    // Because pack_quantity=4 with unit="PCS" lacks explicit "4x1L" multipack text or promo text,
    // packaging semantics remain safely ambiguous instead of guessing a 4x1L SKU!
    const pkg = resolveQuantityAndPromoSemantics(offer)
    expect(pkg.packagingSemantics).toBe('ambiguous')

    const grouping = new BrandGroupingService()
    const suf = evaluateIdentitySufficiency(grouping.extractNormalizedAttributes(offer), offer)
    expect(suf.isSufficient).toBe(false)
    expect(suf.codes).toContain('PACKAGING_SEMANTICS_AMBIGUOUS')
    expect(suf.codes).not.toContain('MISSING_UNIT_SIZE')
  })

  it('recognizes 4 x 1L as manufacturer multipack ONLY when extracted evidence explicitly states 4x1L', () => {
    const rawWithMultipackText = {
      arabic_product_name: 'مشروب غازي 4×1 لتر',
      english_product_name: 'Soda Drink 4x1L',
      brand: 'TestBrand',
      pack_quantity: 4,
      unit: 'PCS',
      size: '1',
      size_unit: 'L',
      offer_price: 15
    }
    const offer = toUnifiedOfferFromLegacy('explicit_4x1l', rawWithMultipackText)
    const pkg = resolveQuantityAndPromoSemantics(offer)
    expect(pkg.packagingSemantics).toBe('manufacturer_multipack')
    expect(pkg.manufacturerPackCount).toBe(4)

    const grouping = new BrandGroupingService()
    const suf = evaluateIdentitySufficiency(grouping.extractNormalizedAttributes(offer), offer)
    expect(suf.isSufficient).toBe(true)
  })

  it('keeps beverage measured ONLY in PCS without physical size_unit unresolved as MISSING_UNIT_SIZE', () => {
    const rawPcsOnly = {
      arabic_product_name: 'كوكا كولا بلاستيك',
      english_product_name: 'Coca Cola',
      pack_quantity: 4,
      unit: 'PCS',
      size: '1',
      offer_price: 15
    }
    const offer = toUnifiedOfferFromLegacy('pcs_only_no_size_unit', rawPcsOnly)
    expect(offer.each_size_value).toBe(1)
    expect(offer.each_size_unit).toBe('piece')

    const grouping = new BrandGroupingService()
    const suf = evaluateIdentitySufficiency(grouping.extractNormalizedAttributes(offer), offer)
    expect(suf.isSufficient).toBe(false)
    expect(suf.codes).toContain('MISSING_UNIT_SIZE')
  })

  it('preserves physical unit from embedded size strings ("155g", "18g") when unit="Each" or unit_weight is used', () => {
    const lays = extractLegacyQuantityAndSize({
      english_product_name: "Lay's Potato Chips",
      size: '155g',
      unit: 'Each',
      pack_quantity: 1
    })
    expect(lays.each_size_value).toBe(155)
    expect(lays.each_size_unit).toBe('g')
    expect(lays.sale_unit_raw).toBe('Each')
    expect(lays.sale_unit_type).toBe('piece')

    const maggi = extractLegacyQuantityAndSize({
      english_product_name: 'Maggi Stock Chicken',
      unit_weight: '18g',
      pack_quantity: 16
    })
    expect(maggi.each_size_value).toBe(18)
    expect(maggi.each_size_unit).toBe('g')
    expect(maggi.pack_quantity).toBe(16)
  })

  it('keeps Original Taste and Zero Calories variants as strictly separate identities', () => {
    const rawOrig = JSON.parse(
      readFileSync(
        join(process.cwd(), 'Extracts', 'Othaim_week24', 'json', 'page-002', 'othaim-week24_002_001.json'),
        'utf8'
      )
    )
    const rawZero = JSON.parse(
      readFileSync(
        join(process.cwd(), 'Extracts', 'Othaim_week24', 'json', 'page-002', 'othaim-week24_002_003.json'),
        'utf8'
      )
    )

    const offerOrig = toUnifiedOfferFromLegacy('coca_orig_320', rawOrig, {
      variantOrFlavor: 'Original',
      quantity_semantics: 'manufacturer_multipack'
    })
    const offerZero = toUnifiedOfferFromLegacy('coca_zero_320', rawZero, {
      quantity_semantics: 'manufacturer_multipack'
    })
    expect(offerZero.variantOrFlavor).toBe('Zero Calories')

    const grouping = new BrandGroupingService()
    const reg = new TemporaryProductRegistry('variant_sep')
    const rOrig = reg.reconcileTemporaryOffer({
      requestTempRef: 't1',
      requestScopedMap: new Map(),
      attrs: grouping.extractNormalizedAttributes(offerOrig),
      sourceOffer: offerOrig
    })
    const rZero = reg.reconcileTemporaryOffer({
      requestTempRef: 't2',
      requestScopedMap: new Map(),
      attrs: grouping.extractNormalizedAttributes(offerZero),
      sourceOffer: offerZero
    })
    expect(rOrig.temporaryId).not.toBe(rZero.temporaryId)
  })
})
