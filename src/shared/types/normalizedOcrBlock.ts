export type NormalizedOcrBlock = {
  block_id: string;
  page_number: number;

  block_type: string | null;
  text: string;

  normalized_text: string;

  confidence: number | null;

  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  source_dimensions: {
    width: number;
    height: number;
  };

  rendered_page_bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};
