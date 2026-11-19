/**
 * WIFRAN-EXTRACTOR-IDENTITY-005G (WP6-D)
 * High-Resolution Crop Generation, Geometry Validation, and Full Internal Lineage.
 *
 * Reuses existing `boundingBoxValidator` (`validateAndClampBoundingBox`, `padBoundingBox`)
 * and `itemImageCropper` (`cropItemImage`) on rendered original full-page images.
 * Handles normalized 0..1000 Gemini [ymin, xmin, ymax, xmax] union boxes, adds margin/context
 * padding, rejects corrupted/inverted geometry, and never leaks local file paths to DTOs.
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import {
  padBoundingBox,
  validateAndClampBoundingBox
} from '../../image/boundingBoxValidator';
import { cropItemImage } from '../../image/itemImageCropper';
import type {
  CropLineageMetadata,
  NormalizedBox2D,
  PixelBoundingBox,
  V3RawComponentBoxes
} from '../../../shared/types/hybridExtractionV3';

export const DEFAULT_CROP_PADDING_PERCENT = 8;

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Computes the union of valid non-null 0..1000 normalized component boxes on a card.
 * Rejects inverted (`ymax <= ymin` or `xmax <= xmin`), NaN, or severely out-of-bounds boxes.
 */
export function computeCardUnionNormalizedBox(
  components: V3RawComponentBoxes | null | undefined,
  explicitCardBox?: NormalizedBox2D | null
): {
  ok: boolean;
  unionBox: NormalizedBox2D | null;
  issues: string[];
} {
  const issues: string[] = [];
  const candidateBoxes: NormalizedBox2D[] = [];

  if (explicitCardBox) {
    candidateBoxes.push(explicitCardBox);
  }

  if (components) {
    const ordered: Array<[string, NormalizedBox2D | null | undefined]> = [
      ['product_graphic_box', components.product_graphic_box],
      ['promo_price_box', components.promo_price_box],
      ['original_price_box', components.original_price_box],
      ['title_text_box', components.title_text_box],
      ['unit_and_size_badge_box', components.unit_and_size_badge_box]
    ];
    for (const [name, box] of ordered) {
      if (box == null) continue;
      if (!Array.isArray(box) || box.length !== 4) {
        issues.push(`INVALID_BOX_TUPLE:${name}`);
        return { ok: false, unionBox: null, issues };
      }
      const [ymin, xmin, ymax, xmax] = box;
      if ([ymin, xmin, ymax, xmax].some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
        issues.push(`NON_FINITE_COORDS:${name}`);
        return { ok: false, unionBox: null, issues };
      }
      if (ymax <= ymin || xmax <= xmin) {
        issues.push(`INVERTED_OR_ZERO_AREA_BOX:${name}`);
        return { ok: false, unionBox: null, issues };
      }
      if (ymin < 0 || xmin < 0 || ymax > 1000 || xmax > 1000) {
        issues.push(`OUT_OF_NORMALIZED_BOUNDS:${name}`);
        return { ok: false, unionBox: null, issues };
      }
      candidateBoxes.push(box);
    }
  }

  if (candidateBoxes.length === 0) {
    issues.push('MISSING_COMPONENT_BOXES');
    return { ok: false, unionBox: null, issues };
  }

  let ymin = 1000;
  let xmin = 1000;
  let ymax = 0;
  let xmax = 0;
  for (const [bYmin, bXmin, bYmax, bXmax] of candidateBoxes) {
    ymin = Math.min(ymin, bYmin);
    xmin = Math.min(xmin, bXmin);
    ymax = Math.max(ymax, bYmax);
    xmax = Math.max(xmax, bXmax);
  }

  if (ymax <= ymin || xmax <= xmin) {
    issues.push('COLLAPSED_UNION_BOX');
    return { ok: false, unionBox: null, issues };
  }

  return {
    ok: true,
    unionBox: [ymin, xmin, ymax, xmax],
    issues
  };
}

export function normalizedBoxToPixelBox(
  normBox: NormalizedBox2D,
  pageWidth: number,
  pageHeight: number
): PixelBoundingBox {
  const [ymin, xmin, ymax, xmax] = normBox;
  const x = Math.round((xmin / 1000) * pageWidth);
  const y = Math.round((ymin / 1000) * pageHeight);
  const right = Math.round((xmax / 1000) * pageWidth);
  const bottom = Math.round((ymax / 1000) * pageHeight);
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y)
  };
}

