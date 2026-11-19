import React, { useState, useEffect } from 'react'
import type { StagedLeafletHeader, StagedLeafletDraft } from '../../../../shared/types/productImageEnrichment'
import { mergeSupermarketCatalogLists } from '../../../../shared/utils/supermarketCandidateUtils'

export interface MetadataCompletionModalProps {
  jobDir: string
  currentHeader: StagedLeafletHeader
  pendingSupermarkets?: SupermarketOption[]
  missingFields?: Array<'supermarket' | 'region' | 'validFrom' | 'validTo'>
  validationWarnings?: string[]
  onClose: () => void
  onSave: (updatedDraft: StagedLeafletDraft) => void
}

interface SupermarketOption {
  id: string
  name_en: string
  name_ar: string
  slug?: string
  pendingCatalogCreation?: boolean
}

interface RegionOption {
  id: string
  name_en: string
  name_ar: string
  slug?: string
}

export function MetadataCompletionModal({
  jobDir,
  currentHeader,
  pendingSupermarkets = [],
  missingFields = [],
  validationWarnings = [],
  onClose,
  onSave
}: MetadataCompletionModalProps): JSX.Element {
  const [supermarkets, setSupermarkets] = useState<SupermarketOption[]>([])
  const [regions, setRegions] = useState<RegionOption[]>([])
  const [loadingData, setLoadingData] = useState<boolean>(true)

  // Form State
  const [selectedSupermarket, setSelectedSupermarket] = useState<string>('')
  const [customSupermarket, setCustomSupermarket] = useState<string>('')
  const [selectedRegion, setSelectedRegion] = useState<string>('')
  const [customRegion, setCustomRegion] = useState<string>('')
  const [validFrom, setValidFrom] = useState<string>('')
  const [validTo, setValidTo] = useState<string>('')

  const [saving, setSaving] = useState<boolean>(false)
  const [formError, setFormError] = useState<string | null>(null)

  // 1. Fetch Supermarkets & Regions from DB via IPC / Reference Data
  useEffect(() => {
    let isMounted = true

    async function loadOptions() {
      try {
        let sms: SupermarketOption[] = []
        let regs: RegionOption[] = []

        // Try direct enrichment IPC first
        if (window.wifranExtractor?.productEnrichment?.getSupermarketsAndRegions) {
          const res = await window.wifranExtractor.productEnrichment.getSupermarketsAndRegions()
          if (res?.supermarkets) sms = res.supermarkets
          if (res?.regions) regs = res.regions
        }

        // Fallback to reference.loadAll if needed
        if ((sms.length === 0 || regs.length === 0) && window.wifranExtractor?.reference?.loadAll) {
          const refRes = await window.wifranExtractor.reference.loadAll()
          if (refRes?.ok && refRes?.data) {
            if (sms.length === 0) sms = refRes.data.supermarkets || []
            if (regs.length === 0) regs = refRes.data.regions || []
          }
        }

        if (!isMounted) return

        const mergedSms = mergeSupermarketCatalogLists(sms, pendingSupermarkets)
        setSupermarkets(mergedSms)
        setRegions(regs)

        // Pre-fill supermarket
        const currentSm = (currentHeader.supermarketId || '').trim()
        if (currentSm) {
          const found = mergedSms.find((s) => s.id === currentSm || s.slug === currentSm || s.name_en?.toLowerCase() === currentSm.toLowerCase())
          if (found) {
            setSelectedSupermarket(found.id)
          } else {
            setSelectedSupermarket('__ADD_NEW__')
            setCustomSupermarket(currentSm)
          }
        }

        // Pre-fill region
        const currentReg = (currentHeader.region || '').trim()
        if (currentReg) {
          const found = regs.find((r) => r.name_en?.toLowerCase() === currentReg.toLowerCase() || r.slug === currentReg || r.id === currentReg)
          if (found) {
            setSelectedRegion(found.name_en || found.slug || found.id)
          } else {
            setSelectedRegion('__ADD_NEW__')
            setCustomRegion(currentReg)
          }
        }
      } catch (err: any) {
        console.warn('Failed to load reference lists for metadata completion modal:', err)
      } finally {
        if (isMounted) setLoadingData(false)
      }
    }

    // Set initial dates from currentHeader
    if (currentHeader.validFrom) {
      setValidFrom(currentHeader.validFrom.split('T')[0])
    }
    if (currentHeader.validTo) {
      setValidTo(currentHeader.validTo.split('T')[0])
    }

    loadOptions()

    return () => {
      isMounted = false
    }
  }, [currentHeader])

  // Save & Apply Metadata Handler
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    // Validation
    const isNewSm = selectedSupermarket === '__ADD_NEW__'
    const smVal = isNewSm ? customSupermarket.trim() : selectedSupermarket.trim()
    if (!smVal) {
      setFormError('Please select or specify a supermarket.')
      return
    }

    const isNewReg = selectedRegion === '__ADD_NEW__'
    const regVal = isNewReg ? customRegion.trim() : selectedRegion.trim()
    if (!regVal) {
      setFormError('Please select or specify a region.')
      return
    }

    if (!validFrom) {
      setFormError('Please select a valid Offer Start Date.')
      return
    }
    if (!validTo) {
      setFormError('Please select a valid Offer End Date.')
      return
    }
    if (new Date(validTo).getTime() < new Date(validFrom).getTime()) {
      setFormError(`End Date (${validTo}) cannot be earlier than Start Date (${validFrom}).`)
      return
    }

    setSaving(true)
    try {
      let finalSupermarketId = selectedSupermarket
      if (isNewSm) {
        // Resolve or create brand new supermarket in DB
        const resolvedSm = await window.wifranExtractor.productEnrichment.resolveSupermarket(smVal)
        finalSupermarketId = resolvedSm.id
      }

      let finalRegion = selectedRegion
      if (isNewReg) {
        // Resolve or create brand new region in DB
        const resolvedReg = await window.wifranExtractor.productEnrichment.resolveRegion(regVal)
        finalRegion = resolvedReg.name_en || resolvedReg.slug || regVal
      }

      const updatedDraft = await window.wifranExtractor.productEnrichment.updateHeader(jobDir, {
        supermarketId: finalSupermarketId,
        region: finalRegion,
        validFrom,
        validTo
      })

      onSave(updatedDraft)
      onClose()
    } catch (err: any) {
      setFormError(err.message || 'Failed to save header metadata.')
    } finally {
      setSaving(false)
    }
  }

  const isFieldMissing = (field: 'supermarket' | 'region' | 'validFrom' | 'validTo') =>
    missingFields.includes(field)

  const isConfirmationMode = missingFields.length === 0 && validationWarnings.length === 0

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="metadata-completion-modal"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '560px',
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          border: '1px solid #cbd5e1',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#f8fafc'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.25rem' }}>{isConfirmationMode ? '✅' : '📋'}</span>
            <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#0f172a', fontWeight: 600 }}>
              {isConfirmationMode ? 'Confirm Leaflet Metadata' : 'Complete Leaflet Metadata'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.25rem',
              color: '#64748b',
              cursor: 'pointer',
              lineHeight: 1
            }}
          >
            ×
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSave} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Confirmation Info Banner or Missing / Corrupted Warning Alert */}
          {isConfirmationMode ? (
            <div
              style={{
                backgroundColor: '#eff6ff',
                border: '1px solid #bfdbfe',
                borderRadius: '8px',
                padding: '12px 14px',
                fontSize: '0.85rem',
                color: '#1e40af'
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>ℹ️</span>
                <span>Review & Confirm Leaflet Metadata</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#1d4ed8' }}>
                Review and confirm the discovered or operator-entered Supermarket, Region/Scope, and Offer Validity Dates below before publishing to the database.
              </p>
            </div>
          ) : (
            (missingFields.length > 0 || validationWarnings.length > 0) && (
              <div
                style={{
                  backgroundColor: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  fontSize: '0.85rem',
                  color: '#92400e'
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>⚠️</span>
                  <span>Missing or Unverified Metadata Detected</span>
                </div>
                <p style={{ margin: '0 0 6px 0', fontSize: '0.8rem', color: '#b45309' }}>
                  Leaflet header metadata is incomplete. Candidate product/offer images remain staged; please verify or supply the missing metadata below before publishing.
                </p>
                {validationWarnings.length > 0 && (
                  <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '0.8rem' }}>
                    {validationWarnings.map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
            )
          )}

          {formError && (
            <div
              style={{
                backgroundColor: '#fef2f2',
                border: '1px solid #f87171',
                borderRadius: '6px',
                padding: '10px 14px',
                color: '#991b1b',
                fontSize: '0.85rem'
              }}
            >
              {formError}
            </div>
          )}

          {/* 1. Supermarket */}
          <div
            style={{
              padding: isFieldMissing('supermarket') ? '10px' : '0',
              borderRadius: '6px',
              backgroundColor: isFieldMissing('supermarket') ? '#fff7ed' : 'transparent',
              border: isFieldMissing('supermarket') ? '1px dashed #f97316' : 'none'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>
                Supermarket
              </label>
              {isFieldMissing('supermarket') && (
                <span style={{ fontSize: '0.75rem', color: '#c2410c', fontWeight: 600 }}>Required</span>
              )}
            </div>

            <select
              data-testid="modal-supermarket-select"
              className="form-control"
              value={selectedSupermarket}
              onChange={(e) => setSelectedSupermarket(e.target.value)}
              disabled={loadingData || saving}
              style={{ width: '100%', fontSize: '0.9rem', marginBottom: selectedSupermarket === '__ADD_NEW__' ? '8px' : '0' }}
            >
              <option value="">{loadingData ? 'Loading supermarkets...' : 'Select a supermarket...'}</option>
              {supermarkets.map((sm) => (
                <option key={sm.id} value={sm.id}>
                  {sm.name_en || sm.slug} {sm.name_ar ? `(${sm.name_ar})` : ''}{sm.pendingCatalogCreation ? ' [New — Save on Publish]' : ''}
                </option>
              ))}
              <option value="__ADD_NEW__">New supermarket...</option>
            </select>

            {selectedSupermarket === '__ADD_NEW__' && (
              <input
                data-testid="modal-custom-supermarket-input"
                type="text"
                className="form-control"
                placeholder="Enter new supermarket name (e.g. Al Ahlam Hypermarket)..."
                value={customSupermarket}
                onChange={(e) => setCustomSupermarket(e.target.value)}
                disabled={saving}
                style={{ width: '100%', fontSize: '0.9rem' }}
                autoFocus
              />
            )}
          </div>

          {/* 2. Region */}
          <div
            style={{
              padding: isFieldMissing('region') ? '10px' : '0',
              borderRadius: '6px',
              backgroundColor: isFieldMissing('region') ? '#fff7ed' : 'transparent',
              border: isFieldMissing('region') ? '1px dashed #f97316' : 'none'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>
                Region / City
              </label>
              {isFieldMissing('region') && (
                <span style={{ fontSize: '0.75rem', color: '#c2410c', fontWeight: 600 }}>Required</span>
              )}
            </div>

            <select
              data-testid="modal-region-select"
              className="form-control"
              value={selectedRegion}
              onChange={(e) => setSelectedRegion(e.target.value)}
              disabled={loadingData || saving}
              style={{ width: '100%', fontSize: '0.9rem', marginBottom: selectedRegion === '__ADD_NEW__' ? '8px' : '0' }}
            >
              <option value="">{loadingData ? 'Loading regions...' : 'Select a region or city...'}</option>
              <option value="__ADD_NEW__">➕ Add New Region...</option>
              {regions.map((r) => (
                <option key={r.id || r.slug} value={r.name_en || r.slug || r.id}>
                  {r.name_en || r.slug} {r.name_ar ? `(${r.name_ar})` : ''}
                </option>
              ))}
            </select>

            {selectedRegion === '__ADD_NEW__' && (
              <input
                data-testid="modal-custom-region-input"
                type="text"
                className="form-control"
                placeholder="Enter new region name (e.g. Neom Province)..."
                value={customRegion}
                onChange={(e) => setCustomRegion(e.target.value)}
                disabled={saving}
                style={{ width: '100%', fontSize: '0.9rem' }}
              />
            )}
          </div>

          {/* 3. Offer Dates */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div
              style={{
                padding: isFieldMissing('validFrom') ? '8px' : '0',
                borderRadius: '6px',
                backgroundColor: isFieldMissing('validFrom') ? '#fff7ed' : 'transparent',
                border: isFieldMissing('validFrom') ? '1px dashed #f97316' : 'none'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>
                  Start Date
                </label>
                {isFieldMissing('validFrom') && (
                  <span style={{ fontSize: '0.7rem', color: '#c2410c', fontWeight: 600 }}>Required</span>
                )}
              </div>
              <input
                data-testid="modal-valid-from-input"
                type="date"
                className="form-control"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
                disabled={saving}
                style={{ width: '100%', fontSize: '0.9rem' }}
              />
            </div>

            <div
              style={{
                padding: isFieldMissing('validTo') ? '8px' : '0',
                borderRadius: '6px',
                backgroundColor: isFieldMissing('validTo') ? '#fff7ed' : 'transparent',
                border: isFieldMissing('validTo') ? '1px dashed #f97316' : 'none'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>
                  End Date
                </label>
                {isFieldMissing('validTo') && (
                  <span style={{ fontSize: '0.7rem', color: '#c2410c', fontWeight: 600 }}>Required</span>
                )}
              </div>
              <input
                data-testid="modal-valid-to-input"
                type="date"
                className="form-control"
                value={validTo}
                onChange={(e) => setValidTo(e.target.value)}
                disabled={saving}
                style={{ width: '100%', fontSize: '0.9rem' }}
              />
            </div>
          </div>

          {/* Modal Footer / Actions */}
          <div
            style={{
              marginTop: '12px',
              paddingTop: '16px',
              borderTop: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '10px'
            }}
          >
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              data-testid="modal-save-metadata-btn"
              type="submit"
              className="btn btn-primary"
              disabled={saving}
              style={{
                backgroundColor: '#0284c7',
                borderColor: '#0284c7',
                color: '#ffffff',
                fontWeight: 600
              }}
            >
              {saving ? 'Saving...' : isConfirmationMode ? 'Confirm & Apply Metadata' : 'Save & Apply Metadata'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

