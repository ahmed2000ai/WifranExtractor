export type CropLayoutTemplateBox = {
  id: string;
  itemNumber: string;
  x: number;
  y: number;
  width: number;
  height: number;
  included: boolean;
  rowId: string;
  columnId: string;
  locked?: boolean;
  label?: string | null;
  createdFromGrid?: boolean;
};

export type CropLayoutTemplateRow = {
  id: string;
  order: number;
  boxIds: string[];
};

export type CropLayoutTemplateColumn = {
  id: string;
  order: number;
  boxIds: string[];
};

export type CropLayoutTemplate = {
  templateId: string;
  name: string;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string | null;
  supermarket_code?: string;
  supermarket_description?: string;
  sourcePageWidth: number;
  sourcePageHeight: number;
  boxCount: number;
  boxes: CropLayoutTemplateBox[];
  rowLines: number[];
  columnLines: number[];
  source?: 'manual' | 'corrected_auto_suggestion';
  origin_strategy?: string;
  origin_confidence?: number;
};

export type SaveCropLayoutTemplateInput = {
  name: string;
  notes?: string;
  supermarket_code?: string;
  supermarket_description?: string;
  sourcePageWidth: number;
  sourcePageHeight: number;
  boxes: CropLayoutTemplateBox[];
  rowLines: number[];
  columnLines: number[];
  source?: 'manual' | 'corrected_auto_suggestion';
  origin_strategy?: string;
  origin_confidence?: number;
};
