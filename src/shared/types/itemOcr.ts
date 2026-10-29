/**
 * Strict item-level OCR JSON — returned by Mistral for a single cropped item image.
 * No page_number, no bounding boxes, no coordinates, no brand/category, no confidence.
 */
export type ItemOcrJson = Record<string, unknown>;

/**
 * Metadata stored outside OCR JSON. Tracks crop context and OCR status per item.
 */
export type ReviewItem = {
  pageNumber: number;
  itemNumber: string;
  localImagePath: string;
  cropBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  ocr: ItemOcrJson | null;
  ocrStatus: 'pending' | 'running' | 'completed' | 'failed' | 'warning';
  ocrError?: {
    code: string;
    message: string;
  } | null;
  canonical?: import('./canonicalOffer').CanonicalOffer | null;
  localJsonPath?: string;
  aliasesReplaced?: Array<{ alias: string; canonicalKey: string }>;
  newKeysAdded?: string[];
  collisions?: Array<{
    canonicalKey: string;
    keptValue: unknown;
    discardedValues: unknown[];
    sourceKeys: string[];
  }>;
};
