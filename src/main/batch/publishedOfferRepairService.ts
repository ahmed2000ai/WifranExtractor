import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { DatabaseContext } from '../db/databaseEnvironmentResolver';
import type { SqlQueryable } from '../db/schemaCompatibilityService';
import type { StorageLifecycleAdapter } from '../storage/stagedStorageLifecycleService';
import {
  arePackConfigsStrictlyCompatible,
  validateImageSafetyWithPackageSafeguards
} from '../../shared/utils/sizeCompatibility';
import { normalizeAssortedTitle } from '../../shared/utils/offerRevalidation';
import { recordJournalMutation } from '../db/publicationJournalAndUndoService';
import type {
  BatchManifest,
  PublishedOfferImageRepairItem,
  PublishedOfferImageRepairResult,
  PublishedOfferRepairEligibility
} from '../../shared/types/batchExtraction';

interface DraftItemRef {
  leafletId: string;
  workspacePath: string;
  draftPath: string;
  item: any;
  draft: any;
}

interface DbLiveOfferState {
  offer_id: string;
  product_id: string | null;
  title_en: string | null;
  title_ar: string | null;
  assortment_status: string | null;
  catalog_match_status: string | null;
  exact_identity_status: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  image_subject_scope?: string | null;
  each_size_value: number | null;
  each_size_unit: string | null;
  inner_pack_count: number | null;
  p_id: string | null;
  p_name_en: string | null;
  p_name_ar: string | null;
  p_brand_name: string | null;
  p_each_size_value: number | null;
  p_each_size_unit: string | null;
  p_inner_pack_count: number | null;
  p_sale_unit_type: string | null;
  p_variant_or_flavor: string | null;
  p_verification_status?: string | null;
  p_is_active?: boolean | null;
  pi_public_url: string | null;
  odi_public_url: string | null;
  vco_image_url?: string | null;
}

interface DbProductSiblingOfferRow {
  offer_id: string;
  source_offer_id: string | null;
  source_item_number: string | null;
  product_id: string;
  title_en: string | null;
  status: string | null;
  assortment_status: string | null;
  each_size_value: number | null;
  each_size_unit: string | null;
  inner_pack_count: number | null;
  p_each_size_value: number | null;
  p_each_size_unit: string | null;
  p_inner_pack_count: number | null;
}

function isDbOfferIncompatibleWithProduct(row: {
  assortment_status?: string | null;
  each_size_value?: number | null;
  each_size_unit?: string | null;
  inner_pack_count?: number | null;
  p_each_size_value?: number | null;
  p_each_size_unit?: string | null;
  p_inner_pack_count?: number | null;
}): boolean {
  const rawAssortment = String(row.assortment_status || '').toLowerCase();
  if (
    rawAssortment === 'multiple_variants' ||
    rawAssortment === 'explicit_assortment' ||
    rawAssortment === 'unsplit_assortment'
  ) {
    return true;
  }
  if (row.p_each_size_value != null && row.each_size_value != null) {
    const compat = arePackConfigsStrictlyCompatible({
      sizeValue1: row.each_size_value,
      sizeUnit1: row.each_size_unit ?? null,
      packCount1: row.inner_pack_count ?? 1,
      sizeValue2: row.p_each_size_value,
      sizeUnit2: row.p_each_size_unit ?? null,
      packCount2: row.p_inner_pack_count ?? 1
    });
    if (!compat.isCompatible) return true;
  }
  return false;
}

interface AssortmentInspection {
  isAssortment: boolean;
  proposedTitleEn: string | null;
  proposedTitleAr: string | null;
  knownOptions: Array<Record<string, any>>;
}

function normalizeVariantStr(v?: string | null): string {
  return (v || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .trim();
}

function formatPackSizeLabel(
  eachSizeValue: number | null | undefined,
  eachSizeUnit: string | null | undefined,
  innerPackCount: number | null | undefined,
  subItems?: any[]
): string {
  if (Array.isArray(subItems) && subItems.length > 1) {
    const parts = subItems
      .map((s) => {
        const val = s.each_size_value;
        const unit = s.each_size_unit;
        const pack = s.manufacturer_pack_count && s.manufacturer_pack_count > 1 ? s.manufacturer_pack_count : null;
        if (val != null && unit) {
          return pack ? `${pack}×${val}${unit}` : `${val}${unit}`;
        }
        return s.variant_or_flavor || '';
      })
      .filter(Boolean);
    const unique = Array.from(new Set(parts));
    if (unique.length > 0) return unique.join(' / ');
  }
  if (eachSizeValue != null && eachSizeUnit) {
    const pack = innerPackCount && innerPackCount > 1 ? `${innerPackCount}×` : '';
    return `${pack}${eachSizeValue} ${eachSizeUnit}`;
  }
  return '—';
}

function inspectAssortmentSource(item: any): AssortmentInspection {
  const v3Card = item?.canonical?.reconciled_v3;
  const subItems: any[] = Array.isArray(v3Card?.sub_items) ? v3Card.sub_items : [];
  const rawAssortment = String(item?.assortment_status || v3Card?.assortment?.status || '').toLowerCase();
  const v3Retention = String(item?.v3RetentionMode || '');

  const isAssortment =
    subItems.length > 1 ||
    rawAssortment === 'explicit_assortment' ||
    rawAssortment === 'unsplit_assortment' ||
    rawAssortment === 'multiple_variants' ||
    rawAssortment === 'visual_multiple_variants' ||
    rawAssortment === 'assorted' ||
    v3Retention === 'decomposed_shared_promo_parent' ||
    v3Retention === 'unsplit_assortment' ||
    item?.imageSubjectScope === 'representative_assortment';

  if (!isAssortment) {
    return {
      isAssortment: false,
      proposedTitleEn: null,
      proposedTitleAr: null,
      knownOptions: []
    };
  }

  const knownOptions = subItems.map((s: any) => ({
    sub_item_ref: s.sub_item_ref ?? null,
    brand_en: s.brand_en ?? item.brandEn ?? item.brand ?? null,
    brand_ar: s.brand_ar ?? item.brandAr ?? null,
    product_name_en: s.product_name_en ?? item.titleEn ?? null,
    product_name_ar: s.product_name_ar ?? item.titleAr ?? null,
    variant_or_flavor: s.variant_or_flavor ?? null,
    each_size_value: s.each_size_value ?? null,
    each_size_unit: s.each_size_unit ?? null,
    manufacturer_pack_count: s.manufacturer_pack_count ?? 1
  }));

  const distinctSizes = new Set(
    subItems
      .filter((s) => s.each_size_value != null && s.each_size_unit)
      .map((s) => `${s.manufacturer_pack_count || 1}x${s.each_size_value}${s.each_size_unit}`)
  );
  const distinctVariants = subItems
    .map((s) => String(s.variant_or_flavor || '').trim())
    .filter(Boolean);

  let baseEn = String(item.titleEn || '').trim();
  let baseAr = String(item.titleAr || '').trim();

  if (subItems.length > 1) {
    const choiceText =
      distinctSizes.size > 1
        ? Array.from(distinctSizes)
            .map((sz) => sz.replace(/^1x/, '').replace('x', '×'))
            .join(' / ')
        : distinctVariants.length > 1
          ? `${distinctVariants.join(' / ')}${item.each_size_value && item.each_size_unit ? ` ${item.each_size_value}${item.each_size_unit}` : ''}`
          : '';

    const brandEn = String(item.brandEn || item.brand || subItems[0]?.brand_en || '').trim();
    const brandAr = String(item.brandAr || subItems[0]?.brand_ar || '').trim();

    if (brandEn && baseEn && !baseEn.toLowerCase().includes(brandEn.toLowerCase())) {
      baseEn = `${brandEn} ${baseEn}`;
    }
    if (brandAr && baseAr && !baseAr.includes(brandAr)) {
      baseAr = `${brandAr} ${baseAr}`;
    }

    if (choiceText) {
      // Remove trailing variant word from s01 if listing all choices cleanly
      if (distinctSizes.size <= 1 && distinctVariants.length > 1) {
        const firstVar = distinctVariants[0];
        if (firstVar) {
          const escaped = firstVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          baseEn = baseEn.replace(new RegExp(`\\s*\\b${escaped}\\b`, 'i'), '').trim();
        }
      }
      if (!baseEn.includes(choiceText)) {
        baseEn = `${baseEn} (${choiceText})`;
      }
      if (!baseAr.includes(choiceText) && distinctSizes.size > 1) {
        baseAr = `${baseAr} (${choiceText})`;
      }
    }
  }

  return {
    isAssortment: true,
    proposedTitleEn: normalizeAssortedTitle(baseEn, 'en'),
    proposedTitleAr: normalizeAssortedTitle(baseAr, 'ar'),
    knownOptions
  };
}

async function findMatchingCatalogProduct(
  pgClient: SqlQueryable,
  params: {
    nameEn?: string | null;
    nameAr?: string | null;
    brandName?: string | null;
    eachSizeValue: number | null;
    eachSizeUnit: string | null;
    innerPackCount: number;
    saleUnitType: string;
    variantOrFlavor?: string | null;
  }
): Promise<Record<string, any> | null> {
  const candidatesRes = await pgClient.query(
    `SELECT * FROM public.products
     WHERE (name_en = $1 OR name_ar = $2)
       AND LOWER(btrim(COALESCE(brand_name, ''))) = LOWER(btrim(COALESCE($3, '')))
       AND COALESCE(is_active, true) = true
       AND COALESCE(verification_status, 'verified') <> 'rejected'
     LIMIT 25`,
    [params.nameEn || '', params.nameAr || '', params.brandName || '']
  );

  const targetSaleUnit = (params.saleUnitType || 'piece').toLowerCase().trim();
  const targetVariantNorm = normalizeVariantStr(params.variantOrFlavor);

  for (const row of candidatesRes.rows) {
    const packCompat = arePackConfigsStrictlyCompatible({
      sizeValue1: params.eachSizeValue,
      sizeUnit1: params.eachSizeUnit,
      packCount1: params.innerPackCount || 1,
      sizeValue2: row.each_size_value != null ? Number(row.each_size_value) : null,
      sizeUnit2: row.each_size_unit ?? null,
      packCount2: row.inner_pack_count != null ? Number(row.inner_pack_count) : 1
    });
    if (!packCompat.isCompatible) continue;
    const rowSaleUnit = (row.sale_unit_type || 'piece').toLowerCase().trim();
    if (rowSaleUnit !== targetSaleUnit) continue;
    if (normalizeVariantStr(row.variant_or_flavor) !== targetVariantNorm) continue;
    return row;
  }
  return null;
}

function isVisibleLabelConflictingWithOfferSize(
  visibleLabel: string | null | undefined,
  offerSizeVal: number | null | undefined,
  offerSizeUnit: string | null | undefined,
  offerPackCount: number | null | undefined
): boolean {
  if (!visibleLabel || offerSizeVal == null || !offerSizeUnit) return false;
  const decision = validateImageSafetyWithPackageSafeguards({
    printedLabel: visibleLabel,
    advertisedSizeValue: Number(offerSizeVal),
    advertisedSizeUnit: offerSizeUnit,
    advertisedPackCount: offerPackCount || 1
  });
  return decision.hasConflict;
}

interface PublicConsumerUrlValidation {
  valid: boolean;
  isPrivateEvidence: boolean;
  publicUrl: string | null;
  bucket: 'offer-display-images' | 'product-images' | null;
  objectPath: string | null;
  sha256Hint: string | null;
  reason?: string;
}

function validatePublicConsumerAssetUrl(rawUrl?: string | null): PublicConsumerUrlValidation {
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return {
      valid: false,
      isPrivateEvidence: false,
      publicUrl: null,
      bucket: null,
      objectPath: null,
      sha256Hint: null,
      reason: 'Empty image URL'
    };
  }
  const trimmed = rawUrl.trim();
  if (/^file:\/\//i.test(trimmed) || /^[a-z]:\\/i.test(trimmed) || trimmed.startsWith('/')) {
    return {
      valid: false,
      isPrivateEvidence: true,
      publicUrl: trimmed,
      bucket: null,
      objectPath: null,
      sha256Hint: null,
      reason: 'Local filesystem path is not a public consumer URL.'
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      isPrivateEvidence: false,
      publicUrl: trimmed,
      bucket: null,
      objectPath: null,
      sha256Hint: null,
      reason: 'Malformed image URL.'
    };
  }
  const lowerPath = parsed.pathname.toLowerCase();
  if (
    lowerPath.includes('/offer-images/') ||
    lowerPath.includes('/object/sign/') ||
    lowerPath.includes('/object/authenticated/')
  ) {
    return {
      valid: false,
      isPrivateEvidence: true,
      publicUrl: trimmed,
      bucket: null,
      objectPath: null,
      sha256Hint: null,
      reason: 'Private offer-images evidence URL or signed URL is forbidden as a consumer-facing image.'
    };
  }

  const supaMatch = parsed.pathname.match(/\/storage\/v1\/object\/public\/(offer-display-images|product-images)\/(.+)$/);
  const mockMatch = !supaMatch
    ? parsed.pathname.match(/^\/(offer-display-images|product-images)\/(.+)$/)
    : null;
  const m = supaMatch || mockMatch;
  if (!m) {
    return {
      valid: false,
      isPrivateEvidence: false,
      publicUrl: trimmed,
      bucket: null,
      objectPath: null,
      sha256Hint: null,
      reason: 'URL does not resolve to an approved public consumer bucket (offer-display-images or product-images).'
    };
  }

  const bucket = m[1] as 'offer-display-images' | 'product-images';
  const objectPath = decodeURIComponent(m[2]);
  const shaMatch = objectPath.match(/sha256\/[0-9a-f]{2}\/([0-9a-f]{64})\./i);
  return {
    valid: true,
    isPrivateEvidence: false,
    publicUrl: trimmed,
    bucket,
    objectPath,
    sha256Hint: shaMatch ? shaMatch[1].toLowerCase() : null
  };
}

