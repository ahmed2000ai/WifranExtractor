/**
 * WIFRAN BATCH EXTRACTION TYPES
 * Milestone: WIFRAN-EXTRACTOR-BULK-001
 * Multi-Leaflet Batch Extraction & Unified Pre-Publish Preview
 */

export type BatchStatus =
  | 'created'
  | 'validating'
  | 'extracting'
  | 'completed'
  | 'partially_published'
  | 'completed_with_errors'
  | 'cancelled'
  | 'failed';

export type LeafletBatchStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ExtractionLifecycleStatus =
  | 'not_started'
  | 'in_progress'
  | 'partially_extracted'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ReviewLifecycleStatus =
  | 'pending'
  | 'in_review'
  | 'needs_review'
  | 'ready'
  | 'completed';

export type PublicationLifecycleStatus =
  | 'not_published'
  | 'partially_published'
  | 'published'
  | 'failed';

export interface ActiveWorkflowSession {
  schemaVersion: 'wifran.workflow.session/1.0';
  activeBatchId: string | null;
  activeStep: 1 | 2 | 3 | 4;
  selectedLeafletIds?: string[];
  updatedAt: string;
}

export type OfferPublicationStatus =
  | 'extracted'
  | 'reviewed'
  | 'ready_for_matching'
  | 'ready_for_publication'
  | 'published';

export type ExtractionPipelineMode = 'legacy_rev1' | 'hybrid_v3';

export type PageSelectionMode = 'all' | 'specific';

export type MetadataFieldKey =
  | 'retailer'
  | 'validity'
  | 'title'
  | 'currency'
  | 'locationScope';

export type MetadataAcceptanceStatus =
  | 'auto_accepted'
  | 'operator_verified'
  | 'needs_review';

export type ReviewTriageCategory =
  | 'ready'
  | 'needs_review'
  | 'blocked';

export type OfferEligibilityStatus =
  | ReviewTriageCategory
  | 'published';

export interface LeafletMetadataRevision {
  revision: number;
  updatedAt: string;
  updatedBy: string;
  reason?: string | null;
  metadata: {
    supermarketId?: string | null;
    supermarketName?: string | null;
    locationScope?: 'national' | 'region' | 'city' | null;
    locationLabel?: string | null;
    locationSlug?: string | null;
    cityId?: string | null;
    regionId?: string | null;
    offerStartDate?: string | null;
    offerEndDate?: string | null;
    currency?: string | null;
    leafletTitle?: string | null;
  };
}

export interface OfferBatchPublicationState {
  state: 'published';
  databaseContext: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST';
  publishOperationId: string;
  publishedAt: string;
  sourceOfferId: string;
  batchOfferKey?: string | null;
  offerId?: string | null;
  productId?: string | null;
  imageUrl?: string | null;
  committedMetadataVersion?: number | null;
  needsUpdateReview?: boolean;
}

export interface BatchPublicationOperationRecord {
  publishOperationId: string;
  databaseContext: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST';
  publishedAt: string;
  publishedOfferKeys: string[];
  deferredOfferKeys: string[];
  alreadyPublishedOfferKeys: string[];
  insertedOffersCount: number;
  updatedOffersCount: number;
  undoneAt?: string | null;
}

export type ProcessingStageStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

export type GeographicScopeSource =
  | 'explicit_leaflet_evidence'
  | 'operator_override'
  | 'default_national';

export interface MetadataFieldEvidenceSummary {
  field: MetadataFieldKey;
  sourcePage?: number | null;
  method: 'offline_text' | 'hybrid_extraction' | 'targeted_vision' | 'operator' | 'default_rule';
  evidenceText?: string | null;
  confidence?: number;
}

export interface MetadataValidityConflictSummary {
  startDate: string | null;
  endDate: string | null;
  rawPrintedText?: string;
  sourcePage: number;
}

