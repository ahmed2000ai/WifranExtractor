import { createSlug } from './slugify'

export function buildLeafletId(input: {
  supermarketSlug: string
  coverageScope: 'national' | 'region' | 'city'
  locationSlug: string
  validTo: string
}): string {
  const sm = createSlug(input.supermarketSlug) || 'unknown-supermarket'
  const loc = createSlug(input.locationSlug) || 'unknown-location'
  const date = createSlug(input.validTo) || 'unknown-date'
  
  return `${sm}-${input.coverageScope}-${loc}-${date}`
}
