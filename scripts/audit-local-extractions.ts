import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

interface RawExtractSummary {
  workspace: string
  retailer: string
  filePath: string
  canonicalSourceId: string
  pageNumber: number
  itemNumber: string
  titleEn: string
  titleAr: string
  brand: string | null
  sizeText: string | null
  eachSizeValue: number | null
  eachSizeUnit: string | null
  packQuantity: number | null
  promoPrice: number | null
  originalPrice: number | null
  promoMechanic: string | null
  conditionText: string | null
  bundleQuantity: number | null
  customerLimit: number | null
  cropPath: string | null
  rawMatchedEntryFound: boolean
  isMultiBrandOrVariant: boolean | null
  hasSlashInTitle: boolean
  hasAssortedOrOrKeyword: boolean
  hasFlavorOrUnspecifiedKeyword: boolean
  assortmentSignals: string[]
}

const WORKSPACES: Array<{ folder: string; retailer: string }> = [
  { folder: 'Panda_Test', retailer: 'Panda' },
  { folder: 'BNDW_Test', retailer: 'BinDawood' },
  { folder: 'Alwafa_Test', retailer: 'AlWafa' },
  { folder: 'Lulu_Test', retailer: 'LuLu' },
  { folder: 'noori-supermarket-229798534-jeddah', retailer: 'Noori' },
  { folder: 'dukan-849797163-jeddah', retailer: 'Dukan' },
  { folder: 'Othaim_week24', retailer: 'Othaim' }
]

function walkJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name)
    if (ent.isDirectory()) {
      out.push(...walkJsonFiles(full))
    } else if (ent.name.endsWith('.json')) {
      out.push(full)
    }
  }
  return out
}

function findMatchingRawEntry(rawArr: any[], titleEn: string, titleAr: string, itemNum: string): any | null {
  if (!Array.isArray(rawArr) || rawArr.length === 0) return null
  const enLower = (titleEn || '').trim().toLowerCase()
  const arTrim = (titleAr || '').trim()
  const byTitle = rawArr.find((r) => {
    const rEn = String(r.english_title || '').trim().toLowerCase()
    const rAr = String(r.arabic_title || '').trim()
    return (enLower && rEn === enLower) || (arTrim && rAr === arTrim)
  })
  if (byTitle) return byTitle
  if (rawArr.length === 1) return rawArr[0]
  const num = Number(itemNum)
  if (Number.isFinite(num)) {
    const byNum = rawArr.find((r) => Number(r.offer_number) === num)
    if (byNum) return byNum
  }
  return null
}

