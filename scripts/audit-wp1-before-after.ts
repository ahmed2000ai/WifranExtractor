import { readFileSync } from 'fs'
import { join, basename } from 'path'
import { BrandGroupingService } from '../src/main/db/brandGroupingService'
import { TemporaryProductRegistry } from '../src/main/db/temporaryProductRegistry'
import {
  evaluateIdentitySufficiency,
  resolveQuantityAndPromoSemantics
} from '../src/main/db/productIdentityPolicy'
import { findMatchingRawExtractionEntry } from '../src/shared/utils/canonicalRawAttributes'
import type { UnifiedBatchOffer } from '../src/shared/types/batchExtraction'
import type { MatchingEvidenceAnnotation } from '../src/shared/types/catalogMatching'

const EXECUTION_TIMEOUT_MS = 30000

function resolveConfidenceFromRaw(rawData: any, rawEntry: any): 'high' | 'medium' | 'low' {
  const qual = rawData?.quality?.extraction_confidence
  if (qual === 'high' || qual === 'medium' || qual === 'low') return qual
  const numConf =
    typeof rawEntry?.confidence === 'number'
      ? rawEntry.confidence
      : typeof rawData?.confidence === 'number'
      ? rawData.confidence
      : null
  if (numConf !== null) {
    return numConf >= 0.85 ? 'high' : numConf >= 0.6 ? 'medium' : 'low'
  }
  return 'medium'
}

function resolveAssortmentStatus(rawData: any, rawEntry: any): string | null {
  const explicitContractStatus = rawData?.contract_v2?.assortment?.status
  if (explicitContractStatus) return explicitContractStatus
  if (rawEntry?.is_multi_brand_or_variant === true) return 'assortment_indicated'
  return 'unknown'
}

