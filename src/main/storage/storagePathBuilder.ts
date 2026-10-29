import { createSlug } from '../../shared/utils/slugify'

export function buildOfferImageStoragePath(input: {
  supermarketSlug?: string | null
  coverageScope: 'national' | 'region' | 'city'
  locationSlug: string
  leafletId: string
  itemNumber: string
  extension?: 'jpg' | 'png' | 'webp'
  imageType?: 'offer_card' | 'product_thumb' | 'card' | 'thumbnail'
}): string {
  const supermarket = input.supermarketSlug ? createSlug(input.supermarketSlug) : 'unknown-supermarket'
  const scope = input.coverageScope
  const loc = createSlug(input.locationSlug) || 'unknown-location'
  const leaf = createSlug(input.leafletId) || 'unknown-leaflet'
  const item = input.itemNumber || 'unknown-item'
  const ext = input.extension || 'webp'
  
  if (input.imageType === 'product_thumb' || input.imageType === 'thumbnail') {
    return `${supermarket}/${scope}/${loc}/${leaf}/${item}_thumb.${ext}`
  }
  return `${supermarket}/${scope}/${loc}/${leaf}/${item}.${ext}`
}
