import { useState } from 'react'
import { ImageEnrichmentWorkflow } from './ImageEnrichmentWorkflow'

interface CatalogEnrichmentPanelProps {
  initialTab?: 'resolution' | 'images'
  onClose?: () => void
}

export function CatalogEnrichmentPanel({ initialTab = 'images', onClose }: CatalogEnrichmentPanelProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<'resolution' | 'images'>(initialTab)

  // Step 1: Resolution state
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisResult, setAnalysisResult] = useState<any | null>(null)
  const [selectedCandidateKeys, setSelectedCandidateKeys] = useState<Set<string>>(new Set())
  const [operatorConfirmedIdentity, setOperatorConfirmedIdentity] = useState(false)
  const [approving, setApproving] = useState(false)
  const [approvalResult, setApprovalResult] = useState<any | null>(null)
  const [step1Error, setStep1Error] = useState<string | null>(null)

  // 1. Analyze Candidates
  const handleAnalyze = async () => {
    setAnalyzing(true)
    setStep1Error(null)
    setApprovalResult(null)
    try {
      const res = await window.wifranExtractor.catalog.analyzeCandidates()
      setAnalysisResult(res)
      // Select all candidate keys by default
      const allKeys = new Set<string>((res.candidates || []).map((c: any) => c.candidateKey))
      setSelectedCandidateKeys(allKeys)
    } catch (err: any) {
      setStep1Error(err.message || 'Failed to analyze catalog candidates')
    } finally {
      setAnalyzing(false)
    }
  }

  // Toggle single candidate selection
  const toggleCandidateKey = (key: string) => {
    const next = new Set(selectedCandidateKeys)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setSelectedCandidateKeys(next)
  }

  // 2. Approve Candidates
  const handleApprove = async () => {
    if (!operatorConfirmedIdentity) return
    setApproving(true)
    setStep1Error(null)
    try {
      const res = await window.wifranExtractor.catalog.approveCandidates({
        candidateKeys: Array.from(selectedCandidateKeys),
        operatorConfirmedIdentity: true,
        verifiedBy: 'operator',
        verificationBasis: 'operator_verified_pack_identity'
      })
      setApprovalResult(res)
      // Re-run analysis to refresh state
      await handleAnalyze()
    } catch (err: any) {
      setStep1Error(err.message || 'Failed to approve catalog candidates')
    } finally {
      setApproving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-w-6xl w-full max-h-[92vh] flex flex-col overflow-hidden text-slate-100">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              Catalog Resolution &amp; Image Enrichment
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              WIFRAN-07G Rev 1.1 &amp; WIFRAN-07J Hybrid Visual Pipeline • Private Leaflet Evidence Protected
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-sm"
            >
              ✕ Close
            </button>
          )}
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 bg-slate-950/30 px-6 pt-2">
          <button
            onClick={() => setActiveTab('images')}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === 'images'
                ? 'border-indigo-500 text-indigo-400 bg-slate-800/40'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Hybrid Image Enrichment (07J)
          </button>
          <button
            onClick={() => setActiveTab('resolution')}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === 'resolution'
                ? 'border-indigo-500 text-indigo-400 bg-slate-800/40'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Catalog SKU Resolution (07G)
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* TAB 1: HYBRID IMAGE ENRICHMENT */}
          {activeTab === 'images' && <ImageEnrichmentWorkflow />}

          {/* TAB 2: CATALOG RESOLUTION */}
          {activeTab === 'resolution' && (
            <div className="space-y-6">
              {/* Action Toolbar */}
              <div className="flex items-center justify-between bg-slate-800/50 p-4 rounded-lg border border-slate-700">
                <div>
                  <h3 className="font-semibold text-white">Review-Assisted Catalog Matching</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Analyzes published offers, isolates ambiguous assortments/commodities, and groups single-product candidates for review.
                  </p>
                </div>
                <button
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-sm px-4 py-2 rounded-lg transition"
                >
                  {analyzing ? 'Analyzing Offers...' : 'Analyze Published Offers'}
                </button>
              </div>

              {step1Error && (
                <div className="p-3 bg-red-950/60 border border-red-800 text-red-300 rounded-lg text-sm">
                  {step1Error}
                </div>
              )}

              {approvalResult && (
                <div className="p-4 bg-emerald-950/60 border border-emerald-800 text-emerald-300 rounded-lg text-sm flex items-center justify-between">
                  <div>
                    <span className="font-bold">Identity Verification Approved!</span> Created/verified{' '}
                    {approvalResult.approvedCount} catalog products and safely linked{' '}
                    {approvalResult.linkedOffersCount} offers.
                  </div>
                  <button
                    onClick={() => setActiveTab('images')}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-3 py-1.5 rounded"
                  >
                    Proceed to Image Enrichment →
                  </button>
                </div>
              )}

              {analysisResult && (
                <div className="space-y-6">
                  {/* Summary Metric Cards */}
                  <div className="grid grid-cols-4 gap-4">
                    <div className="bg-slate-800/60 border border-slate-700 p-3 rounded-lg">
                      <div className="text-xs text-slate-400 font-medium">Total Published Offers</div>
                      <div className="text-2xl font-bold text-white mt-1">{analysisResult.totalOffers}</div>
                    </div>
                    <div className="bg-slate-800/60 border border-slate-700 p-3 rounded-lg">
                      <div className="text-xs text-amber-400 font-medium">Excluded Ambiguous</div>
                      <div className="text-2xl font-bold text-amber-400 mt-1">{analysisResult.excludedAmbiguousCount}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">Kept as product_id = null</div>
                    </div>
                    <div className="bg-slate-800/60 border border-slate-700 p-3 rounded-lg">
                      <div className="text-xs text-cyan-400 font-medium">Pending Candidate Groups</div>
                      <div className="text-2xl font-bold text-cyan-400 mt-1">{analysisResult.pendingReviewCandidateCount}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">Ready for operator review</div>
                    </div>
                    <div className="bg-slate-800/60 border border-slate-700 p-3 rounded-lg">
                      <div className="text-xs text-emerald-400 font-medium">Verified / Linked</div>
                      <div className="text-2xl font-bold text-emerald-400 mt-1">
                        {analysisResult.alreadyLinkedCount + analysisResult.autoLinkedCount}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">Safe catalog reuse</div>
                    </div>
                  </div>

                  {/* Pending Candidates Table */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-white uppercase tracking-wider">
                        Candidate Product Groups for Review ({analysisResult.candidates?.length || 0})
                      </h4>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            const all = new Set<string>(analysisResult.candidates.map((c: any) => c.candidateKey))
                            setSelectedCandidateKeys(all)
                          }}
                          className="text-xs text-indigo-400 hover:text-indigo-300"
                        >
                          Select All
                        </button>
                        <span className="text-slate-600">|</span>
                        <button
                          onClick={() => setSelectedCandidateKeys(new Set())}
                          className="text-xs text-slate-400 hover:text-slate-300"
                        >
                          Deselect All
                        </button>
                      </div>
                    </div>

                    <div className="border border-slate-800 rounded-lg overflow-hidden bg-slate-950/40 max-h-96 overflow-y-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 sticky top-0">
                          <tr>
                            <th className="p-3 w-8"></th>
                            <th className="p-3">Complete Item Name (CSV Export)</th>
                            <th className="p-3">Brand</th>
                            <th className="p-3">Pack &amp; Size</th>
                            <th className="p-3">Linked Offers</th>
                            <th className="p-3 text-right">Evidence</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {analysisResult.candidates.map((c: any) => {
                            const isSelected = selectedCandidateKeys.has(c.candidateKey)
                            return (
                              <tr key={c.candidateKey} className={isSelected ? 'bg-indigo-950/20' : 'opacity-70'}>
                                <td className="p-3">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleCandidateKey(c.candidateKey)}
                                    className="rounded border-slate-700 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
                                  />
                                </td>
                                <td className="p-3 font-medium text-white">{c.itemNameComplete}</td>
                                <td className="p-3 text-slate-300">{c.brandName || '—'}</td>
                                <td className="p-3 text-slate-300">
                                  {c.innerPackCount > 1 ? `${c.innerPackCount}x ` : ''}
                                  {c.eachSizeValue ? `${c.eachSizeValue} ${c.eachSizeUnit || ''}` : c.saleUnitType}
                                </td>
                                <td className="p-3 text-slate-400">
                                  <span className="bg-slate-800 px-2 py-0.5 rounded text-[11px] font-mono">
                                    {c.offerIds?.length} offer(s)
                                  </span>
                                </td>
                                <td className="p-3 text-right">
                                  {c.evidenceUrls?.[0] ? (
                                    <img
                                      src={c.evidenceUrls[0]}
                                      alt="Evidence"
                                      className="w-10 h-10 object-contain rounded border border-slate-700 bg-white/5 inline-block"
                                    />
                                  ) : (
                                    <span className="text-[11px] text-slate-500">No crop</span>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Operator Identity Confirmation & Approval Gate */}
                    <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg space-y-4">
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={operatorConfirmedIdentity}
                          onChange={(e) => setOperatorConfirmedIdentity(e.target.checked)}
                          className="mt-1 rounded border-slate-700 bg-slate-800 text-indigo-600 focus:ring-indigo-500"
                        />
                        <div className="text-xs text-slate-300 leading-relaxed">
                          <span className="font-semibold text-white">Operator Pack Identity Verification Gate:</span> I
                          confirm that I have reviewed the candidate product names, sizes, pack counts, and private leaflet
                          evidence. These selected candidate groups represent verified standalone SKU identities.
                        </div>
                      </label>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                        <div className="text-xs text-slate-400">
                          Selected for approval: <span className="font-bold text-white">{selectedCandidateKeys.size}</span>{' '}
                          candidates
                        </div>
                        <button
                          onClick={handleApprove}
                          disabled={approving || !operatorConfirmedIdentity || selectedCandidateKeys.size === 0}
                          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2 rounded-lg transition shadow-lg"
                        >
                          {approving ? 'Creating & Linking Products...' : 'Approve & Link Verified Products'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Excluded Ambiguous Offers Accordion */}
                  {analysisResult.excludedOffers?.length > 0 && (
                    <div className="border border-slate-800 rounded-lg p-4 bg-slate-950/20 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-2">
                          <span>🛡️</span> Excluded Ambiguous Offers ({analysisResult.excludedOffers.length})
                        </h4>
                        <span className="text-[11px] text-slate-500">
                          Strictly kept with product_id = null (WIFRAN-07G §6 &amp; WIFRAN-07H §2)
                        </span>
                      </div>
                      <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                        {analysisResult.excludedOffers.map((ex: any) => (
                          <div
                            key={ex.offerId}
                            className="text-xs p-2 rounded bg-slate-900/60 border border-slate-800/80 flex items-center justify-between"
                          >
                            <span className="font-medium text-slate-300">{ex.titleEn}</span>
                            <span className="text-[11px] px-2 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-800/50">
                              {ex.details}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