export function pixelBoxToNormalizedBox(
  pixelBox: PixelBoundingBox,
  pageWidth: number,
  pageHeight: number
): NormalizedBox2D {
  if (pageWidth <= 0 || pageHeight <= 0) {
    return [0, 0, 0, 0];
  }
  const ymin = Math.max(0, Math.min(1000, Math.round((pixelBox.y / pageHeight) * 1000)));
  const xmin = Math.max(0, Math.min(1000, Math.round((pixelBox.x / pageWidth) * 1000)));
  const ymax = Math.max(
    0,
    Math.min(1000, Math.round(((pixelBox.y + pixelBox.height) / pageHeight) * 1000))
  );
  const xmax = Math.max(
    0,
    Math.min(1000, Math.round(((pixelBox.x + pixelBox.width) / pageWidth) * 1000))
  );
  return [ymin, xmin, ymax, xmax];
}

export interface GenerateHybridCropInput {
  cropId: string;
  parentSourceOfferId: string;
  regionKind: 'offer_card' | 'compound_card_full' | 'page_header' | 'page_footer';
  pageImagePath: string;
  outputDir: string;
  components?: V3RawComponentBoxes | null;
  explicitNormalizedBox?: NormalizedBox2D | null;
  paddingPercent?: number;
  dryRunGeometryOnly?: boolean;
}

/**
 * Generates (or in `dryRunGeometryOnly` mode computes & validates) a high-res crop
 * from the source leaflet page image with full geometry validation and internal lineage.
 */
