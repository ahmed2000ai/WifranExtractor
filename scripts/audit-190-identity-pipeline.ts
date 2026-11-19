import { readFileSync, writeFileSync } from 'fs'
import { join, basename } from 'path'
import { BrandGroupingService } from '../src/main/db/brandGroupingService'
import {
  evaluateIdentitySufficiency,
  resolveQuantityAndPromoSemantics
} from '../src/main/db/productIdentityPolicy'
import { findMatchingRawExtractionEntry } from '../src/shared/utils/canonicalRawAttributes'
import type { UnifiedBatchOffer } from '../src/shared/types/batchExtraction'

const EXECUTION_TIMEOUT_MS = 30000

interface AuditedRecordOutput {
  index: number
  retailer: string
  workspace: string
  canonicalSourceId: string
  sourceFileName: string
  titleEn: string
  titleAr: string
  brandRaw: string | null
  brandKey: string
  brandStatus: string
  brandNameEn: string | null
  brandNameAr: string | null
  sizeOrWeight: string | null
  eachSizeValue: number | null
  eachSizeUnit: string | null
  manufacturerPackCount: number
  promoConditionQuantity: number | null
  quantitySemantics: string
  assortmentStateCategory: 'explicitly_confirmed_single_sku' | 'explicitly_indicated_assortment' | 'unknown_or_unrecorded'
  recordedAssortmentStatus: string | null
  rawIsMultiBrandOrVariant: boolean | null
  isAssortmentEvaluated: boolean
  isIdentitySufficient: boolean
  sufficiencyCodes: string[]
  preservedConfidence: 'high' | 'medium' | 'low' | 'unrecorded'
  missingFields: string[]
  cropPath: string | null
  error?: string
}

function resolveConfidenceFromRaw(
  rawData: any,
  rawEntry: any
): { offerConfidence: 'high' | 'medium' | 'low'; preservedLabel: 'high' | 'medium' | 'low' | 'unrecorded' } {
  const qual = rawData?.quality?.extraction_confidence
  if (qual === 'high' || qual === 'medium' || qual === 'low') {
    return { offerConfidence: qual, preservedLabel: qual }
  }
  const numConf =
    typeof rawEntry?.confidence === 'number'
      ? rawEntry.confidence
      : typeof rawData?.confidence === 'number'
      ? rawData.confidence
      : null
  if (numConf !== null) {
    const mapped = numConf >= 0.85 ? 'high' : numConf >= 0.6 ? 'medium' : 'low'
    return { offerConfidence: mapped, preservedLabel: mapped }
  }
  // Never fabricate 'high' confidence when source evidence lacks a confidence score
  return { offerConfidence: 'medium', preservedLabel: 'unrecorded' }
}

function classifyAssortmentState(
  rawData: any,
  rawEntry: any
): {
  category: 'explicitly_confirmed_single_sku' | 'explicitly_indicated_assortment' | 'unknown_or_unrecorded'
  assortmentStatusForOffer: string | null
} {
  const explicitContractStatus = rawData?.contract_v2?.assortment?.status
  if (explicitContractStatus === 'single_sku') {
    return { category: 'explicitly_confirmed_single_sku', assortmentStatusForOffer: 'single_sku' }
  }
  if (
    explicitContractStatus === 'assortment_indicated' ||
    explicitContractStatus === 'multiple_variants' ||
    explicitContractStatus === 'multi_brand' ||
    explicitContractStatus === 'choice_among_options' ||
    rawEntry?.is_multi_brand_or_variant === true
  ) {
    return {
      category: 'explicitly_indicated_assortment',
      assortmentStatusForOffer: explicitContractStatus || 'assortment_indicated'
    }
  }
  // IMPORTANT: Do NOT equate is_multi_brand_or_variant === false/null/missing to 'single_sku'
  return {
    category: 'unknown_or_unrecorded',
    assortmentStatusForOffer: explicitContractStatus || 'unknown'
  }
}

