import { getSupabaseAdminClient } from './supabaseAdminClient'
import { DuplicateOfferMatch } from '../../shared/types/offerPayload'

export async function findDuplicateOffer(input: {
  supermarketId: string
  cityId: string | null
  regionId: string | null
  productId: string | number | null
  titleAr: string | null
  titleEn: string | null
  offerStartDate: string
  offerEndDate: string
  offerPrice: number
  packSizeValue: number | null
  packSizeUnit: string | null
  packQuantity: number | null
}): Promise<DuplicateOfferMatch | null> {
  const supabase = getSupabaseAdminClient()

  let query = supabase.from('offers').select('id').eq('supermarket_id', input.supermarketId)

  // 1. Geography check
  if (input.cityId) {
    query = query.eq('city_id', input.cityId)
  } else if (input.regionId) {
    query = query.eq('region_id', input.regionId)
  }

  // 2. Dates
  query = query.eq('offer_start_date', input.offerStartDate)
  query = query.eq('offer_end_date', input.offerEndDate)

  // 3. Exact Price
  query = query.eq('offer_price', input.offerPrice)

  // 4. Pack sizes (handle nulls carefully using is/eq)
  if (input.packSizeValue !== null) query = query.eq('pack_size_value', input.packSizeValue)
  else query = query.is('pack_size_value', null)

  if (input.packQuantity !== null) query = query.eq('pack_quantity', input.packQuantity)
  else query = query.is('pack_quantity', null)

  // 5. Product vs Titles
  if (input.productId) {
    query = query.eq('product_id', input.productId)
  } else {
    // If no productId, fall back to matching exactly on titles
    if (input.titleAr) query = query.eq('title_ar', input.titleAr)
    if (input.titleEn) query = query.eq('title_en', input.titleEn)
    query = query.is('product_id', null)
  }

  // Fetch only the first 1 to prove existence
  const { data, error } = await query.limit(1).maybeSingle()

  if (error) {
    console.error('Error finding duplicate offer:', error)
    throw new Error(`DUPLICATE_CHECK_FAILED: ${error.message}`)
  }

  if (data) {
    return {
      duplicateOfferId: data.id,
      matchReason: 'Exact match on location, dates, price, pack data, and product identifier.'
    }
  }

  return null
}