export async function generateHybridRegionCrop(
  input: GenerateHybridCropInput
): Promise<CropLineageMetadata> {
  const paddingPercent = input.paddingPercent ?? DEFAULT_CROP_PADDING_PERCENT;

  if (!input.pageImagePath || !existsSync(input.pageImagePath)) {
    return {
      cropId: input.cropId,
      parentSourceOfferId: input.parentSourceOfferId,
      regionKind: input.regionKind,
      sourcePageImagePath: input.pageImagePath,
      sourcePageWidth: 0,
      sourcePageHeight: 0,
      rawUnionNormalizedBox: null,
      paddedNormalizedBox: null,
      pixelBox: null,
      paddingRatio: paddingPercent / 100,
      cropImagePath: null,
      cropSha256: null,
      geometryValid: false,
      geometryIssues: ['SOURCE_PAGE_IMAGE_NOT_FOUND']
    };
  }

  const meta = await sharp(input.pageImagePath).metadata();
  const pageWidth = meta.width || 0;
  const pageHeight = meta.height || 0;
  if (pageWidth <= 0 || pageHeight <= 0) {
    return {
      cropId: input.cropId,
      parentSourceOfferId: input.parentSourceOfferId,
      regionKind: input.regionKind,
      sourcePageImagePath: input.pageImagePath,
      sourcePageWidth: pageWidth,
      sourcePageHeight: pageHeight,
      rawUnionNormalizedBox: null,
      paddedNormalizedBox: null,
      pixelBox: null,
      paddingRatio: paddingPercent / 100,
      cropImagePath: null,
      cropSha256: null,
      geometryValid: false,
      geometryIssues: ['INVALID_PAGE_IMAGE_DIMENSIONS']
    };
  }

  const unionRes = computeCardUnionNormalizedBox(input.components, input.explicitNormalizedBox);
  if (!unionRes.ok || !unionRes.unionBox) {
    return {
      cropId: input.cropId,
      parentSourceOfferId: input.parentSourceOfferId,
      regionKind: input.regionKind,
      sourcePageImagePath: input.pageImagePath,
      sourcePageWidth: pageWidth,
      sourcePageHeight: pageHeight,
      rawUnionNormalizedBox: null,
      paddedNormalizedBox: null,
      pixelBox: null,
      paddingRatio: paddingPercent / 100,
      cropImagePath: null,
      cropSha256: null,
      geometryValid: false,
      geometryIssues: unionRes.issues
    };
  }

  const rawPixel = normalizedBoxToPixelBox(unionRes.unionBox, pageWidth, pageHeight);
  const validation = validateAndClampBoundingBox(rawPixel, pageWidth, pageHeight);
  const issues = validation.issues.map((i) => `${i.code}: ${i.message}`);

  if (!validation.isValid || !validation.box) {
    return {
      cropId: input.cropId,
      parentSourceOfferId: input.parentSourceOfferId,
      regionKind: input.regionKind,
      sourcePageImagePath: input.pageImagePath,
      sourcePageWidth: pageWidth,
      sourcePageHeight: pageHeight,
      rawUnionNormalizedBox: unionRes.unionBox,
      paddedNormalizedBox: null,
      pixelBox: null,
      paddingRatio: paddingPercent / 100,
      cropImagePath: null,
      cropSha256: null,
      geometryValid: false,
      geometryIssues: issues
    };
  }

  const paddedPixel =
    paddingPercent > 0
      ? padBoundingBox(validation.box, pageWidth, pageHeight, paddingPercent)
      : validation.box;

  // Guard against unusably tiny crops
  if (paddedPixel.width < 32 || paddedPixel.height < 32) {
    return {
      cropId: input.cropId,
      parentSourceOfferId: input.parentSourceOfferId,
      regionKind: input.regionKind,
      sourcePageImagePath: input.pageImagePath,
      sourcePageWidth: pageWidth,
      sourcePageHeight: pageHeight,
      rawUnionNormalizedBox: unionRes.unionBox,
      paddedNormalizedBox: pixelBoxToNormalizedBox(paddedPixel, pageWidth, pageHeight),
      pixelBox: paddedPixel,
      paddingRatio: paddingPercent / 100,
      cropImagePath: null,
      cropSha256: null,
      geometryValid: false,
      geometryIssues: [...issues, 'CROP_TOO_SMALL_UNDER_32PX']
    };
  }

  const paddedNorm = pixelBoxToNormalizedBox(paddedPixel, pageWidth, pageHeight);

  if (input.dryRunGeometryOnly) {
    return {
      cropId: input.cropId,
      parentSourceOfferId: input.parentSourceOfferId,
      regionKind: input.regionKind,
      sourcePageImagePath: input.pageImagePath,
      sourcePageWidth: pageWidth,
      sourcePageHeight: pageHeight,
      rawUnionNormalizedBox: unionRes.unionBox,
      paddedNormalizedBox: paddedNorm,
      pixelBox: paddedPixel,
      paddingRatio: paddingPercent / 100,
      cropImagePath: null,
      cropSha256: null,
      geometryValid: true,
      geometryIssues: issues
    };
  }

  const outPath = join(input.outputDir, `${sanitizeFileSegment(input.cropId)}.webp`);
  await cropItemImage({
    pageImagePath: input.pageImagePath,
    outputPath: outPath,
    cropBox: paddedPixel,
    outputFormat: 'webp',
    outputQuality: 92
  });

  const buf = readFileSync(outPath);
  const cropSha256 = createHash('sha256').update(buf).digest('hex');

  return {
    cropId: input.cropId,
    parentSourceOfferId: input.parentSourceOfferId,
    regionKind: input.regionKind,
    sourcePageImagePath: input.pageImagePath,
    sourcePageWidth: pageWidth,
    sourcePageHeight: pageHeight,
    rawUnionNormalizedBox: unionRes.unionBox,
    paddedNormalizedBox: paddedNorm,
    pixelBox: paddedPixel,
    paddingRatio: paddingPercent / 100,
    cropImagePath: outPath,
    cropSha256,
    geometryValid: true,
    geometryIssues: issues
  };
}

const UNSAFE_PRODUCT_IMAGE_CONFLICTS = new Set([
  'UNLABELED_SWATCH_OR_BOTTLE_VARIANTS',
  'INCOMPLETE_VISIBLE_ASSORTMENT',
  'TEXT_VS_IMAGE_CONFLICT',
  'AMBIGUOUS_PRICE_TIE',
  'PRICE_ROLE_AMBIGUOUS',
  'MISSING_CRITICAL_IDENTITY_ATTRIBUTES'
]);

export interface OfferAndProductCropResult {
  offerSquareCrop: CropLineageMetadata | null;
  productOnlyCrop: CropLineageMetadata | null;
  imageSubjectScope: 'product_package' | 'representative_assortment' | 'unverified';
  canUseProductThumbForCatalogSku: boolean;
  reasons: string[];
}