function sha256FileHex(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toLowerCase();
  } catch {
    return null;
  }
}

function readDerivedTierCropMeta(cropPath: string): {
  sizeConfirmationStatus?: string;
  operatorConfirmed?: boolean;
  visiblePackageWeightLabel?: string | null;
  visiblePackageSizeConflict?: boolean;
  allowOperatorConfirmation?: boolean;
  requiresReplacementImage?: boolean;
  confirmationBlockedReason?: string | null;
  metaPath: string;
} | null {
  const metaPath = path.join(path.dirname(cropPath), 'derived_tier_crop_meta.json');
  if (!fs.existsSync(metaPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    return {
      sizeConfirmationStatus: parsed.sizeConfirmationStatus,
      operatorConfirmed: Boolean(parsed.operatorConfirmed),
      visiblePackageWeightLabel: parsed.visiblePackageWeightLabel ?? null,
      visiblePackageSizeConflict: Boolean(parsed.visiblePackageSizeConflict),
      allowOperatorConfirmation:
        parsed.allowOperatorConfirmation !== undefined ? Boolean(parsed.allowOperatorConfirmation) : true,
      requiresReplacementImage: Boolean(parsed.requiresReplacementImage),
      confirmationBlockedReason: parsed.confirmationBlockedReason ?? null,
      metaPath
    };
  } catch {
    return null;
  }
}

export function confirmDerivedTierCropOnDisk(input: {
  batchDir: string;
  batchId: string;
  batchOfferKey: string;
  manifest: BatchManifest;
}): { confirmed: boolean; metaPath: string | null } {
  const parts = input.batchOfferKey.split(':');
  const leafletId = parts[1];
  const sourceOfferId = parts.slice(3).join(':');
  const leaflet = input.manifest.leaflets.find((l) => l.leafletId === leafletId);
  if (!leaflet) throw new Error(`Leaflet ${leafletId} not found in batch ${input.batchId}`);

  const draftPath = path.join(leaflet.workspacePath, 'staged-draft.json');
  const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
  const item = draft.items?.find((it: any) => (it.sourceOfferId || it.id) === sourceOfferId);
  if (!item) throw new Error(`Offer ${sourceOfferId} not found in draft`);

  const thumbPath = path.join(
    leaflet.workspacePath,
    'crops',
    `page_${item.pageNumber || 1}`,
    sourceOfferId,
    'product_thumb_crop.webp'
  );
  const metaPath = path.join(path.dirname(thumbPath), 'derived_tier_crop_meta.json');
  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const labelConflict = isVisibleLabelConflictingWithOfferSize(
      meta.visiblePackageWeightLabel,
      item.each_size_value,
      item.each_size_unit,
      item.inner_pack_count
    );
    if (
      meta.visiblePackageSizeConflict === true ||
      meta.allowOperatorConfirmation === false ||
      meta.requiresReplacementImage === true ||
      labelConflict
    ) {
      throw new Error(
        meta.confirmationBlockedReason ||
          `INCONSISTENT_PACKAGE_SIZE_CONFIRMATION_BLOCKED: Cannot confirm a ${meta.visiblePackageWeightLabel || 'conflicting'}-labeled package crop as an exact ${item.each_size_value || ''}${item.each_size_unit || ''} product image for ${sourceOfferId}. Supply a suitable replacement image instead.`
      );
    }
    meta.operatorConfirmed = true;
    meta.operatorConfirmedAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
    return { confirmed: true, metaPath };
  }

  return { confirmed: fs.existsSync(thumbPath), metaPath: null };
}

