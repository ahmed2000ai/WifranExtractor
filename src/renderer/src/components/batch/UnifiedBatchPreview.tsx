import { useState, useEffect, useMemo, useCallback } from 'react';
import { ProductMatchingReview } from './ProductMatchingReview';
import { BatchWorkflowStepper } from './BatchWorkflowStepper';
import { ExtractionCostSummaryCard } from './ExtractionCostSummaryCard';
import {
  isLeafletMetadataAccepted,
  summarizeBatchReviewTriage
} from '../../../../shared/utils/reviewTriageClassifier';
import { buildCrossRetailerGroups } from '../../../../shared/utils/crossRetailerGrouping';
import {
  buildPendingSupermarketCatalogEntry,
  parseBilingualSupermarketInput,
  mergeSupermarketCatalogLists,
  type PendingSupermarketCatalogEntry
} from '../../../../shared/utils/supermarketCandidateUtils';
import type {
  LeafletBatchItem,
  MetadataFieldKey,
  OfferEligibilityStatus,
  UnifiedBatchOffer,
  UnifiedBatchSummary
} from '../../../../shared/types/batchExtraction';
import type { MatchingRunManifest } from '../../../../shared/types/catalogMatching';

interface RefItem {
  id: string;
  name_en?: string | null;
  name_ar?: string | null;
  slug?: string | null;
  region_id?: string | null;
}

interface UnifiedBatchPreviewProps {
  batchId: string;
  onBack: () => void;
  catalogSupermarkets?: RefItem[];
  catalogRegions?: RefItem[];
  catalogCities?: RefItem[];
  initialStep?: 3 | 4;
  onStepChange?: (step: 3 | 4) => void;
}

function isStrictIsoCalendarInput(val: string | null | undefined): boolean {
  return Boolean(val && /^\d{4}-\d{2}-\d{2}$/.test(val.trim()));
}