/**
 * Guardrail ensuring an unverified, cropped-wrong, or multi-product assortment graphic
 * is NEVER blindly treated as an exact catalog SKU product image.
 */
export function canAttachProductImageToCatalogSku(input: {
  assortmentStatus?: string | null;
  conflictCodes?: string[];
  decomposedChildrenCount?: number;
  hasSeparateChildProductBox?: boolean;
  hasValidProductGraphicBox: boolean;
}): {
  canUseForCatalogSku: boolean;
  imageSubjectScope: 'product_package' | 'representative_assortment' | 'unverified';
  reasons: string[];
} {
  const reasons: string[] = [];
  if (!input.hasValidProductGraphicBox) {
    reasons.push('MISSING_OR_INVALID_PRODUCT_GRAPHIC_BOX');
    return {
      canUseForCatalogSku: false,
      imageSubjectScope: 'unverified',
      reasons
    };
  }

  const conflicts = input.conflictCodes || [];
  const blockingConflicts = conflicts.filter((c) => UNSAFE_PRODUCT_IMAGE_CONFLICTS.has(c));
  if (blockingConflicts.length > 0) {
    reasons.push(`UNSAFE_CONFLICT_PRESENT:${blockingConflicts.join(',')}`);
    return {
      canUseForCatalogSku: false,
      imageSubjectScope: 'unverified',
      reasons
    };
  }

  const assortment = input.assortmentStatus || 'single_sku';
  const isMultiProductGroup =
    assortment === 'multiple_variants' ||
    assortment === 'ambiguous_alternatives' ||
    assortment === 'unknown_composition' ||
    assortment === 'compound_multi_tier' ||
    ((input.decomposedChildrenCount ?? 1) > 1 && !input.hasSeparateChildProductBox);

  if (isMultiProductGroup) {
    reasons.push('MULTI_PRODUCT_OR_SHARED_ASSORTMENT_IMAGE');
    return {
      canUseForCatalogSku: false,
      imageSubjectScope: 'representative_assortment',
      reasons
    };
  }

  return {
    canUseForCatalogSku: true,
    imageSubjectScope: 'product_package',
    reasons
  };
}

/**
 * Trims product_graphic_box geometry to avoid bleeding into adjacent or overlapping
 * promotional price badges (e.g. red 19.99 badge in the lower portion of the product graphic).
 */
export function excludePromotionalBadgesFromProductBox(
  productBox: NormalizedBox2D,
  promoPriceBox?: NormalizedBox2D | null
): NormalizedBox2D {
  if (!promoPriceBox) return productBox;
  const [pYmin, pXmin, pYmax, pXmax] = productBox;
  const [bYmin, bXmin, bYmax, bXmax] = promoPriceBox;

  // Check if promo price badge overlaps or is immediately adjacent to the product graphic box
  const hasYOverlap = bYmin < pYmax && bYmax > pYmin;
  const hasXOverlap = bXmin < pXmax && bXmax > pXmin;
  if (!hasYOverlap || !hasXOverlap) {
    return productBox;
  }

  // If badge is located at the bottom edge (e.g. bottom 50% of the box)
  if (bYmin > pYmin && bYmin >= pYmin + (pYmax - pYmin) * 0.45) {
    const adjustedYmax = Math.max(pYmin + 20, bYmin - 3);
    return [pYmin, pXmin, adjustedYmax, pXmax];
  }

  // If badge is located at the top edge (e.g. top 50% of the box)
  if (bYmax < pYmax && bYmax <= pYmin + (pYmax - pYmin) * 0.55) {
    const adjustedYmin = Math.min(pYmax - 20, bYmax + 3);
    return [adjustedYmin, pXmin, pYmax, pXmax];
  }

  return productBox;
}

/**
 * Generates BOTH:
 * 1) Offer-square image (`offer_card_crop.webp`): full offer card context (title, promo badge, price, product).
 * 2) Product-only crop (`product_thumb_crop.webp`): isolated `product_graphic_box` (without price overlays/neighbors when distinct).
 */
