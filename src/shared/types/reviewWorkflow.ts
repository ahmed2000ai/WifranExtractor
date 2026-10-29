import type { ReviewItem } from './itemOcr'
import type { ManualCropPageLayout } from './manualCrop'

// ── Crop + Item OCR Workflow ────────────────────────────────────────────────

export type CropAndItemOcrWorkflowInput = {
  workspacePath: string;
  layouts: ManualCropPageLayout[];
  imageFormat: 'webp' | 'jpg' | 'jpeg' | 'png';
  imageQuality: number;
};

export type CropAndItemOcrProgressStage =
  | 'started'
  | 'validating_layouts'
  | 'cropping_started'
  | 'crop_completed'
  | 'crop_failed'
  | 'ocr_queued'
  | 'ocr_started'
  | 'ocr_waiting_rate_limit'
  | 'ocr_completed'
  | 'ocr_failed'
  | 'writing_review_package'
  | 'completed'
  | 'partially_completed'
  | 'failed'
  | 'flexible_item_ocr_queued'
  | 'flexible_item_ocr_started'
  | 'flexible_item_ocr_waiting_rate_limit'
  | 'flexible_item_ocr_completed'
  | 'flexible_item_ocr_failed'
  | 'flexible_item_json_written'
  | 'ocr_returned_keys_updated'
  | 'ocr_keys_without_values_updated';

export type CropAndItemOcrProgressEvent = {
  stage: CropAndItemOcrProgressStage;
  message: string;
  pageNumber?: number;
  itemNumber?: string;
  currentCrop?: number;
  totalCrops?: number;
  currentOcr?: number;
  totalOcr?: number;
  localImagePath?: string;
  waitMs?: number;
};

export type CropAndItemOcrWorkflowResult = {
  ok: boolean;
  totalPages: number;
  totalCrops: number;
  totalOcrCompleted: number;
  totalOcrFailed: number;
  reviewItems: ReviewItem[];
  reviewSummaryPath: string;
  reviewItemsPath: string;
  cropFolderPath: string;
  returnedKeysRegistryPath?: string;
  keysWithoutValuesPath?: string;
  error?: string;
};

// ── Pre-DB Review ───────────────────────────────────────────────────────────

export type PreDbReviewSummaryJson = {
  total_pages: number;
  total_crops: number;
  total_ocr_completed: number;
  total_ocr_failed: number;
  pages: Array<{
    page_number: number;
    crop_count: number;
    ocr_completed: number;
    ocr_failed: number;
  }>;
};

export type PreDbReviewItemsJson = {
  items: Array<{
    page_number: number;
    item_number: string;
    local_image_path: string;
    crop_box: { x: number; y: number; width: number; height: number };
    ocr_status: string;
    ocr: import('./itemOcr').ItemOcrJson | null;
    ocr_error: { code: string; message: string } | null;
    canonical?: import('./canonicalOffer').CanonicalOffer | null;
  }>;
};

// ── Flexible OCR Metadata ───────────────────────────────────────────────────

export type FlexibleItemOcrSummaryJson = {
  total_images: number;
  ocr_completed: number;
  ocr_failed: number;
  json_files_written: number;
  returned_keys_registry_path: string;
  keys_without_values_path: string;
  items: Array<{
    image_path: string;
    json_path: string;
    status: 'completed' | 'failed' | 'warning' | 'pending' | 'running';
    keys_returned: string[];
    new_keys_with_values_added: string[];
    new_keys_without_values_added: string[];
    error: string | null;
  }>;
};

// ── Layout Validation ───────────────────────────────────────────────────────

export type LayoutValidationIssue = {
  pageNumber: number;
  message: string;
};

export type LayoutValidationResult = {
  ok: boolean;
  issues: LayoutValidationIssue[];
};