async function runAudit(): Promise<void> {
  const timeoutHandle = setTimeout(() => {
    console.error(`[FATAL] Bounded 190-record audit exceeded ${EXECUTION_TIMEOUT_MS}ms timeout.`)
    process.exit(1)
  }, EXECUTION_TIMEOUT_MS)

  try {
    const invPath = join(process.cwd(), 'Extracts', 'audit_003_local_extractions_inventory.json')
    const inv = JSON.parse(readFileSync(invPath, 'utf8'))
    const records: any[] = inv.allRecords || []

    console.log(`[Audit190] Starting offline read-only audit of ${records.length} records (timeout=${EXECUTION_TIMEOUT_MS}ms).`)
    const grouping = new BrandGroupingService()
    const results: AuditedRecordOutput[] = []
    const errors: Array<{ index: number; canonicalSourceId: string; file: string; error: string }> = []

    for (let idx = 0; idx < records.length; idx++) {
      const r = records[idx]
      const fileLabel = basename(r.filePath || r.canonicalSourceId)
      console.log(`[Record ${idx + 1}/${records.length}] Starting ${r.canonicalSourceId} (${fileLabel})`)

      try {
        const rawData = JSON.parse(readFileSync(r.filePath, 'utf8'))
        const isLegacyOthaim = r.workspace === 'Othaim_week24' && !rawData.product
        const rawEntry = isLegacyOthaim ? rawData : findMatchingRawExtractionEntry(rawData)

        let { category: assortmentCategory, assortmentStatusForOffer } = classifyAssortmentState(rawData, rawEntry)
        if (isLegacyOthaim && Array.isArray(rawData.variants) && rawData.variants.length > 1) {
          assortmentCategory = 'explicitly_indicated_assortment'
          assortmentStatusForOffer = 'multiple_variants'
        }
        const { offerConfidence, preservedLabel } = resolveConfidenceFromRaw(rawData, rawEntry)

        const missingFields: string[] = []
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

        if (!brandRaw) missingFields.push('brand')
        if (!titleEn) missingFields.push('title_en')
        if (!titleAr) missingFields.push('title_ar')
        if (isLegacyOthaim) missingFields.push('canonical_v1_schema')
        if (preservedLabel === 'unrecorded') missingFields.push('extraction_confidence')
        if (assortmentCategory === 'unknown_or_unrecorded') missingFields.push('explicit_assortment_confirmation')

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
          mfgPack =
            typeof rawData.pack_quantity === 'number' && rawData.pack_quantity > 0 ? rawData.pack_quantity : 1
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

        if (eachSizeVal === null || !eachSizeUnit) missingFields.push('structured_each_size')

        const offer: UnifiedBatchOffer = {
          batchId: 'audit_003',
          leafletId: r.workspace,
          sourceFileName: fileLabel,
          sourcePdfPath: '',
          sourcePage: r.pageNumber || 1,
          sourceOfferId: String(r.itemNumber || r.canonicalSourceId),
          canonicalSourceId: r.canonicalSourceId,
          batchOfferKey: `audit_003::${r.canonicalSourceId}`,
          supermarketId: r.retailer.toLowerCase(),
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
          assortment_status: assortmentStatusForOffer,
          matchingEvidence: null,
          productThumbCropPath: r.cropPath,
          offerCardCropPath: r.cropPath,
          status: 'extracted',
          confidence: offerConfidence,
          canonical: rawData
        }

        const attrs = grouping.extractNormalizedAttributes(offer)
        const qtySem = resolveQuantityAndPromoSemantics(offer)
        const suf = evaluateIdentitySufficiency(attrs, offer, null)

        results.push({
          index: idx,
          retailer: r.retailer,
          workspace: r.workspace,
          canonicalSourceId: r.canonicalSourceId,
          sourceFileName: fileLabel,
          titleEn,
          titleAr,
          brandRaw,
          brandKey: attrs.brandKey,
          brandStatus: attrs.brandStatus,
          brandNameEn: brandEn,
          brandNameAr: brandAr,
          sizeOrWeight: sizeText,
          eachSizeValue: attrs.eachSizeValue,
          eachSizeUnit: attrs.eachSizeUnit,
          manufacturerPackCount: qtySem.manufacturerPackCount,
          promoConditionQuantity: qtySem.promoPurchaseQuantity,
          quantitySemantics: qtySem.packagingSemantics,
          assortmentStateCategory: assortmentCategory,
          recordedAssortmentStatus: assortmentStatusForOffer,
          rawIsMultiBrandOrVariant: typeof rawEntry?.is_multi_brand_or_variant === 'boolean' ? rawEntry.is_multi_brand_or_variant : null,
          isAssortmentEvaluated: suf.isAssortment,
          isIdentitySufficient: suf.isSufficient,
          sufficiencyCodes: suf.codes,
          preservedConfidence: preservedLabel,
          missingFields,
          cropPath: r.cropPath
        })
      } catch (err: any) {
        const msg = err?.message || String(err)
        console.error(`[Error] Record ${idx + 1} (${r.canonicalSourceId}): ${msg}`)
        errors.push({ index: idx, canonicalSourceId: r.canonicalSourceId, file: fileLabel, error: msg })
      }

      if ((idx + 1) % 10 === 0 || idx + 1 === records.length) {
        console.log(`[Progress] Processed ${idx + 1}/${records.length} records (errors=${errors.length})`)
      }
    }

    const summary = {
      generatedAt: new Date().toISOString(),
      totalRecords: records.length,
      processedCount: results.length,
      errorCount: errors.length,
      assortmentBreakdown: {
        explicitlyConfirmedSingleSku: results.filter((r) => r.assortmentStateCategory === 'explicitly_confirmed_single_sku').length,
        explicitlyIndicatedAssortment: results.filter((r) => r.assortmentStateCategory === 'explicitly_indicated_assortment').length,
        unknownOrUnrecorded: results.filter((r) => r.assortmentStateCategory === 'unknown_or_unrecorded').length,
        evaluatedAssortmentTrue: results.filter((r) => r.isAssortmentEvaluated).length
      },
      confidenceBreakdown: {
        high: results.filter((r) => r.preservedConfidence === 'high').length,
        medium: results.filter((r) => r.preservedConfidence === 'medium').length,
        low: results.filter((r) => r.preservedConfidence === 'low').length,
        unrecorded: results.filter((r) => r.preservedConfidence === 'unrecorded').length
      },
      sufficiencyBreakdown: {
        sufficientCount: results.filter((r) => r.isIdentitySufficient).length,
        insufficientCount: results.filter((r) => !r.isIdentitySufficient).length
      },
      brandStatusBreakdown: {
        known: results.filter((r) => r.brandStatus === 'known').length,
        unbranded: results.filter((r) => r.brandStatus === 'unbranded').length,
        multi_brand: results.filter((r) => r.brandStatus === 'multi_brand').length,
        unknown: results.filter((r) => r.brandStatus === 'unknown').length
      },
      errors,
      records: results
    }

    const outPath = join(process.cwd(), 'Extracts', 'audit_003_pipeline_190_records.json')
    writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8')
    console.log(`[Audit190] Saved complete offline audit to ${outPath}`)
    console.log('[Summary]', JSON.stringify({
      processedCount: summary.processedCount,
      errorCount: summary.errorCount,
      assortmentBreakdown: summary.assortmentBreakdown,
      confidenceBreakdown: summary.confidenceBreakdown,
      sufficiencyBreakdown: summary.sufficiencyBreakdown,
      brandStatusBreakdown: summary.brandStatusBreakdown
    }, null, 2))
  } finally {
    clearTimeout(timeoutHandle)
  }
}

runAudit()
  .then(() => {
    const activeHandles = (process as any)._getActiveHandles?.() || []
    if (activeHandles.length > 0) {
      console.log(`[Audit190] Active handles count before exit: ${activeHandles.length}`)
    }
    process.exit(0)
  })
  .catch((err) => {
    console.error('[Audit190] Unhandled error:', err)
    process.exit(1)
  })

