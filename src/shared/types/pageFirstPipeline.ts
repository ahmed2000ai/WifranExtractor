export type PageFirstProgressEvent = {
  stage: 'initializing' | 'rendering' | 'ocr_running' | 'linking' | 'cropping' | 'validating' | 'retrying' | 'completed' | 'failed';
  currentPage: number;
  totalPages: number;
  primaryCompletedPages: number;
  retryCompletedPages: number;
  completedPages: number;
  unresolvedPages: number;
  failedPages: number;
  offersDetected: number;
  offersLinked: number;
  cropsGenerated: number;
  estimatedCostUsd: number;
  elapsedMs: number;
  message?: string;
};

export type PageFirstPipelineResult = {
  status: 'completed' | 'completed_with_warnings' | 'unresolved' | 'failed';
  totalPages: number;
  completedPages: number;
  unresolvedPages: number;
  failedPages: number;
  offersDetected: number;
  offersLinked: number;
  cropsGenerated: number;
  estimatedCostUsd: number;
  reportPath: string;
};

export type ProcessPageResult = {
  status: string;
  offers_detected: number;
  offers_linked: number;
  crops_generated: number;
  completeness_score: number;
  warnings: string[];
  blocking_issues: Array<{ code: string; message: string }>;
};

export type PageFirstPipelineStatus = {
  status: string;
  total_pages: number;
  completed_pages: number;
  unresolved_pages: number;
  offers_detected: number;
  offers_linked: number;
  crops_generated: number;
  estimated_cost_usd: number;
};