export async function generateOfferAndProductCrops(input: {
  sourceOfferId: string;
  pageImagePath: string;
  outputDir: string;
  components?: V3RawComponentBoxes | null;
  explicitCardBox?: NormalizedBox2D | null;
  assortmentStatus?: string | null;
  conflictCodes?: string[];
  decomposedChildrenCount?: number;
  hasSeparateChildProductBox?: boolean;
  dryRunGeometryOnly?: boolean;
}): Promise<OfferAndProductCropResult> {
  const offerSquareCrop = await generateHybridRegionCrop({
    cropId: 'offer_card_crop',
    parentSourceOfferId: input.sourceOfferId,
    regionKind: 'offer_card',
    pageImagePath: input.pageImagePath,
    outputDir: input.outputDir,
    components: input.components,
    explicitNormalizedBox: input.explicitCardBox,
    paddingPercent: 6,
    dryRunGeometryOnly: input.dryRunGeometryOnly
  });

  const rawProductBox = input.components?.product_graphic_box ?? null;
  const productBox = rawProductBox
    ? excludePromotionalBadgesFromProductBox(rawProductBox, input.components?.promo_price_box)
    : null;
  const productOnlyCrop = productBox
    ? await generateHybridRegionCrop({
        cropId: 'product_thumb_crop',
        parentSourceOfferId: input.sourceOfferId,
        regionKind: 'offer_card',
        pageImagePath: input.pageImagePath,
        outputDir: input.outputDir,
        components: { product_graphic_box: productBox },
        paddingPercent: 2,
        dryRunGeometryOnly: input.dryRunGeometryOnly
      })
    : null;

  const hasValidProductGraphicBox = Boolean(productOnlyCrop && productOnlyCrop.geometryValid);
  const guard = canAttachProductImageToCatalogSku({
    assortmentStatus: input.assortmentStatus,
    conflictCodes: input.conflictCodes,
    decomposedChildrenCount: input.decomposedChildrenCount,
    hasSeparateChildProductBox: input.hasSeparateChildProductBox,
    hasValidProductGraphicBox
  });

  return {
    offerSquareCrop,
    productOnlyCrop,
    imageSubjectScope: guard.imageSubjectScope,
    canUseProductThumbForCatalogSku: guard.canUseForCatalogSku,
    reasons: guard.reasons
  };
}

export interface DerivedTierCropOutput {
  sourceOfferId: string;
  parentCardId: string;
  tierIndex: number;
  outputPath: string;
  metaPath: string;
  sizeConfirmationStatus: 'exact_tier_graphic' | 'shared_single_graphic_requires_confirmation';
  hasOwnGraphicBox: boolean;
  priceBoxTrimmed: boolean;
  cropSha256: string;
  pixelBox: PixelBoundingBox;
  operatorConfirmed?: boolean;
  visiblePackageWeightLabel?: string | null;
  visiblePackageSizeConflict?: boolean;
  allowOperatorConfirmation?: boolean;
  requiresReplacementImage?: boolean;
}

/**
 * Deterministic local crop generator for multi-tier cards using original high-res page image
 * and stored V3 component geometry (zero Gemini API calls, preserves offer_card_crop.webp).
 */
