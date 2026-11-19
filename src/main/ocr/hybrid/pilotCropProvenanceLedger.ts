/**
 * WIFRAN-EXTRACTOR-IDENTITY-005H (WP7-B)
 * Immutable Pilot Crop Provenance Ledger & Strict Crop Source-Lineage Guard.
 *
 * Establishes cryptographic and structural traceability across all 12 saved 005E
 * crop assets, 4 audited pilot pages, and raw JSON response archives without altering
 * any historical 005E artifact files.
 */

import type { OfferContractV3Record } from '../../../shared/types/extractorContractV3';
import type { CropLineageMetadata } from '../../../shared/types/hybridExtractionV3';

export interface PilotCropProvenanceEntry {
  readonly slotIndex: number;
  readonly manifestSlotId: string;
  readonly sourceOfferId: string;
  readonly leafletId: string;
  readonly pageNumber: number;
  readonly retailer: string;
  readonly legacyMetadataOfferNumber: number;
  readonly pagePassCorrespondenceOfferNumber: number | null;
  readonly sourcePageImagePath: string | null;
  readonly sourcePageWidth: number | null;
  readonly sourcePageHeight: number | null;
  readonly cropImagePath: string;
  readonly cropWidth: number;
  readonly cropHeight: number;
  readonly assetBytes: number;
  readonly assetSha256: string;
  readonly rawResponseArchivePath: string;
  readonly rawResponseSha256: string;
  readonly inFourPageOverlapSet: boolean;
  readonly historicalNote: string | null;
}

function freezeEntry(entry: PilotCropProvenanceEntry): PilotCropProvenanceEntry {
  return Object.freeze(entry);
}

/**
 * Immutable provenance ledger for all 12 crop slots in Extracts/pilot_v3_005e/manifest.json.
 */