function buildOfferFromInventoryRecord(r: any): UnifiedBatchOffer {
  const rawData = JSON.parse(readFileSync(r.filePath, 'utf8'))
  const isLegacyOthaim = r.workspace === 'Othaim_week24' && !rawData.product
  const rawEntry = isLegacyOthaim ? rawData : findMatchingRawExtractionEntry(rawData)

  let assortmentStatus = resolveAssortmentStatus(rawData, rawEntry)
  if (isLegacyOthaim && Array.isArray(rawData.variants) && rawData.variants.length > 1) {
    assortmentStatus = 'multiple_variants'
  }

  const titleEn = isLegacyOthaim
    ? String(rawData.english_product_name || rawData.product_name_english || '')
    : String(rawData.product?.title_en || '')
  const titleAr = isLegacyOthaim
    ? String(rawData.arabic_product_name || rawData.product_name_arabic || '')
    : String(rawData.product?.title_ar || '')
  const brandRaw = isLegacyOthaim
    ? rawData.brand || null
    : rawData.product?.brand_text || rawData.product?.brand || rawEntry?.brand || null
  const brandEn = isLegacyOthaim ? rawData.brand || null : rawData.product?.brand_en || brandRaw
  const brandAr = isLegacyOthaim ? null : rawData.product?.brand_ar || null

  let eachSizeVal: number | null = null
  let eachSizeUnit: string | null = null
  let sizeText: string | null = null
  let mfgPack = 1

  if (isLegacyOthaim) {
    const parsedWeightMatch =
      typeof rawData.unit_weight === 'string'
        ? /^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)$/.exec(rawData.unit_weight.trim())
        : null
    const rawVal = rawData.unit_size ?? rawData.size ?? (parsedWeightMatch ? parsedWeightMatch[1] : null)
    const parsedNum = rawVal !== null && rawVal !== undefined && rawVal !== '' ? Number(rawVal) : NaN
    eachSizeVal = Number.isFinite(parsedNum) && parsedNum > 0 ? parsedNum : null
    eachSizeUnit = rawData.unit || (parsedWeightMatch ? parsedWeightMatch[2] : null)
    mfgPack = typeof rawData.pack_quantity === 'number' && rawData.pack_quantity > 0 ? rawData.pack_quantity : 1
    sizeText =
      eachSizeVal && eachSizeUnit
        ? mfgPack > 1
          ? `${mfgPack}x${eachSizeVal}${eachSizeUnit}`
          : `${eachSizeVal}${eachSizeUnit}`
        : rawData.size_or_weight || null
  } else {
    eachSizeVal = typeof rawData.content?.each_size_value === 'number' ? rawData.content.each_size_value : null
    eachSizeUnit = rawData.content?.each_size_unit || null
    sizeText = rawData.content?.size_text || rawEntry?.size_value || null
    mfgPack = typeof rawData.content?.pack_quantity === 'number' ? rawData.content.pack_quantity : 1
  }

  const promoCondQty = isLegacyOthaim
    ? null
    : typeof rawData.promotion?.bundle_quantity === 'number'
    ? rawData.promotion.bundle_quantity
    : typeof rawData.content?.bundle_quantity === 'number'
    ? rawData.content.bundle_quantity
    : null

  return {
    batchId: 'audit_005a_wp1',
    leafletId: r.workspace,
    sourceFileName: basename(r.filePath || r.canonicalSourceId),
    sourcePdfPath: '',
    sourcePage: r.pageNumber || 1,
    sourceOfferId: String(r.itemNumber || r.canonicalSourceId),
    canonicalSourceId: r.canonicalSourceId,
    batchOfferKey: `audit_005a_wp1::${r.canonicalSourceId}`,
    supermarketId: String(r.retailer || '').toLowerCase(),
    supermarketName: r.retailer,
    offerStartDate: null,
    offerEndDate: null,
    locationScope: 'national',
    locationLabel: null,
    cityId: null,
    regionId: null,
    titleAr,
    titleEn,
    brand: brandRaw,
    brandAr,
    brandEn,
    variantOrFlavor: isLegacyOthaim
      ? rawData.variant || rawData.flavor || null
      : rawData.product?.variant_or_flavor || rawData.product?.variant || rawEntry?.variant_or_flavor || null,
    promoPrice: r.promoPrice ?? null,
    originalPrice: r.originalPrice ?? null,
    discountPercent: null,
    promoNotes: isLegacyOthaim
      ? rawData.price_condition || null
      : rawData.pricing?.promo_description ||
        rawData.promotion?.condition_text ||
        rawData.promotion?.special_offer ||
        null,
    sizeOrWeight: sizeText,
    each_size_value: eachSizeVal,
    each_size_unit: eachSizeUnit,
    inner_pack_count: mfgPack,
    sale_unit_type: isLegacyOthaim ? null : rawData.content?.sale_unit_type || null,
    total_content_value: isLegacyOthaim ? null : rawData.content?.total_content_value ?? null,
    total_content_unit: isLegacyOthaim ? null : rawData.content?.total_content_unit ?? null,
    free_units_text: null,
    customer_limit: r.customerLimit ?? null,
    promo_condition_quantity: promoCondQty,
    promotion_mechanic: isLegacyOthaim ? null : rawData.promotion?.mechanic || null,
    bundle_quantity: promoCondQty,
    quantity_semantics: isLegacyOthaim ? null : rawData.content?.quantity_semantics || null,
    assortment_status: assortmentStatus,
    matchingEvidence: null,
    productThumbCropPath: r.cropPath || null,
    offerCardCropPath: r.cropPath || null,
    status: 'extracted',
    confidence: resolveConfidenceFromRaw(rawData, rawEntry),
    canonical: rawData
  }
}

