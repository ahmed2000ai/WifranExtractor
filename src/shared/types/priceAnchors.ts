export type PriceAnchorGroup = {
  id: string;
  pageNumber: number;

  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  currentPriceRegion: {
    bounds: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    confidence: number;
  } | null;

  originalPriceRegions: Array<{
    bounds: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    confidence: number;
    likelyCrossedOut: boolean;
  }>;

  currencyRegions: Array<{
    bounds: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    confidence: number;
  }>;

  confidence: number;

  reasonCodes: string[];
};

export type OfferBoxAnchorDiagnostic = {
  boxId: string;

  containedAnchorGroupIds: string[];
  containedIndependentCurrentPriceCount: number;

  uncoveredAnchorGroupIds: string[];

  status:
    | 'valid_single_anchor'
    | 'multi_anchor_requires_split'
    | 'no_anchor_requires_review'
    | 'ambiguous';

  reasonCodes: string[];
};

export type PageOfferCompletenessResult = {
  pageNumber: number;

  status:
    | 'complete'
    | 'review_required'
    | 'failed';

  priceAnchorCount: number;
  suggestedBoxCount: number;

  uncoveredAnchorIds: string[];
  duplicateAnchorIds: string[];
  multiAnchorBoxIds: string[];
  anchorlessBoxIds: string[];

  largeUncoveredRegions: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;

  score: number;
  reasonCodes: string[];
};
