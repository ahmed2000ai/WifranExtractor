import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { join } from 'path';
import type {
  ExtractedOfferRev1,
  NormalizedBox2D,
  PixelBoundingBox,
  OfferCropRectangles
} from '../../shared/types/leafletExtraction';
import { denormalizeBox, denormalizeCoord } from '../image/nativeResolutionService';

/**
 * Computes the pixel union bounding box across all visible atomic components of an offer.
 */
export function computeRawOfferUnionBox(
  offer: ExtractedOfferRev1,
  nativeWidth: number,
  nativeHeight: number
): PixelBoundingBox {
  const comp = offer.components;
  const boxes: NormalizedBox2D[] = [];

  if (
    comp.product_graphic_box &&
    comp.product_graphic_box[2] > comp.product_graphic_box[0] &&
    comp.product_graphic_box[3] > comp.product_graphic_box[1]
  ) {
    boxes.push(comp.product_graphic_box);
  }

  if (
    comp.promo_price_box &&
    comp.promo_price_box[2] > comp.promo_price_box[0] &&
    comp.promo_price_box[3] > comp.promo_price_box[1]
  ) {
    boxes.push(comp.promo_price_box);
  }

  // Strictly exclude original_price_box when original_price === null or original_price_box === null
  if (
    offer.original_price !== null &&
    offer.original_price !== undefined &&
    comp.original_price_box &&
    comp.original_price_box[2] > comp.original_price_box[0] &&
    comp.original_price_box[3] > comp.original_price_box[1]
  ) {
    boxes.push(comp.original_price_box);
  }

  if (
    comp.unit_and_size_badge_box &&
    comp.unit_and_size_badge_box[2] > comp.unit_and_size_badge_box[0] &&
    comp.unit_and_size_badge_box[3] > comp.unit_and_size_badge_box[1]
  ) {
    boxes.push(comp.unit_and_size_badge_box);
  }

  if (
    comp.title_text_box &&
    comp.title_text_box[2] > comp.title_text_box[0] &&
    comp.title_text_box[3] > comp.title_text_box[1]
  ) {
    boxes.push(comp.title_text_box);
  } else if (
    boxes.length > 0 &&
    (offer.arabic_title || offer.english_title)
  ) {
    // Defensive spatial fallback: If title_text_box is missing despite having a title,
    // extend ymax downward by 8% of the offer's height (clamped inside 0..1000)
    // so a bottom printed title banner is never guillotined.
    const currentYmin = Math.min(...boxes.map(b => b[0]));
    const currentYmax = Math.max(...boxes.map(b => b[2]));
    const currentHeight = Math.max(10, currentYmax - currentYmin);
    const fallbackTitleYmin = currentYmax;
    const fallbackTitleYmax = Math.min(1000, currentYmax + Math.round(currentHeight * 0.08));
    const currentXmin = Math.min(...boxes.map(b => b[1]));
    const currentXmax = Math.max(...boxes.map(b => b[3]));
    boxes.push([fallbackTitleYmin, currentXmin, fallbackTitleYmax, currentXmax]);
  }

  if (boxes.length === 0) {
    return {
      xmin: 0,
      ymin: 0,
      xmax: nativeWidth,
      ymax: nativeHeight,
      width: nativeWidth,
      height: nativeHeight
    };
  }

  let yminNorm = Math.min(...boxes.map(b => b[0]));
  let xminNorm = Math.min(...boxes.map(b => b[1]));
  let ymaxNorm = Math.max(...boxes.map(b => b[2]));
  let xmaxNorm = Math.max(...boxes.map(b => b[3]));

  yminNorm = Math.max(0, Math.min(1000, yminNorm));
  xminNorm = Math.max(0, Math.min(1000, xminNorm));
  ymaxNorm = Math.max(0, Math.min(1000, ymaxNorm));
  xmaxNorm = Math.max(0, Math.min(1000, xmaxNorm));

  const ymin = denormalizeCoord(yminNorm, nativeHeight);
  const xmin = denormalizeCoord(xminNorm, nativeWidth);
  const ymax = denormalizeCoord(ymaxNorm, nativeHeight);
  const xmax = denormalizeCoord(xmaxNorm, nativeWidth);

  return {
    xmin,
    ymin,
    xmax,
    ymax,
    width: Math.max(1, xmax - xmin),
    height: Math.max(1, ymax - ymin)
  };
}

