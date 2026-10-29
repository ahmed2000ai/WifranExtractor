import { z } from 'zod';

export const accuracyRunReportItemSchema = z.object({
  source_page_number: z.number().nullable(),
  source_item_number: z.string(),
  crop_path: z.string().nullable(),
  raw_json_path: z.string().nullable(),
  canonical_json_path: z.string().nullable(),
  validation_json_path: z.string().nullable(),

  title_ar: z.string().nullable(),
  title_en: z.string().nullable(),
  brand_text: z.string().nullable(),
  item_domain: z.string().nullable(),

  offer_price: z.number().nullable(),
  original_price: z.number().nullable(),
  currency: z.string().nullable(),

  size_text: z.string().nullable(),
  pack_quantity: z.number().nullable(),
  bundle_quantity: z.number().nullable(),
  price_basis: z.string().nullable(),
  promotion_mechanic: z.string().nullable(),

  extraction_confidence: z.string().nullable(),
  validation_result: z.string().nullable(),
  validation_confidence: z.string().nullable(),

  publish_decision: z.enum(['publish', 'publish_but_exclude_from_comparison', 'skip_or_quarantine']),

  comparison_eligible: z.boolean(),
  comparison_unit: z.string().nullable(),
  comparison_unit_price: z.number().nullable(),
  comparison_exclusion_reason: z.string().nullable(),

  blocking_errors: z.array(z.object({ code: z.string(), message: z.string() })),
  non_blocking_warnings: z.array(z.object({ code: z.string(), message: z.string() })),

  image_upload_status: z.enum(['not_started', 'success', 'failed', 'skipped']),
  db_upsert_status: z.enum(['not_started', 'success', 'failed', 'skipped']),
  db_error_message: z.string().nullable()
});

export const accuracyRunReportSchema = z.object({
  schema_version: z.literal(1),
  report_id: z.string(),
  created_at: z.string(),
  updated_at: z.string().nullable(),

  package: z.object({
    package_name: z.string(),
    package_path: z.string().nullable(),
    leaflet_id: z.string().nullable(),
    source_pdf_path: z.string().nullable()
  }),

  context: z.object({
    supermarket_name: z.string().nullable(),
    supermarket_slug: z.string().nullable(),
    coverage_scope: z.enum(['national', 'region', 'city']).nullable(),
    location_label: z.string().nullable(),
    city_id: z.string().nullable(),
    region_id: z.string().nullable(),
    offer_start_date: z.string().nullable(),
    offer_end_date: z.string().nullable()
  }),

  counts: z.object({
    total_crops: z.number(),
    total_raw_json: z.number(),
    total_canonical_items: z.number(),

    extraction_calls: z.number(),
    validation_calls: z.number(),
    style_profile_calls: z.number(),

    extracted_count: z.number(),
    validation_pass_count: z.number(),
    validation_corrected_count: z.number(),
    validation_failed_count: z.number(),

    publish_count: z.number(),
    publish_but_exclude_from_comparison_count: z.number(),
    skip_or_quarantine_count: z.number(),

    comparison_eligible_count: z.number(),
    comparison_excluded_count: z.number(),
    non_grocery_count: z.number(),

    price_ambiguity_count: z.number(),
    size_as_price_detections: z.number(),
    old_price_as_offer_price_detections: z.number(),

    image_upload_success_count: z.number(),
    image_upload_failure_count: z.number(),
    db_upsert_success_count: z.number(),
    db_upsert_failure_count: z.number(),

    pre_publish_preview_opened_count: z.number(),
    pre_publish_approved_count: z.number()
  }),

  warnings_by_code: z.record(z.string(), z.number()),
  errors_by_code: z.record(z.string(), z.number()),
  comparison_exclusions_by_code: z.record(z.string(), z.number()),

  queue_summary: z.object({
    total_mistral_requests: z.number(),
    total_queue_wait_ms: z.number().nullable(),
    completed_by_kind: z.record(z.string(), z.number()),
    failed_by_kind: z.record(z.string(), z.number()),
    retry_after_count: z.number().nullable(),
    rate_limit_429_count: z.number().nullable()
  }),

  pre_publish_preview: z.object({
    status: z.enum(['not_opened', 'opened', 'approved', 'not_available']),
    opened_at: z.string().nullable(),
    approved_at: z.string().nullable(),
    publish_count: z.number(),
    publish_but_exclude_from_comparison_count: z.number(),
    skip_or_quarantine_count: z.number(),
    warning_count: z.number(),
    blocking_error_count: z.number()
  }),

  db_update: z.object({
    status: z.enum(['not_started', 'running', 'completed', 'failed', 'partial']),
    started_at: z.string().nullable(),
    completed_at: z.string().nullable(),
    error_message: z.string().nullable()
  }),

  items: z.array(accuracyRunReportItemSchema)
});
