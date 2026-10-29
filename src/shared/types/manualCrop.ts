export type SuggestedCropBox = {
  id: string;
  pageNumber: number;

  x: number;
  y: number;
  width: number;
  height: number;

  confidence: number;

  source:
    | 'brand_template_auto_match'
    | 'local_cv_detection'
    | 'local_ml_detection_refined'
    | 'manual_generated_grid'
    | 'operator_manual'
    | 'price_anchor_split'
    | 'leaflet_session_adapted';

  reasonCodes: string[];

  status:
    | 'suggested'
    | 'accepted'
    | 'edited'
    | 'rejected';

  templateId?: string | null;
  supermarketCode?: string | null;
};

export type TemplateAutoMatchResult = {
  matched: boolean;
  templateId: string | null;
  templateName: string | null;
  supermarketCode: string | null;
  confidence: number;
  reasonCodes: string[];
  scaledBoxes: SuggestedCropBox[];
};

export type PageCropSuggestionResult = {
  pageNumber: number;
  pageImagePath: string;

  strategy:
    | 'brand_template_auto_match'
    | 'local_ml_detection_refined'
    | 'local_cv_detection'
    | 'price_anchor_split'
    | 'leaflet_session_adapted'
    | 'none';

  confidence: number;

  suggestedBoxes: SuggestedCropBox[];

  diagnostics: {
    pageWidth: number;
    pageHeight: number;
    candidateCountBeforeFiltering: number;
    candidateCountAfterFiltering: number;
    rejectedCandidateCount: number;
    reasonCodes: string[];
  };

  warnings: Array<{
    code: string;
    message: string;
  }>;
};

export type ManualCropRow = {
  id: string;
  order: number;
  boxIds: string[];
};

export type ManualCropColumn = {
  id: string;
  order: number;
  boxIds: string[];
};

export type ManualPageCropStatus =
  | 'not_started'
  | 'queued'
  | 'running'
  | 'ready'
  | 'stale'
  | 'failed'
  | 'warning';

export type ManualPageCropInfo = {
  pageNumber: number;
  status: ManualPageCropStatus;
  expectedCropCount: number;
  generatedCropCount: number;
  outputDir: string | null;
  cropFiles: Array<{
    pageNumber: number;
    itemNumber: string;
    boxId: string;
    localImagePath: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: {
    code: string;
    message: string;
  } | null;
  warning?: {
    code: string;
    message: string;
  } | null;
};


export type ManualCropBox = {
  id: string;
  pageNumber: number;
  itemNumber: string;
  x: number; // 0.0 to 1.0 (normalized) OR absolute pixel coords? Prompt says: "Use pixel coordinates relative to the rendered page image. Do not store screen/display coordinates as final crop coordinates."
  y: number;
  width: number;
  height: number;
  included: boolean;
  rowId: string;
  columnId: string;
  locked?: boolean;
  label?: string | null;
  linkedRowIndex?: number | null;
  linkedColumnIndex?: number | null;
  createdFromGrid?: boolean;
  provenance?: 'price_anchor_split' | 'leaflet_session_adapted' | 'ctrl_drag_clone';
};

export type ManualCropPageLayout = {
  pageNumber: number;
  pageImagePath: string;
  pageWidth: number;
  pageHeight: number;
  gridRows: number;
  gridColumns: number;
  rows?: ManualCropRow[];
  columns?: ManualCropColumn[];
  rowLines: number[]; // Pixel coordinates of horizontal dividers
  columnLines: number[]; // Pixel coordinates of vertical dividers
  boxes: ManualCropBox[];
  suggestedBoxes?: SuggestedCropBox[];
  pageComplete?: boolean;
  cropStatus?: ManualPageCropStatus;
  cropInfo?: ManualPageCropInfo;
  queue_status?: 'accepted' | 'review_required' | 'corrected';
  completedAt?: string | null;
  updatedAt: string;
};

export type ManualCropSession = {
  importBatchId?: string | null;
  pdfPath?: string | null;
  pageLayouts: ManualCropPageLayout[];
  deletedPages?: number[];
};

export type ManualCropResult = {
  ok: boolean;
  pageNumber: number;
  totalBoxes: number;
  includedBoxes: number;
  skippedBoxes: number;
  croppedImages: Array<{
    itemNumber: string;
    pageNumber: number;
    cropPath: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  error?: {
    code: string;
    message: string;
  };
};
