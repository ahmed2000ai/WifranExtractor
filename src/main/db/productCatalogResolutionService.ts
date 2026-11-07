import { getSupabaseAdminClient } from './supabaseAdminClient'
import {
  CatalogCandidateGroup,
  ExcludedAmbiguousOffer,
  AnalyzeOfferCatalogCandidatesResult,
  ApproveCatalogCandidatesInput,
  ApproveCatalogCandidatesResult
} from '../../shared/types/catalogResolution'

export type {
  CatalogCandidateGroup,
  ExcludedAmbiguousOffer,
  AnalyzeOfferCatalogCandidatesResult,
  ApproveCatalogCandidatesInput,
  ApproveCatalogCandidatesResult
}

export function buildCanonicalProductKey(params: {
  brandName?: string | null
  normalizedTitleEn: string
  variantOrFlavor?: string | null
  eachSizeValue?: number | null
  eachSizeUnit?: string | null
  innerPackCount?: number | null
  saleUnitType?: string | null
}): string {
  const brandPart = (params.brandName || 'unbranded').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const titlePart = params.normalizedTitleEn.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const variantPart = (params.variantOrFlavor || 'std').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const sizeVal = params.eachSizeValue != null ? String(Number(params.eachSizeValue)) : '0'
  const sizeUnit = (params.eachSizeUnit || 'unit').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const pack = params.innerPackCount || 1
  const saleUnit = (params.saleUnitType || 'each').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')

  return `${brandPart}:${titlePart}:${variantPart}:${sizeVal}${sizeUnit}:${pack}x${saleUnit}`
}

export function buildItemNameComplete(params: {
  brandName?: string | null
  titleEn: string
  titleAr?: string | null
  variantOrFlavor?: string | null
  eachSizeValue?: number | null
  eachSizeUnit?: string | null
  innerPackCount?: number | null
  saleUnitType?: string | null
}): string {
  const partsEn: string[] = []
  const brand = params.brandName?.trim()
  const titleEn = params.titleEn.trim()

  if (brand && !titleEn.toLowerCase().startsWith(brand.toLowerCase())) {
    partsEn.push(brand)
  }
  partsEn.push(titleEn)

  if (params.variantOrFlavor && !titleEn.toLowerCase().includes(params.variantOrFlavor.toLowerCase())) {
    partsEn.push(`(${params.variantOrFlavor.trim()})`)
  }

  const enDescription = partsEn.filter(Boolean).join(' ')

  const pack = params.innerPackCount || 1
  const sizeVal = params.eachSizeValue != null ? Number(params.eachSizeValue) : null
  const sizeUnit = params.eachSizeUnit?.trim()

  const lowerEn = enDescription.toLowerCase()
  const alreadyMentionsPack = pack <= 1 || lowerEn.includes(`${pack}x`) || lowerEn.includes(`${pack} x`) || lowerEn.includes(`pack of ${pack}`)
  const alreadyMentionsSize = !sizeVal || lowerEn.includes(`${sizeVal}g`) || lowerEn.includes(`${sizeVal}kg`) || lowerEn.includes(`${sizeVal}l`) || lowerEn.includes(`${sizeVal}ml`) || lowerEn.includes(`${sizeVal}lt`) || lowerEn.includes(`${sizeVal} lt`) || lowerEn.includes(`${sizeVal} l`) || lowerEn.includes(`${sizeVal} kg`) || lowerEn.includes(`${sizeVal} g`)

  let packSummary = ''
  if (!alreadyMentionsPack || !alreadyMentionsSize) {
    if (pack > 1 && sizeVal && sizeUnit) {
      packSummary = `(${pack}x ${sizeVal} ${sizeUnit})`
    } else if (sizeVal && sizeUnit) {
      packSummary = `(${sizeVal} ${sizeUnit})`
    } else if (pack > 1) {
      packSummary = `(Pack of ${pack})`
    }
  }

  const titleAr = params.titleAr?.trim()

  if (titleAr) {
    return packSummary ? `${enDescription} - ${titleAr} ${packSummary}`.trim() : `${enDescription} - ${titleAr}`.trim()
  }
  return packSummary ? `${enDescription} ${packSummary}`.trim() : enDescription.trim()
}

