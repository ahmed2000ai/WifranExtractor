export type LocalDetectorPageResult = {
  schema_version: 1;

  page_number: number;
  page_image_path: string;

  model: {
    model_id: string;
    model_version: string;
    model_path: string;
    model_hash: string;
  };

  inference: {
    started_at: string;
    completed_at: string;
    duration_ms: number;
    execution_provider: 'cpu' | 'cuda' | 'directml' | 'other';
  };

  predictions: Array<{
    id: string;
    class_name: 'offer_block';
    confidence: number;

    x: number;
    y: number;
    width: number;
    height: number;
  }>;

  warnings: Array<{
    code: string;
    message: string;
  }>;
};

export type DetectorPageQualityResult = {
  page_number: number;

  status:
    | 'high_confidence'
    | 'review_recommended'
    | 'low_confidence'
    | 'no_offers_detected'
    | 'failed';

  score: number;

  metrics: {
    predicted_box_count: number;
    refined_box_count: number;
    low_confidence_box_count: number;
    overlap_conflict_count: number;
    suspicious_large_box_count: number;
    uncovered_content_warning_count: number;
  };

  reason_codes: string[];
};

export type AutoAcceptanceReadiness = {
  eligible: boolean;
  reason_codes: string[];
  page_quality_score: number;
  model_maturity_status:
    | 'no_active_model'
    | 'immature'
    | 'validated'
    | 'highly_validated';
};
