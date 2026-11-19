import type { LeafletFilenameMetadataResult } from '../utils/leafletFilenameParser'

export type SelectedPdfFile = {
  path: string
  name: string
  sizeBytes: number
  extension: string
  pageCount?: number
  contentFingerprint?: string
  parsedMetadata?: LeafletFilenameMetadataResult
  pageSelectionMode?: PageSelectionMode
  pageSelectionInput?: string
  selectedPages?: number[]
  pageSelectionError?: string | null
}

export type SelectedImportLocation = {
  locationScope: 'national' | 'region' | 'city'
  cityId: string | null
  regionId: string | null
  label: string
  coverageLabel: string
  locationSlug: string
  leafletId?: string
}

export type PageSelectionMode = 'all' | 'specific'

export interface PageSelectionState {
  mode: PageSelectionMode
  specificInput: string
  selectedPages: number[]
  normalizedString: string
  isValid: boolean
  errorMessage?: string
}

export type ImportFormState = {
  pdfFile: SelectedPdfFile | null
  supermarketId: string | null
  location: SelectedImportLocation | null
  offerStartDate: string
  offerEndDate: string
  pageSelection: PageSelectionState
}

export type ImportFormValidationError = {
  field: 'pdfFile' | 'pageSelection' | 'supermarketId' | 'location' | 'offerStartDate' | 'offerEndDate' | 'form'
  code: string
  message: string
}

export type ImportFormValidationResult = {
  ok: boolean
  errors: ImportFormValidationError[]
}