/**
 * Computes Intersection over Union (IoU) between two pixel boxes.
 */
export function computeBoxIoU(boxA: PixelBoundingBox, boxB: PixelBoundingBox): number {
  const interXmin = Math.max(boxA.xmin, boxB.xmin);
  const interYmin = Math.max(boxA.ymin, boxB.ymin);
  const interXmax = Math.min(boxA.xmax, boxB.xmax);
  const interYmax = Math.min(boxA.ymax, boxB.ymax);

  if (interXmax <= interXmin || interYmax <= interYmin) {
    return 0;
  }

  const interArea = (interXmax - interXmin) * (interYmax - interYmin);
  const areaA = boxA.width * boxA.height;
  const areaB = boxB.width * boxB.height;
  const unionArea = areaA + areaB - interArea;

  return unionArea > 0 ? interArea / unionArea : 0;
}

/**
 * Computes IoU between two normalized 2D boxes [ymin, xmin, ymax, xmax] (0..1000).
 */
export function computeBoxIoUNorm(
  boxA: NormalizedBox2D | null | undefined,
  boxB: NormalizedBox2D | null | undefined
): number {
  if (!boxA || !boxB) return 0;
  const interYmin = Math.max(boxA[0], boxB[0]);
  const interXmin = Math.max(boxA[1], boxB[1]);
  const interYmax = Math.min(boxA[2], boxB[2]);
  const interXmax = Math.min(boxA[3], boxB[3]);
  if (interYmax <= interYmin || interXmax <= interXmin) return 0;

  const interArea = (interYmax - interYmin) * (interXmax - interXmin);
  const areaA = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1]);
  const areaB = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1]);
  const unionArea = areaA + areaB - interArea;
  return unionArea > 0 ? interArea / unionArea : 0;
}

/**
 * Computes word token overlap between two strings (case-insensitive, unicode-safe).
 */
export function computeTokenOverlap(strA: string | null | undefined, strB: string | null | undefined): number {
  if (!strA || !strB) return 0;
  const tokenize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1);
  const tokensA = new Set(tokenize(strA));
  const tokensB = new Set(tokenize(strB));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let common = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) common++;
  }
  const minSize = Math.min(tokensA.size, tokensB.size);
  return minSize > 0 ? common / minSize : 0;
}

/**
 * Determines whether two offers represent compound siblings sharing a single visual cell.
 */
