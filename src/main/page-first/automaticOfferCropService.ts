import { join } from 'path';
import { mkdirSync } from 'fs';
import sharp from 'sharp';
import type { PageFirstExtractedOffer } from '../../shared/types/pageFirstOfferExtraction';
import type { NormalizedOcrBlock } from '../../shared/types/normalizedOcrBlock';
import type { PageOfferEvidenceLink } from '../../shared/types/pageOfferEvidenceLink';
import type { AutomaticOfferCrop, AutomaticOfferCropStrategy } from '../../shared/types/automaticOfferCrop';
import { normalizeTextForMatching } from './evidenceLinkerService';

export type CropConstructionInput = {
  pdfBaseName: string;
  pageNumber: number;
  renderedImagePath: string;
  packageDir: string;
  pageDimensions: { width: number; height: number };
  offers: PageFirstExtractedOffer[];
  blocks: NormalizedOcrBlock[];
  links: PageOfferEvidenceLink[];
  existingCropMap?: Map<string, string>; // stable source-offer-key -> existing itemNumber
  outputFormat?: 'webp' | 'jpeg' | 'png';
  outputQuality?: number;
};

export type CropConstructionResult = {
  crops: AutomaticOfferCrop[];
  cropFilePaths: Map<string, string>; // itemNumber -> absolute image path
  validCropCount: number;
  invalidCropCount: number;
};

export function buildSourceOfferKey(
  pdfBaseName: string,
  pageNumber: number,
  anchorBounds: { x: number; y: number; width: number; height: number } | null,
  title: string | null,
  offerPrice: number | null
): string {
  const normTitle = normalizeTextForMatching(title).slice(0, 30).replace(/[^a-z0-9]/g, '_');
  const priceStr = offerPrice !== null ? offerPrice.toFixed(2) : 'no_price';
  const posStr = anchorBounds
    ? `${Math.round(anchorBounds.x / 10)}_${Math.round(anchorBounds.y / 10)}`
    : 'no_pos';
  return `${pdfBaseName}_p${pageNumber}_${posStr}_${normTitle}_${priceStr}`;
}

