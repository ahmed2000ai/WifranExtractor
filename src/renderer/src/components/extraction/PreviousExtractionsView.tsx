import { useState, useEffect, useMemo } from 'react'
import type { AvailableExtractionItem } from '../../../../shared/types/extractionManifest'
import type { SupermarketReference } from '../../../../shared/types/referenceData'

interface PreviousExtractionsViewProps {
  onBack: () => void
  onSelectForPreview: (folderPath: string) => void
  onSelectForLoad?: (folderPath: string) => void
  supermarkets?: SupermarketReference[]
}

export function PreviousExtractionsView({
  onBack,
  onSelectForPreview,
  onSelectForLoad,
  supermarkets = []
}: PreviousExtractionsViewProps): JSX.Element {
  const [extractions, setExtractions] = useState<AvailableExtractionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'ready' | 'in_progress'>('all')
  const [isOpening, setIsOpening] = useState<string | null>(null)

  const loadExtractions = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.wifranExtractor.extractionPackage.listAvailable()
      if (res.ok && res.extracts) {
        setExtractions(res.extracts)
      } else {
        setError(res.error || 'Failed to load available extractions from Extracts folder.')
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred while scanning the Extracts folder.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadExtractions()
  }, [])

  // Resolve supermarket name helper
  const getSupermarketName = (item: AvailableExtractionItem): string => {
    if (item.supermarketName) return item.supermarketName
    if (item.supermarketId && supermarkets.length > 0) {
      const found = supermarkets.find(s => s.id === item.supermarketId)
      if (found) {
        const name = found.name_en || found.name_ar || found.slug
        if (name) return name
      }
    }
    if (item.supermarketCode) return item.supermarketCode
    return 'Unknown Supermarket'
  }

  // Filtered extractions
  const filteredExtractions = useMemo(() => {
    return extractions.filter(item => {
      // Status filter
      if (statusFilter === 'ready' && !item.canPreview) return false
      if (statusFilter === 'in_progress' && item.extractionStatus === 'completed' && item.canPreview) return false

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const smName = getSupermarketName(item).toLowerCase()
        const folder = item.folderName.toLowerCase()
        const location = (item.locationLabel || '').toLowerCase()
        const dates = `${item.offerDates?.valid_from || ''} ${item.offerDates?.valid_to || ''}`.toLowerCase()
        return folder.includes(q) || smName.includes(q) || location.includes(q) || dates.includes(q)
      }
      return true
    })
  }, [extractions, searchQuery, statusFilter, supermarkets])

  const readyCount = extractions.filter(e => e.canPreview).length
  const inProgressCount = extractions.filter(e => !e.canPreview || e.extractionStatus !== 'completed').length

  const handlePreviewClick = async (folderPath: string) => {
    setIsOpening(folderPath)
    try {
      await onSelectForPreview(folderPath)
    } finally {
      setIsOpening(null)
    }
  }

  return (
    <div className="page-container" style={{ maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            id="back-to-import-btn"
            className="btn btn-secondary"
            onClick={onBack}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 16px', fontWeight: 600 }}
          >
            ← Back to Import
          </button>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.5rem', color: '#0f172a' }}>Previous Extractions</h2>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.9rem', color: '#64748b' }}>
              Select an extraction from the <code>Extracts/</code> directory to view its Pre-Publish preview.
            </p>
          </div>
        </div>

        <button
          id="refresh-extractions-btn"
          className="btn btn-secondary"
          onClick={loadExtractions}
          disabled={loading}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <span style={{ display: 'inline-block', transform: loading ? 'rotate(180deg)' : 'none', transition: 'transform 0.5s' }}>🔄</span>
          {loading ? 'Refreshing...' : 'Refresh List'}
        </button>
      </div>

      {/* Search and Filters Bar */}
      <div className="card" style={{ padding: '16px 20px', marginBottom: '24px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: '1 1 320px', minWidth: '260px' }}>
          <div style={{ position: 'relative', width: '100%' }}>
            <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>🔍</span>
            <input
              type="text"
              id="extractions-search-input"
              className="form-control"
              placeholder="Search by folder name, supermarket, or date..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '100%', maxWidth: '100%', paddingLeft: '36px', boxSizing: 'border-box' }}
            />
          </div>
          {searchQuery && (
            <button
              className="btn btn-secondary"
              onClick={() => setSearchQuery('')}
              style={{ padding: '6px 12px', fontSize: '0.85rem' }}
            >
              Clear
            </button>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 600 }}>Filter:</span>
          <button
            className={`btn ${statusFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '6px 14px', fontSize: '0.85rem', borderRadius: '20px' }}
            onClick={() => setStatusFilter('all')}
          >
            All ({extractions.length})
          </button>
          <button
            className={`btn ${statusFilter === 'ready' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '6px 14px', fontSize: '0.85rem', borderRadius: '20px' }}
            onClick={() => setStatusFilter('ready')}
          >
            ✓ Preview Ready ({readyCount})
          </button>
          <button
            className={`btn ${statusFilter === 'in_progress' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '6px 14px', fontSize: '0.85rem', borderRadius: '20px' }}
            onClick={() => setStatusFilter('in_progress')}
          >
            ⏳ In Progress ({inProgressCount})
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div style={{ padding: '16px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', marginBottom: '20px', color: '#991b1b', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <strong>Error loading extractions:</strong> {error}
          </div>
          <button className="btn btn-secondary" onClick={loadExtractions} style={{ fontSize: '0.85rem' }}>Retry</button>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="card" style={{ padding: '60px', textAlign: 'center', color: '#64748b' }}>
          <div style={{ fontSize: '2rem', marginBottom: '12px' }}>📂</div>
          <p style={{ margin: 0, fontSize: '1.05rem', fontWeight: 500 }}>Scanning Extracts directory for previous extractions...</p>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && filteredExtractions.length === 0 && (
        <div className="card" style={{ padding: '60px 24px', textAlign: 'center', color: '#64748b' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>📭</div>
          <h3 style={{ margin: '0 0 8px 0', color: '#334155' }}>
            {searchQuery || statusFilter !== 'all' ? 'No matching extractions found' : 'No previous extractions found'}
          </h3>
          <p style={{ margin: '0 0 20px 0', fontSize: '0.9rem' }}>
            {searchQuery || statusFilter !== 'all'
              ? 'Try modifying your search query or filter to see more results.'
              : 'Extraction packages will appear here once you process PDF leaflets.'}
          </p>
          {(searchQuery || statusFilter !== 'all') && (
            <button
              className="btn btn-secondary"
              onClick={() => { setSearchQuery(''); setStatusFilter('all'); }}
            >
              Reset Filters
            </button>
          )}
        </div>
      )}

      {/* Extractions Grid */}
      {!loading && !error && filteredExtractions.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '20px' }}>
          {filteredExtractions.map((item) => {
            const smName = getSupermarketName(item)
            const isCurrentlyOpening = isOpening === item.folderPath

            return (
              <div
                key={item.folderPath}
                className="card"
                style={{
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '16px',
                  border: item.canPreview ? '1px solid #cbd5e1' : '1px solid #e2e8f0',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                  borderRadius: '10px',
                  transition: 'all 0.2s ease',
                  backgroundColor: '#ffffff'
                }}
              >
                {/* Card Top: Supermarket & Status Badge */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <span
                      style={{
                        padding: '3px 10px',
                        borderRadius: '6px',
                        backgroundColor: '#eff6ff',
                        color: '#1d4ed8',
                        fontWeight: 700,
                        fontSize: '0.8rem',
                        border: '1px solid #bfdbfe'
                      }}
                    >
                      🛒 {smName}
                    </span>

                    <span
                      style={{
                        padding: '3px 10px',
                        borderRadius: '12px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        backgroundColor: item.canPreview ? '#f0fdf4' : '#fffbeb',
                        color: item.canPreview ? '#166534' : '#b45309',
                        border: `1px solid ${item.canPreview ? '#bbf7d0' : '#fde68a'}`
                      }}
                    >
                      {item.canPreview ? '✓ Preview Ready' : '⏳ In Progress'}
                    </span>
                  </div>

                  {/* Folder Name */}
                  <h3
                    style={{
                      margin: '0 0 8px 0',
                      fontSize: '1.15rem',
                      color: '#0f172a',
                      wordBreak: 'break-word',
                      fontWeight: 600
                    }}
                  >
                    {item.folderName}
                  </h3>

                  {/* Metadata rows */}
                  <div style={{ fontSize: '0.85rem', color: '#64748b', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {item.locationLabel && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>📍</span>
                        <span>{item.locationLabel}</span>
                      </div>
                    )}
                    {item.offerDates?.valid_from && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>📅</span>
                        <span>
                          {item.offerDates.valid_from} {item.offerDates.valid_to ? `to ${item.offerDates.valid_to}` : ''}
                        </span>
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8', fontSize: '0.8rem' }}>
                      <span>🕒</span>
                      <span>Updated {new Date(item.updatedAt || item.createdAt || '').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                    </div>
                  </div>
                </div>

                {/* Metrics Pills */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', backgroundColor: '#f8fafc', padding: '10px', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                  <div style={{ fontSize: '0.82rem', color: '#334155' }}>
                    📄 <strong>{item.pageCount}</strong> Pages
                  </div>
                  <div style={{ color: '#cbd5e1' }}>•</div>
                  <div style={{ fontSize: '0.82rem', color: '#334155' }}>
                    ✂️ <strong>{item.cropCount}</strong> Crops
                  </div>
                  <div style={{ color: '#cbd5e1' }}>•</div>
                  <div style={{ fontSize: '0.82rem', color: item.itemCount > 0 ? '#15803d' : '#64748b' }}>
                    🏷️ <strong>{item.itemCount}</strong> Offers
                  </div>
                </div>

                {/* Actions Footer */}
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <button
                    id={`preview-btn-${item.folderName}`}
                    className="btn btn-primary"
                    style={{
                      flex: 1,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      padding: '10px 16px',
                      fontWeight: 600,
                      boxShadow: '0 1px 2px rgba(37, 99, 235, 0.2)'
                    }}
                    disabled={isCurrentlyOpening}
                    onClick={() => handlePreviewClick(item.folderPath)}
                  >
                    {isCurrentlyOpening ? (
                      'Loading Preview...'
                    ) : (
                      <>
                        <span>👁️</span> Pre-Publish Preview
                      </>
                    )}
                  </button>

                  {onSelectForLoad && (
                    <button
                      className="btn btn-secondary"
                      title="Load into Import page workspace"
                      style={{ padding: '10px 12px', fontSize: '0.85rem' }}
                      onClick={() => onSelectForLoad(item.folderPath)}
                    >
                      Load
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