export function areCompoundSiblings(
  offerA: ExtractedOfferRev1,
  offerB: ExtractedOfferRev1,
  rawBoxA?: PixelBoundingBox,
  rawBoxB?: PixelBoundingBox
): boolean {
  if (offerA.offer_number === offerB.offer_number) return true;

  // 1. Both share the same non-null compound_group_id
  if (
    offerA.compound_group_id &&
    offerB.compound_group_id &&
    offerA.compound_group_id === offerB.compound_group_id
  ) {
    return true;
  }

  // 2. iou(offerA.components.title_text_box, offerB.components.title_text_box) > 0.20
  if (computeBoxIoUNorm(offerA.components.title_text_box, offerB.components.title_text_box) > 0.20) {
    return true;
  }

  // 3. iou(offerA.components.product_graphic_box, offerB.components.product_graphic_box) > 0.20
  if (computeBoxIoUNorm(offerA.components.product_graphic_box, offerB.components.product_graphic_box) > 0.20) {
    return true;
  }

  // 4. Raw union vertical overlap > 0.20, horizontal X-projection overlap > 0.55, and title token overlap >= 0.70
  const bA = rawBoxA || computeRawOfferUnionBox(offerA, 1000, 1000);
  const bB = rawBoxB || computeRawOfferUnionBox(offerB, 1000, 1000);

  const interXmin = Math.max(bA.xmin, bB.xmin);
  const interXmax = Math.min(bA.xmax, bB.xmax);
  const interYmin = Math.max(bA.ymin, bB.ymin);
  const interYmax = Math.min(bA.ymax, bB.ymax);

  const interWidth = Math.max(0, interXmax - interXmin);
  const interHeight = Math.max(0, interYmax - interYmin);
  const interArea = interWidth * interHeight;

  const minArea = Math.min(bA.width * bA.height, bB.width * bB.height);
  const minWidth = Math.min(bA.width, bB.width);

  const xOverlap = minWidth > 0 ? interWidth / minWidth : 0;
  const areaOverlap = minArea > 0 ? interArea / minArea : 0;

  if (areaOverlap > 0.20 && xOverlap > 0.55) {
    const arOverlap = computeTokenOverlap(offerA.arabic_title, offerA.arabic_title ? offerB.arabic_title : '');
    const enOverlap = computeTokenOverlap(offerA.english_title, offerA.english_title ? offerB.english_title : '');
    if (arOverlap >= 0.70 || enOverlap >= 0.70) {
      return true;
    }
  }

  return false;
}

/**
 * Calculates pixel boundary encompassing core protected components
 * (promo_price_box, title_text_box, product_graphic_box) for an offer or cluster of offers.
 */
export function getCoreComponentPixelBounds(
  offers: ExtractedOfferRev1[],
  nativeWidth: number,
  nativeHeight: number
): PixelBoundingBox {
  const normBoxes: NormalizedBox2D[] = [];

  for (const off of offers) {
    const comp = off.components;
    if (comp.promo_price_box) normBoxes.push(comp.promo_price_box);
    if (comp.title_text_box) normBoxes.push(comp.title_text_box);
    if (comp.product_graphic_box) normBoxes.push(comp.product_graphic_box);
  }

  if (normBoxes.length === 0) {
    return { xmin: 0, ymin: 0, xmax: 0, ymax: 0, width: 0, height: 0 };
  }

  const ymin = denormalizeCoord(Math.min(...normBoxes.map(b => b[0])), nativeHeight);
  const xmin = denormalizeCoord(Math.min(...normBoxes.map(b => b[1])), nativeWidth);
  const ymax = denormalizeCoord(Math.max(...normBoxes.map(b => b[2])), nativeHeight);
  const xmax = denormalizeCoord(Math.max(...normBoxes.map(b => b[3])), nativeWidth);

  return {
    xmin,
    ymin,
    xmax,
    ymax,
    width: Math.max(1, xmax - xmin),
    height: Math.max(1, ymax - ymin)
  };
}

/**
 * Performs pairwise Voronoi midpoint clamping when two adjacent offers overlap beyond threshold.
 * Prevents neighbor-bleed on borderless multi-column layouts while preserving compound sibling cells
 * and enforcing hard core-component protection.
 */