export async function executeOrPreviewPublishedOfferRepairs(input: {
  batchesDir: string;
  manifest: BatchManifest;
  batchId: string;
  operatorAuthorizedRepair?: boolean;
  operatorAuthorizedIdentityCorrection?: boolean;
  confirmedCropOfferKeys?: string[];
  targetBatchOfferKeys?: string[];
  previewOnly?: boolean;
  operatorId?: string;
  databaseContext?: DatabaseContext;
  pgClient?: SqlQueryable;
  storageAdapter?: StorageLifecycleAdapter;
}): Promise<PublishedOfferImageRepairResult> {
  const isPreview = Boolean(input.previewOnly);
  const authImages = Boolean(input.operatorAuthorizedRepair);
  const authIdentity = Boolean(input.operatorAuthorizedIdentityCorrection);
  const targetBatchKeySet =
    Array.isArray(input.targetBatchOfferKeys) && input.targetBatchOfferKeys.length > 0
      ? new Set(input.targetBatchOfferKeys)
      : null;

  if (!isPreview && !authImages && !authIdentity) {
    throw new Error(
      'OPERATOR_AUTHORIZATION_REQUIRED: Published repair requires explicit operator authorization.'
    );
  }

  const publishedDraftItems: DraftItemRef[] = [];
  const modifiedDrafts = new Map<string, { path: string; draft: any }>();

  for (const leaflet of input.manifest.leaflets) {
    const draftPath = path.join(leaflet.workspacePath, 'staged-draft.json');
    if (!fs.existsSync(draftPath)) continue;
    const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
    if (!Array.isArray(draft.items)) continue;

    for (const item of draft.items) {
      if (item.publicationState?.state === 'published') {
        publishedDraftItems.push({
          leafletId: leaflet.leafletId,
          workspacePath: leaflet.workspacePath,
          draftPath,
          item,
          draft
        });
      }
    }
  }

  const totalPublishedOffers = publishedDraftItems.length;
  const dbContext = input.databaseContext || 'PRODUCTION_UI';
  const confirmedCropSet = new Set(input.confirmedCropOfferKeys || []);

  // Connect pgClient if provided, OR during live preview (read-only) / live execution
  let pgClient: SqlQueryable | null = input.pgClient || null;
  let ownedClient = false;
  let adapter: StorageLifecycleAdapter | null = input.storageAdapter || null;

  const isOfflineEnv =
    process.env.WIFRAN_OFFLINE_UAT === '1' ||
    process.env.VITEST === 'true';

  if (!pgClient && (!isOfflineEnv || !isPreview)) {
    try {
      const { createGuardedPgClient } = await import('../db/databaseEnvironmentResolver');
      const guarded = createGuardedPgClient(dbContext);
      await guarded.connect();
      pgClient = guarded;
      ownedClient = true;
    } catch {
      if (!isPreview) {
        throw new Error(`Unable to connect to ${dbContext} database for controlled repair.`);
      }
    }
  }

  if (!isPreview && authImages && !adapter) {
    const { createGuardedStorageAdapter } = await import('../storage/stagedStorageLifecycleService');
    adapter = createGuardedStorageAdapter(dbContext);
  }

  const liveOfferMap = new Map<string, DbLiveOfferState>();
  const productOfferCountInDb = new Map<string, number>();
  const dbOffersByProductId = new Map<string, DbProductSiblingOfferRow[]>();

  try {
    if (pgClient) {
      if (isPreview && ownedClient) {
        await pgClient.query('BEGIN READ ONLY');
      }

      const offerIds = publishedDraftItems
        .map((r) => r.item.publicationState?.offerId)
        .filter((id): id is string => Boolean(id));

      if (offerIds.length > 0) {
        const dbRes = await pgClient.query<DbLiveOfferState>(
          `SELECT
             o.id::text AS offer_id,
             o.product_id::text AS product_id,
             o.title_en,
             o.title_ar,
             o.assortment_status,
             o.catalog_match_status,
             o.exact_identity_status,
             o.image_url,
             o.thumbnail_url,
             o.image_subject_scope,
             o.each_size_value::float8 AS each_size_value,
             o.each_size_unit,
             o.inner_pack_count,
             p.id::text AS p_id,
             p.name_en AS p_name_en,
             p.name_ar AS p_name_ar,
             p.brand_name AS p_brand_name,
             p.each_size_value::float8 AS p_each_size_value,
             p.each_size_unit AS p_each_size_unit,
             p.inner_pack_count AS p_inner_pack_count,
             p.sale_unit_type AS p_sale_unit_type,
             p.variant_or_flavor AS p_variant_or_flavor,
             p.verification_status AS p_verification_status,
             p.is_active AS p_is_active,
             pi.public_url AS pi_public_url,
             odi.public_url AS odi_public_url,
             vco.image_url AS vco_image_url
           FROM public.offers o
           LEFT JOIN public.products p ON p.id = o.product_id
           LEFT JOIN public.product_images pi ON pi.product_id = p.id AND pi.role = 'primary' AND pi.approval_status = 'approved'
           LEFT JOIN public.offer_display_images odi ON odi.offer_id = o.id AND odi.approval_status = 'approved'
           LEFT JOIN public.v_consumer_offers vco ON vco.id = o.id
           WHERE o.id = ANY($1::uuid[])`,
          [offerIds]
        );
        for (const row of dbRes.rows) {
          liveOfferMap.set(String(row.offer_id), row);
          if (row.product_id) {
            productOfferCountInDb.set(
              String(row.product_id),
              (productOfferCountInDb.get(String(row.product_id)) || 0) + 1
            );
          }
        }
      }

      // Inspect ALL offers in public.offers referencing any product_id touched by this batch
      // so cross-batch or un-repaired size/assortment mismatches can never be overwritten with a shared product_images row.
      const distinctProductIds = Array.from(
        new Set(
          [
            ...Array.from(liveOfferMap.values()).map((r) => r.product_id),
            ...publishedDraftItems.map((r) =>
              r.item.publicationState?.productId ? String(r.item.publicationState.productId) : null
            )
          ]
            .filter((v): v is string => Boolean(v && /^\d+$/.test(String(v))))
            .map((v) => Number(v))
        )
      );
      if (distinctProductIds.length > 0) {
        const sibRes = await pgClient.query<DbProductSiblingOfferRow>(
          `SELECT
             o.id::text AS offer_id,
             o.source_offer_id,
             o.source_item_number,
             o.product_id::text AS product_id,
             o.title_en,
             o.status,
             o.assortment_status,
             o.each_size_value::float8 AS each_size_value,
             o.each_size_unit,
             o.inner_pack_count,
             p.each_size_value::float8 AS p_each_size_value,
             p.each_size_unit AS p_each_size_unit,
             p.inner_pack_count AS p_inner_pack_count
           FROM public.offers o
           JOIN public.products p ON p.id = o.product_id
           WHERE o.product_id = ANY($1::bigint[])`,
          [distinctProductIds]
        );
        for (const row of sibRes.rows) {
          const pKey = String(row.product_id);
          const list = dbOffersByProductId.get(pKey) || [];
          list.push(row);
          dbOffersByProductId.set(pKey, list);
          productOfferCountInDb.set(pKey, list.length);
        }
      }

      if (isPreview && ownedClient) {
        await pgClient.query('ROLLBACK');
      }
    }

    // Fallback draft product sharing map when offline without DB
    const draftProductUsage = new Map<string, DraftItemRef[]>();
    for (const ref of publishedDraftItems) {
      const live = liveOfferMap.get(String(ref.item.publicationState?.offerId));
      const pId = live?.product_id ?? ref.item.publicationState?.productId ?? null;
      if (pId) {
        const list = draftProductUsage.get(String(pId)) || [];
        list.push(ref);
        draftProductUsage.set(String(pId), list);
      }
    }

    // Track which productIds will remain shared AFTER identity corrections
    const postIdentityProductUsage = new Map<string, number>();
    interface AnalyzedOffer {
      ref: DraftItemRef;
      batchOfferKey: string;
      sourceOfferId: string;
      offerId: string;
      liveRow: DbLiveOfferState | null;
      currentProductId: string | null;
      currentProductLabel: string;
      assortInfo: AssortmentInspection;
      identityIssueKind: 'none' | 'wrong_pack_size_tier' | 'assortment_linked_to_single_sku';
      proposedIdentityAction: 'keep' | 'relink_or_create_10kg' | 'convert_to_assorted_non_catalog';
      proposedProductLabel: string | null;
      relinkTargetProductId: string | null;
      localSourceCropPath: string | null;
      cropType: 'product_thumb' | 'custom_thumb' | 'offer_card_unsuitable' | 'none';
      requiresCropConfirmation: boolean;
      canConfirmCrop: boolean;
      requiresReplacementImage: boolean;
      visiblePackageWeightLabel: string | null;
      cropConfirmed: boolean;
      cropConfidenceNote: string | null;
      hasUsableCrop: boolean;
      hasPopulatedOfferThumbnailWithoutConsumerRow: boolean;
      existingConsumerViewUrl: string | null;
      existingAssetIssueNote: string | null;
      existingPublicAsset: PublicConsumerUrlValidation | null;
      repairActionKind:
        | 'upload_and_link_crop'
        | 'associate_existing_public_asset_to_odi'
        | 'identity_and_crop_repair'
        | 'identity_only_hold_crop'
        | 'blocked_private_or_unsuitable_asset';
      isSharedProduct: boolean;
      dependsOnSiblingIdentityCorrection: boolean;
      blockingSiblingSourceOfferIds: string[];
      blockingSiblingBatchKeys: string[];
      hasUnresolvableExternalConflict: boolean;
      repairExecutionPhase: 1 | 2 | null;
      offerSizeConfig: { value: number | null; unit: string | null; packCount: number };
      targetBucket: 'product-images' | 'offer-display-images';
      repairEligibility: PublishedOfferRepairEligibility;
      plannedDbChanges: string[];
      reason: string;
      packSizeLabel: string;
      brandName: string | null;
    }

    const analyzedMissingOffers: AnalyzedOffer[] = [];
    let missingImageOffersCount = 0;
    let missingOdiAssociationCount = 0;

    for (const ref of publishedDraftItems) {
      const { item, leafletId, workspacePath } = ref;
      const sourceOfferId = item.sourceOfferId || item.id;
      const batchOfferKey = `${input.batchId}:${leafletId}:${item.pageNumber || 1}:${sourceOfferId}`;
      const offerId = String(item.publicationState?.offerId || '');
      const liveRow = liveOfferMap.get(offerId) ?? null;

      // Ground-truth check: evaluate ACTUAL consumer-view visibility (v_consumer_offers / approved pi or odi),
      // NEVER treating raw offers.thumbnail_url IS NOT NULL alone as consumer-accessible!
      const isLiveCatalogEligible = Boolean(
        liveRow &&
          liveRow.product_id != null &&
          liveRow.p_id != null &&
          liveRow.p_is_active !== false &&
          ((liveRow.catalog_match_status === 'verified_linked' &&
            (liveRow.p_verification_status || 'verified') !== 'rejected') ||
            (liveRow.catalog_match_status === 'candidate_pending_review' &&
              (liveRow.p_verification_status === 'verified' || liveRow.p_verification_status === 'candidate')))
      );
      const hasConsumerVisibleImage = liveRow
        ? Boolean(liveRow.vco_image_url || liveRow.odi_public_url || (liveRow.pi_public_url && isLiveCatalogEligible))
        : Boolean(
            item.publicationState?.consumerViewImageUrl ||
              (item.publicationState?.imageUrl && item.publicationState?.productId != null)
          );

      if (hasConsumerVisibleImage) {
        continue;
      }

      missingImageOffersCount++;
      const populatedLiveThumb = liveRow ? (liveRow.thumbnail_url || liveRow.image_url || null) : (item.publicationState?.imageUrl ?? null);
      const hasPopulatedOfferThumbnailWithoutConsumerRow = Boolean(populatedLiveThumb);
      if (hasPopulatedOfferThumbnailWithoutConsumerRow) {
        missingOdiAssociationCount++;
      }

      const currentProductId = liveRow ? liveRow.product_id : (item.publicationState?.productId ? String(item.publicationState.productId) : null);
      const currentProdName = liveRow?.p_name_en || item.titleEn || '';
      const currentProdBrand = liveRow?.p_brand_name || item.brandEn || item.brand || '';
      const currentProdSize =
        liveRow?.p_each_size_value != null && liveRow?.p_each_size_unit
          ? `${liveRow.p_each_size_value} ${liveRow.p_each_size_unit}`
          : '';
      const currentProductLabel = currentProductId
        ? `#${currentProductId} ${currentProdBrand ? `${currentProdBrand} ` : ''}${currentProdName}${currentProdSize ? ` (${currentProdSize})` : ''}`
        : 'Unlinked (NULL)';

      // 1. Check Assortment Linked to Single SKU
      const assortInfo = inspectAssortmentSource(item);
      const isAlreadyAssortedInDb =
        liveRow != null &&
        liveRow.product_id == null &&
        liveRow.assortment_status === 'multiple_variants';

      // 2. Check Pack Size Tier Mismatch
      let isWrongPackSizeTier = false;
      if (!assortInfo.isAssortment && currentProductId) {
        if (liveRow && liveRow.p_each_size_value != null) {
          const compat = arePackConfigsStrictlyCompatible({
            sizeValue1: liveRow.each_size_value ?? item.each_size_value,
            sizeUnit1: liveRow.each_size_unit ?? item.each_size_unit,
            packCount1: liveRow.inner_pack_count ?? item.inner_pack_count ?? 1,
            sizeValue2: liveRow.p_each_size_value,
            sizeUnit2: liveRow.p_each_size_unit,
            packCount2: liveRow.p_inner_pack_count ?? 1
          });
          if (!compat.isCompatible) {
            isWrongPackSizeTier = true;
          }
        } else {
          // Offline fallback: check sibling sharing same productId with smaller/different pack size
          const siblings = draftProductUsage.get(currentProductId) || [];
          const hasDifferentSizeSibling = siblings.some((s) => {
            if (s === ref) return false;
            const c = arePackConfigsStrictlyCompatible({
              sizeValue1: item.each_size_value,
              sizeUnit1: item.each_size_unit,
              packCount1: item.inner_pack_count || 1,
              sizeValue2: s.item.each_size_value,
              sizeUnit2: s.item.each_size_unit,
              packCount2: s.item.inner_pack_count || 1
            });
            return !c.isCompatible;
          });
          if (hasDifferentSizeSibling && (/__tier_([2-9]|\d{2,})$/.test(sourceOfferId) || Number(item.each_size_value || 0) >= 10)) {
            isWrongPackSizeTier = true;
          }
        }
      }

      let identityIssueKind: AnalyzedOffer['identityIssueKind'] = 'none';
      let proposedIdentityAction: AnalyzedOffer['proposedIdentityAction'] = 'keep';
      let proposedProductLabel: string | null = null;
      let relinkTargetProductId: string | null = null;
      const brandName = (liveRow?.p_brand_name || item.brandEn || item.brand || null) as string | null;

      if (assortInfo.isAssortment && !isAlreadyAssortedInDb && currentProductId != null) {
        identityIssueKind = 'assortment_linked_to_single_sku';
        proposedIdentityAction = 'convert_to_assorted_non_catalog';
        proposedProductLabel = 'Assorted / Non-Catalog (product_id = NULL, comparison disabled)';
      } else if (isWrongPackSizeTier) {
        identityIssueKind = 'wrong_pack_size_tier';
        proposedIdentityAction = 'relink_or_create_10kg';
        const targetSizeVal = liveRow?.each_size_value ?? item.each_size_value ?? null;
        const targetSizeUnit = liveRow?.each_size_unit ?? item.each_size_unit ?? null;
        const targetPack = liveRow?.inner_pack_count ?? item.inner_pack_count ?? 1;

        if (pgClient) {
          const existingMatch = await findMatchingCatalogProduct(pgClient, {
            nameEn: item.titleEn,
            nameAr: item.titleAr,
            brandName,
            eachSizeValue: targetSizeVal,
            eachSizeUnit: targetSizeUnit,
            innerPackCount: targetPack,
            saleUnitType: item.sale_unit_type || 'piece',
            variantOrFlavor: item.variantOrFlavor || null
          });
          if (existingMatch) {
            relinkTargetProductId = String(existingMatch.id);
            proposedProductLabel = `Reuse Product #${existingMatch.id} (${existingMatch.brand_name || ''} ${existingMatch.name_en}, ${existingMatch.each_size_value} ${existingMatch.each_size_unit})`;
          }
        }
        if (!proposedProductLabel) {
          proposedProductLabel = `Create Candidate Product: ${brandName || ''} ${item.titleEn || ''} (${targetSizeVal || '?'} ${targetSizeUnit || ''})`.trim();
        }
      }

      // Compute post-correction product sharing
      if (proposedIdentityAction === 'keep' && currentProductId) {
        postIdentityProductUsage.set(currentProductId, (postIdentityProductUsage.get(currentProductId) || 0) + 1);
      } else if (proposedIdentityAction === 'relink_or_create_10kg' && relinkTargetProductId) {
        postIdentityProductUsage.set(relinkTargetProductId, (postIdentityProductUsage.get(relinkTargetProductId) || 0) + 1);
      }

      // 3. Locate & Validate Local Crop + Existing Offer-Level Public URL (strictly reject offer_card_crop.webp & private offer-images URLs!)
      let localSourceCropPath: string | null = null;
      let cropType: AnalyzedOffer['cropType'] = 'none';
      let requiresCropConfirmation = false;
      let canConfirmCrop = true;
      let requiresReplacementImage = false;
      let visiblePackageWeightLabel: string | null = null;
      let cropConfirmed = false;
      let cropConfidenceNote: string | null = null;

      const customPath = item.customProductThumbCropPath;
      if (customPath && typeof customPath === 'string' && fs.existsSync(customPath)) {
        localSourceCropPath = customPath;
        cropType = 'custom_thumb';
      } else {
        const candidateThumbs = [
          item.consumerProductImagePath,
          item.productThumbLocalPath,
          path.join(workspacePath, 'crops', `page_${item.pageNumber || 1}`, sourceOfferId, 'product_thumb_crop.webp'),
          item.product_thumb_crop_path
        ].filter((p): p is string => Boolean(p && typeof p === 'string'));

        for (const p of candidateThumbs) {
          if (!p.toLowerCase().includes('offer_card_crop') && fs.existsSync(p)) {
            localSourceCropPath = p;
            cropType = 'product_thumb';
            break;
          }
        }
      }

      const offerSizeVal = liveRow?.each_size_value ?? item.each_size_value ?? null;
      const offerSizeUnit = liveRow?.each_size_unit ?? item.each_size_unit ?? null;
      const offerPackCount = liveRow?.inner_pack_count ?? item.inner_pack_count ?? 1;

      if (cropType === 'product_thumb' && localSourceCropPath) {
        const meta = readDerivedTierCropMeta(localSourceCropPath);
        if (meta) {
          visiblePackageWeightLabel = meta.visiblePackageWeightLabel ?? null;
          const labelConflict = isVisibleLabelConflictingWithOfferSize(
            meta.visiblePackageWeightLabel,
            offerSizeVal,
            offerSizeUnit,
            offerPackCount
          );
          const isSizeConflictBlocked = Boolean(
            meta.visiblePackageSizeConflict ||
              meta.allowOperatorConfirmation === false ||
              meta.requiresReplacementImage ||
              labelConflict
          );
          if (isSizeConflictBlocked) {
            requiresCropConfirmation = true;
            canConfirmCrop = false;
            requiresReplacementImage = true;
            cropConfirmed = false;
            cropConfidenceNote =
              meta.confirmationBlockedReason ||
              `Flyer package graphic is labeled ${meta.visiblePackageWeightLabel || 'with a different weight'}, conflicting with ${offerSizeVal ?? ''}${offerSizeUnit ?? ''} offer. A suitable replacement photo is required; confirmation is blocked.`;
          } else if (meta.sizeConfirmationStatus === 'shared_single_graphic_requires_confirmation') {
            requiresCropConfirmation = true;
            canConfirmCrop = true;
            requiresReplacementImage = false;
            cropConfirmed = Boolean(meta.operatorConfirmed || confirmedCropSet.has(batchOfferKey));
            cropConfidenceNote =
              'Derived locally from Page 18 single bag graphic (no weight printed on bag; trimmed above price box). Replace with an exact 10kg photo or confirm representative offer-display visual only.';
          }
        }
      }

      if (!localSourceCropPath) {
        const candidateCardPath =
          item.croppedEvidenceLocalPath ||
          item.offerCardCropPath ||
          path.join(workspacePath, 'crops', `page_${item.pageNumber || 1}`, sourceOfferId, 'offer_card_crop.webp');
        if (candidateCardPath && fs.existsSync(candidateCardPath)) {
          cropType = 'offer_card_unsuitable';
          cropConfidenceNote = 'Only dual-price promotional card crop exists; cannot be published directly.';
        }
      }

      const existingAssetValidation = hasPopulatedOfferThumbnailWithoutConsumerRow
        ? validatePublicConsumerAssetUrl(populatedLiveThumb)
        : null;
      let existingAssetIssueNote: string | null = null;
      let canAssociateExistingPublicAsset = false;

      if (hasPopulatedOfferThumbnailWithoutConsumerRow && existingAssetValidation) {
        if (existingAssetValidation.isPrivateEvidence) {
          existingAssetIssueNote =
            'Existing offers.thumbnail_url points to private offer-images evidence/local file and MUST NOT be exposed to consumers. Upload a clean public crop to offer-display-images.';
        } else if (!existingAssetValidation.valid) {
          existingAssetIssueNote =
            existingAssetValidation.reason ||
            'Existing offers.thumbnail_url is not a valid public consumer URL; replace with clean offer-display-images crop.';
        } else if (cropType === 'custom_thumb') {
          existingAssetIssueNote =
            'Operator supplied replacement crop; will upload cleanly to offer-display-images and replace stale offers.thumbnail_url.';
        } else {
          const localSha = localSourceCropPath ? sha256FileHex(localSourceCropPath) : null;
          if (localSha && existingAssetValidation.sha256Hint && localSha !== existingAssetValidation.sha256Hint) {
            existingAssetIssueNote =
              'offers.thumbnail_url references an older uploaded crop while offer_display_images is missing; cleaner regenerated local product_thumb_crop.webp will replace it in offer-display-images.';
          } else {
            canAssociateExistingPublicAsset = true;
            existingAssetIssueNote =
              'Valid public asset exists on offers.thumbnail_url, but public.offer_display_images row is missing (v_consumer_offers.image_url is NULL); ready to associate cleanly into offer_display_images.';
          }
        }
      }

      const hasUsableCrop =
        cropType === 'custom_thumb' ||
        canAssociateExistingPublicAsset ||
        (cropType === 'product_thumb' && (!requiresCropConfirmation || (canConfirmCrop && cropConfirmed)));

      const repairActionKind: AnalyzedOffer['repairActionKind'] =
        hasPopulatedOfferThumbnailWithoutConsumerRow && existingAssetValidation?.isPrivateEvidence && !localSourceCropPath
          ? 'blocked_private_or_unsuitable_asset'
          : canAssociateExistingPublicAsset
            ? 'associate_existing_public_asset_to_odi'
            : identityIssueKind !== 'none'
              ? hasUsableCrop
                ? 'identity_and_crop_repair'
                : 'identity_only_hold_crop'
              : hasUsableCrop
                ? 'upload_and_link_crop'
                : 'identity_only_hold_crop';

      const dbSibsForProduct = currentProductId ? dbOffersByProductId.get(currentProductId) || [] : [];
      const isSharedProductPre = Boolean(
        currentProductId &&
          ((draftProductUsage.get(currentProductId)?.length || 0) > 1 || dbSibsForProduct.length > 1)
      );

      analyzedMissingOffers.push({
        ref,
        batchOfferKey,
        sourceOfferId,
        offerId,
        liveRow,
        currentProductId,
        currentProductLabel,
        assortInfo,
        identityIssueKind,
        proposedIdentityAction,
        proposedProductLabel,
        relinkTargetProductId,
        localSourceCropPath,
        cropType,
        requiresCropConfirmation,
        canConfirmCrop,
        requiresReplacementImage,
        visiblePackageWeightLabel,
        cropConfirmed,
        cropConfidenceNote,
        hasUsableCrop,
        hasPopulatedOfferThumbnailWithoutConsumerRow,
        existingConsumerViewUrl: liveRow?.vco_image_url ?? null,
        existingAssetIssueNote,
        existingPublicAsset: existingAssetValidation,
        repairActionKind,
        isSharedProduct: isSharedProductPre,
        dependsOnSiblingIdentityCorrection: false,
        blockingSiblingSourceOfferIds: [],
        blockingSiblingBatchKeys: [],
        hasUnresolvableExternalConflict: false,
        repairExecutionPhase: null,
        offerSizeConfig: {
          value: offerSizeVal != null ? Number(offerSizeVal) : null,
          unit: offerSizeUnit ?? null,
          packCount: offerPackCount || 1
        },
        targetBucket: 'product-images', // resolved in second pass below
        repairEligibility: 'ready_for_repair', // resolved below
        plannedDbChanges: [],
        reason: '',
        packSizeLabel: formatPackSizeLabel(
          liveRow?.each_size_value ?? item.each_size_value,
          liveRow?.each_size_unit ?? item.each_size_unit,
          liveRow?.inner_pack_count ?? item.inner_pack_count,
          item?.canonical?.reconciled_v3?.sub_items
        ),
        brandName
      });
    }

    // Build lookup maps to evaluate shared-product sibling dependencies across all missing offers & live DB rows
    const analyzedByOfferId = new Map<string, AnalyzedOffer>();
    const analyzedBySourceId = new Map<string, AnalyzedOffer>();
    for (const a of analyzedMissingOffers) {
      if (a.offerId) analyzedByOfferId.set(a.offerId, a);
      analyzedBySourceId.set(a.sourceOfferId, a);
    }

    // Second pass: resolve cross-offer shared-product dependencies, targetBucket, repairEligibility, plannedDbChanges, and reason
    let readyForRepairCount = 0;
    let awaitingCropCorrectionCount = 0;
    let awaitingIdentityCorrectionCount = 0;
    let requiresOperatorAttentionCount = 0;

    for (const a of analyzedMissingOffers) {
      if (a.proposedIdentityAction === 'keep' && a.currentProductId) {
        const dbSibs = dbOffersByProductId.get(a.currentProductId) || [];
        const draftSibs = draftProductUsage.get(a.currentProductId) || [];
        const seenSibKeys = new Set<string>();

        for (const ds of dbSibs) {
          if (a.offerId && String(ds.offer_id) === String(a.offerId)) continue;
          const sibKey = `id:${ds.offer_id}`;
          if (seenSibKeys.has(sibKey)) continue;
          seenSibKeys.add(sibKey);

          const sibAnalyzed = analyzedByOfferId.get(String(ds.offer_id));
          const sizeDiffersFromOffer =
            ds.each_size_value != null && a.offerSizeConfig.value != null
              ? !arePackConfigsStrictlyCompatible({
                  sizeValue1: ds.each_size_value,
                  sizeUnit1: ds.each_size_unit ?? null,
                  packCount1: ds.inner_pack_count ?? 1,
                  sizeValue2: a.offerSizeConfig.value,
                  sizeUnit2: a.offerSizeConfig.unit,
                  packCount2: a.offerSizeConfig.packCount
                }).isCompatible
              : false;
          const incompatible =
            isDbOfferIncompatibleWithProduct(ds) ||
            sizeDiffersFromOffer ||
            Boolean(sibAnalyzed && sibAnalyzed.proposedIdentityAction !== 'keep');

          if (!incompatible) continue;

          const sibLabel = sibAnalyzed?.sourceOfferId || ds.source_offer_id || ds.title_en || ds.offer_id;
          a.blockingSiblingSourceOfferIds.push(sibLabel);
          if (sibAnalyzed && sibAnalyzed.proposedIdentityAction !== 'keep') {
            a.blockingSiblingBatchKeys.push(sibAnalyzed.batchOfferKey);
            if (targetBatchKeySet && !targetBatchKeySet.has(sibAnalyzed.batchOfferKey)) {
              a.hasUnresolvableExternalConflict = true;
            } else {
              a.dependsOnSiblingIdentityCorrection = true;
            }
          } else {
            a.hasUnresolvableExternalConflict = true;
          }
        }

        for (const refSib of draftSibs) {
          const refOfferId = String(refSib.item.publicationState?.offerId || '');
          const refSourceId = refSib.item.sourceOfferId || refSib.item.id;
          if (
            (a.offerId && refOfferId && refOfferId === a.offerId) ||
            refSourceId === a.sourceOfferId
          ) {
            continue;
          }
          const sibKey = refOfferId ? `id:${refOfferId}` : `src:${refSourceId}`;
          if (seenSibKeys.has(sibKey)) continue;
          seenSibKeys.add(sibKey);

          const sibAnalyzed =
            (refOfferId ? analyzedByOfferId.get(refOfferId) : undefined) ||
            analyzedBySourceId.get(refSourceId);
          const sizeDiffers =
            refSib.item.each_size_value != null && a.offerSizeConfig.value != null
              ? !arePackConfigsStrictlyCompatible({
                  sizeValue1: Number(refSib.item.each_size_value),
                  sizeUnit1: refSib.item.each_size_unit ?? null,
                  packCount1: refSib.item.inner_pack_count || 1,
                  sizeValue2: a.offerSizeConfig.value,
                  sizeUnit2: a.offerSizeConfig.unit,
                  packCount2: a.offerSizeConfig.packCount
                }).isCompatible
              : false;
          const incompatible =
            sizeDiffers || Boolean(sibAnalyzed && sibAnalyzed.proposedIdentityAction !== 'keep');
          if (!incompatible) continue;

          a.blockingSiblingSourceOfferIds.push(refSourceId);
          if (sibAnalyzed && sibAnalyzed.proposedIdentityAction !== 'keep') {
            a.blockingSiblingBatchKeys.push(sibAnalyzed.batchOfferKey);
            if (targetBatchKeySet && !targetBatchKeySet.has(sibAnalyzed.batchOfferKey)) {
              a.hasUnresolvableExternalConflict = true;
            } else {
              a.dependsOnSiblingIdentityCorrection = true;
            }
          } else {
            a.hasUnresolvableExternalConflict = true;
          }
        }
      }

      const needsIdentityFix = a.identityIssueKind !== 'none';
      const postShared =
        a.proposedIdentityAction === 'keep' && a.currentProductId
          ? (postIdentityProductUsage.get(a.currentProductId) || 0) > 1
          : a.proposedIdentityAction === 'relink_or_create_10kg' && a.relinkTargetProductId
            ? (postIdentityProductUsage.get(a.relinkTargetProductId) || 0) > 1
            : false;

      // Assortments, offers without product_id, and confirmed single-graphic tier-2 visuals ALWAYS route to offer-display-images.
      // Shared 5kg catalog product offers keep targetBucket = 'product-images' and fail-closed behind Phase 1 sibling separation!
      const isOfferLevelDisplay =
        a.assortInfo.isAssortment ||
        a.currentProductId == null ||
        a.proposedIdentityAction === 'convert_to_assorted_non_catalog' ||
        a.repairActionKind === 'associate_existing_public_asset_to_odi' ||
        a.requiresCropConfirmation ||
        postShared;

      a.targetBucket = isOfferLevelDisplay ? 'offer-display-images' : 'product-images';
      const isBlockedBySharedProduct =
        a.targetBucket === 'product-images' &&
        (a.dependsOnSiblingIdentityCorrection || a.hasUnresolvableExternalConflict);
      a.repairExecutionPhase = needsIdentityFix ? 1 : a.hasUsableCrop ? 2 : null;

      if (!a.hasUsableCrop && needsIdentityFix) {
        a.repairEligibility = 'requires_operator_attention';
        requiresOperatorAttentionCount++;
      } else if (!a.hasUsableCrop) {
        a.repairEligibility = 'awaiting_crop_correction';
        awaitingCropCorrectionCount++;
      } else if (a.hasUnresolvableExternalConflict && a.targetBucket === 'product-images') {
        a.repairEligibility = 'requires_operator_attention';
        requiresOperatorAttentionCount++;
      } else if (needsIdentityFix || isBlockedBySharedProduct) {
        a.repairEligibility = 'awaiting_identity_correction';
        awaitingIdentityCorrectionCount++;
      } else {
        a.repairEligibility = 'ready_for_repair';
        readyForRepairCount++;
      }

      // Build explicit planned DB changes & human-readable reason
      const changes: string[] = [];
      if (a.proposedIdentityAction === 'convert_to_assorted_non_catalog') {
        changes.push(
          `[Phase 1] UPDATE public.offers: set product_id = NULL, assortment_status = 'multiple_variants', exact_identity_status = 'unresolved', title_en/ar with Assorted/متنوع, populate known_options (${a.assortInfo.knownOptions.length} choices), suppress unit_price & enable comparison blocking`
        );
        changes.push(`Preserve catalog Product #${a.currentProductId} intact in public.products`);
      } else if (a.proposedIdentityAction === 'relink_or_create_10kg') {
        changes.push(
          a.relinkTargetProductId
            ? `[Phase 1] Relink public.offers.product_id from #${a.currentProductId} (5kg) -> #${a.relinkTargetProductId} (10kg)`
            : `[Phase 1] INSERT candidate 10kg product into public.products & relink public.offers.product_id from #${a.currentProductId} -> new 10kg product`
        );
      }

      if (isBlockedBySharedProduct) {
        changes.push(
          `[Phase 2 — Held Pending Sibling Identity Separation] Verify ZERO conflicting offers (${a.blockingSiblingSourceOfferIds.join(', ')}) remain linked to Product #${a.currentProductId} before uploading to 'product-images'.`
        );
      }

      if (a.repairActionKind === 'associate_existing_public_asset_to_odi' && a.existingPublicAsset?.valid) {
        changes.push(
          `[Phase 2] Associate verified public asset (${a.existingPublicAsset.bucket}/${a.existingPublicAsset.objectPath}) into public.offer_display_images (no duplicate upload, no offer recreation)`
        );
        changes.push(`UPDATE public.offers thumbnail_url/image_url & image_subject_scope (preserve existing source identity & products)`);
      } else if (a.hasUsableCrop) {
        if (a.targetBucket === 'offer-display-images') {
          changes.push(`[Phase 2] Upload ${path.basename(a.localSourceCropPath!)} -> bucket 'offer-display-images'`);
          changes.push(
            `UPSERT public.offer_display_images (offer_id) + UPDATE public.offers thumbnail_url/image_url${a.assortInfo.isAssortment ? " & image_subject_scope = 'representative_assortment'" : ''} (shared product_images untouched)`
          );
        } else {
          changes.push(`[Phase 2] Upload ${path.basename(a.localSourceCropPath!)} -> bucket 'product-images'`);
          changes.push(`UPSERT public.product_images (product_id) + UPDATE public.offers thumbnail_url/image_url`);
        }
      } else {
        changes.push('Hold image upload until valid product-only crop or 10kg replacement image is provided.');
      }
      a.plannedDbChanges = changes;

      if (a.repairEligibility === 'ready_for_repair') {
        a.reason =
          a.existingAssetIssueNote ||
          'Clean product-only crop and valid identity; ready for automatic repair.';
      } else if (a.repairEligibility === 'awaiting_identity_correction') {
        a.reason =
          a.identityIssueKind === 'assortment_linked_to_single_sku'
            ? `Assortment promotion linked to single SKU #${a.currentProductId}; requires authorization to convert to Assorted / Non-Catalog and route image to offer-display-images.`
            : a.identityIssueKind === 'wrong_pack_size_tier'
              ? `10kg tier linked to 5kg Product #${a.currentProductId}; requires authorization to create/relink 10kg product identity.`
              : `Held pending identity separation of conflicting sibling offer(s) (${a.blockingSiblingSourceOfferIds.join(', ')}) still linked to Product #${a.currentProductId}. Authorize identity correction so 10kg tiers separate before adding this catalog image.`;
      } else if (a.repairEligibility === 'awaiting_crop_correction') {
        a.reason =
          a.existingAssetIssueNote ||
          a.cropConfidenceNote ||
          'Valid product-only crop missing; crop correction or replacement required.';
      } else if (a.hasUnresolvableExternalConflict && a.targetBucket === 'product-images' && !needsIdentityFix) {
        a.reason = `Held fail-closed: Product #${a.currentProductId} still has conflicting un-targeted offer(s) (${a.blockingSiblingSourceOfferIds.join(', ')}) in public.offers.`;
      } else {
        a.reason = [
          a.identityIssueKind === 'wrong_pack_size_tier'
            ? `10kg tier currently linked to 5kg Product #${a.currentProductId}`
            : `Assortment currently linked to single SKU #${a.currentProductId}`,
          a.cropConfidenceNote || 'requires replacement image'
        ].join(' + ');
      }
    }

    const toRepairItem = (
      a: AnalyzedOffer,
      status: PublishedOfferImageRepairItem['status'],
      overrideReason?: string,
      uploadedUrl?: string
    ): PublishedOfferImageRepairItem => ({
      batchOfferKey: a.batchOfferKey,
      sourceOfferId: a.sourceOfferId,
      offerId: a.offerId || null,
      titleEn: a.liveRow?.title_en || a.ref.item.titleEn || a.ref.item.titleAr || 'Untitled',
      titleAr: a.liveRow?.title_ar || a.ref.item.titleAr || null,
      offerPrice: typeof a.ref.item.priceAfter === 'number' ? a.ref.item.priceAfter : null,
      currency: 'SAR',
      packSizeLabel: a.packSizeLabel,
      productId: a.currentProductId,
      currentProductLabel: a.currentProductLabel,
      identityIssueKind: a.identityIssueKind,
      proposedIdentityAction: a.proposedIdentityAction,
      proposedProductLabel: a.proposedProductLabel,
      proposedTitleEn: a.assortInfo.proposedTitleEn,
      proposedTitleAr: a.assortInfo.proposedTitleAr,
      proposedKnownOptions: a.assortInfo.knownOptions,
      relinkTargetProductId: a.relinkTargetProductId,
      isSharedProduct: a.isSharedProduct,
      dependsOnSiblingIdentityCorrection: a.dependsOnSiblingIdentityCorrection,
      blockingSiblingSourceOfferIds:
        a.blockingSiblingSourceOfferIds.length > 0 ? [...a.blockingSiblingSourceOfferIds] : undefined,
      repairExecutionPhase: a.repairExecutionPhase,
      existingImageUrl: a.liveRow?.pi_public_url || a.liveRow?.odi_public_url || a.liveRow?.thumbnail_url || a.liveRow?.image_url || a.ref.item.publicationState?.imageUrl || null,
      existingConsumerViewUrl: a.existingConsumerViewUrl,
      hasPopulatedOfferThumbnailWithoutConsumerRow: a.hasPopulatedOfferThumbnailWithoutConsumerRow,
      existingAssetIssueNote: a.existingAssetIssueNote,
      repairActionKind: a.repairActionKind,
      localSourceCropPath: a.localSourceCropPath,
      cropType: a.cropType,
      requiresCropConfirmation: a.requiresCropConfirmation,
      canConfirmCrop: a.canConfirmCrop,
      requiresReplacementImage: a.requiresReplacementImage,
      visiblePackageWeightLabel: a.visiblePackageWeightLabel,
      cropConfirmed: a.cropConfirmed,
      cropConfidenceNote: a.cropConfidenceNote,
      targetBucket: a.targetBucket,
      repairEligibility: a.repairEligibility,
      plannedDbChanges: a.plannedDbChanges,
      uploadedUrl,
      status,
      reason: overrideReason || a.reason
    });

    if (isPreview) {
      return {
        batchId: input.batchId,
        success: true,
        previewOnly: true,
        totalPublishedOffers,
        missingImageOffersCount,
        missingOdiAssociationCount,
        readyForRepairCount,
        awaitingCropCorrectionCount,
        awaitingIdentityCorrectionCount,
        requiresOperatorAttentionCount,
        identityCorrectedCount: 0,
        repairedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        repairs: analyzedMissingOffers.map((a) => toRepairItem(a, 'preview_eligible'))
      };
    }

    // LIVE EXECUTION (BEGIN ... COMMIT with full journal & compensating storage rollback)
    const { stageContentAddressedUpload } = await import('../storage/stagedStorageLifecycleService');

    let repairedCount = 0;
    let identityCorrectedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const resultItems: PublishedOfferImageRepairItem[] = [];
    const exclusiveStagedForRollback: Array<{ bucket: string; objectPath: string }> = [];
    let maintenanceOperationId: string | null = null;

    if (!pgClient) {
      throw new Error('PG_CLIENT_REQUIRED: Database connection unavailable for live repair execution.');
    }

    // Determine two-phase dependencies before executing inside single controlled transaction
    const analyzedByBatchKey = new Map(analyzedMissingOffers.map((x) => [x.batchOfferKey, x]));
    const isOfferInScope = (a: AnalyzedOffer): boolean =>
      !targetBatchKeySet || targetBatchKeySet.has(a.batchOfferKey);

    const canFixIdentityInPhase1 = (a: AnalyzedOffer): boolean =>
      isOfferInScope(a) && authIdentity && a.identityIssueKind !== 'none';

    const hasPendingSharedProductDependency = (a: AnalyzedOffer): boolean => {
      if (a.targetBucket !== 'product-images') return false;
      if (a.hasUnresolvableExternalConflict) return true;
      if (!a.dependsOnSiblingIdentityCorrection) return false;
      if (!authIdentity) return true;
      return a.blockingSiblingBatchKeys.some((sibKey) => {
        const sib = analyzedByBatchKey.get(sibKey);
        return !sib || !canFixIdentityInPhase1(sib);
      });
    };

    const associatedExistingAssetByKey = new Map<
      string,
      { publicUrl: string; bucket: 'offer-display-images' | 'product-images'; objectPath: string; contentSha256: string }
    >();
    const canUploadOffer = (a: AnalyzedOffer): boolean => {
      if (!isOfferInScope(a)) return false;
      if (!authImages || !a.hasUsableCrop || !a.localSourceCropPath) return false;
      if (a.repairActionKind === 'associate_existing_public_asset_to_odi') return false;
      if (a.identityIssueKind !== 'none' && !authIdentity) return false;
      if (hasPendingSharedProductDependency(a)) return false;
      return true;
    };
    const canAssociateExistingAsset = (a: AnalyzedOffer): boolean => {
      if (!isOfferInScope(a)) return false;
      if (!authImages || a.repairActionKind !== 'associate_existing_public_asset_to_odi') return false;
      if (!a.existingPublicAsset?.valid || !a.existingPublicAsset.publicUrl || !a.existingPublicAsset.bucket || !a.existingPublicAsset.objectPath) {
        return false;
      }
      if (a.identityIssueKind !== 'none' && !authIdentity) return false;
      return true;
    };

    try {
      // Prepare & validate existing-public-asset ODI associations (never private offer-images URLs!)
      if (authImages) {
        for (const a of analyzedMissingOffers) {
          if (!canAssociateExistingAsset(a)) continue;
          const asset = a.existingPublicAsset!;
          if (asset.isPrivateEvidence || !asset.valid || !asset.bucket || !asset.objectPath || !asset.publicUrl) {
            throw new Error(`PRIVATE_EVIDENCE_URL_REJECTED: Refusing to expose private or invalid URL for ${a.sourceOfferId}`);
          }
          associatedExistingAssetByKey.set(a.batchOfferKey, {
            publicUrl: asset.publicUrl,
            bucket: asset.bucket,
            objectPath: asset.objectPath,
            contentSha256:
              asset.sha256Hint ||
              crypto.createHash('sha256').update(`${asset.bucket}/${asset.objectPath}`).digest('hex')
          });
        }
      }

      // Check journal table existence
      const journalCheck = await pgClient.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'publication_operations'
         ) AS exists`
      );
      const hasJournalTables = Boolean(journalCheck.rows[0]?.exists);

      await pgClient.query('BEGIN');

      let seqNo = 1;
      if (hasJournalTables) {
        maintenanceOperationId = crypto.randomUUID();
        const opKey = `repair:${input.batchId}:${crypto.createHash('sha256').update(analyzedMissingOffers.map((x) => `${x.batchOfferKey}:${authIdentity}:${authImages}`).join('|')).digest('hex').slice(0, 16)}:${Date.now()}`;
        const targetRef = dbContext === 'DEVELOPMENT_TEST' ? 'gykrbpykjhpyrdrinkuk' : 'swratbmclahjyekouned';
        await pgClient.query(
          `INSERT INTO public.publication_operations (
            publish_operation_id, idempotency_key, payload_fingerprint, target_project_ref,
            environment_context, batch_id, source_document_ids, operator_id, status,
            requested_offers_count, preflight_summary, undo_eligible
          ) VALUES ($1, $2, $3, $4, $5, $6, '[]'::jsonb, $7, 'in_progress', $8, $9::jsonb, true)`,
          [
            maintenanceOperationId,
            opKey,
            opKey,
            targetRef,
            dbContext,
            input.batchId,
            input.operatorId || 'operator_repair',
            analyzedMissingOffers.length,
            JSON.stringify({ authIdentity, authImages, missingImageOffersCount })
          ]
        );
      }

      let createdProductsCount = 0;
      let reusedProductsCount = 0;
      let updatedOffersCount = 0;
      const created10kgMap = new Map<string, string>(); // `${brand}|${name}|${size}|${unit}` -> productId
      const activeProductIdByKey = new Map<string, string | null>();
      const didIdentityFixKeys = new Set<string>();
      const phaseOutcomeByKey = new Map<string, PublishedOfferImageRepairItem>();

      // =========================================================================
      // PHASE 1: Execute ALL authorized identity corrections FIRST inside tx
      // =========================================================================
      for (const a of analyzedMissingOffers) {
        const offerId = a.offerId;
        const { item } = a.ref;
        let activeProductId = a.currentProductId;
        activeProductIdByKey.set(a.batchOfferKey, activeProductId);

        if (!isOfferInScope(a)) {
          skippedCount++;
          phaseOutcomeByKey.set(
            a.batchOfferKey,
            toRepairItem(a, 'skipped_shared_product_identity_pending', 'Excluded from selected repair targets.')
          );
          continue;
        }

        if (a.identityIssueKind !== 'none' && !authIdentity) {
          skippedCount++;
          phaseOutcomeByKey.set(
            a.batchOfferKey,
            toRepairItem(
              a,
              'skipped_identity_correction_unauthorized',
              'Identity correction authorization required before updating or imaging this offer.'
            )
          );
          continue;
        }

        if (a.proposedIdentityAction === 'convert_to_assorted_non_catalog' && authIdentity) {
          const preOfferRes = await pgClient.query(`SELECT * FROM public.offers WHERE id = $1`, [offerId]);
          const preOffer = preOfferRes.rows[0] || null;
          const nextTitleEn = a.assortInfo.proposedTitleEn || item.titleEn;
          const nextTitleAr = a.assortInfo.proposedTitleAr || item.titleAr;
          const nextScoped = {
            exact_product_comparison: 'blocked',
            unit_price_comparison: 'blocked'
          };
          const nextReasonCodes = [
            'COMPARISON_DISABLED_NO_VERIFIED_SKU',
            'NON_CATALOG_APPROVED',
            'NON_CATALOG_UNSPLIT_ASSORTMENT'
          ];

          const updRes = await pgClient.query(
            `UPDATE public.offers
             SET product_id = NULL,
                 catalog_match_status = 'candidate_pending_review',
                 catalog_verification_basis = NULL,
                 catalog_verified_by = NULL,
                 catalog_verified_at = NULL,
                 exact_identity_status = 'unresolved',
                 assortment_status = 'multiple_variants',
                 known_options = $2::jsonb,
                 title_en = $3,
                 title_ar = $4,
                 unit_price = NULL,
                 unit_price_unit = NULL,
                 informational_inner_unit_price = NULL,
                 display_unit_price_label_en = NULL,
                 display_unit_price_label_ar = NULL,
                 image_subject_scope = 'representative_assortment',
                 scoped_assessments = $5::jsonb,
                 reason_codes = $6::text[],
                 updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [
              offerId,
              JSON.stringify(a.assortInfo.knownOptions),
              nextTitleEn,
              nextTitleAr,
              JSON.stringify(nextScoped),
              nextReasonCodes
            ]
          );

          if (hasJournalTables && maintenanceOperationId && updRes.rows[0]) {
            seqNo = await recordJournalMutation({
              client: pgClient,
              publishOperationId: maintenanceOperationId,
              sequenceNo: seqNo,
              tableName: 'offers',
              recordPk: offerId,
              mutationType: 'update',
              preState: preOffer,
              postState: updRes.rows[0],
              metadata: { repairAction: 'convert_to_assorted_non_catalog', preservedProductId: a.currentProductId }
            });
          }

          activeProductId = null;
          activeProductIdByKey.set(a.batchOfferKey, null);
          item.titleEn = nextTitleEn;
          item.titleAr = nextTitleAr;
          item.assortment_status = 'unsplit_assortment';
          item.imageSubjectScope = 'representative_assortment';
          item.publicationState.productId = null;
          modifiedDrafts.set(a.ref.draftPath, { path: a.ref.draftPath, draft: a.ref.draft });
          if (input.manifest.publishedOffers?.[a.batchOfferKey]) {
            input.manifest.publishedOffers[a.batchOfferKey].productId = null;
          }
          didIdentityFixKeys.add(a.batchOfferKey);
          identityCorrectedCount++;
          updatedOffersCount++;
        } else if (a.proposedIdentityAction === 'relink_or_create_10kg' && authIdentity) {
          const targetSizeVal = a.liveRow?.each_size_value ?? item.each_size_value ?? 10;
          const targetSizeUnit = a.liveRow?.each_size_unit ?? item.each_size_unit ?? 'kg';
          const targetPack = a.liveRow?.inner_pack_count ?? item.inner_pack_count ?? 1;
          const targetSaleUnit = item.sale_unit_type || 'piece';
          const targetVariant = item.variantOrFlavor || null;
          const dedupKey = `${(a.brandName || '').toLowerCase()}|${(item.titleEn || '').toLowerCase()}|${targetSizeVal}|${targetSizeUnit}|${targetPack}|${normalizeVariantStr(targetVariant)}`;

          let resolved10kgId = created10kgMap.get(dedupKey) || a.relinkTargetProductId;
          if (!resolved10kgId) {
            const existing10kg = await findMatchingCatalogProduct(pgClient, {
              nameEn: item.titleEn,
              nameAr: item.titleAr,
              brandName: a.brandName,
              eachSizeValue: targetSizeVal,
              eachSizeUnit: targetSizeUnit,
              innerPackCount: targetPack,
              saleUnitType: targetSaleUnit,
              variantOrFlavor: targetVariant
            });
            if (existing10kg) {
              resolved10kgId = String(existing10kg.id);
              reusedProductsCount++;
            } else {
              const insProd = await pgClient.query(
                `INSERT INTO public.products (
                  name_en, name_ar, brand_name, variant_or_flavor,
                  each_size_value, each_size_unit, inner_pack_count, sale_unit_type,
                  verification_status, verification_basis
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'candidate', 'operator_maintenance_repair')
                RETURNING *`,
                [
                  item.titleEn,
                  item.titleAr,
                  a.brandName,
                  targetVariant,
                  targetSizeVal,
                  targetSizeUnit,
                  targetPack,
                  targetSaleUnit
                ]
              );
              resolved10kgId = String(insProd.rows[0].id);
              createdProductsCount++;
              if (hasJournalTables && maintenanceOperationId) {
                seqNo = await recordJournalMutation({
                  client: pgClient,
                  publishOperationId: maintenanceOperationId,
                  sequenceNo: seqNo,
                  tableName: 'products',
                  recordPk: resolved10kgId,
                  mutationType: 'insert',
                  preState: null,
                  postState: insProd.rows[0],
                  metadata: { repairAction: 'create_10kg_product_candidate', sourceOfferId: a.sourceOfferId }
                });
              }
            }
            created10kgMap.set(dedupKey, resolved10kgId);
          } else {
            reusedProductsCount++;
          }

          if (a.currentProductId && String(resolved10kgId) === String(a.currentProductId)) {
            throw new Error(
              `RELINK_TARGET_CONFLICT: 10kg identity fix for ${a.sourceOfferId} resolved back to wrong-size Product #${a.currentProductId}.`
            );
          }

          const preOfferRes = await pgClient.query(`SELECT * FROM public.offers WHERE id = $1`, [offerId]);
          const preOffer = preOfferRes.rows[0] || null;
          const relinkRes = await pgClient.query(
            `UPDATE public.offers
             SET product_id = $2::bigint,
                 catalog_match_status = CASE
                   WHEN catalog_match_status = 'unresolved' THEN 'candidate_pending_review'
                   ELSE catalog_match_status
                 END,
                 updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [offerId, Number(resolved10kgId)]
          );
          if (hasJournalTables && maintenanceOperationId && relinkRes.rows[0]) {
            seqNo = await recordJournalMutation({
              client: pgClient,
              publishOperationId: maintenanceOperationId,
              sequenceNo: seqNo,
              tableName: 'offers',
              recordPk: offerId,
              mutationType: 'update',
              preState: preOffer,
              postState: relinkRes.rows[0],
              metadata: {
                repairAction: 'relink_10kg_product',
                previousProductId: a.currentProductId,
                newProductId: resolved10kgId
              }
            });
          }

          activeProductId = resolved10kgId;
          activeProductIdByKey.set(a.batchOfferKey, resolved10kgId);
          item.publicationState.productId = resolved10kgId;
          modifiedDrafts.set(a.ref.draftPath, { path: a.ref.draftPath, draft: a.ref.draft });
          if (input.manifest.publishedOffers?.[a.batchOfferKey]) {
            input.manifest.publishedOffers[a.batchOfferKey].productId = resolved10kgId;
          }
          didIdentityFixKeys.add(a.batchOfferKey);
          identityCorrectedCount++;
          updatedOffersCount++;
        }
      }

      // =========================================================================
      // POST-PHASE-1 VERIFICATION GATE (Fail-Closed Inside Same Transaction)
      // Verify ZERO incompatible / 10kg / assortment offers remain linked to any
      // product_id targeted for public.product_images BEFORE staging or writing!
      // =========================================================================
      const verifiedSafeCatalogProductIds = new Set<string>();
      const catalogProductTargetsToVerify = new Map<string, AnalyzedOffer[]>();

      for (const a of analyzedMissingOffers) {
        if (phaseOutcomeByKey.has(a.batchOfferKey)) continue;

        if (authImages && hasPendingSharedProductDependency(a)) {
          skippedCount++;
          phaseOutcomeByKey.set(
            a.batchOfferKey,
            toRepairItem(
              a,
              'skipped_shared_product_identity_pending',
              `Held fail-closed: catalog image update for Product #${a.currentProductId} blocked because conflicting sibling offer(s) (${a.blockingSiblingSourceOfferIds.join(', ')}) remain linked without Phase 1 separation.`
            )
          );
          continue;
        }

        if (canUploadOffer(a) && a.targetBucket === 'product-images') {
          const activeProductId = activeProductIdByKey.get(a.batchOfferKey) ?? null;
          if (!activeProductId || !/^\d+$/.test(String(activeProductId))) {
            throw new Error(
              `INVALID_CATALOG_PRODUCT_TARGET: Cannot write product_images without valid numeric product_id for ${a.sourceOfferId}`
            );
          }
          const list = catalogProductTargetsToVerify.get(String(activeProductId)) || [];
          list.push(a);
          catalogProductTargetsToVerify.set(String(activeProductId), list);
        }
      }

      if (catalogProductTargetsToVerify.size > 0) {
        const checkProductIds = Array.from(catalogProductTargetsToVerify.keys()).map((id) => Number(id));
        const verifyRes = await pgClient.query<DbProductSiblingOfferRow>(
          `SELECT
             o.id::text AS offer_id,
             o.source_offer_id,
             o.source_item_number,
             o.product_id::text AS product_id,
             o.title_en,
             o.status,
             o.assortment_status,
             o.each_size_value::float8 AS each_size_value,
             o.each_size_unit,
             o.inner_pack_count,
             p.each_size_value::float8 AS p_each_size_value,
             p.each_size_unit AS p_each_size_unit,
             p.inner_pack_count AS p_inner_pack_count
           FROM public.offers o
           JOIN public.products p ON p.id = o.product_id
           WHERE o.product_id = ANY($1::bigint[])`,
          [checkProductIds]
        );

        const rowsByProduct = new Map<string, DbProductSiblingOfferRow[]>();
        for (const r of verifyRes.rows) {
          const pKey = String(r.product_id);
          const arr = rowsByProduct.get(pKey) || [];
          arr.push(r);
          rowsByProduct.set(pKey, arr);
        }

        for (const [pId, targetOffers] of catalogProductTargetsToVerify.entries()) {
          const linkedRows = rowsByProduct.get(pId) || [];
          if (linkedRows.length === 0) {
            throw new Error(
              `SHARED_PRODUCT_CONTAMINATION_BLOCKED: No offers verified on Product #${pId} after Phase 1 identity check.`
            );
          }
          for (const targetOffer of targetOffers) {
            for (const row of linkedRows) {
              const sizeMismatchWithTarget =
                row.each_size_value != null && targetOffer.offerSizeConfig.value != null
                  ? !arePackConfigsStrictlyCompatible({
                      sizeValue1: row.each_size_value,
                      sizeUnit1: row.each_size_unit ?? null,
                      packCount1: row.inner_pack_count ?? 1,
                      sizeValue2: targetOffer.offerSizeConfig.value,
                      sizeUnit2: targetOffer.offerSizeConfig.unit,
                      packCount2: targetOffer.offerSizeConfig.packCount
                    }).isCompatible
                  : false;

              if (isDbOfferIncompatibleWithProduct(row) || sizeMismatchWithTarget) {
                throw new Error(
                  `SHARED_PRODUCT_CONTAMINATION_BLOCKED: Refusing to upload/link catalog image for ${targetOffer.sourceOfferId} (${targetOffer.packSizeLabel}) onto Product #${pId} because incompatible offer ${row.source_offer_id || row.offer_id} (${row.each_size_value ?? ''}${row.each_size_unit ?? ''}, assortment=${row.assortment_status ?? ''}) is still linked.`
                );
              }
            }
          }
          verifiedSafeCatalogProductIds.add(pId);
        }
      }

      // =========================================================================
      // PHASE 2: Stage Storage Blobs & Execute Safe Image Updates Inside Same Tx
      // =========================================================================
      for (const a of analyzedMissingOffers) {
        if (phaseOutcomeByKey.has(a.batchOfferKey)) continue;

        const offerId = a.offerId;
        const { item } = a.ref;
        const activeProductId = activeProductIdByKey.get(a.batchOfferKey) ?? a.currentProductId;
        const didIdentityFix = didIdentityFixKeys.has(a.batchOfferKey);

        let stagedImg: Awaited<ReturnType<typeof stageContentAddressedUpload>> | null = null;
        if (canUploadOffer(a) && adapter) {
          const isOfferDisplay = a.targetBucket === 'offer-display-images';
          stagedImg = await stageContentAddressedUpload({
            adapter,
            bucket: a.targetBucket,
            localFilePath: a.localSourceCropPath!,
            scopePrefix: isOfferDisplay ? 'offers' : 'products',
            extension: 'webp'
          });
          if (!stagedImg?.publicUrl) {
            throw new Error(`Storage upload failed for ${a.sourceOfferId}`);
          }
          if (stagedImg.ownershipMode === 'exclusive_created') {
            exclusiveStagedForRollback.push({
              bucket: stagedImg.bucket,
              objectPath: stagedImg.objectPath
            });
          }
        }

        const existingAssociatedImg = associatedExistingAssetByKey.get(a.batchOfferKey);
        const effectivePublicUrl = stagedImg?.publicUrl || existingAssociatedImg?.publicUrl || null;
        const effectiveBucket = stagedImg ? a.targetBucket : (existingAssociatedImg?.bucket ?? a.targetBucket);
        const effectiveObjectPath = stagedImg?.objectPath || existingAssociatedImg?.objectPath || '';
        const effectiveSha256 = stagedImg?.contentSha256 || existingAssociatedImg?.contentSha256 || 'unknown';
        const effectiveByteSize = stagedImg?.byteSize || 1024;
        const associateInOdi = Boolean(existingAssociatedImg) || a.targetBucket === 'offer-display-images';

        if (!effectivePublicUrl) {
          if (didIdentityFix) {
            phaseOutcomeByKey.set(
              a.batchOfferKey,
              toRepairItem(
                a,
                'identity_corrected_only',
                a.hasUsableCrop
                  ? 'Identity corrected; image upload skipped because image repair was not authorized.'
                  : `Identity corrected; image held (${a.cropConfidenceNote || 'awaiting clean crop'}).`
              )
            );
          } else {
            skippedCount++;
            phaseOutcomeByKey.set(
              a.batchOfferKey,
              toRepairItem(
                a,
                a.cropType === 'offer_card_unsuitable' || a.requiresReplacementImage ? 'skipped_unsuitable_crop' : 'skipped_no_crop',
                a.reason
              )
            );
          }
          continue;
        }

        if (!associateInOdi) {
          if (!activeProductId || !verifiedSafeCatalogProductIds.has(String(activeProductId))) {
            throw new Error(
              `SHARED_PRODUCT_CONTAMINATION_BLOCKED: Product #${activeProductId ?? 'NULL'} did not pass Phase 1 verification before product_images write for ${a.sourceOfferId}.`
            );
          }
        }

        const preImgOfferRes = await pgClient.query(`SELECT * FROM public.offers WHERE id = $1`, [offerId]);
        const preImgOffer = preImgOfferRes.rows[0] || null;
        const nextSubjectScope =
          a.assortInfo.isAssortment || a.liveRow?.assortment_status === 'multiple_variants'
            ? 'representative_assortment'
            : preImgOffer?.image_subject_scope || 'product_package';
        const updImgRes = await pgClient.query(
          `UPDATE public.offers
           SET thumbnail_url = $1,
               image_url = $1,
               image_subject_scope = $2,
               updated_at = NOW()
           WHERE id = $3
           RETURNING *`,
          [effectivePublicUrl, nextSubjectScope, offerId]
        );
        if (hasJournalTables && maintenanceOperationId && updImgRes.rows[0]) {
          seqNo = await recordJournalMutation({
            client: pgClient,
            publishOperationId: maintenanceOperationId,
            sequenceNo: seqNo,
            tableName: 'offers',
            recordPk: offerId,
            mutationType: 'update',
            preState: preImgOffer,
            postState: updImgRes.rows[0],
            metadata: {
              repairAction: existingAssociatedImg ? 'associate_existing_public_asset' : 'repair_offer_image',
              targetBucket: a.targetBucket
            }
          });
        }
        updatedOffersCount++;

        if (associateInOdi) {
          const existingOdi = await pgClient.query(
            `SELECT * FROM public.offer_display_images WHERE offer_id = $1 AND approval_status = 'approved' LIMIT 1`,
            [offerId]
          );
          if (existingOdi.rows.length > 0) {
            const odiUpd = await pgClient.query(
              `UPDATE public.offer_display_images
               SET public_url = $1, storage_object_path = $2, storage_bucket = $3, byte_size = $4, content_sha256 = $5, updated_at = NOW()
               WHERE id = $6
               RETURNING *`,
              [
                effectivePublicUrl,
                effectiveObjectPath,
                effectiveBucket,
                effectiveByteSize,
                effectiveSha256,
                existingOdi.rows[0].id
              ]
            );
            if (hasJournalTables && maintenanceOperationId && odiUpd.rows[0]) {
              seqNo = await recordJournalMutation({
                client: pgClient,
                publishOperationId: maintenanceOperationId,
                sequenceNo: seqNo,
                tableName: 'offer_display_images',
                recordPk: String(odiUpd.rows[0].id),
                mutationType: 'update',
                preState: existingOdi.rows[0],
                postState: odiUpd.rows[0]
              });
            }
          } else {
            const odiIns = await pgClient.query(
              `INSERT INTO public.offer_display_images (
                offer_id, storage_bucket, storage_object_path, public_url,
                mime_type, byte_size, content_sha256, source_kind, visual_subject_key,
                approval_status, rights_basis, reviewed_by
              ) VALUES ($1, $2, $3, $4, 'image/webp', $5, $6, 'promotional_leaflet_crop', $7, 'approved', 'operator_manual_verified', $8)
              RETURNING *`,
              [
                offerId,
                effectiveBucket,
                effectiveObjectPath,
                effectivePublicUrl,
                effectiveByteSize,
                effectiveSha256,
                a.sourceOfferId,
                input.operatorId || 'operator_bulk_repair'
              ]
            );
            if (hasJournalTables && maintenanceOperationId && odiIns.rows[0]) {
              seqNo = await recordJournalMutation({
                client: pgClient,
                publishOperationId: maintenanceOperationId,
                sequenceNo: seqNo,
                tableName: 'offer_display_images',
                recordPk: String(odiIns.rows[0].id),
                mutationType: 'insert',
                preState: null,
                postState: odiIns.rows[0]
              });
            }
          }
        } else if (activeProductId) {
          const existingPi = await pgClient.query(
            `SELECT * FROM public.product_images WHERE product_id = $1 AND role = 'primary' AND approval_status = 'approved' LIMIT 1`,
            [Number(activeProductId)]
          );
          if (existingPi.rows.length > 0) {
            const piUpd = await pgClient.query(
              `UPDATE public.product_images
               SET public_url = $1, storage_object_path = $2, byte_size = $3, content_sha256 = $4, updated_at = NOW()
               WHERE id = $5
               RETURNING *`,
              [
                effectivePublicUrl,
                effectiveObjectPath,
                effectiveByteSize,
                effectiveSha256,
                existingPi.rows[0].id
              ]
            );
            if (hasJournalTables && maintenanceOperationId && piUpd.rows[0]) {
              seqNo = await recordJournalMutation({
                client: pgClient,
                publishOperationId: maintenanceOperationId,
                sequenceNo: seqNo,
                tableName: 'product_images',
                recordPk: String(piUpd.rows[0].id),
                mutationType: 'update',
                preState: existingPi.rows[0],
                postState: piUpd.rows[0]
              });
            }
          } else {
            const piIns = await pgClient.query(
              `INSERT INTO public.product_images (
                product_id, role, storage_bucket, storage_object_path, public_url,
                mime_type, byte_size, content_sha256, source_url, normalized_source_url,
                approval_status, rights_basis, reviewed_by
              ) VALUES ($1, 'primary', $2, $3, $4, 'image/webp', $5, $6, $4, $4, 'approved', 'operator_manual_verified', $7)
              RETURNING *`,
              [
                Number(activeProductId),
                effectiveBucket,
                effectiveObjectPath,
                effectivePublicUrl,
                effectiveByteSize,
                effectiveSha256,
                input.operatorId || 'operator_bulk_repair'
              ]
            );
            if (hasJournalTables && maintenanceOperationId && piIns.rows[0]) {
              seqNo = await recordJournalMutation({
                client: pgClient,
                publishOperationId: maintenanceOperationId,
                sequenceNo: seqNo,
                tableName: 'product_images',
                recordPk: String(piIns.rows[0].id),
                mutationType: 'insert',
                preState: null,
                postState: piIns.rows[0]
              });
            }
          }
        }

        if (stagedImg && hasJournalTables && maintenanceOperationId) {
          await pgClient.query(
            `INSERT INTO public.publication_storage_operations (
              publish_operation_id, bucket, object_path, content_sha256,
              ownership_mode, storage_state, linked_offer_id, linked_product_id
            ) VALUES ($1, $2, $3, $4, $5, 'committed', $6, $7)
            ON CONFLICT (publish_operation_id, bucket, object_path) DO NOTHING`,
            [
              maintenanceOperationId,
              stagedImg.bucket,
              stagedImg.objectPath,
              stagedImg.contentSha256,
              stagedImg.ownershipMode,
              offerId,
              activeProductId ? Number(activeProductId) : null
            ]
          );
        }

        item.publicationState.imageUrl = effectivePublicUrl;
        item.publicationState.consumerViewImageUrl = effectivePublicUrl;
        item.publicationState.needsUpdateReview = false;
        modifiedDrafts.set(a.ref.draftPath, { path: a.ref.draftPath, draft: a.ref.draft });
        if (input.manifest.publishedOffers?.[a.batchOfferKey]) {
          input.manifest.publishedOffers[a.batchOfferKey].imageUrl = effectivePublicUrl;
        }

        repairedCount++;
        phaseOutcomeByKey.set(a.batchOfferKey, toRepairItem(a, 'repaired', undefined, effectivePublicUrl));
      }

      for (const a of analyzedMissingOffers) {
        const resItem = phaseOutcomeByKey.get(a.batchOfferKey);
        if (resItem) resultItems.push(resItem);
      }

      if (hasJournalTables && maintenanceOperationId) {
        const opStatus = updatedOffersCount === 0 && createdProductsCount === 0 ? 'noop' : 'completed';
        await pgClient.query(
          `UPDATE public.publication_operations
           SET status = $2,
               updated_offers_count = $3,
               created_products_count = $4,
               reused_products_count = $5,
               storage_objects_uploaded = $6,
               completed_at = NOW(),
               updated_at = NOW()
           WHERE publish_operation_id = $1`,
          [
            maintenanceOperationId,
            opStatus,
            updatedOffersCount,
            createdProductsCount,
            reusedProductsCount,
            exclusiveStagedForRollback.length
          ]
        );
      }

      await pgClient.query('COMMIT');

      // Persist modified drafts & manifest only AFTER transaction commits
      for (const entry of modifiedDrafts.values()) {
        fs.writeFileSync(entry.path, JSON.stringify(entry.draft, null, 2), 'utf8');
      }
      if (modifiedDrafts.size > 0) {
        const manifestPath = path.join(input.batchesDir, input.batchId, 'batch-manifest.json');
        if (fs.existsSync(manifestPath)) {
          fs.writeFileSync(manifestPath, JSON.stringify(input.manifest, null, 2), 'utf8');
        }
      }
    } catch (txErr: any) {
      try {
        await pgClient.query('ROLLBACK');
      } catch {
        // Ignore rollback failure if connection died
      }
      // Compensating Storage cleanup for any exclusive blobs uploaded before rollback
      if (adapter && exclusiveStagedForRollback.length > 0) {
        const byBucket = new Map<string, string[]>();
        for (const obj of exclusiveStagedForRollback) {
          const list = byBucket.get(obj.bucket) || [];
          list.push(obj.objectPath);
          byBucket.set(obj.bucket, list);
        }
        for (const [bkt, paths] of byBucket.entries()) {
          try {
            await adapter.deleteObjects(bkt, paths);
          } catch {
            // Best-effort cleanup
          }
        }
      }
      throw txErr;
    }

    return {
      batchId: input.batchId,
      success: failedCount === 0,
      previewOnly: false,
      totalPublishedOffers,
      missingImageOffersCount,
      missingOdiAssociationCount,
      readyForRepairCount,
      awaitingCropCorrectionCount,
      awaitingIdentityCorrectionCount,
      requiresOperatorAttentionCount,
      identityCorrectedCount,
      repairedCount,
      skippedCount,
      failedCount,
      maintenanceOperationId,
      repairs: resultItems
    };
  } finally {
    if (ownedClient && pgClient && (pgClient as any).end) {
      await (pgClient as any).end();
    }
  }
}
