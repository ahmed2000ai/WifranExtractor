export type PageOfferEvidenceLink = {
  temporary_offer_id: string;

  linked_block_ids: string[];

  title_block_ids: string[];
  description_block_ids: string[];

  current_price_block_ids: string[];
  original_price_block_ids: string[];

  size_content_block_ids: string[];
  promotion_block_ids: string[];

  current_price_anchor_block_id: string | null;

  confidence: number;

  unmatched_evidence: Array<{
    field: string;
    evidence_text: string;
  }>;

  warnings: string[];
};