async function runComparisonAudit(): Promise<void> {
  const timeoutHandle = setTimeout(() => {
    console.error(`[WP1CompareAudit] TIMEOUT: exceeded ${EXECUTION_TIMEOUT_MS}ms.`)
    process.exit(1)
  }, EXECUTION_TIMEOUT_MS)

  try {
    const grouping = new BrandGroupingService()
    const registry = new TemporaryProductRegistry('wp1_audit')

    // 1. Compare 190-record corpus BEFORE vs AFTER WP1
    const before190Path = join(process.cwd(), 'Extracts', 'audit_003_pipeline_190_records.json')
    const before190 = JSON.parse(readFileSync(before190Path, 'utf8'))
    const invPath = join(process.cwd(), 'Extracts', 'audit_003_local_extractions_inventory.json')
    const inv = JSON.parse(readFileSync(invPath, 'utf8'))
    const records: any[] = inv.allRecords || []

    const beforeById = new Map<string, any>()
    for (const r of before190.records || []) {
      beforeById.set(r.canonicalSourceId, r)
    }

    let afterSufficient190 = 0
    let afterInsufficient190 = 0
    const afterBrandStatusCounts190: Record<string, number> = { known: 0, unbranded: 0, multi_brand: 0, unknown: 0 }
    const changed190: Array<{
      id: string
      titleEn: string
      before: { brandKey: string; brandStatus: string; mfgPack: number; suf: boolean; codes: string[] }
      after: { brandKey: string; brandStatus: string; mfgPack: number; pkg: string; suf: boolean; codes: string[] }
    }> = []
    let errorCount190 = 0

    console.log(`[WP1CompareAudit] Evaluating 190-corpus (${records.length} records)...`)
    for (let i = 0; i < records.length; i++) {
      const r = records[i]
      if ((i + 1) % 50 === 0 || i + 1 === records.length) {
        console.log(`[WP1CompareAudit] 190-corpus progress: ${i + 1}/${records.length}`)
      }
      try {
        const offer = buildOfferFromInventoryRecord(r)
        const attrs = grouping.extractNormalizedAttributes(offer)
        const pkg = resolveQuantityAndPromoSemantics(offer)
        const suf = evaluateIdentitySufficiency(attrs, offer, null)

        if (suf.isSufficient) afterSufficient190++
        else afterInsufficient190++
        afterBrandStatusCounts190[attrs.brandStatus] = (afterBrandStatusCounts190[attrs.brandStatus] || 0) + 1

        const b = beforeById.get(r.canonicalSourceId)
        if (
          !b ||
          b.brandKey !== attrs.brandKey ||
          b.brandStatus !== attrs.brandStatus ||
          b.isIdentitySufficient !== suf.isSufficient ||
          b.manufacturerPackCount !== pkg.manufacturerPackCount
        ) {
          changed190.push({
            id: r.canonicalSourceId,
            titleEn: offer.titleEn,
            before: {
              brandKey: b?.brandKey,
              brandStatus: b?.brandStatus,
              mfgPack: b?.manufacturerPackCount,
              suf: b?.isIdentitySufficient,
              codes: b?.sufficiencyCodes || []
            },
            after: {
              brandKey: attrs.brandKey,
              brandStatus: attrs.brandStatus,
              mfgPack: pkg.manufacturerPackCount,
              pkg: pkg.packagingSemantics,
              suf: suf.isSufficient,
              codes: suf.codes
            }
          })
        }
      } catch (err) {
        errorCount190++
        console.error(`[WP1CompareAudit] Error on ${r.canonicalSourceId}:`, err)
      }
    }

    console.log('\n=== 190-CORPUS BEFORE vs AFTER (WP1) ===')
    console.log('BEFORE sufficiencyBreakdown:', JSON.stringify(before190.sufficiencyBreakdown))
    console.log('BEFORE brandStatusBreakdown:', JSON.stringify(before190.brandStatusBreakdown))
    console.log('AFTER sufficiencyBreakdown:', JSON.stringify({ sufficientCount: afterSufficient190, insufficientCount: afterInsufficient190, errorCount: errorCount190 }))
    console.log('AFTER brandStatusBreakdown:', JSON.stringify(afterBrandStatusCounts190))
    console.log(`Changed 190-corpus records (${changed190.length}):`)
    for (const c of changed190) {
      console.log(' ', c.id, '|', c.titleEn, '| BEFORE:', JSON.stringify(c.before), '| AFTER:', JSON.stringify(c.after))
    }

    // 2. Compare 106-offer v2.json benchmark dataset BEFORE (004) vs AFTER WP1
    const v2Path = join(process.cwd(), 'test-fixtures', 'matching-benchmarks', 'real_world_100_dataset_v2.json')
    const v2 = JSON.parse(readFileSync(v2Path, 'utf8'))
    const invById = new Map<string, any>()
    for (const r of records) invById.set(r.canonicalSourceId, r)

    let v2SufficientAuto = 0
    let v2SufficientWithOverlay = 0
    const targetTrace: any[] = []

    console.log(`\n[WP1CompareAudit] Evaluating 106-offer benchmark dataset (${v2.items.length} items)...`)
    for (let i = 0; i < v2.items.length; i++) {
      const it = v2.items[i]
      try {
        const invRec = invById.get(it.canonicalSourceId)
        const offer: UnifiedBatchOffer = invRec
          ? buildOfferFromInventoryRecord(invRec)
          : buildOfferFromInventoryRecord({
              filePath: join(process.cwd(), it.sourceFilePath),
              workspace: it.workspace,
              retailer: it.retailer,
              canonicalSourceId: it.canonicalSourceId,
              itemNumber: it.sourceOfferId,
              cropPath: it.cropPath
            })

        // Evaluation A: Pure automated (no evidence overlay)
        const attrsAuto = grouping.extractNormalizedAttributes(offer)
        if (attrsAuto.isIdentitySufficient) v2SufficientAuto++

        // Evaluation B: With v2.json benchmark overlayCorrection applied (matching 004 pipeline setup)
        let overlayAnnotation: MatchingEvidenceAnnotation | null = null
        if (it.requiresEvidenceOverlayForTruth && it.overlayCorrection) {
          overlayAnnotation = {
            source_id: it.canonicalSourceId,
            evidence_source: 'reviewer_annotation',
            assortment_status: it.overlayCorrection.assortment_status,
            identity_resolution: it.overlayCorrection.identity_resolution,
            quantity_semantics: it.overlayCorrection.quantity_semantics,
            manufacturer_pack_count: it.overlayCorrection.manufacturer_pack_count,
            promo_purchase_quantity: it.overlayCorrection.promo_purchase_quantity,
            variant_or_flavor: it.overlayCorrection.variant_or_flavor,
            notes: it.overlayCorrection.notes,
            created_at: '2026-11-13T00:00:00Z',
            updated_at: '2026-11-13T00:00:00Z',
            reversible: true
          }
        }
        const offerWithOverlay: UnifiedBatchOffer = {
          ...offer,
          matchingEvidence: overlayAnnotation
        }
        const attrsOverlay = grouping.extractNormalizedAttributes(offerWithOverlay)
        if (attrsOverlay.isIdentitySufficient) v2SufficientWithOverlay++

        if (
          /othaim-week24_001_001|othaim-week24_002_00[13]|Panda_Test_p003_013|Alwafa_Test_p001_012|noori.*p001_009/i.test(
            it.canonicalSourceId
          )
        ) {
          const fp = registry.buildCanonicalIdentityFingerprint(attrsOverlay)
          targetTrace.push({
            id: it.canonicalSourceId,
            titleEn: offer.titleEn,
            trueSafeDecision: it.trueSafeDecision,
            physicalTruthType: it.physicalTruth?.identityType,
            autoBrandKey: attrsAuto.brandKey,
            autoPkg: attrsAuto.packagingSemantics,
            autoMfgPack: attrsAuto.manufacturerPackCount,
            autoVariant: attrsAuto.variantOrFlavor,
            autoAssortment: attrsAuto.isAssortment,
            autoSufficient: attrsAuto.isIdentitySufficient,
            autoCodes: attrsAuto.insufficiencyCodes,
            fingerprint: fp
          })
        }
      } catch (err) {
        console.error(`[WP1CompareAudit] Benchmark error on ${it.canonicalSourceId}:`, err)
      }
    }

    console.log('\n=== 106-BENCHMARK ELIGIBILITY SUMMARY (WP1 OFFLINE) ===')
    console.log('BEFORE 004 baseline completed eligible/evaluated (with 6 overlays): 42 (39 completed: 19 existing + 20 temp + 3 failed Seara), unresolved: 64')
    console.log(`AFTER WP1 purely automated match-eligible (isIdentitySufficient, 0 overlays): ${v2SufficientAuto}/106`)
    console.log(`AFTER WP1 with v2.json 6 evidence overlays match-eligible (isIdentitySufficient): ${v2SufficientWithOverlay}/106`)
    console.log('Target 106-dataset key items AFTER WP1:')
    for (const t of targetTrace) {
      console.log(' ', JSON.stringify(t))
    }
  } finally {
    clearTimeout(timeoutHandle)
  }
}

runComparisonAudit()
  .then(() => {
    const activeHandles = (process as any)._getActiveHandles?.() || []
    console.log(
      `[WP1CompareAudit] Finished cleanly. Active handles before exit: ${activeHandles.length}`,
      activeHandles.map((h: any) => h?.constructor?.name || typeof h)
    )
    process.exit(0)
  })
  .catch((err) => {
    console.error('[WP1CompareAudit] Fatal error:', err)
    process.exit(1)
  })