export const PILOT_005E_CROP_PROVENANCE_LEDGER: readonly PilotCropProvenanceEntry[] =
  Object.freeze([
    freezeEntry({
      slotIndex: 0,
      manifestSlotId: 'pilot_crop_01_baskin_robbins',
      sourceOfferId: 'Panda_Test_p002_007',
      leafletId: 'panda-national-national-2026-10-20',
      pageNumber: 2,
      retailer: 'Panda',
      legacyMetadataOfferNumber: 7,
      pagePassCorrespondenceOfferNumber: 5,
      sourcePageImagePath: 'Extracts/Panda_Test/pages/page.2.png',
      sourcePageWidth: 2067,
      sourcePageHeight: 2923,
      cropImagePath: 'Extracts/Panda_Test/metadata/rev1/page-002/crops/offer-007/offer_card_crop.webp',
      cropWidth: 648,
      cropHeight: 557,
      assetBytes: 46892,
      assetSha256: '82d0372b1a68edc934ef37a83ebb159b9d4cfacd1b4e0555f8c247796c29e0ae',
      rawResponseArchivePath: 'Extracts/pilot_v3_005e/responses/pilot_crop_01_baskin_robbins.raw.json',
      rawResponseSha256: '080c840b315581a7ce7be3996e355e99283519e83fa6b15ec882e6f756cf8bd8',
      inFourPageOverlapSet: true,
      historicalNote: 'Overlaps with Panda p2 page-pass offer #5 (Baskin Robbins) in 005E raw response numbering.'
    }),
    freezeEntry({
      slotIndex: 1,
      manifestSlotId: 'pilot_crop_02_moussy',
      sourceOfferId: 'Panda_Test_p002_011',
      leafletId: 'panda-national-national-2026-10-20',
      pageNumber: 2,
      retailer: 'Panda',
      legacyMetadataOfferNumber: 11,
      pagePassCorrespondenceOfferNumber: 8,
      sourcePageImagePath: 'Extracts/Panda_Test/pages/page.2.png',
      sourcePageWidth: 2067,
      sourcePageHeight: 2923,
      cropImagePath: 'Extracts/Panda_Test/metadata/rev1/page-002/crops/offer-011/offer_card_crop.webp',
      cropWidth: 660,
      cropHeight: 649,
      assetBytes: 62156,
      assetSha256: '7ed0cbc7d043028a5b934d158fae205a03d34e937ca330533d799e59418e6729',
      rawResponseArchivePath: 'Extracts/pilot_v3_005e/responses/pilot_crop_02_moussy.raw.json',
      rawResponseSha256: 'a2eed607d6d9a1c89e3db695a54085145c43b92f4482876739a23c5a02364e79',
      inFourPageOverlapSet: true,
      historicalNote: 'Overlaps with Panda p2 page-pass offer #8 (Moussy) in 005E raw response numbering.'
    }),
    freezeEntry({
      slotIndex: 2,
      manifestSlotId: 'pilot_crop_03_al_arabi_shams',
      sourceOfferId: 'Panda_Test_p001_008',
      leafletId: 'panda-national-national-2026-10-20',
      pageNumber: 1,
      retailer: 'Panda',
      legacyMetadataOfferNumber: 8,
      pagePassCorrespondenceOfferNumber: null,
      sourcePageImagePath: 'Extracts/Panda_Test/pages/page.1.png',
      sourcePageWidth: null,
      sourcePageHeight: null,
      cropImagePath: 'Extracts/Panda_Test/metadata/rev1/page-001/crops/offer-008/offer_card_crop.webp',
      cropWidth: 946,
      cropHeight: 536,
      assetBytes: 79394,
      assetSha256: '3ed3ae87c047eb00a69949d12cc4e0e8df0ed6bbc13dce7bf97fd40ed8324872',
      rawResponseArchivePath: 'Extracts/pilot_v3_005e/responses/pilot_crop_03_al_arabi_shams.raw.json',
      rawResponseSha256: 'e4fb8e703bbc650bcf77bfb9602f198279415033bb299e01b07edef28b8d9466',
      inFourPageOverlapSet: false,
      historicalNote: 'Panda p1 was not included in the 4-page 005E page-pass fixture.'
    }),
    freezeEntry({
      slotIndex: 3,
      manifestSlotId: 'pilot_crop_04_al_khair_plyms',
      sourceOfferId: 'Panda_Test_p001_007',
      leafletId: 'panda-national-national-2026-10-20',
      pageNumber: 1,
      retailer: 'Panda',
      legacyMetadataOfferNumber: 7,
      pagePassCorrespondenceOfferNumber: null,
      sourcePageImagePath: 'Extracts/Panda_Test/pages/page.1.png',
      sourcePageWidth: null,
      sourcePageHeight: null,
      cropImagePath: 'Extracts/Panda_Test/metadata/rev1/page-001/crops/offer-007/offer_card_crop.webp',
      cropWidth: 780,
      cropHeight: 574,
      assetBytes: 59526,
      assetSha256: 'f5f9ae333ac8b764d9f7de38386d870700ec8f61ed3ac6182e28ab4532a5ab8d',
      rawResponseArchivePath: 'Extracts/pilot_v3_005e/responses/pilot_crop_04_al_khair_plyms.raw.json',
      rawResponseSha256: '97445bb464cf2c0a009fa0edae723bdbe49bf0aecc612d307cbfb268f4139ce2',
      inFourPageOverlapSet: false,
      historicalNote: 'Panda p1 was not included in the 4-page 005E page-pass fixture.'
    }),
    freezeEntry({
      slotIndex: 4,
      manifestSlotId: 'pilot_crop_05_abu_kass',
      sourceOfferId: 'BNDW_Test_p004_001',
      leafletId: 'bin-dawood-national-national-2026-10-20',
      pageNumber: 4,
      retailer: 'BinDawood',
      legacyMetadataOfferNumber: 1,
      pagePassCorrespondenceOfferNumber: 1,
      sourcePageImagePath: 'Extracts/BNDW_Test/pages/page.4.png',
      sourcePageWidth: 2067,
      sourcePageHeight: 2923,
      cropImagePath: 'Extracts/BNDW_Test/metadata/rev1/page-004/crops/offer-001/offer_card_crop.webp',
      cropWidth: 484,
      cropHeight: 542,
      assetBytes: 61824,
      assetSha256: 'df45a9a3b088227b171c353d7d25640df57fb6e97bb07a4f8d27f50371c57283',
      rawResponseArchivePath: 'Extracts/pilot_v3_005e/responses/pilot_crop_05_abu_kass.raw.json',
      rawResponseSha256: 'e42d05e1c7678d17602531854aa045eb723cbe0627c8cd56f2aa17253b01fd6b',
      inFourPageOverlapSet: true,
      historicalNote: null
    }),
    freezeEntry({
      slotIndex: 5,
      manifestSlotId: 'pilot_crop_06_tide_partial_negative',
      sourceOfferId: 'BNDW_Test_p004_011',
      leafletId: 'bin-dawood-national-national-2026-10-20',
      pageNumber: 4,
      retailer: 'BinDawood',
      legacyMetadataOfferNumber: 11,
      pagePassCorrespondenceOfferNumber: 8,
      sourcePageImagePath: 'Extracts/BNDW_Test/pages/page.4.png',
      sourcePageWidth: 2067,
      sourcePageHeight: 2923,
      cropImagePath: 'Extracts/BNDW_Test/metadata/rev1/page-004/crops/offer-011/offer_card_crop.webp',
      cropWidth: 461,
      cropHeight: 575,
      assetBytes: 52834,
      assetSha256: 'd921786d4a84f2850d9219dd2a30ce3686bbc2786263eed9ef039a4be9234566',
      rawResponseArchivePath: 'Extracts/pilot_v3_005e/responses/pilot_crop_06_tide_partial_negative.raw.json',
      rawResponseSha256: '6f22cd02714b38058ca1970207f68d7b124e2cc772e934663e5424f886ffd698',
      inFourPageOverlapSet: true,
      historicalNote: 'Overlaps with BNDW p4 page-pass offer #8 in 005E visual numbering.'
    }),
    freezeEntry({
      slotIndex: 6,
      manifestSlotId: 'pilot_crop_07_persil_sku_negative',
      sourceOfferId: 'BNDW_Test_p004_012',
      leafletId: 'bin-dawood-national-national-2026-10-20',
      pageNumber: 4,
      retailer: 'BinDawood',
      legacyMetadataOfferNumber: 12,
      pagePassCorrespondenceOfferNumber: 12,
      sourcePageImagePath: 'Extracts/BNDW_Test/pages/page.4.png',
      sourcePageWidth: 2067,
      sourcePageHeight: 2923,
      cropImagePath: 'Extracts/BNDW_Test/metadata/rev1/page-004/crops/offer-012/offer_card_crop.webp',
      cropWidth: 484,
      cropHeight: 560,
      assetBytes: 50118,
      assetSha256: 'f869263488e0aedb5d7eb6ef4e5160989fd3f623ced707a8ec0d420c697cdbae',
      rawResponseArchivePath: 'Extracts/pilot_v3_005e/responses/pilot_crop_07_persil_sku_negative.raw.json',
      rawResponseSha256: 'aef0d8ae56f1b43f140b9d1a2df529134747cc2a6197e50c056f0adc3c6d265d',
      inFourPageOverlapSet: true,
      historicalNote: null
    }),
    freezeEntry({
      slotIndex: 7,
      manifestSlotId: 'pilot_crop_08_fakieh_compound',
      sourceOfferId: 'noori-supermarket-229798534-jeddah_p001_002',
      leafletId: 'noori-jeddah-2026-11-15',
      pageNumber: 1,
      retailer: 'Noori Supermarket',
      legacyMetadataOfferNumber: 2,
      pagePassCorrespondenceOfferNumber: 2,
      sourcePageImagePath: 'Extracts/noori-supermarket-229798534-jeddah/pages/page.1.png',
      sourcePageWidth: 2066,
      sourcePageHeight: 2923,
      cropImagePath: 'Extracts/noori-supermarket-229798534-jeddah/metadata/rev1/page-001/crops/offer-002/offer_card_crop.webp',
      cropWidth: 600,
      cropHeight: 505,
      assetBytes: 50206,
      assetSha256: 'c297a98f0db95222b8fdded397eb0d80c6e90097cc360f8b74106cb9febe8fc8',
      rawResponseArchivePath: 'Extracts/pilot_v3_005e/responses/pilot_crop_08_fakieh_compound.raw.json',
      rawResponseSha256: 'eb1905d1f301ac59e461b0c96300098c3e219d620429186680c981bcb5f7a6d3',
      inFourPageOverlapSet: true,
      historicalNote:
        'Audited WP7-B discrepancy: 005G Markdown report misnamed this slot as pilot_crop_12_noori_compound_weight; actual evaluated JSON was pilot_crop_08_fakieh_compound.raw.json.'
    }),
    freezeEntry({
      slotIndex: 8,
      manifestSlotId: 'pilot_crop_09_softy_arabic_only_bonus',
      sourceOfferId: 'noori-supermarket-229798534-jeddah_p001_009',
      leafletId: 'noori-jeddah-2026-11-15',
      pageNumber: 1,
      retailer: 'Noori Supermarket',
      legacyMetadataOfferNumber: 9,
      pagePassCorrespondenceOfferNumber: 8,
      sourcePageImagePath: 'Extracts/noori-supermarket-229798534-jeddah/pages/page.1.png',
      sourcePageWidth: 2066,
      sourcePageHeight: 2923,
      cropImagePath: 'Extracts/noori-supermarket-229798534-jeddah/metadata/rev1/page-001/crops/offer-009/offer_card_crop.webp',
      cropWidth: 592,
      cropHeight: 490,
      assetBytes: 35178,
      assetSha256: '64a3ff82f8b314baf3eff2a43dc5393e99f5b737563592166028ffae37d3f84f',
      rawResponseArchivePath: 'Extracts/pilot_v3_005e/responses/pilot_crop_09_softy_arabic_only_bonus.raw.json',
      rawResponseSha256: '8ffc2540499b2cfe218eb8f6333b2d9d7bc611f693e8a5531867557e7199aaf7',
      inFourPageOverlapSet: true,
      historicalNote: 'Overlaps with Noori p1 page-pass offer #8 (Softy) in 005E visual numbering.'
    }),
    freezeEntry({
      slotIndex: 9,
      manifestSlotId: 'pilot_crop_10_wafir_conflict_negative',
      sourceOfferId: 'noori-supermarket-229798534-jeddah_p001_008',
      leafletId: 'noori-jeddah-2026-11-15',
      pageNumber: 1,
      retailer: 'Noori Supermarket',
      legacyMetadataOfferNumber: 8,
      pagePassCorrespondenceOfferNumber: 7,
      sourcePageImagePath: 'Extracts/noori-supermarket-229798534-jeddah/pages/page.1.png',
      sourcePageWidth: 2066,
      sourcePageHeight: 2923,
      cropImagePath: 'Extracts/noori-supermarket-229798534-jeddah/metadata/rev1/page-001/crops/offer-008/offer_card_crop.webp',
      cropWidth: 538,
      cropHeight: 493,
      assetBytes: 41650,
      assetSha256: '66d6ec00e804a9fafaf443c9fed94adb6aba4018bd95fceb4b3e45f3648f05cd',
      rawResponseArchivePath: 'Extracts/pilot_v3_005e/responses/pilot_crop_10_wafir_conflict_negative.raw.json',
      rawResponseSha256: 'c24a9c2419be6500476fad57b0e71a50305f6a2d43b4cc80a22a5c69230a543b',
      inFourPageOverlapSet: true,
      historicalNote:
        'Wafir negative conflict card: legacy crop index #8 corresponds to 005E page-pass visual card #7.'
    }),
    freezeEntry({
      slotIndex: 10,
      manifestSlotId: 'pilot_crop_11_fakieh_multibuy_en_ar_conflict',
      sourceOfferId: 'Alwafa_Test_p001_007',
      leafletId: 'alwafa-city-jeddah-2026-10-20',
      pageNumber: 1,
      retailer: 'AlWafa',
      legacyMetadataOfferNumber: 7,
      pagePassCorrespondenceOfferNumber: 4,
      sourcePageImagePath: 'Extracts/Alwafa_Test/pages/page.1.png',
      sourcePageWidth: 2067,
      sourcePageHeight: 2923,
      cropImagePath: 'Extracts/Alwafa_Test/metadata/rev1/page-001/crops/offer-007/offer_card_crop.webp',
      cropWidth: 518,
      cropHeight: 389,
      assetBytes: 53984,
      assetSha256: 'af284dce76caa6fd8c75e8a3ef6f643fb16012ca2df5d0bcc1db2ecb788db71b',
      rawResponseArchivePath: 'Extracts/pilot_v3_005e/responses/pilot_crop_11_fakieh_multibuy_en_ar_conflict.raw.json',
      rawResponseSha256: '04cf4037efbd5c9bdf245292ad954c7bc8fef6e860e8d6240d98a42dea0209bb',
      inFourPageOverlapSet: true,
      historicalNote: 'Overlaps with AlWafa p1 page-pass offer #4 (Fakieh multibuy) in 005E raw response numbering.'
    }),
    freezeEntry({
      slotIndex: 11,
      manifestSlotId: 'pilot_crop_12_perinna_non_grocery_negative',
      sourceOfferId: 'Alwafa_Test_p003_014',
      leafletId: 'alwafa-city-jeddah-2026-10-20',
      pageNumber: 3,
      retailer: 'AlWafa',
      legacyMetadataOfferNumber: 14,
      pagePassCorrespondenceOfferNumber: null,
      sourcePageImagePath: 'Extracts/Alwafa_Test/pages/page.3.png',
      sourcePageWidth: null,
      sourcePageHeight: null,
      cropImagePath: 'Extracts/Alwafa_Test/metadata/rev1/page-003/crops/offer-014/offer_card_crop.webp',
      cropWidth: 409,
      cropHeight: 398,
      assetBytes: 32820,
      assetSha256: '48eecac3e224e613d2b2672f28868c1be705ef17651c6af8a2d8d778a6967997',
      rawResponseArchivePath: 'Extracts/pilot_v3_005e/responses/pilot_crop_12_perinna_non_grocery_negative.raw.json',
      rawResponseSha256: 'c85f479b32c1863208c7e039ce64382d892293362f443f71aa939c48547f2a2b',
      inFourPageOverlapSet: false,
      historicalNote: 'AlWafa p3 was not included in the 4-page 005E page-pass fixture.'
    })
  ]);

