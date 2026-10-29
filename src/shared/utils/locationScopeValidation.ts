export type LocationScope = 'national' | 'region' | 'city'

export function validateLocationScope(input: {
  locationScope: LocationScope
  cityId: string | null
  regionId: string | null
}): {
  ok: boolean
  errors: Array<{
    code: string
    message: string
  }>
} {
  const errors: Array<{ code: string; message: string }> = []

  if (!input.locationScope || !['national', 'region', 'city'].includes(input.locationScope)) {
    errors.push({ code: 'INVALID_LOCATION_SCOPE', message: 'Location scope must be national, region, or city.' })
    return { ok: false, errors }
  }

  if (input.locationScope === 'national') {
    if (input.cityId || input.regionId) {
      errors.push({ code: 'NATIONAL_SCOPE_MUST_NOT_HAVE_CITY_OR_REGION', message: 'National scope must not have city or region specified.' })
    }
  } else if (input.locationScope === 'region') {
    if (!input.regionId) {
      errors.push({ code: 'REGION_REQUIRED_FOR_REGION_SCOPE', message: 'Region ID is required for region scope.' })
    }
    if (input.cityId) {
      errors.push({ code: 'REGION_SCOPE_MUST_NOT_HAVE_CITY', message: 'Region scope must not have a city specified.' })
    }
  } else if (input.locationScope === 'city') {
    if (!input.cityId) {
      errors.push({ code: 'CITY_REQUIRED_FOR_CITY_SCOPE', message: 'City ID is required for city scope.' })
    }
  }

  return { ok: errors.length === 0, errors }
}