export function UnifiedBatchPreview({
  batchId,
  onBack,
  catalogSupermarkets = [],
  catalogRegions = [],
  catalogCities = [],
  initialStep = 3,
  onStepChange
}: UnifiedBatchPreviewProps): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<UnifiedBatchSummary | null>(null);
  const [matchingManifest, setMatchingManifest] = useState<MatchingRunManifest | null>(null);
  const [offers, setOffers] = useState<UnifiedBatchOffer[]>([]);
  const [selectedOffer, setSelectedOffer] = useState<UnifiedBatchOffer | null>(null);
  const [viewMode, setViewMode] = useState<'offers' | 'matching'>(initialStep === 4 ? 'matching' : 'offers');

  useEffect(() => {
    if (initialStep === 4 && viewMode !== 'matching') {
      setViewMode('matching');
    } else if (initialStep === 3 && viewMode !== 'offers') {
      setViewMode('offers');
    }
  }, [initialStep]);

  const handleSwitchToMatching = () => {
    setViewMode('matching');
    onStepChange?.(4);
  };

  const handleSwitchToOffers = () => {
    setViewMode('offers');
    onStepChange?.(3);
  };
  const [reviewSection, setReviewSection] = useState<'offers' | 'grouped'>('offers');
  const [triageFilter, setTriageFilter] = useState<'all' | OfferEligibilityStatus>('all');
  const [bulkApproving, setBulkApproving] = useState(false);
  const [savingConsumerImage, setSavingConsumerImage] = useState(false);
  const [rematchNotice, setRematchNotice] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    titleAr: string;
    titleEn: string;
    brand: string;
    variantOrFlavor: string;
    promoPrice: string;
    originalPrice: string;
    sizeOrWeight: string;
    each_size_value: string;
    each_size_unit: string;
    inner_pack_count: string;
    sale_unit_type: string;
    assortment_status: string;
    confirmConflictResolution: boolean;
  } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const [localPendingSupermarkets, setLocalPendingSupermarkets] = useState<PendingSupermarketCatalogEntry[]>([]);
  const effectiveSupermarkets = useMemo(
    () => mergeSupermarketCatalogLists<RefItem>(catalogSupermarkets, localPendingSupermarkets),
    [catalogSupermarkets, localPendingSupermarkets]
  );

  const [isNewSupermarketModalOpen, setIsNewSupermarketModalOpen] = useState(false);
  const [newSupermarketNameEn, setNewSupermarketNameEn] = useState('');
  const [newSupermarketNameAr, setNewSupermarketNameAr] = useState('');
  const [newSupermarketError, setNewSupermarketError] = useState<string | null>(null);

  // Step 3 Leaflet Metadata verification state
  const [editingMetaLeafletId, setEditingMetaLeafletId] = useState<string | null>(null);
  const [metaDraft, setMetaDraft] = useState<{
    supermarketId: string;
    supermarketName: string;
    leafletTitle: string;
    offerStartDate: string;
    offerEndDate: string;
    locationScope: '' | 'national' | 'region' | 'city';
    regionId: string;
    cityId: string;
    locationLabel: string;
  } | null>(null);
  const [metaSaveError, setMetaSaveError] = useState<string | null>(null);
  const [savingMeta, setSavingMeta] = useState(false);

  const openNewSupermarketModal = (leaflet?: LeafletBatchItem) => {
    setNewSupermarketError(null);
    const m = leaflet?.metadata;
    const detected = m?.supermarketName || '';
    const parsed = parseBilingualSupermarketInput(detected);
    const evidenceText = m?.evidenceByField?.retailer?.evidenceText || '';
    const isArScript = /[\u0600-\u06FF]/.test(evidenceText);

    let prefillEn = parsed.resolvedNameEn || (!/[\u0600-\u06FF]/.test(detected) ? detected : '');
    let prefillAr = parsed.resolvedNameAr || (isArScript ? evidenceText : '') || (/[\u0600-\u06FF]/.test(detected) ? detected : '');

    if (detected.toLowerCase().includes('nokhba') || evidenceText.includes('النخبة')) {
      if (!prefillEn) prefillEn = 'Al Nokhba Markets';
      if (!prefillAr) prefillAr = 'أسواق النخبة';
    }

    setNewSupermarketNameEn(prefillEn || 'Al Nokhba Markets');
    setNewSupermarketNameAr(prefillAr || 'أسواق النخبة');
    setIsNewSupermarketModalOpen(true);
  };

  const handleConfirmNewSupermarket = () => {
    const en = newSupermarketNameEn.trim();
    const ar = newSupermarketNameAr.trim();
    if (!en && !ar) {
      setNewSupermarketError('Please provide at least an English or Arabic supermarket name.');
      return;
    }
    const { entry, alreadyInCatalog } = buildPendingSupermarketCatalogEntry({
      detectedName: en || ar,
      resolvedNameEn: en,
      resolvedNameAr: ar,
      preferExplicitNames: true,
      existingCatalog: effectiveSupermarkets
    });

    if (!alreadyInCatalog) {
      setLocalPendingSupermarkets((prev) => [...prev, entry]);
    }

    if (metaDraft) {
      setMetaDraft({
        ...metaDraft,
        supermarketId: entry.id,
        supermarketName: entry.name_en || entry.name_ar || en
      });
    }
    setIsNewSupermarketModalOpen(false);
  };

  const openLeafletMetaEditor = (leaflet: LeafletBatchItem) => {
    const m = leaflet.metadata || {};
    setEditingMetaLeafletId(leaflet.leafletId);
    setMetaSaveError(null);
    setMetaDraft({
      supermarketId: m.supermarketId || '',
      supermarketName: m.supermarketName || '',
      leafletTitle: m.leafletTitle || '',
      offerStartDate: isStrictIsoCalendarInput(m.offerStartDate) ? m.offerStartDate! : '',
      offerEndDate: isStrictIsoCalendarInput(m.offerEndDate) ? m.offerEndDate! : '',
      locationScope: (m.locationScope as '' | 'national' | 'region' | 'city') || '',
      regionId: m.regionId || '',
      cityId: m.cityId || '',
      locationLabel: m.locationLabel || ''
    });
  };

  const handleSaveLeafletMetadata = async () => {
    if (!editingMetaLeafletId || !metaDraft) return;
    if (!metaDraft.supermarketId && !metaDraft.supermarketName.trim()) {
      setMetaSaveError('Retailer / supermarket is required to verify leaflet metadata.');
      return;
    }
    if (!isStrictIsoCalendarInput(metaDraft.offerStartDate) || !isStrictIsoCalendarInput(metaDraft.offerEndDate)) {
      setMetaSaveError('Valid Start Date and End Date (YYYY-MM-DD) are required.');
      return;
    }
    if (metaDraft.offerStartDate > metaDraft.offerEndDate) {
      setMetaSaveError('Start Date cannot be after End Date.');
      return;
    }
    if (!metaDraft.locationScope) {
      setMetaSaveError('Select an explicit Geographic Scope (National, Region, or City). Multi-city leaflets cannot be auto-collapsed.');
      return;
    }
    if (metaDraft.locationScope === 'region' && !metaDraft.regionId && !metaDraft.locationLabel.trim()) {
      setMetaSaveError('Select or enter a Region when Geographic Scope is Region.');
      return;
    }
    if (metaDraft.locationScope === 'city' && !metaDraft.cityId && !metaDraft.locationLabel.trim()) {
      setMetaSaveError('Select or enter a City when Geographic Scope is City.');
      return;
    }

    setSavingMeta(true);
    setMetaSaveError(null);
    try {
      const selectedMarket = effectiveSupermarkets.find((s) => s.id === metaDraft.supermarketId);
      const selectedRegion = catalogRegions.find((r) => r.id === metaDraft.regionId);
      const selectedCity = catalogCities.find((c) => c.id === metaDraft.cityId);

      await window.wifranExtractor.batch.updateLeafletMetadata({
        batchId,
        leafletId: editingMetaLeafletId,
        verified: true,
        operatorId: 'operator_ui',
        metadata: {
          supermarketId: metaDraft.supermarketId || null,
          supermarketName: selectedMarket?.name_en || metaDraft.supermarketName.trim() || null,
          leafletTitle: metaDraft.leafletTitle.trim() || null,
          offerStartDate: metaDraft.offerStartDate,
          offerEndDate: metaDraft.offerEndDate,
          currency: 'SAR',
          locationScope: metaDraft.locationScope,
          regionId:
            metaDraft.locationScope === 'region'
              ? metaDraft.regionId || null
              : metaDraft.locationScope === 'city'
                ? selectedCity?.region_id || metaDraft.regionId || null
                : null,
          cityId: metaDraft.locationScope === 'city' ? metaDraft.cityId || null : null,
          locationLabel:
            metaDraft.locationScope === 'national'
              ? 'National'
              : metaDraft.locationScope === 'city'
                ? selectedCity?.name_en || metaDraft.locationLabel.trim() || 'City'
                : selectedRegion?.name_en || metaDraft.locationLabel.trim() || 'Region',
          locationSlug:
            metaDraft.locationScope === 'national'
              ? 'national'
              : metaDraft.locationScope === 'city'
                ? selectedCity?.slug || null
                : selectedRegion?.slug || null
        }
      });
      setEditingMetaLeafletId(null);
      await loadData();
    } catch (err: any) {
      setMetaSaveError(err?.message || 'Failed to save leaflet metadata.');
    } finally {
      setSavingMeta(false);
    }
  };

  const openOfferInspector = (offer: UnifiedBatchOffer) => {
    setSelectedOffer(offer);
    setRematchNotice(null);
    setEditDraft({
      titleAr: offer.titleAr || '',
      titleEn: offer.titleEn || '',
      brand: offer.brand || '',
      variantOrFlavor: offer.variantOrFlavor || '',
      promoPrice: offer.promoPrice != null ? String(offer.promoPrice) : '',
      originalPrice: offer.originalPrice != null ? String(offer.originalPrice) : '',
      sizeOrWeight: offer.sizeOrWeight || '',
      each_size_value: offer.each_size_value != null ? String(offer.each_size_value) : '',
      each_size_unit: offer.each_size_unit || '',
      inner_pack_count: offer.inner_pack_count != null ? String(offer.inner_pack_count) : '',
      sale_unit_type: offer.sale_unit_type || '',
      assortment_status: offer.assortment_status || '',
      confirmConflictResolution: false
    });
  };

  const handleSaveOfferEdit = async () => {
    if (!selectedOffer || !editDraft) return;
    setSavingEdit(true);
    setError(null);
    setRematchNotice(null);
    try {
      const updated = await window.wifranExtractor.batch.updateOfferFields({
        batchId,
        batchOfferKey: selectedOffer.batchOfferKey,
        operatorId: 'operator_ui',
        patch: {
          titleAr: editDraft.titleAr,
          titleEn: editDraft.titleEn,
          brand: editDraft.brand || null,
          variantOrFlavor: editDraft.variantOrFlavor || null,
          promoPrice: editDraft.promoPrice ? Number(editDraft.promoPrice) : null,
          originalPrice: editDraft.originalPrice ? Number(editDraft.originalPrice) : null,
          sizeOrWeight: editDraft.sizeOrWeight || null,
          each_size_value: editDraft.each_size_value ? Number(editDraft.each_size_value) : null,
          each_size_unit: editDraft.each_size_unit || null,
          inner_pack_count: editDraft.inner_pack_count ? Math.max(1, Math.trunc(Number(editDraft.inner_pack_count))) : null,
          sale_unit_type: editDraft.sale_unit_type || null,
          currency: 'SAR',
          assortment_status: editDraft.assortment_status.trim() || null,
          revalidate: true,
          confirmConflictResolution: editDraft.confirmConflictResolution
        }
      });
      setOffers((prev) => prev.map((o) => (o.batchOfferKey === updated.batchOfferKey ? updated : o)));
      setSelectedOffer(updated);
      if (updated.rematchMessage) {
        setRematchNotice(updated.rematchMessage);
      }
      if (window.wifranExtractor.matching?.getStatus) {
        const refreshedMatching = await window.wifranExtractor.matching.getStatus(batchId);
        setMatchingManifest(refreshedMatching);
      }
    } catch (err: any) {
      setError(`Failed to save offer correction: ${err.message}`);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleResolveAsAssorted = async () => {
    if (!selectedOffer) return;
    setSavingEdit(true);
    setError(null);
    setRematchNotice(null);
    try {
      const updated = await window.wifranExtractor.batch.resolveOfferAsAssorted({
        batchId,
        batchOfferKey: selectedOffer.batchOfferKey,
        operatorId: 'operator_ui',
        customTitleEn: editDraft?.titleEn,
        customTitleAr: editDraft?.titleAr
      });
      setOffers((prev) => prev.map((o) => (o.batchOfferKey === updated.batchOfferKey ? updated : o)));
      setSelectedOffer(updated);
      setRematchNotice('Offer resolved as multi-variant assortment (— Assorted / — متنوع) and transitioned to Ready with product crop.');
      if (window.wifranExtractor.matching?.getStatus) {
        const refreshedMatching = await window.wifranExtractor.matching.getStatus(batchId);
        setMatchingManifest(refreshedMatching);
      }
    } catch (err: any) {
      setError(`Failed to resolve as assorted: ${err.message}`);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleApproveNonCatalog = async () => {
    if (!selectedOffer || !window.wifranExtractor.matching?.saveDecision) return;
    setSavingEdit(true);
    setError(null);
    try {
      await window.wifranExtractor.matching.saveDecision({
        batchId,
        batchOfferKey: selectedOffer.batchOfferKey,
        decision: 'approved',
        targetType: 'non_catalog',
        operatorNotes: 'Operator verified non-catalog commodity/produce identity'
      });
      const refreshedOffers = await window.wifranExtractor.batch.getUnifiedOffers({ batchId });
      setOffers(refreshedOffers);
      const match = refreshedOffers.find((o) => o.batchOfferKey === selectedOffer.batchOfferKey) || null;
      setSelectedOffer(match);
      if (window.wifranExtractor.matching?.getStatus) {
        const refreshedMatching = await window.wifranExtractor.matching.getStatus(batchId);
        setMatchingManifest(refreshedMatching);
      }
      setRematchNotice('Non-catalog identity approved by operator (Transitioned to Ready).');
    } catch (err: any) {
      setError(`Failed to approve non-catalog: ${err.message}`);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleReplaceImage = async () => {
    if (!selectedOffer) return;
    setError(null);
    try {
      const res = await window.wifranExtractor.batch.selectAndReplaceOfferImage({
        batchId,
        batchOfferKey: selectedOffer.batchOfferKey
      });
      if (res.canceled) return;
      if (!res.success) {
        setError(res.error || 'Failed to replace image.');
        return;
      }
      if (res.updatedOffer) {
        setOffers((prev) => prev.map((o) => (o.batchOfferKey === res.updatedOffer!.batchOfferKey ? res.updatedOffer! : o)));
        setSelectedOffer(res.updatedOffer);
      } else {
        const refreshed = await window.wifranExtractor.batch.getUnifiedOffers({ batchId });
        setOffers(refreshed);
        const match = refreshed.find((o) => o.batchOfferKey === selectedOffer.batchOfferKey) || null;
        setSelectedOffer(match);
      }
      if (window.wifranExtractor.matching?.getStatus) {
        const refreshedMatching = await window.wifranExtractor.matching.getStatus(batchId);
        setMatchingManifest(refreshedMatching);
      }
    } catch (err: any) {
      setError(`Image replacement failed: ${err.message}`);
    }
  };

  const handleRestoreDefaultCrop = async () => {
    if (!selectedOffer) return;
    setError(null);
    try {
      const res = await window.wifranExtractor.batch.restoreDefaultOfferImage({
        batchId,
        batchOfferKey: selectedOffer.batchOfferKey
      });
      if (!res.success) {
        setError(res.error || 'Failed to restore default crop.');
        return;
      }
      if (res.updatedOffer) {
        setOffers((prev) => prev.map((o) => (o.batchOfferKey === res.updatedOffer!.batchOfferKey ? res.updatedOffer! : o)));
        setSelectedOffer(res.updatedOffer);
      } else {
        const refreshed = await window.wifranExtractor.batch.getUnifiedOffers({ batchId });
        setOffers(refreshed);
        const match = refreshed.find((o) => o.batchOfferKey === selectedOffer.batchOfferKey) || null;
        setSelectedOffer(match);
      }
      if (window.wifranExtractor.matching?.getStatus) {
        const refreshedMatching = await window.wifranExtractor.matching.getStatus(batchId);
        setMatchingManifest(refreshedMatching);
      }
    } catch (err: any) {
      setError(`Failed to restore default crop: ${err.message}`);
    }
  };

  const handleUpdatePublishedImage = async () => {
    if (!selectedOffer || selectedOffer.publicationState?.state !== 'published') return;
    const confirmed = window.confirm(
      `Update published image in Production for offer "${selectedOffer.titleEn || selectedOffer.titleAr}"?\n\nThis updates the public image reference for the existing published record without creating a duplicate offer or recreating the product.`
    );
    if (!confirmed) return;
    setError(null);
    try {
      const res = await window.wifranExtractor.batch.updatePublishedOfferImage({
        batchId,
        batchOfferKey: selectedOffer.batchOfferKey,
        operatorConfirmed: true
      });
      if (!res.success) {
        setError(res.error || 'Failed to update published image.');
        return;
      }
      const refreshed = await window.wifranExtractor.batch.getUnifiedOffers({ batchId });
      setOffers(refreshed);
      const match = refreshed.find((o) => o.batchOfferKey === selectedOffer.batchOfferKey) || null;
      setSelectedOffer(match);
      alert(`Published image successfully updated in Production:\n${res.newImageUrl}`);
    } catch (err: any) {
      setError(`Failed to update published image: ${err.message}`);
    }
  };

  const [showImageRepairModal, setShowImageRepairModal] = useState<boolean>(false);
  const [repairPreviewData, setRepairPreviewData] = useState<import('../../../../shared/types/batchExtraction').PublishedOfferImageRepairResult | null>(null);
  const [loadingRepairPreview, setLoadingRepairPreview] = useState<boolean>(false);
  const [repairingImages, setRepairingImages] = useState<boolean>(false);
  const [operatorAuthorizedIdentityCorrection, setOperatorAuthorizedIdentityCorrection] = useState<boolean>(false);
  const [operatorAuthorizedRepair, setOperatorAuthorizedRepair] = useState<boolean>(false);
  const [confirmedCropOfferKeys, setConfirmedCropOfferKeys] = useState<string[]>([]);
  const [repairExecutionResult, setRepairExecutionResult] = useState<import('../../../../shared/types/batchExtraction').PublishedOfferImageRepairResult | null>(null);

  const publishedMissingImagesCount = useMemo(() => {
    if (repairPreviewData && typeof repairPreviewData.missingImageOffersCount === 'number') {
      return repairPreviewData.missingImageOffersCount;
    }
    return offers.filter((o) => o.publicationState?.state === 'published' && !o.publicationState?.imageUrl).length;
  }, [offers, repairPreviewData]);

  const refreshRepairPreview = useCallback(async (overrideConfirmedKeys?: string[]) => {
    if (!window.wifranExtractor?.batch?.previewPublishedOfferImageRepairs) return;
    setLoadingRepairPreview(true);
    try {
      const preview = await window.wifranExtractor.batch.previewPublishedOfferImageRepairs({
        batchId,
        confirmedCropOfferKeys: overrideConfirmedKeys ?? confirmedCropOfferKeys
      });
      setRepairPreviewData(preview);
    } catch (err: any) {
      setError(`Failed to preview image repairs: ${err.message}`);
    } finally {
      setLoadingRepairPreview(false);
    }
  }, [batchId, confirmedCropOfferKeys]);

  const hasPublishedOffers = useMemo(
    () => offers.some((o) => o.publicationState?.state === 'published'),
    [offers]
  );

  useEffect(() => {
    if (hasPublishedOffers) {
      void refreshRepairPreview();
    }
  }, [hasPublishedOffers, refreshRepairPreview]);

  const handleOpenRepairModal = async () => {
    setShowImageRepairModal(true);
    setError(null);
    setOperatorAuthorizedIdentityCorrection(false);
    setOperatorAuthorizedRepair(false);
    setRepairExecutionResult(null);
    await refreshRepairPreview();
  };

  const handleConfirmDerivedCropInModal = async (batchOfferKey: string) => {
    try {
      if (window.wifranExtractor?.batch?.confirmDerivedTierCrop) {
        await window.wifranExtractor.batch.confirmDerivedTierCrop({ batchId, batchOfferKey });
      }
      const nextKeys = Array.from(new Set([...confirmedCropOfferKeys, batchOfferKey]));
      setConfirmedCropOfferKeys(nextKeys);
      await refreshRepairPreview(nextKeys);
    } catch (err: any) {
      setError(`Failed confirming crop: ${err.message}`);
    }
  };

  const handleReplaceImageInRepairModal = async (batchOfferKey: string) => {
    try {
      if (!window.wifranExtractor?.batch?.selectAndReplaceOfferImage) return;
      const res = await window.wifranExtractor.batch.selectAndReplaceOfferImage({ batchId, batchOfferKey });
      if (res.success) {
        const nextKeys = Array.from(new Set([...confirmedCropOfferKeys, batchOfferKey]));
        setConfirmedCropOfferKeys(nextKeys);
        await refreshRepairPreview(nextKeys);
      }
    } catch (err: any) {
      setError(`Failed replacing image: ${err.message}`);
    }
  };

  const handleExecuteRepairImages = async () => {
    if (!operatorAuthorizedRepair && !operatorAuthorizedIdentityCorrection) {
      alert('Please authorize identity corrections and/or image repairs before executing.');
      return;
    }
    setRepairingImages(true);
    setError(null);
    try {
      if (window.wifranExtractor?.batch?.repairPublishedOfferImages) {
        const result = await window.wifranExtractor.batch.repairPublishedOfferImages({
          batchId,
          operatorAuthorizedRepair,
          operatorAuthorizedIdentityCorrection,
          confirmedCropOfferKeys
        });
        setRepairExecutionResult(result);
        const refreshedOffers = await window.wifranExtractor.batch.getUnifiedOffers({ batchId });
        setOffers(refreshedOffers);
        if (selectedOffer) {
          const match = refreshedOffers.find((o) => o.batchOfferKey === selectedOffer.batchOfferKey) || null;
          setSelectedOffer(match);
        }
        await refreshRepairPreview();
      }
    } catch (err: any) {
      setError(`Failed to execute controlled repairs: ${err.message}`);
    } finally {
      setRepairingImages(false);
    }
  };

  const handleConsumerImageDecision = async (
    offer: UnifiedBatchOffer,
    decision: 'approve_generated_crop' | 'reuse_existing_catalog_image' | 'reject'
  ) => {
    if (!window.wifranExtractor.matching?.saveConsumerImageApproval) return;
    setSavingConsumerImage(true);
    setError(null);
    try {
      const proposal = matchingManifest?.proposals?.[offer.batchOfferKey] ?? null;
      const boundProductKey =
        proposal?.decision === 'existing' && proposal.matchedProductId
          ? `product:${proposal.matchedProductId}`
          : proposal?.decision === 'temporary' && proposal.temporaryId
          ? `temp:${proposal.temporaryId}`
          : `offer:${offer.batchOfferKey}`;
      const boundProductLabel =
        proposal?.matchedProduct?.nameEn ||
        proposal?.matchedProduct?.nameAr ||
        offer.titleEn ||
        offer.titleAr ||
        null;

      const updatedManifest = await window.wifranExtractor.matching.saveConsumerImageApproval({
        batchId,
        batchOfferKey: offer.batchOfferKey,
        decision,
        productThumbCropPath: offer.productThumbCropPath,
        existingCatalogImageUrl:
          offer.existingCatalogProductImageUrl || proposal?.matchedProduct?.imageUrl || null,
        imageSubjectScope: offer.imageSubjectScope || null,
        boundProductKey,
        boundProductLabel,
        rightsBasis:
          decision === 'approve_generated_crop'
            ? 'operator_verified_leaflet_product_crop'
            : decision === 'reuse_existing_catalog_image'
            ? 'existing_verified_catalog_image'
            : null,
        verifiedBy: 'operator_ui'
      });
      setMatchingManifest(updatedManifest);
      const refreshedOffers = await window.wifranExtractor.batch.getUnifiedOffers({ batchId });
      setOffers(refreshedOffers);
      const refreshedSelected = refreshedOffers.find((o) => o.batchOfferKey === offer.batchOfferKey) || null;
      setSelectedOffer(refreshedSelected);
    } catch (err: any) {
      setError(`Consumer product image decision blocked: ${err.message}`);
    } finally {
      setSavingConsumerImage(false);
    }
  };

  // Filter states
  const [selectedLeafletId, setSelectedLeafletId] = useState<string>('all');
  const [selectedRetailer, setSelectedRetailer] = useState<string>('all');
  const [selectedPageFilter, setSelectedPageFilter] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [sum, items, mManifest] = await Promise.all([
        window.wifranExtractor.batch.getSummary(batchId),
        window.wifranExtractor.batch.getUnifiedOffers({
          batchId,
          filters: {}
        }),
        window.wifranExtractor.matching?.getStatus
          ? window.wifranExtractor.matching.getStatus(batchId)
          : Promise.resolve(null)
      ]);
      setSummary(sum);
      setOffers(items);
      setMatchingManifest(mManifest);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [batchId]);

  const uniqueRetailers = useMemo(() => {
    const set = new Set<string>();
    for (const o of offers) {
      if (o.supermarketName) set.add(o.supermarketName);
      else if (o.supermarketId) set.add(o.supermarketId);
    }
    return Array.from(set).sort();
  }, [offers]);

  const uniquePages = useMemo(() => {
    const set = new Set<number>();
    for (const o of offers) {
      if (typeof o.sourcePage === 'number' && Number.isFinite(o.sourcePage)) {
        set.add(o.sourcePage);
      }
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [offers]);

  const targetDatabaseContext =
    summary?.approvedScope?.targetDatabaseContext ||
    matchingManifest?.matchingDatabaseContext ||
    'PRODUCTION_UI';

  const triageSummary = useMemo(
    () =>
      summarizeBatchReviewTriage({
        offers,
        manifest: matchingManifest,
        targetDatabaseContext
      }),
    [offers, matchingManifest, targetDatabaseContext]
  );

  const groupedView = useMemo(
    () => buildCrossRetailerGroups(offers, matchingManifest),
    [offers, matchingManifest]
  );

  const handleBulkApproveReadyMatches = async () => {
    if (!window.wifranExtractor.matching?.saveDecision) return;
    const safeItems = Object.values(triageSummary.byOfferKey).filter((t) => t.canBulkApprove);
    if (safeItems.length === 0) return;
    setBulkApproving(true);
    setError(null);
    try {
      let latestManifest: MatchingRunManifest | null = matchingManifest;
      for (const item of safeItems) {
        const prop = matchingManifest?.proposals?.[item.batchOfferKey];
        if (!prop || prop.decision !== 'existing' || !prop.matchedProductId) continue;
        latestManifest = await window.wifranExtractor.matching.saveDecision({
          batchId,
          batchOfferKey: item.batchOfferKey,
          decision: 'approved',
          linkedPermanentProductId: prop.matchedProductId
        });
      }
      setMatchingManifest(latestManifest);
    } catch (err: any) {
      setError(`Bulk approval warning: ${err?.message || String(err)}`);
    } finally {
      setBulkApproving(false);
    }
  };

  const filteredOffers = useMemo(() => {
    let result = offers;
    if (selectedLeafletId !== 'all') {
      result = result.filter((o) => o.leafletId === selectedLeafletId);
    }
    if (selectedRetailer !== 'all') {
      result = result.filter(
        (o) => o.supermarketName === selectedRetailer || o.supermarketId === selectedRetailer
      );
    }
    if (selectedPageFilter !== 'all') {
      const pageNum = parseInt(selectedPageFilter, 10);
      if (Number.isFinite(pageNum)) {
        result = result.filter((o) => o.sourcePage === pageNum);
      }
    }
    if (selectedStatus !== 'all') {
      result = result.filter((o) => o.status === selectedStatus);
    }
    if (triageFilter !== 'all') {
      result = result.filter(
        (o) => triageSummary.byOfferKey[o.batchOfferKey]?.eligibilityStatus === triageFilter
      );
    }
    if (searchQuery.trim().length > 0) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (o) =>
          o.titleAr?.toLowerCase().includes(q) ||
          o.titleEn?.toLowerCase().includes(q) ||
          o.brand?.toLowerCase().includes(q) ||
          o.brandAr?.toLowerCase().includes(q) ||
          o.brandEn?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [offers, selectedLeafletId, selectedRetailer, selectedPageFilter, selectedStatus, triageFilter, triageSummary, searchQuery]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'published':
        return <span className="px-2 py-0.5 bg-emerald-950 text-emerald-300 border border-emerald-800 rounded text-[10px] font-semibold">Published</span>;
      case 'ready_for_matching':
        return <span className="px-2 py-0.5 bg-indigo-950 text-indigo-300 border border-indigo-800 rounded text-[10px] font-semibold">Ready for Matching</span>;
      case 'reviewed':
        return <span className="px-2 py-0.5 bg-purple-950 text-purple-300 border border-purple-800 rounded text-[10px] font-semibold">Reviewed</span>;
      case 'extracted':
      default:
        return <span className="px-2 py-0.5 bg-blue-950 text-blue-300 border border-blue-800 rounded text-[10px] font-semibold">Extracted</span>;
    }
  };

  const getLocalImageUrl = (filePath: string | null) => {
    if (!filePath) return null;
    return `local-file://get?path=${encodeURIComponent(filePath)}`;
  };

  if (loading && offers.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-400">
        <span className="inline-block animate-spin text-2xl mb-2">⏳</span>
        <p className="text-sm">Consolidating unified batch offers...</p>
      </div>
    );
  }

  if (viewMode === 'matching') {
    return (
      <ProductMatchingReview
        batchId={batchId}
        offers={offers}
        costSummary={summary?.costSummary ?? null}
        onBack={handleSwitchToOffers}
        onBatchUpdated={loadData}
      />
    );
  }

  const unverifiedLeafletsCount = (summary?.leaflets || []).filter(
    (l) => !isLeafletMetadataAccepted(l.metadata)
  ).length;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-6">
      <BatchWorkflowStepper
        currentStep={3}
        onStepClick={(step) => {
          if (step <= 2) onBack();
          if (step >= 4) handleSwitchToMatching();
        }}
      />

      {/* Header & Back Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span>📝</span> Step 3 — Consolidated Operator Review
            </h2>
            <span className="font-mono text-xs px-2.5 py-0.5 bg-slate-800 border border-slate-700 text-indigo-300 rounded-full">
              {batchId}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Unified workspace for leaflet metadata, extracted offers, cross-retailer catalog grouping, and exception triage prior to Step 4 Publication.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSwitchToMatching}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow transition-all flex items-center gap-1.5"
          >
            🚀 Step 4: Publication &amp; Reconciliation →
          </button>
          <button
            type="button"
            onClick={onBack}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5"
          >
            ← Back to Progress
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-950/60 border border-rose-800 rounded-lg text-rose-200 text-xs">
          {error}
        </div>
      )}

      {/* Safety & Status Gate Alert */}
      <div className="p-3 bg-blue-950/40 border border-blue-800/60 rounded-lg flex flex-wrap items-center justify-between gap-2 text-xs text-blue-200">
        <div className="flex items-center gap-2">
          <span>🛡️</span>
          <span>
            <strong>Publication Gate:</strong>{' '}
            {unverifiedLeafletsCount > 0
              ? `${unverifiedLeafletsCount} leaflet(s) flagged Needs Review — resolve highlighted fields before Step 4 Publication. Staged drafts are local only.`
              : 'All leaflet metadata accepted (auto-accepted or operator-verified) for Step 4 Publication readiness. Local staged drafts only.'}
          </span>
        </div>
        <span className="font-mono text-[11px] text-blue-300 font-semibold">
          Database Writes: ZERO • Target Ref DB: {targetDatabaseContext}
        </span>
      </div>

      {/* Step 3A — Per-Leaflet Draft Metadata Review & Verification */}
      {summary && summary.leaflets.length > 0 && (
        <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-white">
                Step 3A — Leaflet Metadata Review &amp; Automatic Acceptance
              </h3>
              <p className="text-[11px] text-slate-400">
                Complete high-confidence leaflets are auto-accepted; review or edit only if needed or flagged.
              </p>
            </div>
            <span
              className={`px-2.5 py-1 rounded text-[11px] font-semibold border ${
                unverifiedLeafletsCount === 0
                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700'
                  : 'bg-amber-950/60 text-amber-300 border-amber-700'
              }`}
            >
              {summary.leaflets.length - unverifiedLeafletsCount} / {summary.leaflets.length} Ready
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {summary.leaflets.map((leaf) => {
              const m = leaf.metadata || {};
              const accepted = isLeafletMetadataAccepted(m);
              const isOperatorVerified = Boolean(
                (m.verified || m.metadataStatus === 'operator_verified') &&
                m.supermarketId &&
                m.offerStartDate &&
                m.offerEndDate &&
                m.metadataStatus !== 'needs_review'
              );
              const isAutoAccepted = !isOperatorVerified && m.metadataStatus === 'auto_accepted' && Boolean(m.supermarketId && m.offerStartDate && m.offerEndDate);
              const isEditingThis = editingMetaLeafletId === leaf.leafletId && metaDraft !== null;
              const evidenceEntries = (Object.entries(m.evidenceByField || {}) as Array<
                [MetadataFieldKey, NonNullable<typeof m.evidenceByField>[MetadataFieldKey]]
              >).filter(([k]) => k !== 'title' && k !== 'currency');
              return (
                <div
                  key={leaf.leafletId}
                  className={`p-3 rounded-lg border text-xs space-y-2 ${
                    isOperatorVerified
                      ? 'bg-emerald-950/20 border-emerald-800/70'
                      : isAutoAccepted
                        ? 'bg-sky-950/20 border-sky-800/70'
                        : 'bg-slate-900/80 border-amber-700/70'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-white">{leaf.fileName}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                          isOperatorVerified
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                            : isAutoAccepted
                              ? 'bg-sky-950 text-sky-300 border-sky-700'
                              : 'bg-amber-950 text-amber-300 border-amber-700'
                        }`}
                      >
                        {isOperatorVerified
                          ? '✓ Operator Verified'
                          : isAutoAccepted
                            ? '✓ Auto Accepted'
                            : '⚠ Needs Review'}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        Retailer: <strong className="text-slate-200">{m.supermarketName || m.supermarketId || 'Unresolved'}</strong>
                        {' · '}
                        Dates: <strong className="text-slate-200">{m.offerStartDate || '?'} → {m.offerEndDate || '?'}</strong>
                        {' · '}
                        Scope:{' '}
                        <strong className="text-slate-200">
                          {m.scopeSource === 'default_national'
                            ? 'National (assumed)'
                            : m.locationLabel || m.locationScope || 'Unresolved'}
                        </strong>
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        isEditingThis ? setEditingMetaLeafletId(null) : openLeafletMetaEditor(leaf)
                      }
                      className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[11px] font-semibold"
                    >
                      {isEditingThis ? 'Close Editor' : accepted ? 'Edit Metadata' : 'Review & Verify Metadata'}
                    </button>
                  </div>

                  {!accepted && Array.isArray(m.metadataStatusReasons) && m.metadataStatusReasons.length > 0 && (
                    <div className="p-2 bg-amber-950/40 border border-amber-800/70 rounded text-amber-200 text-[11px]">
                      ⚠ Review Needed: {m.metadataStatusReasons.join(' • ')}
                    </div>
                  )}

                  {m.validityNormalizationError && (
                    <div className="p-2 bg-rose-950/50 border border-rose-800/80 rounded text-rose-200 text-[11px]">
                      ⚠ Date Normalization Notice: {m.validityNormalizationError}
                    </div>
                  )}
                  {m.geographicNotice && (
                    <div className="p-2 bg-amber-950/50 border border-amber-700/80 rounded text-amber-200 text-[11px]">
                      ⚠ Multi-City Scope Evidence: {m.geographicNotice}
                    </div>
                  )}

                  {evidenceEntries.length > 0 && (
                    <div className="flex flex-wrap gap-2 text-[10px] text-slate-400">
                      {evidenceEntries.map(([k, ev]) =>
                        ev ? (
                          <span key={k} className="px-2 py-0.5 bg-slate-950 border border-slate-800 rounded">
                            <strong>{k}</strong> ({ev.method}, p.{ev.sourcePage ?? '?'}): {ev.evidenceText}
                          </span>
                        ) : null
                      )}
                    </div>
                  )}

                  {isEditingThis && metaDraft && (
                    <div className="pt-3 mt-2 border-t border-slate-800 space-y-3">
                      {metaSaveError && (
                        <div className="p-2 bg-rose-950/70 border border-rose-700 rounded text-rose-200 text-[11px]">
                          {metaSaveError}
                        </div>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[11px] text-slate-400">Retailer *</label>
                            <button
                              type="button"
                              onClick={() => openNewSupermarketModal(leaf)}
                              className="text-[10px] text-indigo-400 hover:text-indigo-300 font-semibold"
                            >
                              + Add Supermarket
                            </button>
                          </div>
                          <div className="flex gap-2">
                            <select
                              aria-label={`Retailer for ${leaf.fileName}`}
                              value={metaDraft.supermarketId}
                              onChange={(e) => {
                                if (e.target.value === '__NEW_SUPERMARKET__') {
                                  openNewSupermarketModal(leaf);
                                  return;
                                }
                                const found = effectiveSupermarkets.find((s) => s.id === e.target.value);
                                setMetaDraft({
                                  ...metaDraft,
                                  supermarketId: e.target.value,
                                  supermarketName: found?.name_en || metaDraft.supermarketName
                                });
                              }}
                              className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-white"
                            >
                              <option value="">-- Select Supermarket --</option>
                              <option value="__NEW_SUPERMARKET__">+ Add New Supermarket...</option>
                              {effectiveSupermarkets.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name_en || s.name_ar || s.id}
                                  {(s as any).pendingCatalogCreation ? ' (Pending)' : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="text-[11px] text-slate-400 block mb-1">Start Date *</label>
                          <input
                            aria-label={`Start Date for ${leaf.fileName}`}
                            type="date"
                            value={metaDraft.offerStartDate}
                            onChange={(e) => setMetaDraft({ ...metaDraft, offerStartDate: e.target.value })}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-white"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-slate-400 block mb-1">End Date *</label>
                          <input
                            aria-label={`End Date for ${leaf.fileName}`}
                            type="date"
                            value={metaDraft.offerEndDate}
                            onChange={(e) => setMetaDraft({ ...metaDraft, offerEndDate: e.target.value })}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-white"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-slate-400 block mb-1">Geographic Scope *</label>
                          <select
                            aria-label={`Geographic Scope for ${leaf.fileName}`}
                            value={metaDraft.locationScope}
                            onChange={(e) => {
                              const nextScope = e.target.value as '' | 'national' | 'region' | 'city';
                              setMetaDraft({
                                ...metaDraft,
                                locationScope: nextScope,
                                regionId: nextScope === 'region' ? metaDraft.regionId : '',
                                cityId: nextScope === 'city' ? metaDraft.cityId : '',
                                locationLabel: nextScope === 'national' ? 'National' : ''
                              });
                            }}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-white"
                          >
                            <option value="">-- Select Verified Scope --</option>
                            <option value="national">National</option>
                            <option value="region">Region</option>
                            <option value="city">City</option>
                          </select>
                        </div>

                        {metaDraft.locationScope === 'region' && (
                          <div>
                            <label className="text-[11px] text-slate-400 block mb-1">Region *</label>
                            {catalogRegions.length > 0 ? (
                              <select
                                aria-label={`Region for ${leaf.fileName}`}
                                value={metaDraft.regionId}
                                onChange={(e) => {
                                  const reg = catalogRegions.find((r) => r.id === e.target.value);
                                  setMetaDraft({
                                    ...metaDraft,
                                    regionId: e.target.value,
                                    locationLabel: reg?.name_en || reg?.name_ar || ''
                                  });
                                }}
                                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-white"
                              >
                                <option value="">-- Select Region --</option>
                                {catalogRegions.map((r) => (
                                  <option key={r.id} value={r.id}>
                                    {r.name_en || r.name_ar || r.id}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type="text"
                                value={metaDraft.locationLabel}
                                onChange={(e) => setMetaDraft({ ...metaDraft, locationLabel: e.target.value })}
                                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-white"
                              />
                            )}
                          </div>
                        )}

                        {metaDraft.locationScope === 'city' && (
                          <div>
                            <label className="text-[11px] text-slate-400 block mb-1">City *</label>
                            {catalogCities.length > 0 ? (
                              <select
                                aria-label={`City for ${leaf.fileName}`}
                                value={metaDraft.cityId}
                                onChange={(e) => {
                                  const ct = catalogCities.find((c) => c.id === e.target.value);
                                  setMetaDraft({
                                    ...metaDraft,
                                    cityId: e.target.value,
                                    regionId: ct?.region_id || metaDraft.regionId,
                                    locationLabel: ct?.name_en || ct?.name_ar || ''
                                  });
                                }}
                                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-white"
                              >
                                <option value="">-- Select City --</option>
                                {catalogCities.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name_en || c.name_ar || c.id}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type="text"
                                value={metaDraft.locationLabel}
                                onChange={(e) => setMetaDraft({ ...metaDraft, locationLabel: e.target.value })}
                                className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-white"
                              />
                            )}
                          </div>
                        )}
                      </div>
                      <details className="bg-slate-950/60 border border-slate-800 rounded p-2.5">
                        <summary className="cursor-pointer text-[11px] font-semibold text-slate-300 select-none">
                          Optional Metadata Details (Campaign Title)
                        </summary>
                        <div className="grid grid-cols-1 gap-3 mt-2.5">
                          <div>
                            <label className="text-[11px] text-slate-400 block mb-1">Campaign / Title (Optional)</label>
                            <input
                              aria-label={`Campaign title for ${leaf.fileName}`}
                              type="text"
                              placeholder="Optional printed campaign title"
                              value={metaDraft.leafletTitle}
                              onChange={(e) => setMetaDraft({ ...metaDraft, leafletTitle: e.target.value })}
                              className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-white"
                            />
                          </div>
                        </div>
                      </details>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingMetaLeafletId(null)}
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={savingMeta}
                          onClick={handleSaveLeafletMetadata}
                          className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded text-xs font-bold"
                        >
                          {savingMeta ? 'Saving...' : '✓ Save & Verify Metadata'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Consolidated Batch Summary Banner */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-lg text-center">
            <span className="text-[11px] text-slate-400">Leaflets / Retailers</span>
            <p className="text-base font-bold text-white mt-0.5">
              {summary.leaflets.length} / {summary.supermarketsRepresented.length}
            </p>
          </div>
          <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-lg text-center">
            <span className="text-[11px] text-slate-400">Pages / Offers</span>
            <p className="text-base font-bold text-amber-400 mt-0.5">
              {summary.totals.pagesProcessed}/{summary.totals.totalPages}p · {offers.length}
            </p>
          </div>
          <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-lg text-center">
            <span className="text-[11px] text-slate-400">Catalog / Provisional</span>
            <p className="text-base font-bold text-emerald-400 mt-0.5">
              {matchingManifest?.totals.proposedExistingCount ?? summary.matchingSummary?.existingMatchesCount ?? 0} / {matchingManifest?.totals.proposedTemporaryCount ?? summary.matchingSummary?.temporaryGroupsCount ?? 0}
            </p>
          </div>
          <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-lg text-center">
            <span className="text-[11px] text-slate-400">Ready / Needs Review</span>
            <p className="text-base font-bold text-indigo-300 mt-0.5">
              {triageSummary.readyCount} / <span className="text-amber-300">{triageSummary.needsReviewCount}</span>
            </p>
          </div>
          <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-lg text-center">
            <span className="text-[11px] text-slate-400">Blocked / Quarantined</span>
            <p className="text-base font-bold text-rose-400 mt-0.5">{triageSummary.blockedCount}</p>
          </div>
          <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-lg text-center">
            <span className="text-[11px] text-slate-400">Actual API Cost</span>
            <p className="text-base font-bold text-cyan-400 mt-0.5">${summary.totals.totalCostUsd.toFixed(4)}</p>
          </div>
        </div>
      )}

      {summary?.costSummary && (
        <ExtractionCostSummaryCard
          costSummary={summary.costSummary}
          batchStatus={summary.status}
        />
      )}

      {/* Exception Triage Bar + Consolidated Review Sub-Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/75 border border-slate-800 p-3 rounded-xl">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="inline-flex bg-slate-900 border border-slate-800 rounded-lg p-0.5 mr-2">
            <button
              type="button"
              onClick={() => setReviewSection('offers')}
              className={`px-3 py-1 rounded-md font-semibold ${
                reviewSection === 'offers' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              📋 Offers &amp; Exceptions ({offers.length})
            </button>
            <button
              type="button"
              onClick={() => setReviewSection('grouped')}
              className={`px-3 py-1 rounded-md font-semibold ${
                reviewSection === 'grouped' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              🧩 Cross-Retailer Product Groups ({groupedView.verifiedGroups.length + groupedView.provisionalGroups.length})
            </button>
          </div>

          {(['all', 'ready', 'needs_review', 'blocked', 'published'] as const).map((cat) => {
            const count =
              cat === 'all'
                ? offers.length
                : cat === 'ready'
                  ? triageSummary.readyCount
                  : cat === 'needs_review'
                    ? triageSummary.needsReviewCount
                    : cat === 'blocked'
                      ? triageSummary.blockedCount
                      : triageSummary.publishedCount;
            const label =
              cat === 'all'
                ? 'All'
                : cat === 'ready'
                  ? '✓ Ready'
                  : cat === 'needs_review'
                    ? '⚠ Needs Review'
                    : cat === 'blocked'
                      ? '⛔ Blocked (Deferred)'
                      : '🚀 Published';
            return (
              <button
                key={cat}
                type="button"
                onClick={() => {
                  setReviewSection('offers');
                  setTriageFilter(cat);
                }}
                className={`px-2.5 py-1 rounded border text-[11px] font-semibold transition-colors ${
                  triageFilter === cat
                    ? 'bg-sky-700 text-white border-sky-500'
                    : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
                }`}
              >
                {label} ({count})
              </button>
            );
          })}
        </div>

        {matchingManifest && (
          <button
            type="button"
            disabled={
              bulkApproving ||
              Object.values(triageSummary.byOfferKey).filter((t) => t.canBulkApprove).length === 0
            }
            onClick={handleBulkApproveReadyMatches}
            className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-xs font-semibold rounded-lg"
            title="Approves only high-confidence verified Ready matches; never approves Needs Review or Blocked items"
          >
            {bulkApproving
              ? 'Approving...'
              : `✓ Approve Safe Ready Matches (${Object.values(triageSummary.byOfferKey).filter((t) => t.canBulkApprove).length})`}
          </button>
        )}
      </div>

      {publishedMissingImagesCount > 0 && (
        <div className="bg-amber-950/60 border border-amber-600/60 rounded-xl p-3.5 flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-3">
            <span className="text-xl">🖼️</span>
            <div>
              <div className="text-sm font-bold text-amber-300">
                Published Offers Missing Consumer Images ({publishedMissingImagesCount})
              </div>
              <div className="text-xs text-amber-200/80">
                {publishedMissingImagesCount} published offer{publishedMissingImagesCount > 1 ? 's lack' : ' lacks'} consumer images in Production. Inspect identity &amp; crop eligibility before authorizing repair.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleOpenRepairModal}
            className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold shadow transition-colors flex items-center gap-2"
          >
            <span>🔧</span>
            <span>Inspect &amp; Repair Images ({publishedMissingImagesCount})</span>
          </button>
        </div>
      )}

      {reviewSection === 'grouped' ? (
        <div className="space-y-4">
          {groupedView.verifiedGroups.length === 0 &&
          groupedView.provisionalGroups.length === 0 &&
          groupedView.unresolvedRows.length === 0 ? (
            <div className="border border-slate-800 rounded-lg p-8 text-center text-xs text-slate-400">
              No cross-retailer product groups available yet. Open Step 4 Publication &amp; Reconciliation for manual catalog matching if needed.
            </div>
          ) : (
            <div className="space-y-4">
              {groupedView.verifiedGroups.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-bold text-emerald-300 uppercase tracking-wider">
                    Verified Catalog Product Groups ({groupedView.verifiedGroups.length})
                  </h3>
                  {groupedView.verifiedGroups.map((grp) => (
                    <div
                      key={grp.groupKey}
                      className="p-3 bg-slate-950/80 border border-slate-800 rounded-lg space-y-2 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-bold text-white">
                            {grp.productTitleEn || grp.productTitleAr}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {grp.brandName || 'No brand'} · {grp.sizeLabel || 'Size N/A'} · Pack {grp.packCount ?? 1} · {grp.retailerCount} retailer(s)
                          </div>
                        </div>
                        <span className="px-2 py-0.5 bg-emerald-950 text-emerald-300 border border-emerald-800 rounded text-[10px] font-semibold">
                          Catalog ID: {grp.matchedProductId} ({grp.operatorDecision})
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        {grp.retailerRows.map((row) => (
                          <div
                            key={row.batchOfferKey}
                            className="p-2 bg-slate-900 border border-slate-800 rounded flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="font-semibold text-blue-300 truncate">{row.supermarketName}</div>
                              <div className="text-[10px] text-slate-400 truncate">
                                p.{row.sourcePage} · {row.offerStartDate || '?'} → {row.offerEndDate || '?'}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-bold text-emerald-400">
                                {row.promoPrice != null ? `${row.promoPrice.toFixed(2)} SAR` : '—'}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {groupedView.provisionalGroups.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-bold text-indigo-300 uppercase tracking-wider">
                    Provisional New-Product Groups ({groupedView.provisionalGroups.length})
                  </h3>
                  {groupedView.provisionalGroups.map((grp) => (
                    <div
                      key={grp.groupKey}
                      className="p-3 bg-slate-950/80 border border-indigo-900/60 rounded-lg space-y-2 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-bold text-white">
                            {grp.productTitleEn || grp.productTitleAr}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {grp.brandName || 'No brand'} · {grp.sizeLabel || 'Size N/A'} · Pack {grp.packCount ?? 1} · {grp.retailerCount} retailer(s)
                          </div>
                        </div>
                        <span className="px-2 py-0.5 bg-indigo-950 text-indigo-300 border border-indigo-800 rounded text-[10px] font-semibold">
                          Provisional ({grp.temporaryId}) · {grp.operatorDecision}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        {grp.retailerRows.map((row) => (
                          <div
                            key={row.batchOfferKey}
                            className="p-2 bg-slate-900 border border-slate-800 rounded flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="font-semibold text-blue-300 truncate">{row.supermarketName}</div>
                              <div className="text-[10px] text-slate-400 truncate">
                                p.{row.sourcePage} · {row.offerStartDate || '?'} → {row.offerEndDate || '?'}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-bold text-emerald-400">
                                {row.promoPrice != null ? `${row.promoPrice.toFixed(2)} SAR` : '—'}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {groupedView.unresolvedRows.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-bold text-amber-300 uppercase tracking-wider">
                    Unresolved / Quarantined Exceptions ({groupedView.unresolvedRows.length})
                  </h3>
                  {groupedView.unresolvedRows.map(({ offer: uo, proposal }) => (
                    <div
                      key={proposal.batchOfferKey}
                      className="p-2.5 bg-slate-950 border border-amber-900/70 rounded-lg flex items-center justify-between gap-3 text-xs"
                    >
                      <div>
                        <div className="font-semibold text-white">
                          {uo?.titleEn || uo?.titleAr || proposal.batchOfferKey}
                        </div>
                        <div className="text-[10px] text-amber-300">
                          {uo?.supermarketName || proposal.supermarketName || 'Retailer'} · p.{proposal.sourcePage} ·{' '}
                          {proposal.validationIssues?.map((v) => v.message).join(' | ') || 'Unresolved identity'}
                        </div>
                      </div>
                      {uo && (
                        <button
                          type="button"
                          onClick={() => openOfferInspector(uo)}
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-indigo-300 rounded text-[11px] font-semibold"
                        >
                          Inspect / Fix
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Filter Toolbar */}
          <div className="bg-slate-950/80 border border-slate-800 p-3.5 rounded-lg flex flex-wrap items-center gap-3">
        {/* Leaflet filter */}
        <div className="flex items-center gap-1.5 text-xs text-slate-300">
          <label className="text-slate-400">Leaflet:</label>
          <select
            value={selectedLeafletId}
            onChange={(e) => setSelectedLeafletId(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="all">All Leaflets ({summary?.leaflets.length || 0})</option>
            {summary?.leaflets.map((l) => (
              <option key={l.leafletId} value={l.leafletId}>
                {l.fileName} ({l.offersCount} offers)
              </option>
            ))}
          </select>
        </div>

        {/* Retailer filter */}
        <div className="flex items-center gap-1.5 text-xs text-slate-300">
          <label className="text-slate-400">Retailer:</label>
          <select
            value={selectedRetailer}
            onChange={(e) => setSelectedRetailer(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="all">All Retailers</option>
            {uniqueRetailers.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        {/* Page filter */}
        <div className="flex items-center gap-1.5 text-xs text-slate-300">
          <label className="text-slate-400">Page:</label>
          <select
            value={selectedPageFilter}
            onChange={(e) => setSelectedPageFilter(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="all">All Pages</option>
            {uniquePages.map((p) => (
              <option key={p} value={String(p)}>
                Page {p}
              </option>
            ))}
          </select>
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-1.5 text-xs text-slate-300">
          <label className="text-slate-400">Status:</label>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="all">All Statuses</option>
            <option value="extracted">Extracted</option>
            <option value="reviewed">Reviewed</option>
            <option value="ready_for_matching">Ready for Matching</option>
            <option value="published">Published</option>
          </select>
        </div>

        {/* Search input */}
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Search by Arabic title, English title, or brand..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        {/* Reset filters */}
        {(selectedLeafletId !== 'all' || selectedRetailer !== 'all' || selectedPageFilter !== 'all' || selectedStatus !== 'all' || searchQuery) && (
          <button
            type="button"
            onClick={() => {
              setSelectedLeafletId('all');
              setSelectedRetailer('all');
              setSelectedPageFilter('all');
              setSelectedStatus('all');
              setSearchQuery('');
            }}
            className="text-xs text-indigo-400 hover:text-indigo-300 underline"
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Offers Table */}
      {filteredOffers.length === 0 ? (
        <div className="border border-slate-800 rounded-lg p-10 text-center text-slate-400">
          <span className="text-3xl block mb-2">🔍</span>
          <p className="text-sm">No offers match the selected filters.</p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-slate-800 rounded-lg max-h-[600px] overflow-y-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 sticky top-0 text-slate-400 border-b border-slate-800 z-10">
              <tr>
                <th className="py-2.5 px-3 font-semibold">Thumbnail</th>
                <th className="py-2.5 px-3 font-semibold">Product Title & Brand</th>
                <th className="py-2.5 px-3 font-semibold">Retailer & Source</th>
                <th className="py-2.5 px-3 font-semibold">Price & Promo</th>
                <th className="py-2.5 px-3 font-semibold">Quantity / Pack Spec</th>
                <th className="py-2.5 px-3 font-semibold">Status</th>
                <th className="py-2.5 px-3 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 bg-slate-900/60">
              {filteredOffers.map((offer) => {
                const thumbUrl = getLocalImageUrl(offer.productThumbCropPath || offer.offerCardCropPath);
                return (
                  <tr key={offer.batchOfferKey} className="hover:bg-slate-800/40 transition-colors">
                    {/* Thumbnail */}
                    <td className="py-2.5 px-3 w-16">
                      <div className="w-14 h-14 bg-slate-950 rounded border border-slate-800 flex items-center justify-center overflow-hidden">
                        {thumbUrl ? (
                          <img
                            src={thumbUrl}
                            alt={offer.titleEn || offer.titleAr}
                            className="w-full h-full object-contain hover:scale-110 transition-transform"
                            onError={(e) => {
                              // If thumb fails, try evidence crop
                              const target = e.currentTarget;
                              if (offer.offerCardCropPath && target.src !== getLocalImageUrl(offer.offerCardCropPath)) {
                                target.src = getLocalImageUrl(offer.offerCardCropPath) || '';
                              }
                            }}
                          />
                        ) : (
                          <span className="text-[10px] text-slate-600">No Image</span>
                        )}
                      </div>
                    </td>

                    {/* Titles & Brand */}
                    <td className="py-2.5 px-3 max-w-xs">
                      {offer.titleAr && (
                        <div className="font-bold text-white text-xs mb-0.5" dir="rtl">
                          {offer.titleAr}
                        </div>
                      )}
                      {offer.titleEn && (
                        <div className="text-slate-300 text-[11px] truncate" title={offer.titleEn}>
                          {offer.titleEn}
                        </div>
                      )}
                      <div className="mt-1 flex flex-wrap gap-1">
                        {offer.brand && (
                          <span className="px-1.5 py-0.5 bg-amber-950/80 border border-amber-800/60 text-amber-300 text-[10px] rounded font-medium">
                            Brand: {offer.brand}
                          </span>
                        )}
                        {offer.operatorEdited && (
                          <span className="px-1.5 py-0.5 bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-[10px] rounded font-semibold">
                            Edited
                          </span>
                        )}
                        {(() => {
                          const triage = triageSummary.byOfferKey[offer.batchOfferKey];
                          if (!triage) return null;
                          if (triage.diagnosticKind === 'non_grocery_excluded') {
                            return (
                              <span className="px-1.5 py-0.5 bg-slate-800 border border-slate-600 text-slate-200 text-[10px] rounded font-semibold">
                                Non-Grocery Excluded
                              </span>
                            );
                          }
                          if (triage.diagnosticKind === 'extraction_conflict') {
                            return (
                              <span className="px-1.5 py-0.5 bg-rose-950/80 border border-rose-700 text-rose-200 text-[10px] rounded font-semibold">
                                Extraction Conflict
                              </span>
                            );
                          }
                          if (triage.diagnosticKind === 'missing_identity') {
                            return (
                              <span className="px-1.5 py-0.5 bg-amber-950/80 border border-amber-700 text-amber-200 text-[10px] rounded font-semibold">
                                Missing Identity
                              </span>
                            );
                          }
                          return null;
                        })()}
                        {offer.consumerImageApprovalStatus === 'approved_generated_crop' && (
                          <span className="px-1.5 py-0.5 bg-emerald-950/80 border border-emerald-700 text-emerald-300 text-[10px] rounded font-semibold">
                            ✓ Product Crop Selected
                          </span>
                        )}
                        {offer.consumerImageApprovalStatus === 'reuse_existing_catalog_image' && (
                          <span className="px-1.5 py-0.5 bg-cyan-950/80 border border-cyan-700 text-cyan-300 text-[10px] rounded font-semibold">
                            ♻️ Catalog Image Reused
                          </span>
                        )}
                        {offer.consumerImageApprovalStatus === 'invalidated_identity_changed' && (
                          <span className="px-1.5 py-0.5 bg-amber-950/80 border border-amber-700 text-amber-300 text-[10px] rounded font-semibold">
                            ⚠ Image Re-approval Required
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Retailer & Source */}
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1 flex-wrap mb-1">
                        {offer.supermarketName && (
                          <span className="px-1.5 py-0.5 bg-blue-950/90 border border-blue-800 text-blue-300 text-[10px] rounded font-semibold">
                            {offer.supermarketName}
                          </span>
                        )}
                        {offer.locationLabel && (
                          <span className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 text-slate-300 text-[10px] rounded">
                            {offer.locationLabel}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate max-w-[180px]" title={offer.sourceFileName}>
                        {offer.sourceFileName} • p.{offer.sourcePage}
                      </div>
                      {offer.offerStartDate && (
                        <div className="text-[9px] text-slate-500">
                          Dates: {offer.offerStartDate} {offer.offerEndDate ? `to ${offer.offerEndDate}` : ''}
                        </div>
                      )}
                      {offer.conflictCodes?.includes('SINGLE_DAY_OFFER_EXCEPTION') && (
                        <span className="inline-block mt-0.5 px-1.5 py-0.5 bg-amber-950 border border-amber-700 text-amber-300 text-[9px] rounded font-semibold">
                          ⚠ ONE DAY ONLY Exception
                        </span>
                      )}
                    </td>

                    {/* Pricing */}
                    <td className="py-2.5 px-3">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-emerald-400 font-bold text-sm">
                          {offer.promoPrice != null ? `${offer.promoPrice.toFixed(2)} SAR` : '—'}
                        </span>
                        {offer.originalPrice != null && (
                          <span className="text-slate-500 line-through text-[11px]">
                            {offer.originalPrice.toFixed(2)}
                          </span>
                        )}
                      </div>
                      {offer.discountPercent != null && (
                        <span className="text-[10px] text-amber-400 font-medium">
                          -{offer.discountPercent}% OFF
                        </span>
                      )}
                    </td>

                    {/* Quantity & Pack Specs */}
                    <td className="py-2.5 px-3">
                      {offer.sizeOrWeight && (
                        <div className="text-slate-200 text-xs font-mono">{offer.sizeOrWeight}</div>
                      )}
                      {offer.inner_pack_count && offer.inner_pack_count > 1 && (
                        <div className="text-[10px] text-indigo-300">
                          Pack: {offer.inner_pack_count} units
                        </div>
                      )}
                      {offer.total_content_value && (
                        <div className="text-[10px] text-slate-400">
                          Total: {offer.total_content_value} {offer.total_content_unit || ''}
                        </div>
                      )}
                      {offer.free_units_text && (
                        <div className="text-[10px] text-emerald-300 font-semibold">
                          Free: {offer.free_units_text}
                        </div>
                      )}
                    </td>

                    {/* Status */}
                    <td className="py-2.5 px-3 space-y-1">
                      {getStatusBadge(offer.status)}
                      {triageSummary.byOfferKey[offer.batchOfferKey] && (
                        <div>
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
                              triageSummary.byOfferKey[offer.batchOfferKey].category === 'ready'
                                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                                : triageSummary.byOfferKey[offer.batchOfferKey].category === 'blocked'
                                  ? 'bg-rose-950/80 text-rose-300 border-rose-800'
                                  : 'bg-amber-950/80 text-amber-300 border-amber-800'
                            }`}
                          >
                            {triageSummary.byOfferKey[offer.batchOfferKey].category === 'ready'
                              ? '✓ Ready'
                              : triageSummary.byOfferKey[offer.batchOfferKey].category === 'blocked'
                                ? '⛔ Blocked'
                                : '⚠ Needs Review'}
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Action */}
                    <td className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => openOfferInspector(offer)}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-indigo-300 hover:text-white rounded text-xs transition-colors font-medium"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
        </>
      )}

      {/* Offer Inspection Modal */}
      {selectedOffer && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-3xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-lg font-bold text-white">Offer Inspection</h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{selectedOffer.batchOfferKey}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOffer(null)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {/* Images: Original Full Page, Offer-Square Crop & Product-Only Crop */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-center">
                <span className="text-xs font-semibold text-slate-400 block mb-2">
                  Original Leaflet Page (p.{selectedOffer.sourcePage})
                </span>
                <div className="h-52 flex items-center justify-center overflow-hidden bg-black/40 rounded">
                  {getLocalImageUrl(selectedOffer.originalPageImagePath || null) ? (
                    <img
                      src={getLocalImageUrl(selectedOffer.originalPageImagePath || null)!}
                      alt="Original Page"
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <span className="text-xs text-slate-600 italic">Original page unavailable</span>
                  )}
                </div>
                <span className="text-[10px] text-slate-500 mt-1 block font-mono truncate">
                  page.{selectedOffer.sourcePage}.png
                </span>
              </div>

              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-center">
                <span className="text-xs font-semibold text-slate-400 block mb-2">
                  Offer-Card Crop (Private Evidence Only)
                </span>
                <div className="h-52 flex items-center justify-center overflow-hidden bg-black/40 rounded">
                  {getLocalImageUrl(selectedOffer.offerCardCropPath) ? (
                    <img
                      src={getLocalImageUrl(selectedOffer.offerCardCropPath)!}
                      alt="Offer Evidence"
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <span className="text-xs text-slate-600 italic">Evidence unavailable</span>
                  )}
                </div>
                <span className="text-[10px] text-amber-400/90 mt-1 block font-mono truncate">
                  offer_card_crop.webp • Private (`offer-images` only)
                </span>
              </div>

              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-center">
                <span className="text-xs font-semibold text-slate-400 block mb-2">
                  Product-Only Crop ({selectedOffer.imageSubjectScope || 'unverified'})
                </span>
                <div className="h-52 flex items-center justify-center overflow-hidden bg-black/40 rounded">
                  {getLocalImageUrl(selectedOffer.productThumbCropPath) ? (
                    <img
                      src={getLocalImageUrl(selectedOffer.productThumbCropPath)!}
                      alt="Product Only"
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <span className="text-xs text-slate-600 italic">Product crop unavailable</span>
                  )}
                </div>
                <span className="text-[10px] text-slate-500 mt-1 block font-mono truncate">
                  product_thumb_crop.webp
                </span>
              </div>
            </div>

            {/* Catalog Identity & Consumer-Facing Product Image Approval Panel */}
            {(() => {
              const prop = matchingManifest?.proposals?.[selectedOffer.batchOfferKey] ?? null;
              const tempGroup =
                prop?.decision === 'temporary' && prop.temporaryId
                  ? matchingManifest?.temporaryProducts?.[prop.temporaryId] ?? null
                  : null;
              const existingImgUrl =
                selectedOffer.existingCatalogProductImageUrl || prop?.matchedProduct?.imageUrl || null;
              const isCustom = Boolean(selectedOffer.customProductThumbCropPath);
              const localCropPath =
                selectedOffer.consumerProductImagePath ||
                selectedOffer.customProductThumbCropPath ||
                selectedOffer.productThumbCropPath;
              const approvalStatus =
                selectedOffer.consumerImageApprovalStatus || (localCropPath ? 'approved_generated_crop' : 'unreviewed');
              const proposedConsumerUrl =
                approvalStatus === 'reuse_existing_catalog_image'
                  ? existingImgUrl
                  : localCropPath
                  ? getLocalImageUrl(localCropPath)
                  : null;

              return (
                <div className="bg-slate-950/90 border border-slate-700/80 rounded-lg p-4 text-xs space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-bold text-indigo-300">
                        Consumer Product Image &amp; Catalog Identity Review
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        Proposed Product Identity:{' '}
                        <strong className="text-slate-200">
                          {prop?.decision === 'existing' && prop.matchedProductId
                            ? `Catalog #${prop.matchedProductId} — ${prop.matchedProduct?.nameEn || prop.matchedProduct?.nameAr || selectedOffer.titleEn || selectedOffer.titleAr}`
                            : tempGroup
                            ? `Provisional ${tempGroup.temporaryId} — ${tempGroup.productNameEn || tempGroup.productNameAr || selectedOffer.titleEn}`
                            : 'Unresolved catalog product identity'}
                        </strong>
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${
                        isCustom
                          ? 'bg-purple-950/80 border-purple-700 text-purple-300'
                          : approvalStatus === 'approved_generated_crop'
                          ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
                          : approvalStatus === 'reuse_existing_catalog_image'
                          ? 'bg-cyan-950/80 border-cyan-700 text-cyan-300'
                          : approvalStatus === 'invalidated_identity_changed'
                          ? 'bg-amber-950/80 border-amber-700 text-amber-300'
                          : approvalStatus === 'rejected'
                          ? 'bg-rose-950/80 border-rose-700 text-rose-300'
                          : 'bg-slate-900 border-slate-700 text-slate-300'
                      }`}
                    >
                      {isCustom ? 'Custom Replacement Image' : `Image Status: ${approvalStatus}`}
                    </span>
                  </div>

                  {selectedOffer.consumerImageInvalidationReason && (
                    <div className="p-2 bg-amber-950/60 border border-amber-700/70 rounded text-amber-200 text-[11px]">
                      ⚠ {selectedOffer.consumerImageInvalidationReason}
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="bg-slate-900 border border-slate-800 rounded p-2.5 text-center">
                      <div className="text-[11px] font-semibold text-slate-400 mb-1.5">
                        Existing Catalog Product Image
                      </div>
                      <div className="h-28 flex items-center justify-center bg-black/40 rounded overflow-hidden">
                        {existingImgUrl ? (
                          <img src={existingImgUrl} alt="Existing Catalog" className="max-h-full max-w-full object-contain" />
                        ) : (
                          <span className="text-[11px] text-slate-500 italic">No existing catalog image</span>
                        )}
                      </div>
                    </div>
                    <div className="bg-slate-900 border border-slate-800 rounded p-2.5 text-center">
                      <div className="text-[11px] font-semibold text-slate-400 mb-1.5">
                        Proposed Consumer-Facing Image (`product-images`)
                      </div>
                      <div className="h-28 flex items-center justify-center bg-black/40 rounded overflow-hidden">
                        {proposedConsumerUrl ? (
                          <img src={proposedConsumerUrl} alt="Consumer Image" className="max-h-full max-w-full object-contain" />
                        ) : (
                          <span className="text-[11px] text-slate-500 italic">
                            No product crop available
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
                        {isCustom ? (
                          <span className="text-[10px] bg-purple-950/80 text-purple-300 border border-purple-700/70 px-1.5 py-0.5 rounded font-mono">
                            Rights: operator_replaced_image
                          </span>
                        ) : selectedOffer.approvedConsumerImageRightsBasis ? (
                          <span className="text-[10px] text-emerald-300/90 font-mono">
                            Rights: {selectedOffer.approvedConsumerImageRightsBasis}
                          </span>
                        ) : localCropPath ? (
                          <span className="text-[10px] text-emerald-300/90 font-mono">
                            Auto-Selected Product Crop
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleReplaceImage}
                      className="px-3 py-1.5 bg-indigo-700 hover:bg-indigo-600 text-white rounded font-semibold text-xs"
                    >
                      📁 Replace Image…
                    </button>
                    {isCustom && (
                      <button
                        type="button"
                        onClick={handleRestoreDefaultCrop}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 rounded font-semibold text-xs"
                      >
                        ↺ Restore Default Crop
                      </button>
                    )}
                    {existingImgUrl && approvalStatus !== 'reuse_existing_catalog_image' && (
                      <button
                        type="button"
                        disabled={savingConsumerImage}
                        onClick={() => handleConsumerImageDecision(selectedOffer, 'reuse_existing_catalog_image')}
                        className="px-3 py-1.5 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 text-white rounded font-semibold text-xs"
                      >
                        Use Catalog Image
                      </button>
                    )}
                    {approvalStatus === 'reuse_existing_catalog_image' && localCropPath && (
                      <button
                        type="button"
                        disabled={savingConsumerImage}
                        onClick={() => handleConsumerImageDecision(selectedOffer, 'approve_generated_crop')}
                        className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white rounded font-semibold text-xs"
                      >
                        Use Product Crop
                      </button>
                    )}
                    {localCropPath && (
                      <span className="px-2.5 py-1 bg-emerald-950/70 border border-emerald-700/70 text-emerald-300 rounded font-semibold text-[11px]">
                        ✓ {isCustom ? 'Custom Product Image Selected' : 'Product-Only Crop Auto-Selected (Default)'}
                      </span>
                    )}
                  </div>

                  {selectedOffer.publicationState?.state === 'published' && (
                    <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[11px] text-emerald-400">
                        ✓ Published in Production (ID: <span className="font-mono">{selectedOffer.publicationState.offerId}</span>)
                      </div>
                      {isCustom && (
                        <button
                          type="button"
                          onClick={handleUpdatePublishedImage}
                          className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded font-bold text-xs"
                        >
                          Update Published Image in Production
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
              })()}

              {(() => {
                const triage = triageSummary.byOfferKey[selectedOffer.batchOfferKey];
                const hasConflicts = (selectedOffer.conflictCodes?.length || 0) > 0;
                const hasQuarantines = (selectedOffer.quarantineReasons?.length || 0) > 0;
                const hasDiagnostics =
                  hasConflicts ||
                  hasQuarantines ||
                  Boolean(triage?.technicalReasons && triage.technicalReasons.length > 0);
                if (!hasDiagnostics && (!triage || triage.diagnosticKind === 'ready')) return null;
                return (
                  <div className="p-3 bg-rose-950/60 border border-rose-800 rounded-lg text-xs text-rose-200 space-y-1.5">
                    <div className="font-bold">
                      {triage ? `${triage.diagnosticLabel}` : 'Review Required'}
                    </div>
                    {triage && triage.reasons.length > 0 && (
                      <div className="text-rose-100">{triage.reasons.join(' ')}</div>
                    )}
                    {hasDiagnostics && (
                      <details className="text-[11px] text-rose-300/80 pt-1 border-t border-rose-900/60">
                        <summary className="cursor-pointer select-none font-semibold">
                          Developer Diagnostics
                        </summary>
                        <div className="mt-1 space-y-0.5 font-mono text-[10px]">
                          {hasConflicts && (
                            <div>Extraction Conflicts: {selectedOffer.conflictCodes!.join(', ')}</div>
                          )}
                          {hasQuarantines && (
                            <div>Quarantine Flags: {selectedOffer.quarantineReasons!.join(' | ')}</div>
                          )}
                          {triage?.technicalReasons && triage.technicalReasons.length > 0 && (
                            <div>Technical Details: {triage.technicalReasons.join(' | ')}</div>
                          )}
                        </div>
                      </details>
                    )}
                  </div>
                );
              })()}

            {/* Operator Edit Form (Preserves Original OCR Evidence) */}
            {editDraft && (
              <div className="bg-slate-950/80 p-4 rounded-lg border border-slate-800 space-y-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-indigo-300">
                    Review & Correct Extracted Fields (Preserves Original OCR Snapshot)
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={savingEdit}
                      onClick={handleResolveAsAssorted}
                      className="px-3 py-1 bg-violet-700 hover:bg-violet-600 disabled:opacity-50 text-white font-semibold rounded text-xs"
                      title="Mark as multi-variant assortment, append — Assorted / — متنوع, suppress mixed-variant unit pricing, and transition to Ready"
                    >
                      Resolve as Assorted / Mark Ready After Review
                    </button>
                    {(!selectedOffer.brand ||
                      triageSummary.byOfferKey[selectedOffer.batchOfferKey]?.reviewReasons?.some((r) =>
                        r.includes('Brand')
                      )) && (
                      <button
                        type="button"
                        disabled={savingEdit}
                        onClick={handleApproveNonCatalog}
                        className="px-3 py-1 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white font-semibold rounded text-xs"
                        title="Approve unbranded or produce/fresh commodity identity and transition to Ready"
                      >
                        Approve Non-Catalog / Mark Ready After Review
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={savingEdit}
                      onClick={handleSaveOfferEdit}
                      className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded text-xs"
                    >
                      {savingEdit ? 'Saving & Revalidating...' : 'Save & Revalidate Corrections'}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  <div>
                    <label className="text-[10px] text-slate-400">Arabic Title</label>
                    <input
                      type="text"
                      dir="rtl"
                      value={editDraft.titleAr}
                      onChange={(e) => setEditDraft({ ...editDraft, titleAr: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400">English Title</label>
                    <input
                      type="text"
                      value={editDraft.titleEn}
                      onChange={(e) => setEditDraft({ ...editDraft, titleEn: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400">Brand / Variant</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <input
                        type="text"
                        placeholder="Brand"
                        value={editDraft.brand}
                        onChange={(e) => setEditDraft({ ...editDraft, brand: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white"
                      />
                      <input
                        type="text"
                        placeholder="Variant"
                        value={editDraft.variantOrFlavor}
                        onChange={(e) => setEditDraft({ ...editDraft, variantOrFlavor: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400">Promo / Original Price</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Promo"
                        value={editDraft.promoPrice}
                        onChange={(e) => setEditDraft({ ...editDraft, promoPrice: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white"
                      />
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Original"
                        value={editDraft.originalPrice}
                        onChange={(e) => setEditDraft({ ...editDraft, originalPrice: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400">Each Size Value / Unit</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Size"
                        value={editDraft.each_size_value}
                        onChange={(e) => setEditDraft({ ...editDraft, each_size_value: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white"
                      />
                      <input
                        type="text"
                        placeholder="g / ml / kg"
                        value={editDraft.each_size_unit}
                        onChange={(e) => setEditDraft({ ...editDraft, each_size_unit: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400">Pack Count &amp; Sale Unit Type</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <input
                        type="number"
                        min="1"
                        placeholder="Pack"
                        value={editDraft.inner_pack_count}
                        onChange={(e) => setEditDraft({ ...editDraft, inner_pack_count: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white"
                      />
                      <input
                        type="text"
                        placeholder="unit / pack / weighted"
                        value={editDraft.sale_unit_type}
                        onChange={(e) => setEditDraft({ ...editDraft, sale_unit_type: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400">Assortment Status</label>
                    <select
                      value={editDraft.assortment_status}
                      onChange={(e) => setEditDraft({ ...editDraft, assortment_status: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white"
                    >
                      <option value="">-- Assortment --</option>
                      <option value="confirmed_single_sku">confirmed_single_sku</option>
                      <option value="single_sku">single_sku</option>
                      <option value="unsplit_assortment">unsplit_assortment (Assorted)</option>
                      <option value="visual_multiple_variants">visual_multiple_variants</option>
                      <option value="multiple_variants">multiple_variants</option>
                    </select>
                  </div>
                </div>
                {(selectedOffer.conflictCodes?.length || 0) > 0 || (selectedOffer.quarantineReasons?.length || 0) > 0 ? (
                  <label className="flex items-center gap-2 text-[11px] text-amber-200 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={editDraft.confirmConflictResolution}
                      onChange={(e) =>
                        setEditDraft({ ...editDraft, confirmConflictResolution: e.target.checked })
                      }
                    />
                    <span>
                      I verified the card evidence and resolved all extraction conflicts above (re-checks all deterministic rules).
                    </span>
                  </label>
                ) : null}
                {rematchNotice && (
                  <div className="p-2 bg-indigo-950/60 border border-indigo-700 rounded text-[11px] text-indigo-200">
                    🔄 {rematchNotice}
                  </div>
                )}
                {selectedOffer.originalOcrSnapshot && (
                  <div className="text-[10px] text-slate-400 pt-1 border-t border-slate-800/80">
                    Immutable Source OCR Evidence: {(selectedOffer.originalOcrSnapshot as any).titleEn || '—'} | {(selectedOffer.originalOcrSnapshot as any).titleAr || '—'} | Promo {(selectedOffer.originalOcrSnapshot as any).priceAfter ?? '—'}
                  </div>
                )}
              </div>
            )}

            {/* Structured Details */}
            <div className="grid grid-cols-2 gap-4 text-xs bg-slate-950/60 p-4 rounded-lg border border-slate-800">
              <div className="space-y-1.5">
                <div>
                  <span className="text-slate-500">Arabic Title: </span>
                  <span className="font-bold text-white" dir="rtl">{selectedOffer.titleAr || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-500">English Title: </span>
                  <span className="text-slate-200">{selectedOffer.titleEn || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-500">Brand: </span>
                  <span className="text-amber-300 font-semibold">{selectedOffer.brand || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-500">Supermarket: </span>
                  <span className="text-blue-300">{selectedOffer.supermarketName || selectedOffer.supermarketId || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-500">Location Scope: </span>
                  <span className="text-slate-300">{selectedOffer.locationLabel || selectedOffer.locationScope || '—'}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <div>
                  <span className="text-slate-500">Promo Price: </span>
                  <span className="text-emerald-400 font-bold">
                    {selectedOffer.promoPrice != null ? `${selectedOffer.promoPrice.toFixed(2)} SAR` : '—'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Original Price: </span>
                  <span className="line-through text-slate-400">
                    {selectedOffer.originalPrice != null ? `${selectedOffer.originalPrice.toFixed(2)} SAR` : '—'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Declared Quantity: </span>
                  <span className="font-mono text-slate-200">{selectedOffer.sizeOrWeight || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-500">Inner Pack Count: </span>
                  <span className="text-slate-300">{selectedOffer.inner_pack_count ?? '1'}</span>
                </div>
                <div>
                  <span className="text-slate-500">Total Content: </span>
                  <span className="text-slate-300">
                    {selectedOffer.total_content_value ? `${selectedOffer.total_content_value} ${selectedOffer.total_content_unit || ''}` : '—'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex justify-end items-center pt-2">
              <button
                type="button"
                onClick={() => setSelectedOffer(null)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg ml-auto"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {isNewSupermarketModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>🏪</span> Add New Supermarket
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Creates a pending retailer record locally with zero database writes. It will be created atomically when publishing to production.
              </p>
            </div>

            {newSupermarketError && (
              <div className="p-2.5 bg-rose-950/70 border border-rose-700 rounded text-rose-200 text-xs">
                {newSupermarketError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  English Supermarket Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Al Nokhba Markets"
                  value={newSupermarketNameEn}
                  onChange={(e) => setNewSupermarketNameEn(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white text-xs focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Arabic Supermarket Name (Optional / Prefilled)
                </label>
                <input
                  type="text"
                  placeholder="e.g. أسواق النخبة"
                  dir="rtl"
                  value={newSupermarketNameAr}
                  onChange={(e) => setNewSupermarketNameAr(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white text-xs focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsNewSupermarketModalOpen(false)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmNewSupermarket}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-bold shadow"
              >
                Save Supermarket
              </button>
            </div>
          </div>
        </div>
      )}

      {showImageRepairModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-6xl w-full p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <span>🔧</span> Guarded Identity &amp; Consumer Image Repair
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Inspect each missing-image offer&apos;s pack size, catalog identity, proposed image preview, and eligibility before authorizing database or storage updates.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowImageRepairModal(false)}
                className="text-slate-400 hover:text-white text-lg font-bold px-2 py-1"
              >
                ✕
              </button>
            </div>

            {loadingRepairPreview && (
              <div className="p-8 text-center text-slate-400 text-sm">
                Scanning published offers, catalog identities, and local crops...
              </div>
            )}

            {!loadingRepairPreview && repairPreviewData && (
              <div className="space-y-4">
                <div className="grid grid-cols-5 gap-2.5 text-xs">
                  <div className="bg-slate-950 p-2.5 rounded border border-slate-800">
                    <span className="text-slate-400 block">Total Published</span>
                    <span className="text-white font-bold text-sm">{repairPreviewData.totalPublishedOffers}</span>
                  </div>
                  <div className="bg-slate-950 p-2.5 rounded border border-amber-900/50">
                    <span className="text-amber-400 block">Missing Images</span>
                    <span className="text-amber-300 font-bold text-sm">{repairPreviewData.missingImageOffersCount}</span>
                  </div>
                  <div className="bg-slate-950 p-2.5 rounded border border-emerald-900/50">
                    <span className="text-emerald-400 block">Ready Automatically</span>
                    <span className="text-emerald-300 font-bold text-sm">{repairPreviewData.readyForRepairCount}</span>
                  </div>
                  <div className="bg-slate-950 p-2.5 rounded border border-indigo-900/50">
                    <span className="text-indigo-400 block">Awaiting Identity Fix</span>
                    <span className="text-indigo-300 font-bold text-sm">{repairPreviewData.awaitingIdentityCorrectionCount}</span>
                  </div>
                  <div className="bg-slate-950 p-2.5 rounded border border-rose-900/50">
                    <span className="text-rose-400 block">Crop / Operator Action</span>
                    <span className="text-rose-300 font-bold text-sm">
                      {repairPreviewData.awaitingCropCorrectionCount + repairPreviewData.requiresOperatorAttentionCount}
                    </span>
                  </div>
                </div>

                <div className="overflow-x-auto border border-slate-800 rounded-lg max-h-[420px] overflow-y-auto">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 sticky top-0 z-10">
                      <tr>
                        <th className="py-2 px-3">Source Offer / Price &amp; Size</th>
                        <th className="py-2 px-3">Current vs. Proposed Identity</th>
                        <th className="py-2 px-3">Proposed Image Preview</th>
                        <th className="py-2 px-3">Eligibility &amp; Planned Changes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 bg-slate-900/60 text-[11px]">
                      {repairPreviewData.repairs.map((rep) => {
                        const badgeCls =
                          rep.repairEligibility === 'ready_for_repair'
                            ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                            : rep.repairEligibility === 'awaiting_identity_correction'
                              ? 'bg-indigo-950 text-indigo-300 border-indigo-800'
                              : rep.repairEligibility === 'awaiting_crop_correction'
                                ? 'bg-amber-950 text-amber-300 border-amber-800'
                                : 'bg-rose-950 text-rose-300 border-rose-800';
                        const badgeLabel =
                          rep.repairEligibility === 'ready_for_repair'
                            ? '✓ Ready for Automatic Repair'
                            : rep.repairEligibility === 'awaiting_identity_correction'
                              ? '🔁 Awaiting Identity Correction'
                              : rep.repairEligibility === 'awaiting_crop_correction'
                                ? '🖼️ Awaiting Crop Correction'
                                : '⚠️ Requires Operator Attention';

                        return (
                          <tr key={rep.batchOfferKey} className="hover:bg-slate-800/30 align-top">
                            <td className="py-2.5 px-3 max-w-[220px]">
                              <div className="font-semibold text-white">{rep.titleEn}</div>
                              {rep.titleAr && <div className="text-slate-400 text-[10px]" dir="rtl">{rep.titleAr}</div>}
                              <div className="font-mono text-slate-500 text-[10px] mt-0.5">{rep.sourceOfferId}</div>
                              <div className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
                                {rep.offerPrice != null && (
                                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-amber-300 font-semibold">
                                    {rep.offerPrice} {rep.currency || 'SAR'}
                                  </span>
                                )}
                                {rep.packSizeLabel && (
                                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-sky-300">
                                    Size: {rep.packSizeLabel}
                                  </span>
                                )}
                              </div>
                            </td>

                            <td className="py-2.5 px-3 max-w-[240px] space-y-1">
                              <div className="text-[10px] text-slate-400">
                                <span className="text-slate-500">Current:</span> {rep.currentProductLabel || 'Unlinked'}
                              </div>
                              {rep.hasPopulatedOfferThumbnailWithoutConsumerRow && (
                                <div className="p-1.5 rounded bg-amber-950/60 border border-amber-800/70 text-[10px] text-amber-200">
                                  ⚠️ <code>offers.thumbnail_url</code> set, but{' '}
                                  <code>v_consumer_offers.image_url</code> is <strong>NULL</strong> (missing{' '}
                                  <code>offer_display_images</code> row).
                                </div>
                              )}
                              {rep.proposedIdentityAction && rep.proposedIdentityAction !== 'keep' ? (
                                <div className="p-1.5 rounded bg-indigo-950/60 border border-indigo-800/70 text-[10px] text-indigo-200">
                                  <span className="font-bold block text-indigo-300">Proposed Fix:</span>
                                  {rep.proposedProductLabel}
                                  {rep.proposedTitleEn && (
                                    <div className="mt-0.5 text-slate-300 italic">Title → {rep.proposedTitleEn}</div>
                                  )}
                                </div>
                              ) : rep.dependsOnSiblingIdentityCorrection ? (
                                <div className="p-1.5 rounded bg-amber-950/60 border border-amber-800/70 text-[10px] text-amber-200">
                                  <span className="font-bold block text-amber-300">⏳ Held Behind Sibling Identity Fix:</span>
                                  Product #{rep.productId} still shared with {rep.blockingSiblingSourceOfferIds?.join(', ') || 'conflicting tier'}. Relinks first in Phase 1 before uploading catalog image.
                                </div>
                              ) : (
                                <div className="text-[10px] text-emerald-400">✓ Identity Verified</div>
                              )}
                              <div className="text-[10px] text-slate-500">Bucket: <code>{rep.targetBucket}</code></div>
                            </td>

                            <td className="py-2.5 px-3 w-[180px]">
                              <div className="flex items-start gap-2">
                                <div className="w-16 h-16 bg-slate-950 rounded border border-slate-800 flex items-center justify-center overflow-hidden shrink-0">
                                  {rep.localSourceCropPath ? (
                                    <img
                                      src={getLocalImageUrl(rep.localSourceCropPath) || ''}
                                      alt={rep.titleEn}
                                      className="w-full h-full object-contain"
                                    />
                                  ) : (
                                    <span className="text-[9px] text-rose-400 text-center px-1">No clean crop</span>
                                  )}
                                </div>
                                <div className="space-y-1">
                                  <div className="text-[10px] text-slate-400">
                                    {rep.cropType === 'custom_thumb'
                                      ? '✓ Custom Replacement Image'
                                      : rep.requiresReplacementImage
                                        ? `⛔ ${rep.visiblePackageWeightLabel || 'Conflicting'}-Labeled Bag — 10kg Photo Required`
                                        : rep.cropType === 'product_thumb'
                                          ? rep.requiresCropConfirmation
                                            ? rep.cropConfirmed
                                              ? '✓ Confirmed Illustrative Display Only'
                                              : '⚠️ Shared Flyer Graphic (Unconfirmed)'
                                            : '✓ Product Crop'
                                          : '✕ Dual-Price Card Blocked'}
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    <button
                                      type="button"
                                      onClick={() => handleReplaceImageInRepairModal(rep.batchOfferKey)}
                                      className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[10px] border border-slate-700"
                                    >
                                      {rep.requiresReplacementImage ? 'Upload Replacement Photo' : 'Replace Image'}
                                    </button>
                                    {rep.requiresCropConfirmation && rep.canConfirmCrop !== false && !rep.cropConfirmed && rep.localSourceCropPath && (
                                      <button
                                        type="button"
                                        onClick={() => handleConfirmDerivedCropInModal(rep.batchOfferKey)}
                                        className="px-1.5 py-0.5 bg-amber-700/80 hover:bg-amber-600 text-white rounded text-[10px]"
                                      >
                                        Confirm Illustrative Display Only
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>

                            <td className="py-2.5 px-3 max-w-[260px] space-y-1">
                              <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border ${badgeCls}`}>
                                {badgeLabel}
                              </span>
                              <div className="text-[10px] text-slate-300">{rep.reason}</div>
                              {rep.plannedDbChanges && rep.plannedDbChanges.length > 0 && (
                                <ul className="list-disc pl-3.5 text-[9px] text-slate-400 space-y-0.5">
                                  {rep.plannedDbChanges.map((ch, idx) => (
                                    <li key={idx}>{ch}</li>
                                  ))}
                                </ul>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {repairExecutionResult && (
                  <div className={`p-3 rounded-lg border text-xs ${
                    repairExecutionResult.success
                      ? 'bg-emerald-950/80 border-emerald-700 text-emerald-200'
                      : 'bg-rose-950/80 border-rose-700 text-rose-200'
                  }`}>
                    <div className="font-bold text-sm mb-1">
                      {repairExecutionResult.success ? '✓ Controlled Repair Completed' : '⚠ Repair Completed With Issues'}
                    </div>
                    <div>
                      Identity Corrected: {repairExecutionResult.identityCorrectedCount} | Images Repaired: {repairExecutionResult.repairedCount} | Skipped: {repairExecutionResult.skippedCount} | Failed: {repairExecutionResult.failedCount}
                    </div>
                    {repairExecutionResult.maintenanceOperationId && (
                      <div className="text-[10px] font-mono text-emerald-300 mt-1">
                        Journal Operation ID: {repairExecutionResult.maintenanceOperationId}
                      </div>
                    )}
                  </div>
                )}

                <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800 space-y-2.5">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={operatorAuthorizedIdentityCorrection}
                      onChange={(e) => setOperatorAuthorizedIdentityCorrection(e.target.checked)}
                      disabled={repairingImages}
                      className="mt-0.5 rounded border-slate-700 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-xs text-slate-300">
                      <strong className="text-indigo-300">Authorization 1 — Catalog Identity &amp; Assortment Corrections:</strong> Explicitly authorize converting the 3 Page 1 multi-variant promotions to Assorted/Non-Catalog (<code>product_id = NULL</code>, preserving existing catalog SKUs) and relinking the 4 Page 18 10kg rice tiers to distinct 10kg catalog products.
                    </span>
                  </label>

                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={operatorAuthorizedRepair}
                      onChange={(e) => setOperatorAuthorizedRepair(e.target.checked)}
                      disabled={repairingImages}
                      className="mt-0.5 rounded border-slate-700 text-amber-600 focus:ring-amber-500"
                    />
                    <span className="text-xs text-slate-300">
                      <strong className="text-amber-300">Authorization 2 — Consumer Image Uploads &amp; In-Place Updates:</strong> Explicitly authorize uploading or associating only verified consumer product/display images (never dual-price cards or 5kg-labeled bags for 10kg SKUs; catalog images for shared 5kg products #19/#20/#21/#36 remain held unless Authorization 1 separates the 10kg tiers first in the same transaction) and updating existing offers without creating duplicate offers or touching the{' '}
                      {Math.max(0, repairPreviewData.totalPublishedOffers - repairPreviewData.missingImageOffersCount)} consumer-visible offers.
                    </span>
                  </label>
                </div>

                <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setShowImageRepairModal(false)}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs font-medium"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    disabled={(!operatorAuthorizedRepair && !operatorAuthorizedIdentityCorrection) || repairingImages}
                    onClick={handleExecuteRepairImages}
                    className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded text-xs font-bold shadow flex items-center gap-1.5"
                  >
                    {repairingImages ? 'Executing Controlled Repair...' : 'Execute Authorized Repair'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