export function clampNeighborBleed(
  offers: ExtractedOfferRev1[],
  rawBoxes: PixelBoundingBox[],
  nativeWidth: number,
  nativeHeight: number
): PixelBoundingBox[] {
  const n = offers.length;
  if (n === 0) return [];

  // 1. Group compound siblings into connected clusters (DSU)
  const parent: number[] = Array.from({ length: n }, (_, i) => i);
  function find(x: number): number {
    if (parent[x] === x) return x;
    parent[x] = find(parent[x]);
    return parent[x];
  }
  function union(a: number, b: number) {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootA] = rootB;
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (areCompoundSiblings(offers[i], offers[j], rawBoxes[i], rawBoxes[j])) {
        union(i, j);
      }
    }
  }

  const clusterMap = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!clusterMap.has(root)) clusterMap.set(root, []);
    clusterMap.get(root)!.push(i);
  }

  // 2. Initialize clamped boxes:
  // For compound clusters (size > 1), set clampedUnionBox for every member
  // to the Full Compound Cell Union Box across ALL atomic components of ALL sibling offers in that cluster.
  const clamped: PixelBoundingBox[] = rawBoxes.map(b => ({ ...b }));

  for (const members of clusterMap.values()) {
    if (members.length > 1) {
      const allCompBoxes: NormalizedBox2D[] = [];
      for (const mIdx of members) {
        const comp = offers[mIdx].components;
        if (comp.product_graphic_box) allCompBoxes.push(comp.product_graphic_box);
        if (comp.promo_price_box) allCompBoxes.push(comp.promo_price_box);
        if (comp.original_price_box && offers[mIdx].original_price !== null) allCompBoxes.push(comp.original_price_box);
        if (comp.unit_and_size_badge_box) allCompBoxes.push(comp.unit_and_size_badge_box);
        if (comp.title_text_box) allCompBoxes.push(comp.title_text_box);
      }

      if (allCompBoxes.length > 0) {
        let yminNorm = Math.max(0, Math.min(1000, Math.min(...allCompBoxes.map(b => b[0]))));
        let xminNorm = Math.max(0, Math.min(1000, Math.min(...allCompBoxes.map(b => b[1]))));
        let ymaxNorm = Math.max(0, Math.min(1000, Math.max(...allCompBoxes.map(b => b[2]))));
        let xmaxNorm = Math.max(0, Math.min(1000, Math.max(...allCompBoxes.map(b => b[3]))));

        // Defensive spatial fallback for compound cell if all siblings lack title_text_box
        const hasAnyTitleBox = members.some(mIdx => {
          const tb = offers[mIdx].components?.title_text_box;
          return tb && tb[2] > tb[0] && tb[3] > tb[1];
        });
        if (!hasAnyTitleBox && members.some(mIdx => offers[mIdx].arabic_title || offers[mIdx].english_title)) {
          const heightNorm = ymaxNorm - yminNorm;
          ymaxNorm = Math.min(1000, ymaxNorm + Math.round(heightNorm * 0.08));
        }

        const ymin = denormalizeCoord(yminNorm, nativeHeight);
        const xmin = denormalizeCoord(xminNorm, nativeWidth);
        const ymax = denormalizeCoord(ymaxNorm, nativeHeight);
        const xmax = denormalizeCoord(xmaxNorm, nativeWidth);

        const compoundUnionBox: PixelBoundingBox = {
          xmin,
          ymin,
          xmax,
          ymax,
          width: Math.max(1, xmax - xmin),
          height: Math.max(1, ymax - ymin)
        };

        for (const mIdx of members) {
          clamped[mIdx] = { ...compoundUnionBox };
        }
      }
    }
  }

  // 3. For genuinely separate neighboring offers (NOT compound siblings / different clusters),
  // enforce Hard Core-Component Protection during Voronoi clamping.
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // NEVER run Voronoi midpoint clamping between offers in the same Compound Sibling Cluster!
      if (find(i) === find(j)) {
        continue;
      }

      const boxA = clamped[i];
      const boxB = clamped[j];
      const iou = computeBoxIoU(boxA, boxB);

      if (iou > 0.02) {
        const interXmin = Math.max(boxA.xmin, boxB.xmin);
        const interXmax = Math.min(boxA.xmax, boxB.xmax);
        const interYmin = Math.max(boxA.ymin, boxB.ymin);
        const interYmax = Math.min(boxA.ymax, boxB.ymax);

        const interArea = (interXmax > interXmin && interYmax > interYmin)
          ? (interXmax - interXmin) * (interYmax - interYmin)
          : 0;
        const minArea = Math.min(boxA.width * boxA.height, boxB.width * boxB.height);
        const areaOverlapRatio = minArea > 0 ? interArea / minArea : 0;

        // Only clamp if overlapArea / min(areaA, areaB) < 0.20
        if (areaOverlapRatio < 0.20) {
          const centerAx = (boxA.xmin + boxA.xmax) / 2;
          const centerAy = (boxA.ymin + boxA.ymax) / 2;
          const centerBx = (boxB.xmin + boxB.xmax) / 2;
          const centerBy = (boxB.ymin + boxB.ymax) / 2;

          const dx = Math.abs(centerAx - centerBx);
          const dy = Math.abs(centerAy - centerBy);

          // Get cluster members to protect all core components of both clusters
          const membersA = clusterMap.get(find(i))!.map(idx => offers[idx]);
          const membersB = clusterMap.get(find(j))!.map(idx => offers[idx]);

          const coreA = getCoreComponentPixelBounds(membersA, nativeWidth, nativeHeight);
          const coreB = getCoreComponentPixelBounds(membersB, nativeWidth, nativeHeight);

          if (dx >= dy) {
            // Horizontal neighbors
            if (centerAx < centerBx) {
              // A is left, B is right
              const rawMidX = Math.round((boxA.xmax + boxB.xmin) / 2);
              const safeA_xmax = Math.max(rawMidX, coreA.xmax);
              const safeB_xmin = Math.min(rawMidX, coreB.xmin);

              boxA.xmax = Math.min(boxA.xmax, safeA_xmax);
              boxB.xmin = Math.max(boxB.xmin, safeB_xmin);
            } else {
              // B is left, A is right
              const rawMidX = Math.round((boxB.xmax + boxA.xmin) / 2);
              const safeB_xmax = Math.max(rawMidX, coreB.xmax);
              const safeA_xmin = Math.min(rawMidX, coreA.xmin);

              boxB.xmax = Math.min(boxB.xmax, safeB_xmax);
              boxA.xmin = Math.max(boxA.xmin, safeA_xmin);
            }
          } else {
            // Vertical neighbors
            if (centerAy < centerBy) {
              // A is top, B is bottom
              const rawMidY = Math.round((boxA.ymax + boxB.ymin) / 2);
              const safeA_ymax = Math.max(rawMidY, coreA.ymax);
              const safeB_ymin = Math.min(rawMidY, coreB.ymin);

              boxA.ymax = Math.min(boxA.ymax, safeA_ymax);
              boxB.ymin = Math.max(boxB.ymin, safeB_ymin);
            } else {
              // B is top, A is bottom
              const rawMidY = Math.round((boxB.ymax + boxA.ymin) / 2);
              const safeB_ymax = Math.max(rawMidY, coreB.ymax);
              const safeA_ymin = Math.min(rawMidY, coreA.ymin);

              boxB.ymax = Math.min(boxB.ymax, safeB_ymax);
              boxA.ymin = Math.max(boxA.ymin, safeA_ymin);
            }
          }

          boxA.width = Math.max(1, boxA.xmax - boxA.xmin);
          boxA.height = Math.max(1, boxA.ymax - boxA.ymin);
          boxB.width = Math.max(1, boxB.xmax - boxB.xmin);
          boxB.height = Math.max(1, boxB.ymax - boxB.ymin);
        }
      }
    }
  }

  // Ensure boxes remain clamped inside native bounds
  return clamped.map(b => {
    const xmin = Math.max(0, Math.min(nativeWidth - 1, b.xmin));
    const ymin = Math.max(0, Math.min(nativeHeight - 1, b.ymin));
    const xmax = Math.max(xmin + 1, Math.min(nativeWidth, b.xmax));
    const ymax = Math.max(ymin + 1, Math.min(nativeHeight, b.ymax));
    return {
      xmin,
      ymin,
      xmax,
      ymax,
      width: xmax - xmin,
      height: ymax - ymin
    };
  });
}

