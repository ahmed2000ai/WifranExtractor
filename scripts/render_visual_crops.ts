import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';

export interface BoundingBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

export interface OfferComponents {
  product_graphic_box?: number[] | null;
  promo_price_box?: number[] | null;
  title_text_box?: number[] | null;
  original_price_box?: number[] | null;
  unit_and_size_badge_box?: number[] | null;
}

export interface RenderOfferItem {
  offer_number: number;
  arabic_title?: string | null;
  english_title?: string | null;
  promo_price?: number | null;
  original_price?: number | null;
  components?: OfferComponents | null;
  spatial_prominence?: {
    normalized_union_box?: number[] | null;
  } | null;
}

export interface CropEvaluationFlag {
  offer_number: number;
  component: string;
  type: 'invalid_coordinates' | 'clipped_edge' | 'zero_area' | 'missing_required';
  message: string;
}

export interface RenderResult {
  outputDir: string;
  annotatedPageImagePath: string;
  offerCrops: Array<{
    offer_number: number;
    unionCropPath?: string;
    graphicCropPath?: string;
    promoPriceCropPath?: string;
    originalPriceCropPath?: string;
    titleCropPath?: string;
    unitBadgeCropPath?: string;
    flags: CropEvaluationFlag[];
  }>;
  allFlags: CropEvaluationFlag[];
}

/**
 * Normalizes [ymin, xmin, ymax, xmax] coordinates to image pixel bounds
 */
export function boxToPixels(
  box: number[] | null | undefined,
  imgWidth: number,
  imgHeight: number
): { left: number; top: number; width: number; height: number; isValid: boolean; raw: number[] } | null {
  if (!box || box.length !== 4) return null;
  const [ymin, xmin, ymax, xmax] = box;

  if (ymin >= ymax || xmin >= xmax) {
    return { left: 0, top: 0, width: 0, height: 0, isValid: false, raw: box };
  }

  const left = Math.max(0, Math.min(imgWidth - 1, Math.round((xmin / 1000) * imgWidth)));
  const top = Math.max(0, Math.min(imgHeight - 1, Math.round((ymin / 1000) * imgHeight)));
  const right = Math.max(left + 1, Math.min(imgWidth, Math.round((xmax / 1000) * imgWidth)));
  const bottom = Math.max(top + 1, Math.min(imgHeight, Math.round((ymax / 1000) * imgHeight)));

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
    isValid: true,
    raw: box
  };
}

/**
 * Computes union bounding box of all present component boxes
 */
export function computeUnionBox(components?: OfferComponents | null): number[] | null {
  if (!components) return null;
  const boxes = [
    components.product_graphic_box,
    components.promo_price_box,
    components.title_text_box,
    components.original_price_box,
    components.unit_and_size_badge_box
  ].filter((b): b is number[] => Boolean(b && b.length === 4));

  if (boxes.length === 0) return null;

  let ymin = 1000;
  let xmin = 1000;
  let ymax = 0;
  let xmax = 0;

  for (const b of boxes) {
    if (b[0] < ymin) ymin = b[0];
    if (b[1] < xmin) xmin = b[1];
    if (b[2] > ymax) ymax = b[2];
    if (b[3] > xmax) xmax = b[3];
  }

  return [ymin, xmin, ymax, xmax];
}

/**
 * Extracts a crop from source image buffer using sharp
 */
async function extractCrop(
  imageBuffer: Buffer,
  cropArea: { left: number; top: number; width: number; height: number },
  outputPath: string
): Promise<void> {
  await sharp(imageBuffer)
    .extract({
      left: cropArea.left,
      top: cropArea.top,
      width: cropArea.width,
      height: cropArea.height
    })
    .png()
    .toFile(outputPath);
}

/**
 * Renders all component visual crops and full-page SVG annotated overlay
 */
