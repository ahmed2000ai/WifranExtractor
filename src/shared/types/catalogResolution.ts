export interface CatalogCandidateGroup {
  candidateKey: string
  itemNameComplete: string
  brandName: string | null
  variantOrFlavor: string | null
  eachSizeValue: number | null
  eachSizeUnit: string | null
  innerPackCount: number | null
  saleUnitType: string
  nameEn: string
  nameAr: string | null
  gtin: string | null
  offerIds: string[]
  offerTitles: string[]
  evidencePaths: string[]
  evidenceUrls: string[]
}

export interface ExcludedAmbiguousOffer {
  offerId: string
  titleEn: string
  titleAr: string | null
  reason: 'assortment' | 'loose_commodity' | 'generic_unbranded' | 'missing_identity'
  details: string
}

export interface AnalyzeOfferCatalogCandidatesResult {
  totalOffers: number
  alreadyLinkedCount: number
  autoLinkedCount: number
  excludedAmbiguousCount: number
  pendingReviewCandidateCount: number
  candidates: CatalogCandidateGroup[]
  excludedOffers: ExcludedAmbiguousOffer[]
}

export interface ApproveCatalogCandidatesInput {
  candidateKeys?: string[]
  offerIds?: string[]
  operatorConfirmedIdentity: boolean
  verifiedBy?: string
  verificationBasis?: string
  gtinMap?: Record<string, string>
}

export interface ApproveCatalogCandidatesResult {
  approvedCount: number
  linkedOffersCount: number
  createdProductIds: Array<number | string>
}