export interface LeafletMetadataScope {
  supermarketId?: string | null;
  supermarketName?: string | null;
  locationScope?: 'national' | 'region' | 'city' | null;
  locationLabel?: string | null;
  locationSlug?: string | null;
  cityId?: string | null;
  regionId?: string | null;
  offerStartDate?: string | null;
  offerEndDate?: string | null;
  validityNormalizationError?: string | null;
  detectedCities?: string[];
  geographicNotice?: string | null;
  scopeSource?: GeographicScopeSource | null;
  leafletTitle?: string | null;
  currency?: string | null;
  currencyConflict?: boolean;
  verified?: boolean;
  metadataStatus?: MetadataAcceptanceStatus;
  metadataStatusReasons?: string[];
  verifiedAt?: string | null;
  verifiedBy?: string | null;
  discoverySource?: 'package_discovery' | 'targeted_vision' | 'operator_verified' | 'unverified';
  discoveryStatus?: 'ok' | 'partial' | 'no_text_found' | 'error';
  discoveryMessage?: string | null;
  discoveryError?: string | null;
  unresolvedFields?: MetadataFieldKey[];
  evidenceByField?: Partial<Record<MetadataFieldKey, MetadataFieldEvidenceSummary>>;
  conflictingValidity?: MetadataValidityConflictSummary[];
  visionCostUsd?: number;
  visionRequestsUsed?: number;
  visionCacheHit?: boolean;
  visionTargetPages?: number[];
  metadataVersion?: number;
  metadataRevisions?: LeafletMetadataRevision[];
}

export interface LeafletBatchItem {
  leafletId: string;
  documentId?: string;
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  fileFingerprint: string;
  pageCount: number;
  pagesToProcess?: number[];
  reusedPages?: number[];
  payablePages?: number[];
  pageSelectionMode?: 'all' | 'specific';
  pageSelectionInput?: string;
  pagesProcessed: number;
  offersCount: number;
  estimatedCostUsd: number;
  status: LeafletBatchStatus;
  extractionStatus?: ExtractionLifecycleStatus;
  reviewStatus?: ReviewLifecycleStatus;
  publicationStatus?: PublicationLifecycleStatus;
  publicationError?: string | null;
  lastPublishedAt?: string | null;
  publishedOffersCount?: number;
  deferredOffersCount?: number;
  readyOffersCount?: number;
  blockedOffersCount?: number;
  transferStatus?: 'active' | 'transferred';
  transferredToBatchId?: string | null;
  transferredAt?: string | null;
  originalBatchId?: string | null;
  workspacePath: string;
  provenance: 'fresh' | 'cache' | 'mixed';
  metadata: LeafletMetadataScope;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
}

export interface BatchApprovedScope {
  hybridV3Authorized: boolean;
  hybridV3LiveAuthorized: boolean;
  totalTargetPages: number;
  pagesByLeafletId: Record<string, number[]>;
  approvedMaxBudgetUsd?: number | null;
  autoRunCatalogMatching?: boolean;
  targetDatabaseContext?: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST';
  authorizedAt: string;
}

export interface BatchProcessingStages {
  extraction: ProcessingStageStatus;
  metadata: ProcessingStageStatus;
  crops: ProcessingStageStatus;
  matching: ProcessingStageStatus;
}

export interface BatchMatchingStageSummary {
  status: string;
  databaseContext?: 'PRODUCTION_UI' | 'DEVELOPMENT_TEST';
  actualCostUsd: number;
  existingMatchesCount: number;
  temporaryGroupsCount: number;
  unresolvedCount: number;
  error?: string | null;
}

export interface BatchTotals {
  totalPdfs: number;
  completedPdfs: number;
  failedPdfs: number;
  cancelledPdfs: number;
  totalPages: number;
  pagesProcessed: number;
  totalOffers: number;
  totalCostUsd: number;
}

export interface BatchManifest {
  schemaVersion: '1.0';
  batchId: string;
  createdAt: string;
  updatedAt: string;
  status: BatchStatus;
  extractionStatus?: ExtractionLifecycleStatus | 'completed_with_errors';
  reviewStatus?: ReviewLifecycleStatus;
  publicationStatus?: PublicationLifecycleStatus;
  parentBatchId?: string | null;
  splitHistory?: Array<{ splitBatchId: string; transferredLeafletIds: string[]; transferredAt: string }>;
  transferredLeaflets?: LeafletBatchItem[];
  historicalTotals?: BatchTotals;
  workspaceDir: string;
  leaflets: LeafletBatchItem[];
  totals: BatchTotals;
  costSummary?: import('./costAccounting').BatchExtractionCostSummary | null;
  executionMode: 'flex' | 'standard';
  extractionPipelineMode?: ExtractionPipelineMode;
  approvedScope?: BatchApprovedScope;
  processingStages?: BatchProcessingStages;
  matchingSummary?: BatchMatchingStageSummary | null;
  publishedOffers?: Record<string, OfferBatchPublicationState>;
  publicationOperations?: BatchPublicationOperationRecord[];
  archivedFromActiveWorkspace?: boolean;
  model: string;
  error?: string | null;
}