export async function constructAutomaticOfferCrops(
  input: CropConstructionInput
): Promise<CropConstructionResult> {
  const {
    pdfBaseName,
    pageNumber,
    renderedImagePath,
    packageDir,
    pageDimensions,
    offers,
    blocks,
    links,
    existingCropMap = new Map(),
    outputFormat = 'webp',
    outputQuality = 90
  } = input;

  const pagePadded = String(pageNumber).padStart(3, '0');
  const cropsDir = packageDir ? join(packageDir, 'crops', `page-${pagePadded}`) : '';
  if (cropsDir) {
    mkdirSync(cropsDir, { recursive: true });
  }

  const blockMap = new Map(blocks.map(b => [b.block_id, b]));
  const linkMap = new Map(links.map(l => [l.temporary_offer_id, l]));

  // 1. Collect and sort offers deterministically by anchor position (top-to-bottom, left-to-right)
  const offersWithAnchors = offers.map(offer => {
    const link = linkMap.get(offer.temporary_offer_id);
    const anchorId = link?.current_price_anchor_block_id;
    const anchorBlock = anchorId ? blockMap.get(anchorId) : undefined;
    const bounds = anchorBlock?.rendered_page_bounds || null;
    const cy = bounds ? bounds.y + bounds.height / 2 : 99999;
    const cx = bounds ? bounds.x + bounds.width / 2 : 99999;

    return {
      offer,
      link,
      anchorBlock,
      anchorBounds: bounds,
      cx,
      cy
    };
  });

  // Sort offers deterministically: top-to-bottom, then left-to-right
  offersWithAnchors.sort((a, b) => {
    // Group into vertical bands of ~60px
    const yDiff = a.cy - b.cy;
    if (Math.abs(yDiff) > 60) return yDiff;
    return a.cx - b.cx;
  });

  // Map of all other anchors for neighbor exclusion
  const allAnchors = offersWithAnchors
    .filter(item => item.anchorBounds !== null)
    .map(item => ({
      offerId: item.offer.temporary_offer_id,
      bounds: item.anchorBounds!
    }));

  const crops: AutomaticOfferCrop[] = [];
  const cropFilePaths = new Map<string, string>();
  let validCropCount = 0;
  let invalidCropCount = 0;

  let offerIndex = 1;

  for (const item of offersWithAnchors) {
    const { offer, link, anchorBlock, anchorBounds } = item;
    const warnings: string[] = [];

    const offerTitle = offer.product?.title_ar || offer.product?.title_en || 'item';
    const sourceOfferKey = buildSourceOfferKey(
      pdfBaseName,
      pageNumber,
      anchorBounds,
      offerTitle,
      offer.selected_prices?.offer_price
    );

    // Stable item numbering
    let sourceItemNumber = existingCropMap.get(sourceOfferKey);
    if (!sourceItemNumber) {
      sourceItemNumber = String(offerIndex++).padStart(3, '0');
    }

    const includedBlockIds = new Set<string>();
    const includedImageIds = new Set<string>();

    let strategy: AutomaticOfferCropStrategy = 'evidence_union';
    let minX = pageDimensions.width;
    let minY = pageDimensions.height;
    let maxX = 0;
    let maxY = 0;

    if (anchorBounds) {
      includedBlockIds.add(anchorBlock!.block_id);
      minX = Math.min(minX, anchorBounds.x);
      minY = Math.min(minY, anchorBounds.y);
      maxX = Math.max(maxX, anchorBounds.x + anchorBounds.width);
      maxY = Math.max(maxY, anchorBounds.y + anchorBounds.height);
    } else {
      warnings.push('Offer has no linked current-price anchor');
      strategy = 'exception_fallback';
    }

    // Include linked evidence blocks
    if (link) {
      for (const blkId of link.linked_block_ids) {
        const blk = blockMap.get(blkId);
        if (blk && blk.rendered_page_bounds) {
          includedBlockIds.add(blkId);
          minX = Math.min(minX, blk.rendered_page_bounds.x);
          minY = Math.min(minY, blk.rendered_page_bounds.y);
          maxX = Math.max(maxX, blk.rendered_page_bounds.x + blk.rendered_page_bounds.width);
          maxY = Math.max(maxY, blk.rendered_page_bounds.y + blk.rendered_page_bounds.height);
        }
      }
    }

    // Associate nearby product-image regions
    const imageBlocks = blocks.filter(b => b.block_type === 'image');
    if (anchorBounds) {
      for (const imgBlk of imageBlocks) {
        const ib = imgBlk.rendered_page_bounds;
        if (!ib) continue;

        // Check distance to current price anchor
        const icx = ib.x + ib.width / 2;
        const icy = ib.y + ib.height / 2;
        const dist = Math.hypot(icx - item.cx, icy - item.cy);

        // Does this image belong closer to this anchor than any other anchor?
        let isClosestToThis = true;
        for (const other of allAnchors) {
          if (other.offerId === offer.temporary_offer_id) continue;
          const ocx = other.bounds.x + other.bounds.width / 2;
          const ocy = other.bounds.y + other.bounds.height / 2;
          const otherDist = Math.hypot(icx - ocx, icy - ocy);
          if (otherDist < dist) {
            isClosestToThis = false;
            break;
          }
        }

        if (isClosestToThis && dist < 450) {
          includedImageIds.add(imgBlk.block_id);
          minX = Math.min(minX, ib.x);
          minY = Math.min(minY, ib.y);
          maxX = Math.max(maxX, ib.x + ib.width);
          maxY = Math.max(maxY, ib.y + ib.height);
        }
      }
    }

    // Fallback if no bounds found
    if (minX >= maxX || minY >= maxY) {
      minX = Math.max(0, item.cx - 150);
      minY = Math.max(0, item.cy - 150);
      maxX = Math.min(pageDimensions.width, item.cx + 150);
      maxY = Math.min(pageDimensions.height, item.cy + 150);
      strategy = 'exception_fallback';
    }

    // Add safe padding (~7% of width/height)
    const padX = Math.round((maxX - minX) * 0.08);
    const padY = Math.round((maxY - minY) * 0.08);
    let boxX = Math.max(0, minX - padX);
    let boxY = Math.max(0, minY - padY);
    let boxW = (maxX - minX) + padX * 2;
    let boxH = (maxY - minY) + padY * 2;

    // Neighboring Anchor Partition constraint:
    // Crop MUST NOT contain any other offer's current-price anchor!
    for (const other of allAnchors) {
      if (other.offerId === offer.temporary_offer_id) continue;
      const ocx = other.bounds.x + other.bounds.width / 2;
      const ocy = other.bounds.y + other.bounds.height / 2;

      // Check if other anchor is inside this box
      if (ocx >= boxX && ocx <= boxX + boxW && ocy >= boxY && ocy <= boxY + boxH) {
        strategy = 'price_anchor_partition';
        // Partition edge along whichever dimension separates them best
        if (Math.abs(item.cy - ocy) > Math.abs(item.cx - ocx)) {
          // Vertical separation
          if (item.cy < ocy) {
            // This offer is above other offer -> clip bottom
            const midY = (item.cy + ocy) / 2;
            boxH = Math.max(50, midY - boxY);
          } else {
            // This offer is below other offer -> clip top
            const midY = (item.cy + ocy) / 2;
            const newY = midY;
            boxH = Math.max(50, (boxY + boxH) - newY);
            boxX = boxX;
            boxY = newY;
          }
        } else {
          // Horizontal separation
          if (item.cx < ocx) {
            // This offer is to the left -> clip right
            const midX = (item.cx + ocx) / 2;
            boxW = Math.max(50, midX - boxX);
          } else {
            // This offer is to the right -> clip left
            const midX = (item.cx + ocx) / 2;
            const newX = midX;
            boxW = Math.max(50, (boxX + boxW) - newX);
            boxX = newX;
          }
        }
      }
    }

    // Gutter refinement: clip to page bounds
    boxX = Math.max(0, Math.min(pageDimensions.width - 20, Math.round(boxX)));
    boxY = Math.max(0, Math.min(pageDimensions.height - 20, Math.round(boxY)));
    boxW = Math.max(20, Math.min(pageDimensions.width - boxX, Math.round(boxW)));
    boxH = Math.max(20, Math.min(pageDimensions.height - boxY, Math.round(boxH)));

    // Validation (Section 28)
    let cropConfidence = 0.85;
    let isValid = true;

    if (!anchorBounds) {
      isValid = false;
      cropConfidence = 0.2;
      warnings.push('Invalid crop: missing anchor');
    } else {
      // Current-price anchor must be inside
      const acx = anchorBounds.x + anchorBounds.width / 2;
      const acy = anchorBounds.y + anchorBounds.height / 2;
      if (acx < boxX || acx > boxX + boxW || acy < boxY || acy > boxY + boxH) {
        isValid = false;
        warnings.push('Invalid crop: anchor outside crop bounds');
      }
    }

    // No other anchor inside
    for (const other of allAnchors) {
      if (other.offerId === offer.temporary_offer_id) continue;
      const ocx = other.bounds.x + other.bounds.width / 2;
      const ocy = other.bounds.y + other.bounds.height / 2;
      if (ocx >= boxX && ocx <= boxX + boxW && ocy >= boxY && ocy <= boxY + boxH) {
        isValid = false;
        warnings.push(`Invalid crop: contains neighboring anchor from ${other.offerId}`);
      }
    }

    if (boxW <= 0 || boxH <= 0) {
      isValid = false;
      warnings.push('Invalid crop: zero dimension');
    }

    if (isValid) {
      validCropCount++;
    } else {
      invalidCropCount++;
    }

    const cropObj: AutomaticOfferCrop = {
      page_number: pageNumber,
      source_offer_key: sourceOfferKey,
      source_item_number: sourceItemNumber,
      bounds: {
        x: boxX,
        y: boxY,
        width: boxW,
        height: boxH
      },
      included_block_ids: Array.from(includedBlockIds),
      included_image_region_ids: Array.from(includedImageIds),
      current_price_anchor_block_id: anchorBlock?.block_id || '',
      crop_confidence: cropConfidence,
      strategy,
      warnings
    };

    crops.push(cropObj);

    // Generate physical image crop file
    if (renderedImagePath && cropsDir) {
      const ext = outputFormat === 'jpeg' ? 'jpg' : outputFormat;
      const cropFileName = `${pdfBaseName}_${pagePadded}_${sourceItemNumber}.${ext}`;
      const cropFilePath = join(cropsDir, cropFileName);

      try {
        let pipeline = sharp(renderedImagePath)
          .extract({ left: boxX, top: boxY, width: boxW, height: boxH });

        if (outputFormat === 'png') {
          pipeline = pipeline.png();
        } else if (outputFormat === 'jpeg') {
          pipeline = pipeline.jpeg({ quality: outputQuality });
        } else {
          pipeline = pipeline.webp({ quality: outputQuality });
        }

        await pipeline.toFile(cropFilePath);
        cropFilePaths.set(sourceItemNumber, cropFilePath);
      } catch (err: any) {
        console.error(`[automaticOfferCropService] Failed to write crop ${cropFileName}:`, err);
        warnings.push(`Image crop extraction failed: ${err.message}`);
      }
    }
  }

  return {
    crops,
    cropFilePaths,
    validCropCount,
    invalidCropCount
  };
}

