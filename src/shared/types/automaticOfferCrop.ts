export type AutomaticOfferCropStrategy =
  | 'evidence_union'
  | 'price_anchor_partition'
  | 'gutter_refined'
  | 'exception_fallback';

export type AutomaticOfferCrop = {
  page_number: number;
  source_offer_key: string;
  source_item_number: string;

  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  included_block_ids: string[];
  included_image_region_ids: string[];

  current_price_anchor_block_id: string;

  crop_confidence: number;

  strategy: AutomaticOfferCropStrategy;

  warnings: string[];
};