export interface UnifiedBatchOffer {
  /**
   * Globally unique offer reference within this batch:
   * Format: `${batchId}:${leafletId}:${pageNumber}:${sourceOfferId}`
   */
  batchOfferKey: string;
  batchId: string;
  leafletId: string;
  sourceDocumentId?: string | null;
  sourceFileName: string;
  sourcePdfPath: string;
  sourceFileFingerprint?: string | null;
  sourcePage: number;
  sourcePageHash?: string | null;
  sourceOfferId: string;
  sourceOfferAnchor?: string | null;
  sourceBboxNorm?: [number, number, number, number] | null;
  canonicalSourceId?: string | null;

  // Retailer and leaflet validity
  supermarketId: string | null;
  supermarketName: string | null;
  locationScope: 'national' | 'region' | 'city' | null;
  locationLabel: string | null;
  cityId: string | null;
  regionId: string | null;
  offerStartDate: string | null;
  offerEndDate: string | null;

  // Product titles and brand preservation
  titleAr: string;
  titleEn: string;
  brand: string | null;
  brandAr: string | null;
  brandEn: string | null;
  brandConfidence?: 'high' | 'medium' | 'low' | null;
  variantOrFlavor?: string | null;

  // Pricing & promotions
  promoPrice: number | null;
  originalPrice: number | null;
  discountPercent: number | null;
  promoNotes: string | null;

  // Standardized quantity & unit representation
  sizeOrWeight: string | null;
  each_size_value: number | null;
  each_size_unit: string | null;
  inner_pack_count: number | null;
  sale_unit_type: string | null;
  total_content_value: number | null;
  total_content_unit: string | null;
  free_units_text: string | null;
  customer_limit: number | null;
  promo_condition_quantity?: number | null;
  promotion_mechanic?: string | null;
  bundle_quantity?: number | null;
  quantity_semantics?: 'manufacturer_multipack' | 'retail_promo_quantity' | 'checkout_multibuy' | 'ambiguous' | null;
  assortment_status?: string | null;
  matchingEvidence?: import('./catalogMatching').MatchingEvidenceAnnotation | null;

  // Local private leaflet evidence crop paths (stored strictly in private evidence bucket `offer-images`)
  productThumbCropPath: string | null;
  customProductThumbCropPath?: string | null;
  selectedImageSource?: 'product_thumb' | 'custom_thumb' | 'none' | null;
  offerCardCropPath: string | null;
  originalPageImagePath?: string | null;
  imageSubjectScope?: 'product_package' | 'representative_assortment' | 'unverified' | null;
  // Approved consumer-facing images (routed strictly to public buckets `product-images` / `offer-display-images`)
  consumerProductImagePath?: string | null;
  consumerDisplayImagePath?: string | null;
  approvedConsumerImageRightsBasis?: string | null;
  approvedConsumerImageSourceKind?: string | null;
  consumerImageApprovalStatus?: import('./catalogMatching').ConsumerProductImageApprovalStatus | null;
  existingCatalogProductImageUrl?: string | null;
  consumerImageApprovedForProductKey?: string | null;
  consumerImageInvalidationReason?: string | null;

  // V3 hybrid reconciliation, decomposition & evidence lineage
  currency?: string | null;
  leafletTitle?: string | null;
  metadataVerified?: boolean;
  metadataStatus?: MetadataAcceptanceStatus;
  scopeSource?: GeographicScopeSource | null;
  conflictCodes?: string[];
  quarantineReasons?: string[];
  v3RetentionMode?: string | null;
  v3CropStatus?: string | null;
  parentSourceOfferId?: string | null;
  decomposedChildIndex?: number | null;
  decomposedChildrenCount?: number | null;
  operatorEdited?: boolean;
  operatorEditedAt?: string | null;
  originalOcrSnapshot?: Record<string, unknown> | null;
  rematchOutcome?: 'reconciled_existing' | 'reconciled_temporary' | 'needs_review' | 'metadata_only_preserved' | 'not_run';
  rematchMessage?: string | null;
  publicationState?: OfferBatchPublicationState | null;
  lastValidatedAt?: string | null;
  validationOrigin?: 'extraction' | 'operator_revalidate' | null;

  // State & quality
  status: OfferPublicationStatus;
  confidence: 'high' | 'medium' | 'low';
  category?: string | null;
  warnings?: string[];
  blockingErrors?: string[];

  // Underlying canonical object reference
  canonical?: Record<string, unknown>;
}