export const AutomaticOfferCropService = {
  constructCrops: (args: {
    pageNumber: number;
    pageWidth: number;
    pageHeight: number;
    pdfBaseName: string;
    offers: PageFirstExtractedOffer[];
    evidenceLinks: PageOfferEvidenceLink[];
    ocrBlocks: NormalizedOcrBlock[];
  }): AutomaticOfferCrop[] => {
    const linkMap = new Map(args.evidenceLinks.map(l => [l.temporary_offer_id, l]));
    const blockMap = new Map(args.ocrBlocks.map(b => [b.block_id, b]));

    const offersWithAnchors = args.offers.map(offer => {
      const link = linkMap.get(offer.temporary_offer_id);
      const anchorId = link?.current_price_anchor_block_id;
      const anchorBlock = anchorId ? blockMap.get(anchorId) : undefined;
      const bounds = anchorBlock?.rendered_page_bounds || null;
      const cy = bounds ? bounds.y + bounds.height / 2 : 99999;
      const cx = bounds ? bounds.x + bounds.width / 2 : 99999;
      return { offer, link, anchorBlock, anchorBounds: bounds, cx, cy };
    });

    offersWithAnchors.sort((a, b) => {
      const yDiff = a.cy - b.cy;
      if (Math.abs(yDiff) > 60) return yDiff;
      return a.cx - b.cx;
    });

    const allAnchors = offersWithAnchors
      .filter(item => item.anchorBounds !== null)
      .map(item => ({ offerId: item.offer.temporary_offer_id, bounds: item.anchorBounds! }));

    const crops: AutomaticOfferCrop[] = [];
    let offerIndex = 1;

    for (const item of offersWithAnchors) {
      const { offer, link, anchorBlock, anchorBounds } = item;
      const warnings: string[] = [];
      const offerTitle = offer.product?.title_ar || offer.product?.title_en || 'item';
      const sourceOfferKey = buildSourceOfferKey(
        args.pdfBaseName,
        args.pageNumber,
        anchorBounds,
        offerTitle,
        offer.selected_prices?.offer_price
      );
      const sourceItemNumber = String(offerIndex++).padStart(3, '0');
      const includedBlockIds = new Set<string>();
      const includedImageIds = new Set<string>();
      let strategy: AutomaticOfferCropStrategy = 'evidence_union';
      let minX = args.pageWidth;
      let minY = args.pageHeight;
      let maxX = 0;
      let maxY = 0;

      if (anchorBounds) {
        includedBlockIds.add(anchorBlock!.block_id);
        minX = Math.min(minX, anchorBounds.x);
        minY = Math.min(minY, anchorBounds.y);
        maxX = Math.max(maxX, anchorBounds.x + anchorBounds.width);
        maxY = Math.max(maxY, anchorBounds.y + anchorBounds.height);
      } else {
        warnings.push('Offer has no linked current-price anchor');
        strategy = 'exception_fallback';
      }

      if (link) {
        for (const blkId of link.linked_block_ids) {
          const blk = blockMap.get(blkId);
          if (blk && blk.rendered_page_bounds) {
            includedBlockIds.add(blkId);
            minX = Math.min(minX, blk.rendered_page_bounds.x);
            minY = Math.min(minY, blk.rendered_page_bounds.y);
            maxX = Math.max(maxX, blk.rendered_page_bounds.x + blk.rendered_page_bounds.width);
            maxY = Math.max(maxY, blk.rendered_page_bounds.y + blk.rendered_page_bounds.height);
          }
        }
      }

      if (minX >= maxX || minY >= maxY) {
        minX = Math.max(0, item.cx - 150);
        minY = Math.max(0, item.cy - 150);
        maxX = Math.min(args.pageWidth, item.cx + 150);
        maxY = Math.min(args.pageHeight, item.cy + 150);
        strategy = 'exception_fallback';
      }

      const padX = Math.round((maxX - minX) * 0.08);
      const padY = Math.round((maxY - minY) * 0.08);
      let boxX = Math.max(0, minX - padX);
      let boxY = Math.max(0, minY - padY);
      let boxW = (maxX - minX) + padX * 2;
      let boxH = (maxY - minY) + padY * 2;

      for (const other of allAnchors) {
        if (other.offerId === offer.temporary_offer_id) continue;
        const ocx = other.bounds.x + other.bounds.width / 2;
        const ocy = other.bounds.y + other.bounds.height / 2;

        if (ocx >= boxX && ocx <= boxX + boxW && ocy >= boxY && ocy <= boxY + boxH) {
          strategy = 'price_anchor_partition';
          if (Math.abs(item.cy - ocy) > Math.abs(item.cx - ocx)) {
            if (item.cy < ocy) {
              const midY = (item.cy + ocy) / 2;
              boxH = Math.max(50, midY - boxY);
            } else {
              const midY = (item.cy + ocy) / 2;
              boxH = Math.max(50, (boxY + boxH) - midY);
              boxY = midY;
            }
          } else {
            if (item.cx < ocx) {
              const midX = (item.cx + ocx) / 2;
              boxW = Math.max(50, midX - boxX);
            } else {
              const midX = (item.cx + ocx) / 2;
              boxW = Math.max(50, (boxX + boxW) - midX);
              boxX = midX;
            }
          }
        }
      }

      boxX = Math.max(0, Math.min(args.pageWidth - 20, Math.round(boxX)));
      boxY = Math.max(0, Math.min(args.pageHeight - 20, Math.round(boxY)));
      boxW = Math.max(20, Math.min(args.pageWidth - boxX, Math.round(boxW)));
      boxH = Math.max(20, Math.min(args.pageHeight - boxY, Math.round(boxH)));

      crops.push({
        page_number: args.pageNumber,
        source_offer_key: sourceOfferKey,
        source_item_number: sourceItemNumber,
        bounds: { x: boxX, y: boxY, width: boxW, height: boxH },
        included_block_ids: Array.from(includedBlockIds),
        included_image_region_ids: Array.from(includedImageIds),
        current_price_anchor_block_id: anchorBlock?.block_id || '',
        crop_confidence: 0.9,
        strategy,
        warnings
      });
    }

    return crops;
  },
  constructAutomaticOfferCrops
};