function main() {
  const summaries: RawExtractSummary[] = []
  const cropPathCounts = new Map<string, number>()

  for (const ws of WORKSPACES) {
    const jsonDir = join(process.cwd(), 'Extracts', ws.folder, 'json')
    const files = walkJsonFiles(jsonDir).filter((f) =>
      ws.folder === 'Othaim_week24' ? f.endsWith('.json') : f.endsWith('.canonical.json')
    )

    for (const filePath of files) {
      const data = JSON.parse(readFileSync(filePath, 'utf8'))

      if (ws.folder === 'Othaim_week24' && !data.product) {
        // Legacy flat JSON format from Othaim_week24
        const titleEn = String(data.english_product_name || '')
        const titleAr = String(data.arabic_product_name || '')
        const baseName = filePath.split(/[\\/]/).pop()!.replace('.json', '')
        const pageMatch = baseName.match(/_(\d{3})_/)
        const pageNum = pageMatch ? Number(pageMatch[1]) : 1
        const itemNum = String(data.item_number || baseName)
        const signals: string[] = []
        if (/[\\/]/.test(`${titleEn} ${titleAr}`)) signals.push('slash_title')
        if (/(assort|variety|flavor|flavours|نكه|منوع|مشكل|أنواع|انواع|الوان|\bor\b|أو)/i.test(`${titleEn} ${titleAr}`)) {
          signals.push('assorted_or_keyword')
        }
        summaries.push({
          workspace: ws.folder,
          retailer: ws.retailer,
          filePath: filePath.replace(process.cwd() + '\\', '').replace(/\\/g, '/'),
          canonicalSourceId: baseName,
          pageNumber: pageNum,
          itemNumber: itemNum,
          titleEn,
          titleAr,
          brand: null,
          sizeText: data.size && data.unit ? `${data.size}${data.unit}` : null,
          eachSizeValue: data.size ? Number(data.size) : null,
          eachSizeUnit: data.unit || null,
          packQuantity: typeof data.pack_quantity === 'number' ? data.pack_quantity : null,
          promoPrice: data.price ? Number(data.price) : null,
          originalPrice: null,
          promoMechanic: data.price_condition || null,
          conditionText: data.price_condition || null,
          bundleQuantity: null,
          customerLimit: null,
          cropPath: null,
          rawMatchedEntryFound: false,
          isMultiBrandOrVariant: null,
          hasSlashInTitle: signals.includes('slash_title'),
          hasAssortedOrOrKeyword: signals.includes('assorted_or_keyword'),
          hasFlavorOrUnspecifiedKeyword: /(marinat|متبل|تبيلة|nuggets|assort|منوع)/i.test(`${titleEn} ${titleAr}`),
          assortmentSignals: signals
        })
        continue
      }

      const titleEn = String(data.product?.title_en || data.product?.product_name_en || '')
      const titleAr = String(data.product?.title_ar || data.product?.product_name_ar || '')
      const itemNum = String(data.source?.source_item_number || '')
      const rawOfferObj = data.raw?.raw_attributes?.raw_offer_extraction || null
      const rawArr = data.raw?.raw_attributes?.raw_extraction_json || []
      const rawEntry = rawOfferObj || findMatchingRawEntry(rawArr, titleEn, titleAr, itemNum)

      const cropPath = (data.source?.crop_path || data.image?.image_path || null) as string | null
      const normCrop = cropPath ? cropPath.replace(/^.*Extracts[\\/]/i, 'Extracts/').replace(/\\/g, '/') : null
      if (normCrop) {
        cropPathCounts.set(normCrop, (cropPathCounts.get(normCrop) || 0) + 1)
      }

      const combinedText = `${titleEn} ${titleAr} ${data.promotion?.condition_text || ''} ${rawEntry?.promo_condition || ''}`
      // Note: unit-slash like "Tomato / Kg" is commodity unit pricing, not product assortment
      const isUnitPriceSlash = /^[^/]+\/\s*(kg|bag|pc|piece|pack|ctn|carton)\s*$/i.test(titleEn.trim())
      const hasSlash = /[/]/.test(`${titleEn} ${titleAr}`) && !isUnitPriceSlash
      const hasAssortedOr = /(assort|asstd|multi[-\s]?brand|variety|various|flavors|flavours|types|choice|منوع|مشكل|نكهات|أنواع|انواع|اشكال|أشكال|ألوان|الوان|\bor\b|\sأو\s)/i.test(combinedText)
      const hasFlavorUnspecified = /(marinat|متبل|تبيلة|flavou?red|منكه)/i.test(`${titleEn} ${titleAr}`)

      const signals: string[] = []
      if (rawEntry?.is_multi_brand_or_variant === true) signals.push('raw_is_multi_brand_or_variant')
      if (hasSlash) signals.push('slash_title')
      if (hasAssortedOr) signals.push('assorted_or_keyword')
      if (hasFlavorUnspecified) signals.push('unspecified_flavor_marinade')
      if (typeof rawEntry?.quantity_limit_per_customer === 'number') signals.push(`customer_limit:${rawEntry.quantity_limit_per_customer}`)
      if (isUnitPriceSlash) signals.push('unit_price_slash')

      summaries.push({
        workspace: ws.folder,
        retailer: ws.retailer,
        filePath: filePath.replace(process.cwd() + '\\', '').replace(/\\/g, '/'),
        canonicalSourceId: String(data.source?.external_image_id || `${ws.folder}_p${data.source?.source_page_number}_${itemNum}`),
        pageNumber: Number(data.source?.source_page_number || 1),
        itemNumber: itemNum,
        titleEn,
        titleAr,
        brand: data.product?.brand_text || data.product?.brand || rawEntry?.brand || null,
        sizeText: data.content?.size_text || rawEntry?.size_value || null,
        eachSizeValue: typeof data.content?.each_size_value === 'number' ? data.content.each_size_value : null,
        eachSizeUnit: data.content?.each_size_unit || null,
        packQuantity: typeof data.content?.pack_quantity === 'number' ? data.content.pack_quantity : null,
        promoPrice: data.prices?.offer_price ?? null,
        originalPrice: data.prices?.original_price ?? null,
        promoMechanic: data.promotion?.mechanic || null,
        conditionText: data.promotion?.condition_text || null,
        bundleQuantity: data.promotion?.bundle_quantity ?? data.content?.bundle_quantity ?? null,
        customerLimit: typeof rawEntry?.quantity_limit_per_customer === 'number' ? rawEntry.quantity_limit_per_customer : null,
        cropPath: normCrop,
        rawMatchedEntryFound: Boolean(rawEntry),
        isMultiBrandOrVariant: typeof rawEntry?.is_multi_brand_or_variant === 'boolean' ? rawEntry.is_multi_brand_or_variant : null,
        hasSlashInTitle: hasSlash,
        hasAssortedOrOrKeyword: hasAssortedOr,
        hasFlavorOrUnspecifiedKeyword: hasFlavorUnspecified,
        assortmentSignals: signals
      })
    }
  }

  // Flag shared crops (multiple canonical records pointing to same physical offer crop)
  const sharedCrops = Array.from(cropPathCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([cropPath, count]) => ({ cropPath, count }))

  const byRetailer = WORKSPACES.map((ws) => {
    const items = summaries.filter((s) => s.workspace === ws.folder)
    return {
      workspace: ws.folder,
      retailer: ws.retailer,
      totalRecords: items.length,
      rawFlaggedMulti: items.filter((i) => i.isMultiBrandOrVariant === true).length,
      slashTitles: items.filter((i) => i.hasSlashInTitle).length,
      assortedOrKeywords: items.filter((i) => i.hasAssortedOrOrKeyword).length,
      unspecifiedFlavor: items.filter((i) => i.hasFlavorOrUnspecifiedKeyword).length,
      anyAssortmentSignal: items.filter((i) => i.assortmentSignals.length > 0).length,
      rawEntryMatchRate: items.filter((i) => i.rawMatchedEntryFound).length
    }
  })

  const out = {
    generatedAt: new Date().toISOString(),
    totalExtractedRecords: summaries.length,
    byRetailer,
    sharedCropsCount: sharedCrops.length,
    sharedCrops,
    assortmentSignalRecords: summaries.filter((s) => s.assortmentSignals.length > 0),
    allRecords: summaries
  }

  const outPath = join(process.cwd(), 'Extracts', 'audit_003_local_extractions_inventory.json')
  writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8')
  console.log(`Audited ${summaries.length} real local extraction records across ${WORKSPACES.length} workspaces -> ${outPath}`)
  console.table(byRetailer)
  console.log('Shared crop count:', sharedCrops.length)
}

main()
