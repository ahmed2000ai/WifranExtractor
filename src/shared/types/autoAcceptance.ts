export type CropAutoAcceptanceMode =
  | 'disabled'
  | 'shadow'
  | 'assisted'
  | 'automatic';

export type PageAutoAcceptanceDecision = {
  schema_version: 1;

  page_number: number;

  decision:
    | 'auto_accept'
    | 'recommend_accept'
    | 'review_required'
    | 'blocked';

  mode: CropAutoAcceptanceMode;

  would_auto_accept_in_automatic_mode: boolean;

  score: number;

  model: {
    model_id: string | null;
    model_version: string | null;
    maturity:
      | 'no_active_model'
      | 'immature'
      | 'validated'
      | 'highly_validated';
  };

  metrics: {
    box_count: number;
    minimum_box_confidence: number | null;
    average_box_confidence: number | null;
    page_quality_score: number | null;
    overlap_conflict_count: number;
    suspicious_large_box_count: number;
    suspicious_small_box_count: number;
    uncovered_content_warning_count: number;
    detector_cv_disagreement_score: number | null;
    invalid_coordinate_count: number;
  };

  required_checks: Array<{
    code: string;
    passed: boolean;
    actual: unknown;
    required: unknown;
  }>;

  reason_codes: string[];
  warnings: string[];

  decided_at: string;
};

export type CropLayoutReviewQueueEntry = {
  page_number: number;
  status:
    | 'recommend_accept'
    | 'review_required'
    | 'blocked'
    | 'resolved';

  priority: 'critical' | 'high' | 'normal';

  reason_codes: string[];
  page_quality_score: number | null;
  minimum_box_confidence: number | null;
  suggestion_count: number;
  resolved_at: string | null;
};

export type CropLayoutReviewQueue = {
  schema_version: 1;
  created_at: string;
  updated_at: string;

  total_pages: number;
  auto_accepted_pages: number;
  recommended_accept_pages: number;
  review_required_pages: number;
  blocked_pages: number;

  entries: CropLayoutReviewQueueEntry[];
};
