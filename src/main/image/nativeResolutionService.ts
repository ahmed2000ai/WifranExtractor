import sharp from 'sharp';
import type { NormalizedBox2D, PixelBoundingBox } from '../../shared/types/leafletExtraction';

export type ComponentWithLabel = {
  id: number | string;
  box2d: NormalizedBox2D;
  classLabel?: string;
  colorHex?: string;
};

/**
 * Reads the 100% untouched native dimensions of an image.
 */
export async function getNativeDimensions(
  input: string | Buffer
): Promise<{ width: number; height: number }> {
  const metadata = await sharp(input).metadata();
  return {
    width: metadata.width || 1000,
    height: metadata.height || 1000
  };
}

/**
 * Denormalizes a 0-1000 normalized coordinate to absolute pixel coordinates.
 */
export function denormalizeCoord(coord: number, maxDimension: number): number {
  return Math.max(0, Math.min(maxDimension, Math.round((coord / 1000) * maxDimension)));
}

/**
 * Converts a [ymin, xmin, ymax, xmax] normalized box (0-1000) to PixelBoundingBox.
 */
export function denormalizeBox(
  box2d: NormalizedBox2D,
  nativeWidth: number,
  nativeHeight: number
): PixelBoundingBox {
  const [yminNorm, xminNorm, ymaxNorm, xmaxNorm] = box2d;
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
 * Slices horizontal row strips from the untouched native-resolution buffer.
 * Useful for high-density pages where badge text needs maximum optical resolution.
 */
export async function sliceRowStrips(
  imageInput: string | Buffer,
  rowBands: Array<{ yminNorm: number; ymaxNorm: number; label: string }>
): Promise<Array<{ label: string; buffer: Buffer; yminPx: number; ymaxPx: number }>> {
  const { width, height } = await getNativeDimensions(imageInput);
  const results: Array<{ label: string; buffer: Buffer; yminPx: number; ymaxPx: number }> = [];

  for (const band of rowBands) {
    const yminPx = denormalizeCoord(band.yminNorm, height);
    const ymaxPx = denormalizeCoord(band.ymaxNorm, height);
    const stripHeight = Math.max(10, ymaxPx - yminPx);

    const buffer = await sharp(imageInput)
      .extract({
        left: 0,
        top: yminPx,
        width,
        height: Math.min(stripHeight, height - yminPx)
      })
      .jpeg({ quality: 95 })
      .toBuffer();

    results.push({ label: band.label, buffer, yminPx, ymaxPx });
  }

  return results;
}

/**
 * Composites crisp Set-of-Mark (SoM) numbered badges and bounding boxes onto an image copy.
 */
export async function drawSetOfMarkOverlay(
  imageInput: string | Buffer,
  components: ComponentWithLabel[],
  options?: { strokeWidth?: number; fontSize?: number }
): Promise<Buffer> {
  const { width, height } = await getNativeDimensions(imageInput);
  const strokeWidth = options?.strokeWidth ?? Math.max(2, Math.round(width / 500));
  const fontSize = options?.fontSize ?? Math.max(14, Math.round(width / 60));

  const svgElements: string[] = [];

  for (const comp of components) {
    const box = denormalizeBox(comp.box2d, width, height);
    const color = comp.colorHex || '#FF0055';
    const label = String(comp.id);

    // Box outline
    svgElements.push(
      `<rect x="${box.xmin}" y="${box.ymin}" width="${box.width}" height="${box.height}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" />`
    );

    // Badge label background + text
    const badgeW = Math.max(28, label.length * (fontSize * 0.7) + 10);
    const badgeH = fontSize + 6;
    const badgeX = box.xmin;
    const badgeY = Math.max(0, box.ymin - badgeH);

    svgElements.push(
      `<rect x="${badgeX}" y="${badgeY}" width="${badgeW}" height="${badgeH}" fill="${color}" rx="3" />`
    );
    svgElements.push(
      `<text x="${badgeX + 4}" y="${badgeY + fontSize - 1}" font-family="sans-serif" font-weight="bold" font-size="${fontSize}" fill="#FFFFFF">${label}</text>`
    );
  }

  const svgOverlay = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    ${svgElements.join('\n')}
  </svg>`;

  return await sharp(imageInput)
    .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}
