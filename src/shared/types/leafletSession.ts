export type LeafletPageLayoutFingerprint = {
  pageNumber: number;
  pageImagePath: string;

  pageWidth: number;
  pageHeight: number;

  perceptualHash: string | null;
  colorHistogram: number[];
  edgeGrid: number[];
  whitespaceGrid: number[];

  normalizedPriceAnchorCenters: Array<{
    x: number;
    y: number;
  }>;

  priceAnchorCount: number;

  createdAt: string;
};

export type LeafletLayoutCluster = {
  clusterId: string;

  memberPageNumbers: number[];
  confirmedPageNumbers: number[];
  unreviewedPageNumbers: number[];

  prototypeConfidence: number;

  prototype: {
    normalizedConfirmedBoxes: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>;

    normalizedPriceAnchors: Array<{
      x: number;
      y: number;
    }>;

    expectedBoxCountRange: {
      min: number;
      max: number;
    };
  } | null;
};

export type LeafletLayoutSession = {
  schema_version: 1;

  leafletId: string | null;
  supermarketCode: string | null;

  createdAt: string;
  updatedAt: string;

  fingerprints: Record<string, LeafletPageLayoutFingerprint>;
  clusters: LeafletLayoutCluster[];

  adaptationEvents: Array<{
    eventId: string;
    confirmedPageNumber: number;
    clusterId: string;
    affectedPageNumbers: number[];
    createdAt: string;
    resultSummary: string;
  }>;
};