export async function renderVisualCropsForPage(
  sourceImagePath: string,
  offers: RenderOfferItem[],
  outputDir: string,
  labelPrefix: string = 'offer'
): Promise<RenderResult> {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const imageBuffer = readFileSync(sourceImagePath);
  const metadata = await sharp(imageBuffer).metadata();
  const imgWidth = metadata.width || 1000;
  const imgHeight = metadata.height || 1000;

  const allFlags: CropEvaluationFlag[] = [];
  const offerCrops: RenderResult['offerCrops'] = [];

  // SVG components for full-page annotated image
  const svgElements: string[] = [];

  // Style colors
  const colors = {
    graphic: '#10B981', // Emerald green
    promoPrice: '#EF4444', // Red
    origPrice: '#F59E0B', // Amber
    title: '#3B82F6', // Blue
    unitBadge: '#8B5CF6', // Purple
    union: '#6B7280' // Gray dashed
  };

  for (const offer of offers) {
    const offerNum = offer.offer_number;
    const comps = offer.components || {};
    const flags: CropEvaluationFlag[] = [];
    const offerDir = join(outputDir, `${labelPrefix}_${String(offerNum).padStart(2, '0')}`);
    if (!existsSync(offerDir)) {
      mkdirSync(offerDir, { recursive: true });
    }

    const offerCropRecord: RenderResult['offerCrops'][0] = {
      offer_number: offerNum,
      flags
    };

    // 1. Union Box Crop
    const unionRaw =
      offer.spatial_prominence?.normalized_union_box || computeUnionBox(comps);
    if (unionRaw) {
      const uPix = boxToPixels(unionRaw, imgWidth, imgHeight);
      if (uPix && uPix.isValid) {
        const uPath = join(offerDir, 'union_card_crop.png');
        try {
          await extractCrop(imageBuffer, uPix, uPath);
          offerCropRecord.unionCropPath = uPath;
          svgElements.push(
            `<rect x="${uPix.left}" y="${uPix.top}" width="${uPix.width}" height="${uPix.height}" fill="none" stroke="${colors.union}" stroke-width="2" stroke-dasharray="6,4" />`
          );
        } catch (err: any) {
          flags.push({
            offer_number: offerNum,
            component: 'union',
            type: 'invalid_coordinates',
            message: `Failed extracting union crop: ${err.message}`
          });
        }
      }
    }

    // Helper for component crops
    const processComponent = async (
      name: keyof OfferComponents,
      fileName: string,
      color: string,
      labelChar: string,
      required: boolean
    ) => {
      const box = comps[name];
      if (!box) {
        if (required) {
          flags.push({
            offer_number: offerNum,
            component: name,
            type: 'missing_required',
            message: `Required component ${name} is missing.`
          });
        }
        return undefined;
      }

      const pix = boxToPixels(box, imgWidth, imgHeight);
      if (!pix || !pix.isValid) {
        flags.push({
          offer_number: offerNum,
          component: name,
          type: 'invalid_coordinates',
          message: `Coordinates for ${name} [${box.join(',')}] are invalid or reversed.`
        });
        return undefined;
      }

      // Check edge clipping
      if (box[0] <= 1 || box[1] <= 1 || box[2] >= 999 || box[3] >= 999) {
        flags.push({
          offer_number: offerNum,
          component: name,
          type: 'clipped_edge',
          message: `Component ${name} touches or crosses page margin boundary.`
        });
      }

      const cropPath = join(offerDir, fileName);
      try {
        await extractCrop(imageBuffer, pix, cropPath);

        // Add box to SVG overlay
        const strokeW = Math.max(2, Math.round(imgWidth / 600));
        const fontSize = Math.max(14, Math.round(imgWidth / 70));
        svgElements.push(
          `<g id="offer_${offerNum}_${name}">`,
          `  <rect x="${pix.left}" y="${pix.top}" width="${pix.width}" height="${pix.height}" fill="none" stroke="${color}" stroke-width="${strokeW}" />`,
          `  <rect x="${pix.left}" y="${Math.max(0, pix.top - fontSize - 4)}" width="${fontSize * 3}" height="${fontSize + 4}" fill="${color}" opacity="0.9" />`,
          `  <text x="${pix.left + 3}" y="${Math.max(fontSize, pix.top - 3)}" fill="#FFFFFF" font-size="${fontSize}" font-weight="bold" font-family="sans-serif">${labelChar}#${offerNum}</text>`,
          `</g>`
        );

        return cropPath;
      } catch (err: any) {
        flags.push({
          offer_number: offerNum,
          component: name,
          type: 'invalid_coordinates',
          message: `Failed extracting crop for ${name}: ${err.message}`
        });
        return undefined;
      }
    };

    offerCropRecord.graphicCropPath = await processComponent(
      'product_graphic_box',
      'product_graphic_crop.png',
      colors.graphic,
      'G',
      true
    );

    offerCropRecord.promoPriceCropPath = await processComponent(
      'promo_price_box',
      'promo_price_crop.png',
      colors.promoPrice,
      'P',
      true
    );

    offerCropRecord.titleCropPath = await processComponent(
      'title_text_box',
      'title_text_crop.png',
      colors.title,
      'T',
      true
    );

    offerCropRecord.originalPriceCropPath = await processComponent(
      'original_price_box',
      'original_price_crop.png',
      colors.origPrice,
      'O',
      false
    );

    offerCropRecord.unitBadgeCropPath = await processComponent(
      'unit_and_size_badge_box',
      'unit_badge_crop.png',
      colors.unitBadge,
      'U',
      false
    );

    allFlags.push(...flags);
    offerCrops.push(offerCropRecord);
  }

  // Build annotated SVG overlay
  const legendFontSize = Math.max(16, Math.round(imgWidth / 55));
  const legendSvg = `
    <g id="legend" transform="translate(20, 20)">
      <rect x="0" y="0" width="${legendFontSize * 24}" height="${legendFontSize * 7.5}" fill="#000000" opacity="0.85" rx="8" />
      <text x="15" y="${legendFontSize * 1.3}" fill="#FFFFFF" font-size="${legendFontSize * 1.1}" font-weight="bold" font-family="sans-serif">Component Legend (${offers.length} Offers)</text>
      <rect x="15" y="${legendFontSize * 2}" width="16" height="16" fill="${colors.graphic}" />
      <text x="40" y="${legendFontSize * 2 + 13}" fill="#FFFFFF" font-size="${legendFontSize * 0.9}" font-family="sans-serif">G: Product Graphic</text>
      <rect x="15" y="${legendFontSize * 3}" width="16" height="16" fill="${colors.promoPrice}" />
      <text x="40" y="${legendFontSize * 3 + 13}" fill="#FFFFFF" font-size="${legendFontSize * 0.9}" font-family="sans-serif">P: Promo Price</text>
      <rect x="15" y="${legendFontSize * 4}" width="16" height="16" fill="${colors.origPrice}" />
      <text x="40" y="${legendFontSize * 4 + 13}" fill="#FFFFFF" font-size="${legendFontSize * 0.9}" font-family="sans-serif">O: Original Price</text>
      <rect x="15" y="${legendFontSize * 5}" width="16" height="16" fill="${colors.title}" />
      <text x="40" y="${legendFontSize * 5 + 13}" fill="#FFFFFF" font-size="${legendFontSize * 0.9}" font-family="sans-serif">T: Bilingual Title</text>
      <rect x="15" y="${legendFontSize * 6}" width="16" height="16" fill="${colors.unitBadge}" />
      <text x="40" y="${legendFontSize * 6 + 13}" fill="#FFFFFF" font-size="${legendFontSize * 0.9}" font-family="sans-serif">U: Unit / Size Badge</text>
    </g>
  `;

  const fullSvg = Buffer.from(`
    <svg width="${imgWidth}" height="${imgHeight}" xmlns="http://www.w3.org/2000/svg">
      ${svgElements.join('\n')}
      ${legendSvg}
    </svg>
  `);

  const annotatedPath = join(outputDir, 'full_page_annotated.jpg');
  await sharp(imageBuffer)
    .composite([{ input: fullSvg, top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toFile(annotatedPath);

  return {
    outputDir,
    annotatedPageImagePath: annotatedPath,
    offerCrops,
    allFlags
  };
}

