import { readFileSync } from 'fs'
import { join } from 'path'
import { BrandGroupingService } from '../src/main/db/brandGroupingService'
import { evaluateIdentitySufficiency } from '../src/main/db/productIdentityPolicy'

const ds = JSON.parse(readFileSync(join(process.cwd(), 'test-fixtures', 'matching-benchmarks', 'real_world_100_dataset_v1.json'), 'utf8'))
const g = new BrandGroupingService()

for (const item of ds.items) {
  const raw = JSON.parse(readFileSync(join(process.cwd(), item.sourceFilePath), 'utf8'))
  const offer: any = {
    batchId: 'dbg', leafletId: item.workspace, sourceFileName: item.canonicalSourceId, sourcePdfPath: '',
    sourcePage: 1, sourceOfferId: item.canonicalSourceId, canonicalSourceId: item.canonicalSourceId,
    batchOfferKey: `dbg::${item.canonicalSourceId}`, supermarketId: item.retailer.toLowerCase(), supermarketName: item.retailer,
    offerStartDate: null, offerEndDate: null, locationScope: 'national', locationLabel: null, cityId: null, regionId: null,
    titleAr: item.titleAr || '', titleEn: item.titleEn || '', brand: item.brandRaw, brandAr: item.brandAr, brandEn: item.brandEn,
    variantOrFlavor: item.variantOrFlavor, promoPrice: null, originalPrice: null, discountPercent: null, promoNotes: null,
    sizeOrWeight: item.sizeOrWeight, each_size_value: item.eachSizeValue, each_size_unit: item.eachSizeUnit,
    inner_pack_count: raw.content?.pack_quantity ?? 1, sale_unit_type: item.saleUnitType,
    total_content_value: null, total_content_unit: null, free_units_text: null, customer_limit: null,
    promo_condition_quantity: item.promoConditionQuantity, promotion_mechanic: raw.promotion?.mechanic || null,
    bundle_quantity: item.promoConditionQuantity, quantity_semantics: raw.content?.quantity_semantics || null,
    assortment_status: item.rawIsMultiBrandOrVariant ? 'assortment_indicated' : 'unknown',
    productThumbCropPath: item.cropPath, offerCardCropPath: item.cropPath, status: 'extracted', confidence: 'medium', canonical: raw
  }
  const attrs = g.extractNormalizedAttributes(offer)
  const suf = evaluateIdentitySufficiency(attrs, offer, null)
  if (suf.isSufficient && (attrs.brandKey === 'unknown_brand' || item.expectedDecisionAutomatic === 'unresolved')) {
    console.log('SURPRISE SUFFICIENT:', item.canonicalSourceId, '| brandKey=', attrs.brandKey, '| status=', attrs.brandStatus, '| expectedAuto=', item.expectedDecisionAutomatic, '| size=', attrs.eachSizeValue, attrs.eachSizeUnit, 'x', attrs.manufacturerPackCount)
  }
  if (!suf.isSufficient && item.expectedDecisionAutomatic !== 'unresolved') {
    console.log('SURPRISE INSUFFICIENT:', item.canonicalSourceId, '| expectedAuto=', item.expectedDecisionAutomatic, '| codes=', suf.codes)
  }
}

