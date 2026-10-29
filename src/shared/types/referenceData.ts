export type SupermarketReference = {
  id: string
  name_ar: string | null
  name_en: string | null
  slug: string | null
  code?: string | null
  logo_url: string | null
  is_active: boolean
  sort_order: number | null
}

export type CityReference = {
  id: string
  name_ar: string | null
  name_en: string | null
  slug: string | null
  code?: string | null
  country_code: string | null
  region_id?: string | null
  is_active: boolean
  sort_order: number | null
}

export type RegionReference = {
  id: string
  name_ar: string | null
  name_en: string | null
  slug: string | null
  code?: string | null
  is_active: boolean
}

export type SupermarketRegionReference = {
  id: string
  supermarket_id: string
  city_id: string | null
  region_id: string | null
  is_active: boolean
}

export type CategoryReference = {
  id: string
  parent_id: string | null
  name_ar: string | null
  name_en: string | null
  slug: string | null
  is_active: boolean
  sort_order: number | null
  requires_unit_price?: boolean | null
  default_unit_type?: string | null
}

export type BrandReference = {
  id: string
  name_ar: string | null
  name_en: string | null
  slug: string | null
  is_active: boolean
}

export type UnitReference = {
  id: string
  code: string
  name_ar: string | null
  name_en: string | null
  symbol_ar: string | null
  symbol_en: string | null
  base_unit_code: string | null
  conversion_to_base: number | null
  is_active: boolean
  sort_order: number | null
}

export type ReferenceDataBundle = {
  supermarkets: SupermarketReference[]
  cities: CityReference[]
  regions: RegionReference[]
  supermarketRegions: SupermarketRegionReference[]
  categories: CategoryReference[]
  brands: BrandReference[]
  units: UnitReference[]
}

export type ReferenceDataLoadResult = {
  ok: boolean
  data?: ReferenceDataBundle
  error?: string
}
