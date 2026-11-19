/**
 * WIFRAN-EXTRACTOR-IDENTITY-005H-B2-PREP
 * Simplified Verified Leaflet Date Metadata Resolver.
 *
 * Resolution rules (strict):
 * 1. Verified operator-supplied dates (`offerStartDate`, `offerEndDate`).
 * 2. Verified operator `manifest.json` `offer_dates` (`valid_from`, `valid_to`).
 * 3. Verified cover-page extraction (`validity_start_date`, `validity_end_date`).
 *
 * Strictly NEVER infers dates from folder names / leaflet slugs and NEVER synthesizes
 * placeholder default dates. Historical leaflets remain valid for isolated offline
 * extraction-accuracy evaluation, while `evaluateHistoricalLeafletDateStatus` marks
 * expired leaflets ineligible for live consumer publication (`EXPIRED_OFFER_DATES`).
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { isValidCalendarDateIso } from '../../../shared/utils/nonCatalogPublicationPolicy';

export type LeafletDateSource =
  | 'operator_supplied'
  | 'operator_manifest'
  | 'verified_cover_page'
  | 'unresolved';

export interface ManifestOfferDates {
  valid_from?: string | null;
  valid_to?: string | null;
}

export interface ResolveLeafletDateInput {
  offerStartDate?: string | null;
  offerEndDate?: string | null;
  manifestPath?: string | null;
  pageImagePath?: string | null;
  manifestOfferDates?: ManifestOfferDates | null;
  coverPageValidityStartDate?: string | null;
  coverPageValidityEndDate?: string | null;
  isVerifiedCoverPage?: boolean;
  pageNumber?: number;
}

export interface ResolvedLeafletDateMetadata {
  offerStartDate: string | null;
  offerEndDate: string | null;
  source: LeafletDateSource;
  resolved: boolean;
  manifestPathUsed: string | null;
  reason: string | null;
}

export interface HistoricalLeafletDateStatus {
  hasValidRange: boolean;
  isExpiredForPublication: boolean;
  usableInOfflineAccuracyEvaluation: boolean;
  eligibleForConsumerPublication: boolean;
  publicationReferenceDateIso: string;
  quarantineCode: 'EXPIRED_OFFER_DATES' | 'MISSING_CRITICAL_OFFER_DATES' | 'INVALID_OFFER_DATE_RANGE' | null;
}

function normalizeValidDatePair(
  rawStart?: string | null,
  rawEnd?: string | null
): { start: string; end: string } | null {
  const start = rawStart ? String(rawStart).trim() : '';
  const end = rawEnd ? String(rawEnd).trim() : '';
  if (!start || !end) return null;
  if (!isValidCalendarDateIso(start) || !isValidCalendarDateIso(end)) return null;
  if (end < start) return null;
  return { start, end };
}

function locateManifestPath(input: ResolveLeafletDateInput): string | null {
  if (input.manifestPath && existsSync(input.manifestPath)) {
    return resolve(input.manifestPath);
  }
  if (!input.pageImagePath) return null;
  const pageDir = dirname(resolve(input.pageImagePath));
  const candidates = [
    join(pageDir, 'manifest.json'),
    join(dirname(pageDir), 'manifest.json')
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function readOfferDatesFromManifestFile(manifestPath: string): ManifestOfferDates | null {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      offer_dates?: ManifestOfferDates;
    };
    return parsed?.offer_dates ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolves leaflet validity dates strictly from trusted operator metadata or verified cover-page extraction.
 * Folder names, leaflet slugs, and fallback date heuristics are intentionally ignored.
 */
export function resolveLeafletDateMetadata(
  input: ResolveLeafletDateInput
): ResolvedLeafletDateMetadata {
  const operatorPair = normalizeValidDatePair(input.offerStartDate, input.offerEndDate);
  if (operatorPair) {
    return {
      offerStartDate: operatorPair.start,
      offerEndDate: operatorPair.end,
      source: 'operator_supplied',
      resolved: true,
      manifestPathUsed: null,
      reason: null
    };
  }

  let manifestDates = input.manifestOfferDates ?? null;
  let manifestPathUsed: string | null = null;
  if (!manifestDates) {
    manifestPathUsed = locateManifestPath(input);
    if (manifestPathUsed) {
      manifestDates = readOfferDatesFromManifestFile(manifestPathUsed);
    }
  }
  const manifestPair = normalizeValidDatePair(
    manifestDates?.valid_from,
    manifestDates?.valid_to
  );
  if (manifestPair) {
    return {
      offerStartDate: manifestPair.start,
      offerEndDate: manifestPair.end,
      source: 'operator_manifest',
      resolved: true,
      manifestPathUsed,
      reason: null
    };
  }

  const coverEligible = input.isVerifiedCoverPage === true || input.pageNumber === 1;
  if (coverEligible) {
    const coverPair = normalizeValidDatePair(
      input.coverPageValidityStartDate,
      input.coverPageValidityEndDate
    );
    if (coverPair) {
      return {
        offerStartDate: coverPair.start,
        offerEndDate: coverPair.end,
        source: 'verified_cover_page',
        resolved: true,
        manifestPathUsed: null,
        reason: null
      };
    }
  }

  return {
    offerStartDate: null,
    offerEndDate: null,
    source: 'unresolved',
    resolved: false,
    manifestPathUsed,
    reason: 'MISSING_VERIFIED_LEAFLET_DATES'
  };
}

/**
 * Separates historical offline accuracy usability from real-world consumer publication eligibility.
 * Historical leaflets remain runnable in isolated extraction tests while expired dates block consumer publication.
 */
export function evaluateHistoricalLeafletDateStatus(input: {
  offerStartDate?: string | null;
  offerEndDate?: string | null;
  publicationReferenceDateIso?: string | null;
}): HistoricalLeafletDateStatus {
  const refDate =
    input.publicationReferenceDateIso &&
    isValidCalendarDateIso(input.publicationReferenceDateIso)
      ? String(input.publicationReferenceDateIso).trim()
      : new Date().toISOString().slice(0, 10);

  const start = input.offerStartDate ? String(input.offerStartDate).trim() : '';
  const end = input.offerEndDate ? String(input.offerEndDate).trim() : '';

  if (!start || !end || !isValidCalendarDateIso(start) || !isValidCalendarDateIso(end)) {
    return {
      hasValidRange: false,
      isExpiredForPublication: false,
      usableInOfflineAccuracyEvaluation: false,
      eligibleForConsumerPublication: false,
      publicationReferenceDateIso: refDate,
      quarantineCode: 'MISSING_CRITICAL_OFFER_DATES'
    };
  }
  if (end < start) {
    return {
      hasValidRange: false,
      isExpiredForPublication: false,
      usableInOfflineAccuracyEvaluation: false,
      eligibleForConsumerPublication: false,
      publicationReferenceDateIso: refDate,
      quarantineCode: 'INVALID_OFFER_DATE_RANGE'
    };
  }

  const isExpired = end < refDate;
  return {
    hasValidRange: true,
    isExpiredForPublication: isExpired,
    usableInOfflineAccuracyEvaluation: true,
    eligibleForConsumerPublication: !isExpired,
    publicationReferenceDateIso: refDate,
    quarantineCode: isExpired ? 'EXPIRED_OFFER_DATES' : null
  };
}