export async function generateDerivedTierProductCropsFromGeometry(input: {
  workspacePath: string;
  pageNumber: number;
  targets: Array<{
    sourceOfferId: string;
    parentCardId: string;
    tierIndex: number;
    visiblePackageWeightLabel?: string | null;
    tierSizeLabel?: string | null;
  }>;
}): Promise<DerivedTierCropOutput[]> {
  const pageImagePath = join(input.workspacePath, 'pages', `page.${input.pageNumber}.png`);
  const v3ResultsPath = join(input.workspacePath, 'hybrid_v3_results', `page_${input.pageNumber}.v3.json`);

  if (!existsSync(pageImagePath)) {
    throw new Error(`High-resolution page image missing: ${pageImagePath}`);
  }
  if (!existsSync(v3ResultsPath)) {
    throw new Error(`V3 geometry results missing: ${v3ResultsPath}`);
  }

  const v3Json = JSON.parse(readFileSync(v3ResultsPath, 'utf8'));
  const boxesByCard: Record<string, V3RawComponentBoxes> =
    v3Json?.pageResult?.componentBoxesBySourceOfferId || {};

  const results: DerivedTierCropOutput[] = [];

  for (const t of input.targets) {
    const ownBox = boxesByCard[t.sourceOfferId] ?? null;
    const parentBox = boxesByCard[t.parentCardId] ?? null;
    const comp = ownBox ?? parentBox;
    if (!comp?.product_graphic_box) {
      throw new Error(`Missing product_graphic_box geometry for ${t.sourceOfferId} (parent=${t.parentCardId})`);
    }

    const rawProductBox = comp.product_graphic_box;
    const trimmedBox = excludePromotionalBadgesFromProductBox(rawProductBox, comp.promo_price_box);
    const priceBoxTrimmed =
      trimmedBox[0] !== rawProductBox[0] ||
      trimmedBox[1] !== rawProductBox[1] ||
      trimmedBox[2] !== rawProductBox[2] ||
      trimmedBox[3] !== rawProductBox[3];

    const outDir = join(input.workspacePath, 'crops', `page_${input.pageNumber}`, t.sourceOfferId);
    mkdirSync(outDir, { recursive: true });

    const crop = await generateHybridRegionCrop({
      cropId: 'product_thumb_crop',
      parentSourceOfferId: t.sourceOfferId,
      regionKind: 'offer_card',
      pageImagePath,
      outputDir: outDir,
      components: { product_graphic_box: trimmedBox },
      // Zero extra padding when badge exclusion trimmed the box to guarantee 0 price-badge bleed
      paddingPercent: priceBoxTrimmed ? 0 : 1
    });

    if (!crop.geometryValid || !crop.cropImagePath || !crop.cropSha256 || !crop.pixelBox) {
      throw new Error(
        `Failed generating clean product crop for ${t.sourceOfferId}: ${crop.geometryIssues.join('; ')}`
      );
    }

    const hasOwnGraphicBox = Boolean(ownBox?.product_graphic_box);
    const sizeConfirmationStatus: DerivedTierCropOutput['sizeConfirmationStatus'] =
      t.tierIndex <= 1 || hasOwnGraphicBox
        ? 'exact_tier_graphic'
        : 'shared_single_graphic_requires_confirmation';
    const normLabel = (s?: string | null) => (s || '').replace(/\s+/g, '').toLowerCase();
    const visiblePkgLabel = t.visiblePackageWeightLabel ?? null;
    const visiblePackageSizeConflict = Boolean(
      visiblePkgLabel &&
        t.tierSizeLabel &&
        normLabel(visiblePkgLabel) !== normLabel(t.tierSizeLabel)
    );
    const allowOperatorConfirmation = !visiblePackageSizeConflict;
    const requiresReplacementImage = visiblePackageSizeConflict;

    const metaPath = join(outDir, 'derived_tier_crop_meta.json');
    const metaPayload = {
      sourceOfferId: t.sourceOfferId,
      parentCardId: t.parentCardId,
      tierIndex: t.tierIndex,
      derivedAt: new Date().toISOString(),
      sourcePageImagePath: pageImagePath,
      rawProductGraphicBox: rawProductBox,
      trimmedProductBox: trimmedBox,
      promoPriceBoxExcluded: comp.promo_price_box ?? null,
      priceBoxTrimmed,
      hasOwnGraphicBox,
      sizeConfirmationStatus,
      visiblePackageWeightLabel: visiblePkgLabel,
      visiblePackageSizeConflict,
      allowOperatorConfirmation,
      requiresReplacementImage,
      confirmationBlockedReason: visiblePackageSizeConflict
        ? `Visible package label (${visiblePkgLabel}) conflicts with offer size (${t.tierSizeLabel}); replacement image required.`
        : null,
      operatorConfirmed: false,
      cropSha256: crop.cropSha256,
      pixelBox: crop.pixelBox
    };
    writeFileSync(metaPath, JSON.stringify(metaPayload, null, 2), 'utf8');

    results.push({
      sourceOfferId: t.sourceOfferId,
      parentCardId: t.parentCardId,
      tierIndex: t.tierIndex,
      outputPath: crop.cropImagePath,
      metaPath,
      sizeConfirmationStatus,
      hasOwnGraphicBox,
      priceBoxTrimmed,
      cropSha256: crop.cropSha256,
      pixelBox: crop.pixelBox,
      visiblePackageWeightLabel: visiblePkgLabel,
      visiblePackageSizeConflict,
      allowOperatorConfirmation,
      requiresReplacementImage
    });
  }

  return results;
}


