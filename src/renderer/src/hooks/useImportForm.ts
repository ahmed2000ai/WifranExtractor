import { useState, useCallback, useMemo, useEffect } from 'react'
import type { 
  SelectedPdfFile,
  SelectedImportLocation, 
  ImportFormState, 
  ImportFormValidationResult,
  ImportFormValidationError
} from '../../../shared/types/importForm'
import { useConfigStatus } from './useConfigStatus'
import { validateLocationScope } from '../../../shared/utils/locationScopeValidation'

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

function getLastWednesday(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  // 0: Sun, 1: Mon, 2: Tue, 3: Wed, 4: Thu, 5: Fri, 6: Sat
  const diff = (day >= 3 ? day - 3 : day + 4)
  d.setDate(d.getDate() - diff)
  return d
}

export function useImportForm() {
  const { configStatus } = useConfigStatus()

  const [formState, setFormState] = useState<ImportFormState>(() => {
    const start = getLastWednesday(new Date())
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    return {
      pdfFile: null,
      supermarketId: null,
      location: null,
      offerStartDate: formatDate(start),
      offerEndDate: formatDate(end)
    }
  })

  // Update default end date when config loads (if configured differently)
  useEffect(() => {
    if (configStatus && !formState.pdfFile && !formState.supermarketId) {
      const start = new Date(formState.offerStartDate)
      const end = new Date(start)
      end.setDate(start.getDate() + (configStatus.importBehavior?.defaultOfferDurationDays ? configStatus.importBehavior.defaultOfferDurationDays - 1 : 6))
      setFormState(prev => ({ ...prev, offerEndDate: formatDate(end) }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configStatus])

  const setSupermarketId = useCallback((id: string | null) => {
    setFormState(prev => ({ ...prev, supermarketId: id, location: null }))
  }, [])

  const setLocation = useCallback((location: SelectedImportLocation | null) => {
    setFormState(prev => ({ ...prev, location }))
  }, [])

  const setOfferStartDate = useCallback((date: string) => {
    setFormState(prev => {
      const start = new Date(date)
      if (isNaN(start.getTime())) {
        return { ...prev, offerStartDate: date }
      }
      const end = new Date(start)
      end.setDate(start.getDate() + 6)
      return { 
        ...prev, 
        offerStartDate: date,
        offerEndDate: formatDate(end)
      }
    })
  }, [])

  const setOfferEndDate = useCallback((date: string) => {
    setFormState(prev => ({ ...prev, offerEndDate: date }))
  }, [])

  const selectPdf = useCallback(async (supermarkets?: any[], cities?: any[], regions?: any[]) => {
    try {
      const file = await window.wifranExtractor.files.selectPdf()
      if (file) {
        setFormState(prev => {
          let bestSupermarketId = prev.supermarketId

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

          let newLocation = prev.location;
          let locationPrefilled = false;

          if (file.parsedMetadata?.ok) {
            // Prefill Supermarket
            if (file.parsedMetadata.supermarket_description && supermarkets) {
              const matchedS = supermarkets.find(s => s.name_en === file.parsedMetadata?.supermarket_description)
              if (matchedS) {
                bestSupermarketId = matchedS.id
              }
            }

            // Prefill Dates
            if (file.parsedMetadata.promotion_start_date) {
              const d = new Date(file.parsedMetadata.promotion_start_date)
              if (!isNaN(d.getTime())) {
                const startStr = formatDate(d)
                const endD = new Date(d)
                endD.setDate(d.getDate() + 6)
                prev.offerStartDate = startStr
                prev.offerEndDate = formatDate(endD)
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

          // If supermarket changed, and we didn't just prefill location from filename, reset location
          if (!locationPrefilled) {
            newLocation = bestSupermarketId !== prev.supermarketId ? null : prev.location
          }

          return { ...prev, pdfFile: file, supermarketId: bestSupermarketId, location: newLocation }
        })
      }
    } catch (error) {
      console.error('Failed to select PDF:', error)
    }
  }, [])

  const setPdfFile = useCallback((file: SelectedPdfFile | null) => {
    setFormState(prev => ({ ...prev, pdfFile: file }))
  }, [])

  const resetForm = useCallback(() => {
    const start = getLastWednesday(new Date())
    const end = new Date(start)
    end.setDate(start.getDate() + (configStatus?.importBehavior?.defaultOfferDurationDays ? configStatus.importBehavior.defaultOfferDurationDays - 1 : 6))
    setFormState({
      pdfFile: null,
      supermarketId: null,
      location: null,
      offerStartDate: formatDate(start),
      offerEndDate: formatDate(end)
    })
  }, [configStatus])

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
    }

    if (!formState.supermarketId) {
      errors.push({ field: 'supermarketId', code: 'SUPERMARKET_REQUIRED', message: 'Supermarket must be selected.' })
    }

    if (!formState.location) {
      errors.push({ field: 'location', code: 'LOCATION_REQUIRED', message: 'Location must be selected.' })
    } else {
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

    if (!formState.offerStartDate) {
      errors.push({ field: 'offerStartDate', code: 'START_DATE_REQUIRED', message: 'Start date must be selected.' })
    }

    if (!formState.offerEndDate) {
      errors.push({ field: 'offerEndDate', code: 'END_DATE_REQUIRED', message: 'End date must be selected.' })
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
    
    // Check config readiness
    if (!configStatus.supabase.url.configured || !configStatus.supabase.serviceRoleKey.configured || !configStatus.supabase.storageBucket.configured) return false
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
    selectPdf,
    setPdfFile,
    resetForm,
    canStart,
    configStatus
  }
}