/**
 * Computes both the full union box (with Voronoi neighbor-bleed clamping)
 * and the product thumb box for all offers on a page.
 */
export function computeOfferUnionAndThumbBoxes(
  offers: ExtractedOfferRev1[],
  nativeWidth: number,
  nativeHeight: number
): OfferCropRectangles[] {
  const rawUnionBoxes = offers.map(o => computeRawOfferUnionBox(o, nativeWidth, nativeHeight));
  const clampedUnionBoxes = clampNeighborBleed(offers, rawUnionBoxes, nativeWidth, nativeHeight);

  return offers.map((offer, idx) => {
    const unionBox = clampedUnionBoxes[idx];
    const thumbBox = denormalizeBox(offer.components.product_graphic_box, nativeWidth, nativeHeight);

    return {
      offer_number: offer.offer_number,
      union_box_px: unionBox,
      product_thumb_box_px: thumbBox
    };
  });
}

/**
 * Slices and saves both offer_card_crop.webp and product_thumb_crop.webp at full native resolution via Sharp.
 */
export async function cropAndSaveOfferAssets(
  imageInput: string | Buffer,
  cropRects: OfferCropRectangles[],
  outputDir: string,
  nativeWidth: number,
  nativeHeight: number
): Promise<OfferCropRectangles[]> {
  mkdirSync(outputDir, { recursive: true });
  const results: OfferCropRectangles[] = [];
  const processedCompoundBoxes = new Map<string, { cardCropPath: string; thumbCropPath: string }>();

  for (const rect of cropRects) {
    const boxSig = `${rect.union_box_px.xmin}_${rect.union_box_px.ymin}_${rect.union_box_px.xmax}_${rect.union_box_px.ymax}`;

    if (processedCompoundBoxes.has(boxSig)) {
      // Sibling offer in a compound multi-price cell: reuse the primary sibling's crop files
      const primaryCrops = processedCompoundBoxes.get(boxSig)!;
      results.push({
        ...rect,
        offer_card_crop_path: primaryCrops.cardCropPath,
        product_thumb_crop_path: primaryCrops.thumbCropPath
      });
      continue;
    }

    const offerPadded = String(rect.offer_number).padStart(3, '0');
    const offerSubDir = join(outputDir, `offer-${offerPadded}`);
    mkdirSync(offerSubDir, { recursive: true });

    const cardCropPath = join(offerSubDir, 'offer_card_crop.webp');
    const thumbCropPath = join(offerSubDir, 'product_thumb_crop.webp');

    // 1.5% clamped safety padding on union box
    const padX = Math.round(rect.union_box_px.width * 0.015);
    const padY = Math.round(rect.union_box_px.height * 0.015);

    const cardLeft = Math.max(0, rect.union_box_px.xmin - padX);
    const cardTop = Math.max(0, rect.union_box_px.ymin - padY);
    const cardWidth = Math.min(nativeWidth - cardLeft, rect.union_box_px.width + padX * 2);
    const cardHeight = Math.min(nativeHeight - cardTop, rect.union_box_px.height + padY * 2);

    await sharp(imageInput)
      .extract({
        left: cardLeft,
        top: cardTop,
        width: Math.max(10, cardWidth),
        height: Math.max(10, cardHeight)
      })
      .webp({ quality: 90 })
      .toFile(cardCropPath);

    // Product thumbnail crop (strictly product_graphic_box)
    const thumbLeft = Math.max(0, Math.min(nativeWidth - 10, rect.product_thumb_box_px.xmin));
    const thumbTop = Math.max(0, Math.min(nativeHeight - 10, rect.product_thumb_box_px.ymin));
    const thumbWidth = Math.min(nativeWidth - thumbLeft, rect.product_thumb_box_px.width);
    const thumbHeight = Math.min(nativeHeight - thumbTop, rect.product_thumb_box_px.height);

    await sharp(imageInput)
      .extract({
        left: thumbLeft,
        top: thumbTop,
        width: Math.max(10, thumbWidth),
        height: Math.max(10, thumbHeight)
      })
      .webp({ quality: 90 })
      .toFile(thumbCropPath);

    processedCompoundBoxes.set(boxSig, { cardCropPath, thumbCropPath });

    results.push({
      ...rect,
      offer_card_crop_path: cardCropPath,
      product_thumb_crop_path: thumbCropPath
    });
  }

  return results;
}