import {
  classifyOfferAmbiguity,
  validateProductIdentityCompatibility
} from './productIdentityCompatibilityValidator'
import { getEquivalentCanonicalKeys } from '../../shared/utils/unitEquivalence'
import {
  getCanonicalBrandId,
  extractNormalizedTokenBag,
  areTokenBagsCompatible
} from '../../shared/utils/bilingualTokenNormalizer'

export { classifyOfferAmbiguity }

export async function analyzeOfferCatalogCandidates(options?: {
  supermarketSlug?: string
  supermarketId?: string
  offerIds?: string[]
}): Promise<AnalyzeOfferCatalogCandidatesResult> {
  const supabase = getSupabaseAdminClient()

  let query = supabase
    .from('offers')
    .select(`
      id,
      title_en,
      title_ar,
      status,
      sale_unit_type,
      each_size_value,
      each_size_unit,
      inner_pack_count,
      assortment_status,
      exact_identity_status,
      brand_id,
      brand_state,
      brand_candidate_text,
      product_id,
      catalog_match_status,
      catalog_candidate_key,
      image_url,
      image_path,
      contract_v2,
      supermarket_id
    `)
    .eq('status', 'published')

  if (options?.supermarketId) {
    query = query.eq('supermarket_id', options.supermarketId)
  }
  if (options?.offerIds && options.offerIds.length > 0) {
    query = query.in('id', options.offerIds)
  }

  const { data: offers, error: fetchErr } = await query
  if (fetchErr) {
    throw new Error(`Failed to query published offers for catalog analysis: ${fetchErr.message}`)
  }

  // Fetch verified products for auto-linking
  const { data: verifiedProducts, error: prodErr } = await supabase
    .from('products')
    .select(`
      id,
      canonical_product_key,
      item_name_complete,
      name_en,
      name_ar,
      brand_name,
      variant_or_flavor,
      each_size_value,
      each_size_unit,
      inner_pack_count,
      sale_unit_type,
      verification_status
    `)
    .eq('verification_status', 'verified')

  if (prodErr) {
    throw new Error(`Failed to query products for auto-linking: ${prodErr.message}`)
  }

  const verifiedProductMap = new Map<string, any>()
  if (verifiedProducts) {
    for (const p of verifiedProducts) {
      if (p.canonical_product_key) {
        verifiedProductMap.set(p.canonical_product_key, p)
        const equivKeys = getEquivalentCanonicalKeys(p.canonical_product_key)
        for (const eqKey of equivKeys) {
          if (!verifiedProductMap.has(eqKey)) {
            verifiedProductMap.set(eqKey, p)
          }
        }
      }
    }
  }

  // Load brands for accurate brand names
  const { data: brandsData } = await supabase.from('brands').select('id, name_en, name_ar')
  const brandMap = new Map<string, string>()
  if (brandsData) {
    for (const b of brandsData) {
      brandMap.set(b.id, b.name_en)
    }
  }

  const result: AnalyzeOfferCatalogCandidatesResult = {
    totalOffers: offers?.length || 0,
    alreadyLinkedCount: 0,
    autoLinkedCount: 0,
    excludedAmbiguousCount: 0,
    pendingReviewCandidateCount: 0,
    candidates: [],
    excludedOffers: []
  }

  const candidateMap = new Map<string, CatalogCandidateGroup>()

  for (const offer of offers || []) {
    // If already verified and linked, count as already linked
    if (offer.product_id && offer.catalog_match_status === 'verified_linked') {
      result.alreadyLinkedCount++
      continue
    }

    const rawBrand =
      (offer.brand_id ? brandMap.get(offer.brand_id) : null) ||
      offer.contract_v2?.product_facts?.brand_assertion?.value ||
      offer.brand_candidate_text ||
      null
    const brandName = getCanonicalBrandId(rawBrand) || rawBrand

    const variantOrFlavor = offer.contract_v2?.product_facts?.variant_or_flavor || null
    const eachSizeVal = offer.each_size_value != null ? Number(offer.each_size_value) : null
    const eachSizeUnit = offer.each_size_unit || null
    const innerPack = offer.inner_pack_count != null ? Number(offer.inner_pack_count) : null
    const saleUnit = offer.sale_unit_type || 'each'

    // Classify ambiguity
    const ambiguity = classifyOfferAmbiguity({
      title_en: offer.title_en,
      title_ar: offer.title_ar,
      brand_name: brandName,
      brand_state: offer.brand_state,
      sale_unit_type: saleUnit,
      inner_pack_count: innerPack,
      each_size_value: eachSizeVal,
      each_size_unit: eachSizeUnit,
      assortment_status: offer.assortment_status
    })

    if (ambiguity.isAmbiguous) {
      // Excluded ambiguous offer
      result.excludedAmbiguousCount++
      result.excludedOffers.push({
        offerId: offer.id,
        titleEn: offer.title_en,
        titleAr: offer.title_ar,
        reason: ambiguity.reason || 'assortment',
        details: ambiguity.details || 'Ambiguous offer'
      })

      // Persist excluded status in DB if not already set
      if (offer.catalog_match_status !== 'excluded_ambiguous') {
        await supabase
          .from('offers')
          .update({
            catalog_match_status: 'excluded_ambiguous'
          })
          .eq('id', offer.id)
      }
      continue
    }

    // Concrete single-product packaged good
    const candidateKey = buildCanonicalProductKey({
      brandName,
      normalizedTitleEn: offer.title_en,
      variantOrFlavor,
      eachSizeValue: eachSizeVal,
      eachSizeUnit: eachSizeUnit,
      innerPackCount: innerPack,
      saleUnitType: saleUnit
    })

    const itemNameComplete = buildItemNameComplete({
      brandName,
      titleEn: offer.title_en,
      titleAr: offer.title_ar,
      variantOrFlavor,
      eachSizeValue: eachSizeVal,
      eachSizeUnit: eachSizeUnit,
      innerPackCount: innerPack
    })

    // Check if verified product already exists
    let existingVerifiedProduct = verifiedProductMap.get(candidateKey)
    if (!existingVerifiedProduct) {
      // Check verified products for token-bag match
      const offerBag = extractNormalizedTokenBag(`${offer.title_en} ${offer.title_ar || ''}`)
      for (const vp of verifiedProductMap.values()) {
        const vpBag = extractNormalizedTokenBag(`${vp.item_name_complete || ''} ${vp.name_en || ''} ${vp.name_ar || ''}`)
        if (areTokenBagsCompatible(offerBag, vpBag).isCompatible) {
          const validation = validateProductIdentityCompatibility(offer, vp)
          if (validation.isCompatible) {
            existingVerifiedProduct = vp
            break
          }
        }
      }
    }

    if (existingVerifiedProduct) {
      // Validate compatibility before auto-linking
      const validation = validateProductIdentityCompatibility(offer, existingVerifiedProduct)
      if (validation.isCompatible) {
        result.autoLinkedCount++
        await supabase
          .from('offers')
          .update({
            product_id: existingVerifiedProduct.id,
            catalog_match_status: 'verified_linked',
            catalog_verification_basis: 'verified_catalog_reuse'
          })
          .eq('id', offer.id)
        continue
      } else {
        await supabase
          .from('offers')
          .update({
            catalog_match_status: 'conflict_needs_review'
          })
          .eq('id', offer.id)
        continue
      }
    }

    // Otherwise, mark candidate_pending_review and group
    if (offer.catalog_match_status !== 'candidate_pending_review' || offer.catalog_candidate_key !== candidateKey) {
      await supabase
        .from('offers')
        .update({
          catalog_candidate_key: candidateKey,
          catalog_match_status: 'candidate_pending_review'
        })
        .eq('id', offer.id)
    }

    const evidencePath = offer.image_path || null
    const evidenceUrl = offer.image_url || null

    if (!candidateMap.has(candidateKey)) {
      candidateMap.set(candidateKey, {
        candidateKey,
        itemNameComplete,
        brandName,
        variantOrFlavor,
        eachSizeValue: eachSizeVal,
        eachSizeUnit: eachSizeUnit,
        innerPackCount: innerPack,
        saleUnitType: saleUnit,
        nameEn: offer.title_en,
        nameAr: offer.title_ar || null,
        gtin: offer.contract_v2?.product_facts?.gtin || null,
        offerIds: [offer.id],
        offerTitles: [offer.title_en],
        evidencePaths: evidencePath ? [evidencePath] : [],
        evidenceUrls: evidenceUrl ? [evidenceUrl] : []
      })
    } else {
      const group = candidateMap.get(candidateKey)!
      group.offerIds.push(offer.id)
      group.offerTitles.push(offer.title_en)
      if (evidencePath && !group.evidencePaths.includes(evidencePath)) {
        group.evidencePaths.push(evidencePath)
      }
      if (evidenceUrl && !group.evidenceUrls.includes(evidenceUrl)) {
        group.evidenceUrls.push(evidenceUrl)
      }
    }
  }

  result.candidates = Array.from(candidateMap.values())
  result.pendingReviewCandidateCount = result.candidates.length

  return result
}

