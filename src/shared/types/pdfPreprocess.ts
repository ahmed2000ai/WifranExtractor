export type PdfPreprocessInput = {
  pdfFilePath: string
  originalFileName: string
  chunkSize: number
  renderDpi: number
}

export type PdfPreprocessProgressStage =
  | 'workspace_created'
  | 'pdf_validating'
  | 'pdf_validated'
  | 'pdf_copying'
  | 'pdf_splitting'
  | 'page_rendering'
  | 'metadata_written'
  | 'completed'
  | 'failed'

export type PdfPreprocessProgressEvent = {
  stage: PdfPreprocessProgressStage
  message: string
  current?: number
  total?: number
  details?: Record<string, unknown>
}

export type PdfChunkMetadata = {
  chunkId: string
  chunkIndex: number
  chunkPdfPath: string
  originalPageNumbers: number[]
  firstOriginalPageNumber: number
  lastOriginalPageNumber: number
}

export type RenderedPageMetadata = {
  pageNumber: number
  imagePath: string
  width: number
  height: number
  dpi: number
}

export type PdfPreprocessResult = {
  ok: boolean
  workspaceId?: string
  workspacePath?: string
  sourcePdfPath?: string
  originalFileName?: string
  pageCount?: number
  chunkSize?: number
  chunks?: PdfChunkMetadata[]
  renderedPages?: RenderedPageMetadata[]
  metadataPath?: string
  error?: {
    code: string
    message: string
  }
}

// ── Streaming Render Types (Chunk 30) ───────────────────────────────────────

export type RenderedPageInfo = {
  pageNumber: number;
  imagePath: string;
  width: number;
  height: number;
  dpi: number;
  status: 'queued' | 'rendering' | 'rendered' | 'failed';
  error?: {
    code: string;
    message: string;
  } | null;
};

export type StreamingPdfRenderInput = {
  jobId?: string;
  pdfPath: string;
  workspacePath?: string;
  dpi: number;
  chunkSize?: number;
  pageCount?: number | null;
  originalFileName?: string;
  metadata?: any;
  selectedPages?: number[];
  selectionMode?: 'all' | 'specific';
};

export type StreamingPdfRenderProgressEvent = {
  jobId?: string;
  stage:
    | 'started'
    | 'workspace_created'
    | 'pdf_validating'
    | 'pdf_validated'
    | 'pdf_copying'
    | 'pdf_splitting'
    | 'page_queued'
    | 'page_rendering'
    | 'page_rendered'
    | 'page_failed'
    | 'completed'
    | 'partially_completed'
    | 'failed';

  message: string;
  pageNumber?: number;
  renderedPages: number;
  failedPages: number;
  totalPages: number;
  page?: RenderedPageInfo;
  workspacePath?: string;
  chunks?: PdfChunkMetadata[];
};

export type StreamingPdfRenderState = {
  status:
    | 'not_started'
    | 'running'
    | 'completed'
    | 'partially_completed'
    | 'failed';

  totalPages: number;
  totalDocumentPages?: number;
  selectedPages?: number[];
  selectionMode?: 'all' | 'specific';
  renderedPages: number;
  failedPages: number;
  pages: RenderedPageInfo[];
  firstPageReady: boolean;
  workspacePath?: string;
  chunks?: PdfChunkMetadata[];
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
};
