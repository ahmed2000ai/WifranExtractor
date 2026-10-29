import type { ExtractionMode, PageFirstRolloutMode } from './pageFirstExtractionMode';
import type { PageFirstCompletenessStatus } from './pageFirstCompleteness';
import type { AutomaticOfferCropStrategy } from './automaticOfferCrop';

export type PageFirstReportOfferItem = {
  temporary_offer_id: string;
  source_item_number: string;
  source_offer_key: string;
  page_number: number;
  title_ar: string | null;
  title_en: string | null;
  offer_price: number | null;
  original_price: number | null;
  size_text: string | null;
  current_price_anchor_block_id: string | null;
  linked_block_ids: string[];
  crop_path: string | null;
  crop_strategy: AutomaticOfferCropStrategy | null;
  crop_confidence: number;
  extraction_confidence: string;
  publish_decision: string;
  warnings: string[];
};

export type PageFirstReportPageItem = {
  page_number: number;
  page_classification: string;
  structured_offer_count: number;
  current_price_anchor_count: number;
  linked_offer_count: number;
  uncovered_anchor_count: number;
  uncovered_anchor_block_ids: string[];
  pass_status: 'primary_completed' | 'retry_completed' | 'unresolved' | 'failed' | 'skipped';
  completeness_status: PageFirstCompletenessStatus;
  crop_count: number;
  unresolved_reason: string | null;
  pages_processed_usage: number;
  estimated_cost_usd: number;
  warnings: string[];
  blocking_issues: string[];
};

export type PageFirstQualityMetrics = {
  total_pages: number;
  offer_pages: number;
  non_offer_pages: number;
  primary_ocr_pages: number;
  retry_ocr_pages: number;
  offers_detected: number;
  offers_linked: number;
  offers_missing_current_price_anchors: number;
  uncovered_current_price_anchors: number;
  duplicate_anchor_assignments: number;
  automatic_crops_generated: number;
  valid_crops: number;
  invalid_crops: number;
  pages_passed_without_retry: number;
  pages_passed_after_retry: number;
  unresolved_pages: number;
  estimated_cost_usd: number;
  processing_time_ms: number;

  page_automation_rate: number;
  offer_anchor_link_rate: number;
  valid_crop_rate: number;
  page_retry_rate: number;
  manual_review_rate: number;
  publishable_row_rate: number;
  critical_error_count: number;
};

export type PageFirstExtractionReport = {
  schema_version: 1;
  created_at: string;
  extraction_mode: ExtractionMode;
  rollout_mode: PageFirstRolloutMode;
  model: string;
  leaflet_base_name: string;
  package_path: string;

  metrics: PageFirstQualityMetrics;
  pages: PageFirstReportPageItem[];
  offers: PageFirstReportOfferItem[];
};
