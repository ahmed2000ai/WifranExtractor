export type FinalPublishDecision =
  | 'publish'
  | 'publish_but_exclude_from_comparison'
  | 'skip_or_quarantine';

export type PublishDecisionReason = {
  code: string;
  severity: 'blocking' | 'warning' | 'comparison_exclusion' | 'info';
  message: string;
};

export type PublishDecisionResult = {
  decision: FinalPublishDecision;
  display_safe: boolean;
  comparison_safe: boolean;
  should_upload_image: boolean;
  should_upsert_db: boolean;
  status_for_db: 'published' | 'needs_review' | 'skipped' | null;
  comparison_eligible: boolean;
  comparison_exclusion_reason: string | null;
  reasons: PublishDecisionReason[];
};