export async function approveCatalogProductCandidates(
  input: ApproveCatalogCandidatesInput
): Promise<ApproveCatalogCandidatesResult> {
  if (!input.operatorConfirmedIdentity) {
    throw new Error('Operator identity confirmation is required before approving catalog product candidates.')
  }

  const hasCandidateKeys = Boolean(input.candidateKeys && input.candidateKeys.length > 0)
  const hasOfferIds = Boolean(input.offerIds && input.offerIds.length > 0)

  if (!hasCandidateKeys && !hasOfferIds) {
    return {
      approvedCount: 0,
      linkedOffersCount: 0,
      createdProductIds: []
    }
  }

  const supabase = getSupabaseAdminClient()
  const verifiedBy = input.verifiedBy || 'operator'
  const verificationBasis = input.verificationBasis || 'operator_verified_pack_identity'
  const verifiedAt = new Date().toISOString()

  // Load brands
  const { data: brandsData } = await supabase.from('brands').select('id, name_en')
  const brandMap = new Map<string, string>()
  if (brandsData) {
    for (const b of brandsData) brandMap.set(b.id, b.name_en)
  }

  // Fetch offers matching candidate keys or offer IDs
  let offerQuery = supabase
    .from('offers')
    .select(`
      id,
      title_en,
      title_ar,
      sale_unit_type,
      each_size_value,
      each_size_unit,
      inner_pack_count,
      brand_id,
      brand_candidate_text,
      catalog_candidate_key,
      contract_v2
    `)

  if (hasOfferIds) {
    offerQuery = offerQuery.in('id', input.offerIds!)
  } else {
    offerQuery = offerQuery.in('catalog_candidate_key', input.candidateKeys!)
  }

  const { data: candidateOffers, error: fetchErr } = await offerQuery

  if (fetchErr) {
    throw new Error(`Failed to fetch candidate offers: ${fetchErr.message}`)
  }

  const offersByKey = new Map<string, any[]>()
  for (const o of candidateOffers || []) {
    let k = o.catalog_candidate_key
    if (!k) {
      const rawBrand =
        (o.brand_id ? brandMap.get(o.brand_id) : null) ||
        o.contract_v2?.product_facts?.brand_assertion?.value ||
        o.brand_candidate_text ||
        null
      const brandName = getCanonicalBrandId(rawBrand) || rawBrand
      const variantOrFlavor = o.contract_v2?.product_facts?.variant_or_flavor || null
      const eachSizeVal = o.each_size_value != null ? Number(o.each_size_value) : null
      const eachSizeUnit = o.each_size_unit || null
      const innerPack = o.inner_pack_count != null ? Number(o.inner_pack_count) : null
      const saleUnit = o.sale_unit_type || 'each'

      k = buildCanonicalProductKey({
        brandName,
        normalizedTitleEn: o.title_en,
        variantOrFlavor,
        eachSizeValue: eachSizeVal,
        eachSizeUnit: eachSizeUnit,
        innerPackCount: innerPack,
        saleUnitType: saleUnit
      })
    }
    if (!offersByKey.has(k)) offersByKey.set(k, [])
    offersByKey.get(k)!.push(o)
  }

  const createdProductIds: Array<number | string> = []
  let totalLinkedOffers = 0

  const candidateKeyList = hasCandidateKeys ? input.candidateKeys! : Array.from(offersByKey.keys())
  const sortedCandidateKeys = [...new Set(candidateKeyList)].sort()
  for (const candidateKey of sortedCandidateKeys) {
    const matchingOffers = offersByKey.get(candidateKey)
    if (!matchingOffers || matchingOffers.length === 0) continue

    const repOffer = matchingOffers[0]
    const brandName =
      (repOffer.brand_id ? brandMap.get(repOffer.brand_id) : null) ||
      repOffer.contract_v2?.product_facts?.brand_assertion?.value ||
      repOffer.brand_candidate_text ||
      null
    const variantOrFlavor = repOffer.contract_v2?.product_facts?.variant_or_flavor || null
    const eachSizeVal = repOffer.each_size_value != null ? Number(repOffer.each_size_value) : null
    const eachSizeUnit = repOffer.each_size_unit || null
    const innerPack = repOffer.inner_pack_count != null ? Number(repOffer.inner_pack_count) : null
    const saleUnit = repOffer.sale_unit_type || 'each'

    const itemNameComplete = buildItemNameComplete({
      brandName,
      titleEn: repOffer.title_en,
      titleAr: repOffer.title_ar,
      variantOrFlavor,
      eachSizeValue: eachSizeVal,
      eachSizeUnit: eachSizeUnit,
      innerPackCount: innerPack
    })

    const slug = candidateKey.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    const gtin = input.gtinMap?.[candidateKey] || repOffer.contract_v2?.product_facts?.gtin || null

    // Upsert into public.products
    const productPayload = {
      canonical_product_key: candidateKey,
      item_name_complete: itemNameComplete,
      brand_name: brandName,
      brand_id: repOffer.brand_id || null,
      variant_or_flavor: variantOrFlavor,
      each_size_value: eachSizeVal,
      each_size_unit: eachSizeUnit,
      inner_pack_count: innerPack,
      sale_unit_type: saleUnit,
      name_en: repOffer.title_en,
      name_ar: repOffer.title_ar || null,
      slug,
      gtin,
      verification_status: 'verified',
      verification_basis: verificationBasis,
      verified_by: verifiedBy,
      verified_at: verifiedAt
    }

    const { data: upsertedProduct, error: upsertErr } = await supabase
      .from('products')
      .upsert(productPayload, { onConflict: 'canonical_product_key' })
      .select('id')
      .single()

    if (upsertErr) {
      throw new Error(`Failed to upsert verified product for key ${candidateKey}: ${upsertErr.message}`)
    }

    const productId = upsertedProduct.id
    createdProductIds.push(productId)

    // Link matching candidate offers without touching exact_identity_status or contract_v2
    const matchingOfferIds = matchingOffers.map((o) => o.id)
    const { error: linkErr } = await supabase
      .from('offers')
      .update({
        product_id: productId,
        catalog_candidate_key: candidateKey,
        catalog_match_status: 'verified_linked',
        catalog_verification_basis: verificationBasis,
        catalog_verified_by: verifiedBy,
        catalog_verified_at: verifiedAt
      })
      .in('id', matchingOfferIds)

    if (linkErr) {
      throw new Error(`Failed to link offers to verified product ${productId}: ${linkErr.message}`)
    }

    totalLinkedOffers += matchingOfferIds.length
  }

  return {
    approvedCount: createdProductIds.length,
    linkedOffersCount: totalLinkedOffers,
    createdProductIds
  }
}