export interface BatchFilterOptions {
  leafletId?: string;
  supermarketId?: string;
  sourcePage?: number | 'all';
  status?: OfferPublicationStatus | 'all';
  category?: string;
  searchQuery?: string;
}

export interface UnifiedBatchSummary {
  batchId: string;
  status: BatchStatus;
  createdAt: string;
  updatedAt: string;
  totals: BatchTotals;
  costSummary?: import('./costAccounting').BatchExtractionCostSummary | null;
  leaflets: LeafletBatchItem[];
  supermarketsRepresented: string[];
  totalOffers: number;
  approvedScope?: BatchApprovedScope;
  processingStages?: BatchProcessingStages;
  matchingSummary?: BatchMatchingStageSummary | null;
}

export interface BatchProgressEvent {
  batchId: string;
  currentLeafletIndex: number;
  totalLeaflets: number;
  currentLeaflet?: LeafletBatchItem;
  stage:
    | 'starting'
    | 'rendering'
    | 'extracting'
    | 'leaflet_completed'
    | 'leaflet_failed'
    | 'matching'
    | 'staging'
    | 'batch_completed'
    | 'batch_cancelled';
  message: string;
  totals: BatchTotals;
  processingStages?: BatchProcessingStages;
}

export type PublishedOfferRepairEligibility =
  | 'ready_for_repair'
  | 'awaiting_crop_correction'
  | 'awaiting_identity_correction'
  | 'requires_operator_attention';

export interface PublishedOfferImageRepairItem {
  batchOfferKey: string;
  sourceOfferId: string;
  offerId?: string | null;
  titleEn: string;
  titleAr?: string | null;
  offerPrice?: number | null;
  currency?: string | null;
  packSizeLabel?: string | null;
  productId: string | null;
  currentProductLabel?: string | null;
  identityIssueKind?: 'none' | 'wrong_pack_size_tier' | 'assortment_linked_to_single_sku';
  proposedIdentityAction?: 'keep' | 'relink_or_create_10kg' | 'convert_to_assorted_non_catalog';
  proposedProductLabel?: string | null;
  proposedTitleEn?: string | null;
  proposedTitleAr?: string | null;
  proposedKnownOptions?: Array<Record<string, any>>;
  relinkTargetProductId?: string | null;
  isSharedProduct: boolean;
  dependsOnSiblingIdentityCorrection?: boolean;
  blockingSiblingSourceOfferIds?: string[];
  repairExecutionPhase?: 1 | 2 | null;
  existingImageUrl?: string | null;
  existingConsumerViewUrl?: string | null;
  hasPopulatedOfferThumbnailWithoutConsumerRow?: boolean;
  existingAssetIssueNote?: string | null;
  repairActionKind?:
    | 'upload_and_link_crop'
    | 'associate_existing_public_asset_to_odi'
    | 'identity_and_crop_repair'
    | 'identity_only_hold_crop'
    | 'blocked_private_or_unsuitable_asset';
  localSourceCropPath: string | null;
  cropType: 'product_thumb' | 'custom_thumb' | 'offer_card_unsuitable' | 'none';
  requiresCropConfirmation?: boolean;
  canConfirmCrop?: boolean;
  requiresReplacementImage?: boolean;
  visiblePackageWeightLabel?: string | null;
  cropConfirmed?: boolean;
  cropConfidenceNote?: string | null;
  targetBucket: 'product-images' | 'offer-display-images';
  repairEligibility: PublishedOfferRepairEligibility;
  plannedDbChanges?: string[];
  uploadedUrl?: string;
  status:
    | 'repaired'
    | 'identity_corrected_only'
    | 'preview_eligible'
    | 'skipped_already_imaged'
    | 'skipped_no_crop'
    | 'skipped_unsuitable_crop'
    | 'skipped_identity_correction_unauthorized'
    | 'skipped_shared_product_identity_pending'
    | 'failed';
  reason?: string;
}

export interface PublishedOfferImageRepairResult {
  batchId: string;
  success: boolean;
  previewOnly: boolean;
  totalPublishedOffers: number;
  missingImageOffersCount: number;
  missingOdiAssociationCount?: number;
  readyForRepairCount: number;
  awaitingCropCorrectionCount: number;
  awaitingIdentityCorrectionCount: number;
  requiresOperatorAttentionCount: number;
  identityCorrectedCount: number;
  repairedCount: number;
  skippedCount: number;
  failedCount: number;
  maintenanceOperationId?: string | null;
  repairs: PublishedOfferImageRepairItem[];
}

