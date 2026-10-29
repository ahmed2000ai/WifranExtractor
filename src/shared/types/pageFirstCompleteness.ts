export type PageFirstCompletenessStatus =
  | 'pass'
  | 'pass_with_warnings'
  | 'retry_required'
  | 'unresolved'
  | 'failed';

export type PageFirstCompletenessResult = {
  page_number: number;

  status: PageFirstCompletenessStatus;

  structured_offer_count: number;
  linked_offer_count: number;
  current_price_anchor_count: number;

  uncovered_current_price_anchor_block_ids: string[];
  duplicate_anchor_assignments: string[];
  offers_missing_current_price_link: string[];
  offers_with_multiple_current_price_links: string[];

  crop_geometry_failures: string[];

  blocking_issues: Array<{
    code: string;
    message: string;
  }>;

  warnings: Array<{
    code: string;
    message: string;
  }>;

  score: number;
};