export function findPilotCropProvenanceBySlotId(
  slotId: string
): PilotCropProvenanceEntry | undefined {
  return PILOT_005E_CROP_PROVENANCE_LEDGER.find((entry) => entry.manifestSlotId === slotId);
}

export interface CropSourceLineageCheckInput {
  expectedSourceOfferId: string;
  expectedLeafletId: string;
  expectedPageNumber: number;
  expectedOfferNumber: number;
  expectedSourcePageImagePath?: string | null;
  cropLineage: CropLineageMetadata | null;
  cropCards: OfferContractV3Record[];
  /**
   * Optional explicit audited override for historical 005E crops whose legacy rev1
   * folder number differs from V3 full-page visual order. Must match exact asset SHA-256.
   */
  auditedPilotManifestSlotId?: string | null;
}

export interface CropSourceLineageCheckResult {
  verified: boolean;
  rejectionReason: string | null;
  matchedAuditSlotId: string | null;
}

function normalizePathSlashes(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .toLowerCase();
}

/**
 * Strictly validates that returned crop evidence belongs to the target page card.
 * Rejects name-only or cross-page/cross-leaflet/cross-offer mismatches fail-closed.
 */
export function verifyCropSourceLineage(
  input: CropSourceLineageCheckInput
): CropSourceLineageCheckResult {
  const {
    expectedSourceOfferId,
    expectedLeafletId,
    expectedPageNumber,
    expectedOfferNumber,
    expectedSourcePageImagePath,
    cropLineage,
    cropCards,
    auditedPilotManifestSlotId
  } = input;

  if (!cropLineage) {
    return {
      verified: false,
      rejectionReason: 'LINEAGE_METADATA_MISSING: cropLineage is required before merging crop evidence.',
      matchedAuditSlotId: null
    };
  }

  if (!cropLineage.geometryValid) {
    return {
      verified: false,
      rejectionReason: `INVALID_CROP_GEOMETRY: ${cropLineage.geometryIssues.join('; ') || 'geometryValid=false'}`,
      matchedAuditSlotId: null
    };
  }

  const slotId = auditedPilotManifestSlotId || cropLineage.manifestSlotId || null;
  const auditEntry = slotId ? findPilotCropProvenanceBySlotId(slotId) : undefined;

  if (slotId && !auditEntry) {
    return {
      verified: false,
      rejectionReason: `UNKNOWN_PILOT_MANIFEST_SLOT: "${slotId}" is not in immutable PILOT_005E_CROP_PROVENANCE_LEDGER.`,
      matchedAuditSlotId: null
    };
  }

  if (auditEntry) {
    if (auditEntry.leafletId !== expectedLeafletId) {
      return {
        verified: false,
        rejectionReason: `LINEAGE_LEAFLET_MISMATCH: audit slot "${auditEntry.manifestSlotId}" belongs to "${auditEntry.leafletId}", expected "${expectedLeafletId}".`,
        matchedAuditSlotId: auditEntry.manifestSlotId
      };
    }
    if (auditEntry.pageNumber !== expectedPageNumber) {
      return {
        verified: false,
        rejectionReason: `LINEAGE_PAGE_MISMATCH: audit slot "${auditEntry.manifestSlotId}" belongs to page ${auditEntry.pageNumber}, expected page ${expectedPageNumber}.`,
        matchedAuditSlotId: auditEntry.manifestSlotId
      };
    }
    const allowedOfferMatch =
      auditEntry.legacyMetadataOfferNumber === expectedOfferNumber ||
      auditEntry.pagePassCorrespondenceOfferNumber === expectedOfferNumber ||
      auditEntry.sourceOfferId === expectedSourceOfferId;
    if (!allowedOfferMatch) {
      return {
        verified: false,
        rejectionReason: `LINEAGE_OFFER_MISMATCH: audit slot "${auditEntry.manifestSlotId}" (${auditEntry.sourceOfferId}) does not correspond to ${expectedSourceOfferId} (#${expectedOfferNumber}).`,
        matchedAuditSlotId: auditEntry.manifestSlotId
      };
    }
    if (
      cropLineage.rawResponseSha256 &&
      cropLineage.rawResponseSha256.toLowerCase() !== auditEntry.rawResponseSha256.toLowerCase()
    ) {
      return {
        verified: false,
        rejectionReason: `LINEAGE_RAW_RESPONSE_SHA256_MISMATCH: rawResponseSha256=${cropLineage.rawResponseSha256} does not match ledger=${auditEntry.rawResponseSha256}.`,
        matchedAuditSlotId: auditEntry.manifestSlotId
      };
    }
    const isUsingHistoricalCropAsset =
      !cropLineage.cropImagePath ||
      normalizePathSlashes(cropLineage.cropImagePath) ===
        normalizePathSlashes(auditEntry.cropImagePath);
    if (
      isUsingHistoricalCropAsset &&
      cropLineage.cropSha256 &&
      cropLineage.cropSha256.toLowerCase() !== auditEntry.assetSha256.toLowerCase()
    ) {
      return {
        verified: false,
        rejectionReason: `LINEAGE_SHA256_MISMATCH: cropSha256=${cropLineage.cropSha256} does not match ledger assetSha256=${auditEntry.assetSha256}.`,
        matchedAuditSlotId: auditEntry.manifestSlotId
      };
    }
  } else {
    if (cropLineage.parentSourceOfferId !== expectedSourceOfferId) {
      return {
        verified: false,
        rejectionReason: `LINEAGE_PARENT_OFFER_MISMATCH: lineage parent="${cropLineage.parentSourceOfferId}" != expected="${expectedSourceOfferId}".`,
        matchedAuditSlotId: null
      };
    }
    if (
      cropLineage.expectedLeafletId &&
      cropLineage.expectedLeafletId !== expectedLeafletId
    ) {
      return {
        verified: false,
        rejectionReason: `LINEAGE_LEAFLET_MISMATCH: lineage leaflet="${cropLineage.expectedLeafletId}" != expected="${expectedLeafletId}".`,
        matchedAuditSlotId: null
      };
    }
    if (
      cropLineage.expectedPageNumber != null &&
      cropLineage.expectedPageNumber !== expectedPageNumber
    ) {
      return {
        verified: false,
        rejectionReason: `LINEAGE_PAGE_MISMATCH: lineage page=${cropLineage.expectedPageNumber} != expected=${expectedPageNumber}.`,
        matchedAuditSlotId: null
      };
    }
    if (
      cropLineage.expectedOfferNumber != null &&
      expectedOfferNumber > 0 &&
      cropLineage.expectedOfferNumber !== expectedOfferNumber
    ) {
      return {
        verified: false,
        rejectionReason: `LINEAGE_OFFER_NUMBER_MISMATCH: lineage offer=${cropLineage.expectedOfferNumber} != expected=${expectedOfferNumber}.`,
        matchedAuditSlotId: null
      };
    }
    if (
      expectedSourcePageImagePath &&
      normalizePathSlashes(cropLineage.sourcePageImagePath) !==
        normalizePathSlashes(expectedSourcePageImagePath)
    ) {
      return {
        verified: false,
        rejectionReason: `LINEAGE_PAGE_IMAGE_MISMATCH: lineage page image="${cropLineage.sourcePageImagePath}" != expected="${expectedSourcePageImagePath}".`,
        matchedAuditSlotId: null
      };
    }
  }

  // Verify returned crop cards do not explicitly claim a different leaflet or page number
  for (const cropCard of cropCards) {
    const cardLeaflet = cropCard.source_card.leaflet_id;
    const cardPage = cropCard.source_card.page_number;
    if (cardLeaflet && cardLeaflet !== expectedLeafletId && cardLeaflet !== 'crop_verification') {
      return {
        verified: false,
        rejectionReason: `CROP_CARD_LEAFLET_MISMATCH: crop card "${cropCard.source_card.source_offer_id}" reports leaflet "${cardLeaflet}", expected "${expectedLeafletId}".`,
        matchedAuditSlotId: auditEntry?.manifestSlotId ?? null
      };
    }
    if (typeof cardPage === 'number' && cardPage > 0 && cardPage !== expectedPageNumber) {
      return {
        verified: false,
        rejectionReason: `CROP_CARD_PAGE_MISMATCH: crop card "${cropCard.source_card.source_offer_id}" reports page ${cardPage}, expected page ${expectedPageNumber}.`,
        matchedAuditSlotId: auditEntry?.manifestSlotId ?? null
      };
    }
  }

  return {
    verified: true,
    rejectionReason: null,
    matchedAuditSlotId: auditEntry?.manifestSlotId ?? null
  };
}
