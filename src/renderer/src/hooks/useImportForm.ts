import { useState, useCallback, useMemo } from 'react'
import type { 
  SelectedPdfFile,
  SelectedImportLocation, 
  ImportFormState, 
  ImportFormValidationResult,
  ImportFormValidationError,
  PageSelectionMode,
  PageSelectionState
} from '../../../shared/types/importForm'
import { useConfigStatus } from './useConfigStatus'
import { validateLocationScope } from '../../../shared/utils/locationScopeValidation'
import { parsePageSelection, formatPageList, formatPageRanges } from '../../../shared/utils/pageRangeParser'

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

function createDefaultAllPagesSelection(totalPages?: number): PageSelectionState {
  if (!totalPages || totalPages <= 0) {
    return {
      mode: 'all',
      specificInput: '',
      selectedPages: [],
      normalizedString: '',
      isValid: true
    }
  }
  const allPages = Array.from({ length: totalPages }, (_, i) => i + 1)
  return {
    mode: 'all',
    specificInput: '',
    selectedPages: allPages,
    normalizedString: formatPageList(allPages),
    isValid: true
  }
}

export function useImportForm() {
  const { configStatus } = useConfigStatus()

  // WIFRAN-EXTRACTOR-METADATA-002: Do not invent unsupported guessed dates.
  // Missing dates remain genuinely unresolved until discovered or confirmed by operator.
  const [formState, setFormState] = useState<ImportFormState>(() => {
    return {
      pdfFile: null,
      supermarketId: null,
      location: null,
      offerStartDate: '',
      offerEndDate: '',
      pageSelection: createDefaultAllPagesSelection()
    }
  })

  const setSupermarketId = useCallback((id: string | null) => {
    setFormState(prev => ({ ...prev, supermarketId: id, location: null }))
  }, [])

  const setLocation = useCallback((location: SelectedImportLocation | null) => {
    setFormState(prev => ({ ...prev, location }))
  }, [])

  // Preserves exact operator input without inferring a synthetic 7-day duration
  const setOfferStartDate = useCallback((date: string) => {
    setFormState(prev => ({ ...prev, offerStartDate: date }))
  }, [])

  const setOfferEndDate = useCallback((date: string) => {
    setFormState(prev => ({ ...prev, offerEndDate: date }))
  }, [])

  const setPageSelectionMode = useCallback((mode: PageSelectionMode) => {
    setFormState(prev => {
      const totalPages = prev.pdfFile?.pageCount || 0
      if (mode === 'all') {
        return {
          ...prev,
          pageSelection: {
            ...createDefaultAllPagesSelection(totalPages),
            specificInput: prev.pageSelection.specificInput
          }
        }
      } else {
        // Re-evaluate specificInput against totalPages
        const rawInput = prev.pageSelection.specificInput
        if (!rawInput.trim()) {
          return {
            ...prev,
            pageSelection: {
              mode: 'specific',
              specificInput: rawInput,
              selectedPages: [],
              normalizedString: '',
              isValid: false,
              errorMessage: 'Page selection cannot be empty. Specify page numbers (e.g. 1-5, 8).'
            }
          }
        }
        const parsed = parsePageSelection(rawInput, totalPages)
        return {
          ...prev,
          pageSelection: {
            mode: 'specific',
            specificInput: rawInput,
            selectedPages: parsed.ok ? parsed.pages : [],
            normalizedString: parsed.ok ? parsed.normalizedString : '',
            isValid: parsed.ok,
            errorMessage: parsed.error
          }
        }
      }
    })
  }, [])

  const setSpecificPageSelection = useCallback((input: string) => {
    setFormState(prev => {
      const totalPages = prev.pdfFile?.pageCount || 0
      const parsed = parsePageSelection(input, totalPages)
      return {
        ...prev,
        pageSelection: {
          mode: 'specific',
          specificInput: input,
          selectedPages: parsed.ok ? parsed.pages : [],
          normalizedString: parsed.ok ? parsed.normalizedString : '',
          isValid: parsed.ok,
          errorMessage: parsed.error
        }
      }
    })
  }, [])

  const restorePageSelection = useCallback((selection: {
    mode: PageSelectionMode
    selectedPages: number[]
    totalPages?: number
  }) => {
    setFormState(prev => {
      const docTotal = selection.totalPages || prev.pdfFile?.pageCount || 0
      if (selection.mode === 'all') {
        return {
          ...prev,
          pageSelection: createDefaultAllPagesSelection(docTotal)
        }
      } else {
        const rangeText = formatPageRanges(selection.selectedPages)
        const parsed = parsePageSelection(rangeText, docTotal || Math.max(...selection.selectedPages, 1))
        return {
          ...prev,
          pageSelection: {
            mode: 'specific',
            specificInput: rangeText,
            selectedPages: parsed.ok ? parsed.pages : selection.selectedPages,
            normalizedString: parsed.ok ? parsed.normalizedString : formatPageList(selection.selectedPages),
            isValid: parsed.ok,
            errorMessage: parsed.error
          }
        }
      }
    })
  }, [])

  const selectPdf = useCallback(async (supermarkets?: any[], cities?: any[], regions?: any[]) => {
    try {
      const file = await window.wifranExtractor.files.selectPdf()
      if (file) {
        setFormState(prev => {
          let bestSupermarketId: string | null = null
          let offerStartDate = ''
          let offerEndDate = ''

          if (supermarkets && supermarkets.length > 0) {
            let bestScore = 0
            
            const getScore = (fileName: string, target: string) => {
               if (!target) return 0
               const fn = fileName.toLowerCase()
               const t = target.toLowerCase()
               
               // Direct substring match is strong
               if (fn.includes(t)) return t.length * 2
               
               // Token intersection
               const fnTokens = fn.split(/[^a-z0-9\u0600-\u06FF]+/).filter(Boolean)
               const tTokens = t.split(/[^a-z0-9\u0600-\u06FF]+/).filter(Boolean)
               
               let matchCount = 0
               for (const token of tTokens) {
                 if (token.length > 2 && fnTokens.some(ft => ft.includes(token) || token.includes(ft))) {
                   matchCount += token.length
                 }
               }
               return matchCount
            }

            for (const s of supermarkets) {
              const scoreEn = getScore(file.name, s.name_en || '')
              const scoreAr = getScore(file.name, s.name_ar || '')
              const scoreSlug = getScore(file.name, s.slug || '')
              const maxScore = Math.max(scoreEn, scoreAr, scoreSlug)
              
              if (maxScore > bestScore && maxScore > 2) {
                bestScore = maxScore
                bestSupermarketId = s.id
              }
            }
          }

          let newLocation: SelectedImportLocation | null = null;
          let locationPrefilled = false;

          if (file.parsedMetadata?.ok) {
            // Prefill Supermarket
            if (file.parsedMetadata.supermarket_description && supermarkets) {
              const matchedS = supermarkets.find(s => s.name_en === file.parsedMetadata?.supermarket_description)
              if (matchedS) {
                bestSupermarketId = matchedS.id
              }
            }

            // Candidate start date from filename (unconfirmed candidate only)
            if (file.parsedMetadata.promotion_start_date) {
              const d = new Date(file.parsedMetadata.promotion_start_date)
              if (!isNaN(d.getTime())) {
                offerStartDate = formatDate(d)
                // WIFRAN-EXTRACTOR-METADATA-002: Do not invent a guessed 7-day end date!
              }
            }

            // Prefill Location
            if (file.parsedMetadata.location_description) {
              const locDesc = file.parsedMetadata.location_description
              if (locDesc.endsWith(' City') && cities) {
                const rawName = locDesc.replace(' City', '').trim()
                const matchedCity = cities.find(c => c.name_en === rawName || c.name_en === locDesc || c.slug?.toLowerCase() === rawName.toLowerCase())
                if (matchedCity) {
                  newLocation = {
                    locationScope: 'city',
                    cityId: matchedCity.id,
                    regionId: null,
                    label: matchedCity.name_en || matchedCity.name_ar,
                    coverageLabel: 'City',
                    locationSlug: matchedCity.slug
                  } as any
                  locationPrefilled = true;
                }
              } else if (locDesc.endsWith(' Region') && regions) {
                const rawName = locDesc.replace(' Region', '').trim()
                const matchedRegion = regions.find(r => r.name_en === rawName || r.name_en === locDesc || r.slug?.toLowerCase() === rawName.toLowerCase())
                if (matchedRegion) {
                  newLocation = {
                    locationScope: 'region',
                    cityId: null,
                    regionId: matchedRegion.id,
                    label: matchedRegion.name_en || matchedRegion.name_ar,
                    coverageLabel: 'Region',
                    locationSlug: matchedRegion.slug
                  } as any
                  locationPrefilled = true;
                }
              }
            }
          }

          if (!locationPrefilled) {
            newLocation = null
          }

          // Switching to a new PDF always resets page selection to 'all'
          return {
            ...prev,
            pdfFile: file,
            supermarketId: bestSupermarketId,
            location: newLocation,
            offerStartDate,
            offerEndDate,
            pageSelection: createDefaultAllPagesSelection(file.pageCount)
          }
        })
      }
    } catch (error) {
      console.error('Failed to select PDF:', error)
    }
  }, [])

  const setPdfFile = useCallback((file: SelectedPdfFile | null) => {
    setFormState(prev => ({
      ...prev,
      pdfFile: file,
      pageSelection: file ? createDefaultAllPagesSelection(file.pageCount) : createDefaultAllPagesSelection()
    }))
  }, [])

  const resetForm = useCallback(() => {
    setFormState({
      pdfFile: null,
      supermarketId: null,
      location: null,
      offerStartDate: '',
      offerEndDate: '',
      pageSelection: createDefaultAllPagesSelection()
    })
  }, [])

  const validation = useMemo<ImportFormValidationResult>(() => {
    const errors: ImportFormValidationError[] = []

    if (!formState.pdfFile) {
      errors.push({ field: 'pdfFile', code: 'PDF_FILE_REQUIRED', message: 'PDF file must be selected.' })
    } else {
      if (formState.pdfFile.extension !== '.pdf') {
        errors.push({ field: 'pdfFile', code: 'PDF_EXTENSION_INVALID', message: 'Selected file must be a PDF.' })
      }
      if (formState.pdfFile.sizeBytes <= 0) {
        errors.push({ field: 'pdfFile', code: 'PDF_FILE_EMPTY', message: 'Selected PDF file is empty.' })
      }
      if (formState.pageSelection.mode === 'specific' && !formState.pageSelection.isValid) {
        errors.push({
          field: 'pageSelection',
          code: 'PAGE_SELECTION_INVALID',
          message: formState.pageSelection.errorMessage || 'Invalid page selection.'
        })
      }
    }

    // In the Local-First WIFRAN-07J pipeline, Supermarket, Location, and Offer Dates
    // are completely optional upfront. They can be detected by Step 2 AI (M_ rows)
    // or filled/edited in the Staging Workspace before final publish.
    if (formState.location) {
      const { ok, errors: locErrors } = validateLocationScope({
        locationScope: formState.location.locationScope,
        cityId: formState.location.cityId,
        regionId: formState.location.regionId
      })
      if (!ok) {
        locErrors.forEach(err => {
          errors.push({ field: 'location', code: err.code, message: err.message })
        })
      }
    }

    if (formState.offerStartDate && formState.offerEndDate) {
      const start = new Date(formState.offerStartDate)
      const end = new Date(formState.offerEndDate)
      if (isNaN(start.getTime())) {
        errors.push({ field: 'offerStartDate', code: 'START_DATE_INVALID', message: 'Start date is invalid.' })
      }
      if (isNaN(end.getTime())) {
        errors.push({ field: 'offerEndDate', code: 'END_DATE_INVALID', message: 'End date is invalid.' })
      }
      if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end < start) {
        errors.push({ field: 'offerEndDate', code: 'DATE_RANGE_INVALID', message: 'End date must be same as or after start date.' })
      }
    }

    return {
      ok: errors.length === 0,
      errors
    }
  }, [formState])

  const canStart = useMemo(() => {
    if (!validation.ok) return false
    if (!configStatus) return false
    
    // Check config readiness for local OCR extraction
    if (!configStatus.mistral.apiKey.configured || !configStatus.mistral.ocrModel.configured || !configStatus.mistral.ocrEndpoint.configured) return false

    return true
  }, [validation.ok, configStatus])

  return {
    formState,
    validation,
    setSupermarketId,
    setLocation,
    setOfferStartDate,
    setOfferEndDate,
    setPageSelectionMode,
    setSpecificPageSelection,
    restorePageSelection,
    selectPdf,
    setPdfFile,
    resetForm,
    canStart,
    configStatus
  }
}
