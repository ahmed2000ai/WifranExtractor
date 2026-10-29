import type { LeafletFilenameMetadataResult } from '../utils/leafletFilenameParser'

export type SelectedPdfFile = {
  path: string
  name: string
  sizeBytes: number
  extension: string
  parsedMetadata?: LeafletFilenameMetadataResult
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

export type ImportFormState = {
  pdfFile: SelectedPdfFile | null
  supermarketId: string | null
  location: SelectedImportLocation | null
  offerStartDate: string
  offerEndDate: string
}

export type ImportFormValidationError = {
  field: 'pdfFile' | 'supermarketId' | 'location' | 'offerStartDate' | 'offerEndDate' | 'form'
  code: string
  message: string
}

export type ImportFormValidationResult = {
  ok: boolean
  errors: ImportFormValidationError[]
}
