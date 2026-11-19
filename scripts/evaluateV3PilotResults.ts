import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import {
  decodeV3PageExtractionToOfferCards,
  V3DecodedPageResult
} from '../src/shared/schemas/leafletPageExtractionV3Schema';
import {
  decomposeV3OfferCard,
  normalizeV3OfferCard,
  V3DecompositionResult
} from '../src/main/ocr/offerV3DecompositionEngine';
import {
  adaptV3DecompositionToOfflineMatching,
  V3OfflineAdapterResult
} from '../src/main/db/v3MatchingInputAdapter';
import { OfferContractV3Record } from '../src/shared/types/extractorContractV3';

const REPO_ROOT = resolve(__dirname, '..');

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function readJson<T = any>(relPath: string): T {
  return JSON.parse(readFileSync(join(REPO_ROOT, relPath), 'utf8')) as T;
}

function stats(values: number[]): { count: number; min: number; mean: number; p50: number; max: number; sum: number } {
  if (values.length === 0) return { count: 0, min: 0, mean: 0, p50: 0, max: 0, sum: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mid = Math.floor(sorted.length / 2);
  const p50 = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return {
    count: sorted.length,
    min: sorted[0],
    mean: sum / sorted.length,
    p50,
    max: sorted[sorted.length - 1],
    sum
  };
}

function approxEq(a: number | null | undefined, b: number | null | undefined, tol = 0.02): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return Math.abs(a - b) <= tol;
}

function normText(s: string | null | undefined): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .trim();
}

function findMatchingAtomicOffers(
  gtOffer: any,
  rawOffers: any[],
  decodedCards: OfferContractV3Record[]
): Array<any> {
  const candidates: Array<{ score: number; match: any }> = [];
  const gtPrice = gtOffer.promo_price as number;
  const gtTitleWords = normText(gtOffer.title_en || gtOffer.title_ar)
    .split(' ')
    .filter((w) => w.length >= 3 && !['per', 'kg', 'pcs', 'gm', 'ltr', 'pack', 'free', 'with'].includes(w));

  for (let i = 0; i < rawOffers.length; i++) {
    const raw = rawOffers[i];
    const card = decodedCards[i];
    const subs = Array.isArray(raw.sub_items) ? raw.sub_items : [];
    const hasSubPrices = subs.some((s: any) => s.independent_promo_price != null);

    if (hasSubPrices) {
      for (let sIdx = 0; sIdx < subs.length; sIdx++) {
        const sub = subs[sIdx];
        if (!approxEq(sub.independent_promo_price, gtPrice)) continue;
        const combinedTitle = normText(
          `${raw.english_title || ''} ${raw.arabic_title || ''} ${sub.product_name_en || ''} ${sub.product_name_ar || ''} ${sub.brand_en || ''} ${sub.variant_or_flavor || ''}`
        );
        const wordHits = gtTitleWords.filter((w) => combinedTitle.includes(w)).length;
        if (wordHits >= 1 || gtTitleWords.length === 0) {
          candidates.push({
            score: wordHits,
            match: {
              rawOfferIdx: i,
              subItemIdx: sIdx,
              promoPrice: sub.independent_promo_price,
              originalPrice: sub.independent_original_price ?? null,
              currency: card.pricing.currency,
              titleEn: sub.product_name_en ?? raw.english_title ?? null,
              titleAr: sub.product_name_ar ?? raw.arabic_title ?? null,
              eachSizeValue: sub.each_size_value ?? card.quantity_and_promo.each_size_value ?? null,
              eachSizeUnit: sub.each_size_unit ?? card.quantity_and_promo.each_size_unit ?? null,
              packCount: sub.manufacturer_pack_count ?? card.quantity_and_promo.manufacturer_pack_count ?? null,
              multibuyQty:
                sub.retailer_checkout_multibuy_qty ?? card.quantity_and_promo.retailer_checkout_multibuy_qty ?? null,
              bonusPaid: card.quantity_and_promo.factory_bonus_paid_qty ?? null,
              bonusFree: card.quantity_and_promo.factory_bonus_free_qty ?? null,
              customerLimit: card.quantity_and_promo.customer_limit_pcs ?? null,
              loyaltyRequired: card.quantity_and_promo.loyalty_required,
              skuCodes: card.printed_retailer_sku_codes || [],
              assortmentStatus: card.assortment.status,
              isComplete: card.assortment.is_enumerated_list_complete,
              subItems: card.sub_items.length > 0 ? [card.sub_items[sIdx] || sub] : [sub],
              evidenceConflicts: card.evidence_conflicts,
              itemDomain: card.non_grocery_specs.domain,
              priceBasis: card.pricing.price_basis,
              saleBasis: card.quantity_and_promo.sale_basis,
              isPerWeight: card.quantity_and_promo.is_per_weight_pricing,
              rawOffer: raw,
              decodedCard: card
            }
          });
        }
      }
    } else {
      if (!approxEq(raw.promo_price, gtPrice)) continue;
      const combinedTitle = normText(`${raw.english_title || ''} ${raw.arabic_title || ''} ${raw.brand || ''}`);
      const wordHits = gtTitleWords.filter((w) => combinedTitle.includes(w)).length;
      if (wordHits >= 1 || gtTitleWords.length === 0) {
        candidates.push({
          score: wordHits,
          match: {
            rawOfferIdx: i,
            subItemIdx: null,
            promoPrice: raw.promo_price ?? null,
            originalPrice: raw.original_price ?? null,
            currency: card.pricing.currency,
            titleEn: raw.english_title ?? null,
            titleAr: raw.arabic_title ?? null,
            eachSizeValue: card.quantity_and_promo.each_size_value ?? null,
            eachSizeUnit: card.quantity_and_promo.each_size_unit ?? null,
            packCount: card.quantity_and_promo.manufacturer_pack_count ?? null,
            multibuyQty: card.quantity_and_promo.retailer_checkout_multibuy_qty ?? null,
            bonusPaid: card.quantity_and_promo.factory_bonus_paid_qty ?? null,
            bonusFree: card.quantity_and_promo.factory_bonus_free_qty ?? null,
            customerLimit: card.quantity_and_promo.customer_limit_pcs ?? null,
            loyaltyRequired: card.quantity_and_promo.loyalty_required,
            skuCodes: card.printed_retailer_sku_codes || [],
            assortmentStatus: card.assortment.status,
            isComplete: card.assortment.is_enumerated_list_complete,
            subItems: card.sub_items,
            evidenceConflicts: card.evidence_conflicts,
            itemDomain: card.non_grocery_specs.domain,
            priceBasis: card.pricing.price_basis,
            saleBasis: card.quantity_and_promo.sale_basis,
            isPerWeight: card.quantity_and_promo.is_per_weight_pricing,
            rawOffer: raw,
            decodedCard: card
          }
        });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.map((c) => c.match);
}

function main() {
  const manifest = readJson('Extracts/pilot_v3_005e/manifest.json');
  const groundTruth = readJson('src/shared/fixtures/v3/pilot_005e_frozen_ground_truth.json');
  const spec = readJson('src/shared/fixtures/v3/pilot_4pages_12crops_spec.json');

  const gtSha = sha256File(join(REPO_ROOT, 'src/shared/fixtures/v3/pilot_005e_frozen_ground_truth.json'));
  const specSha = sha256File(join(REPO_ROOT, 'src/shared/fixtures/v3/pilot_4pages_12crops_spec.json'));

  const specByCropId = new Map<string, any>(spec.crops.map((c: any) => [c.pilot_crop_id, c]));
  const specByPageId = new Map<string, any>(spec.pages.map((p: any) => [p.pilot_page_id, p]));
  const gtByCropId = new Map<string, any>(groundTruth.crops.map((c: any) => [c.pilot_crop_id, c]));
  const gtByPageId = new Map<string, any>(groundTruth.pages.map((p: any) => [p.pilot_page_id, p]));

  // WP5F-G: Frozen ground-truth internal consistency audit without mutating frozen file
  const groundTruthConsistencyWarnings: Array<{
    pilot_page_id: string;
    expected_atomic_offer_count: number;
    visual_offers_length: number;
    erratumId: string;
    note: string;
  }> = [];
  for (const gtPage of groundTruth.pages || []) {
    const headerCount = Number(gtPage.expected_atomic_offer_count ?? gtPage.visual_offers?.length ?? 0);
    const arrayCount = Array.isArray(gtPage.visual_offers) ? gtPage.visual_offers.length : 0;
    if (headerCount !== arrayCount) {
      groundTruthConsistencyWarnings.push({
        pilot_page_id: gtPage.pilot_page_id,
        expected_atomic_offer_count: headerCount,
        visual_offers_length: arrayCount,
        erratumId:
          gtPage.pilot_page_id === 'pilot_page_01_panda_p002'
            ? 'panda_p2_atomic_count_header_erratum'
            : `${gtPage.pilot_page_id}_atomic_count_erratum`,
        note: `Frozen ground truth header expected_atomic_offer_count=${headerCount} differs from enumerated visual_offers.length=${arrayCount}; evaluation uses visual_offers.length=${arrayCount} without mutating frozen ground-truth JSON.`
      });
    }
  }

  const cropEvaluations: any[] = [];
  const pageEvaluations: any[] = [];
  const operationalSlots: any[] = [];

  for (const slotMeta of manifest.slots) {
    const rawArchiveRel = slotMeta.rawArchivePath.startsWith('Extracts/')
      ? slotMeta.rawArchivePath
      : `Extracts/pilot_v3_005e/${slotMeta.rawArchivePath}`;
    const rawArchive = readJson(rawArchiveRel);
    const parsedResponse = rawArchive.parsedResponse;

    const cropSpec = specByCropId.get(slotMeta.slotId);
    const pageSpec = specByPageId.get(slotMeta.slotId);
    const isCrop = slotMeta.kind === 'crop';

    const decodeCtx = isCrop
      ? {
          leafletId: slotMeta.leafletId || 'unknown-leaflet',
          pageNumber: slotMeta.pageNumber || 1,
          sourceOfferIdPrefix: slotMeta.slotId,
          explicitSingleOfferId: slotMeta.sourceOfferId || cropSpec?.source_offer_id,
          retailerId: cropSpec?.retailer_id ?? null,
          retailerName: slotMeta.retailer,
          sourceEvidenceRefInternal: slotMeta.filePath || cropSpec?.file_path,
          locationScope: 'national' as const,
          tolerateOmittedNullableFields: false
        }
      : {
          leafletId: slotMeta.leafletId || pageSpec.leaflet_id,
          pageNumber: slotMeta.pageNumber || pageSpec.page_number,
          sourceOfferIdPrefix: slotMeta.slotId,
          retailerId: pageSpec?.retailer_id ?? null,
          retailerName: slotMeta.retailer,
          sourceEvidenceRefInternal: slotMeta.filePath || pageSpec?.file_path,
          locationScope: 'national' as const,
          tolerateOmittedNullableFields: false
        };

    const strictDecode: V3DecodedPageResult = decodeV3PageExtractionToOfferCards(parsedResponse, decodeCtx);
    const tolerantDecode: V3DecodedPageResult = decodeV3PageExtractionToOfferCards(parsedResponse, {
      ...decodeCtx,
      tolerateOmittedNullableFields: true
    });

    const usage = rawArchive.usageMetadataRaw || {};
    const promptDetails: Array<{ modality: string; tokenCount: number }> = usage.promptTokensDetails || [];
    const textInputTokens = promptDetails.find((d) => d.modality === 'TEXT')?.tokenCount ?? 0;
    const imageInputTokens = promptDetails.find((d) => d.modality === 'IMAGE')?.tokenCount ?? 0;
    const pdfInputTokens = promptDetails.find((d) => d.modality === 'DOCUMENT')?.tokenCount ?? 0;

    operationalSlots.push({
      slotId: slotMeta.slotId,
      kind: slotMeta.kind,
      retailer: slotMeta.retailer,
      durationMs: rawArchive.durationMs,
      finishReason: rawArchive.finishReason,
      assetBytes: rawArchive.assetBytes,
      strictSchemaValid: strictDecode.schemaValid,
      strictSchemaErrorCount: strictDecode.schemaErrors.length,
      tolerantDecodeValid: tolerantDecode.schemaValid,
      rawOffersCount: Array.isArray(parsedResponse?.offers) ? parsedResponse.offers.length : 0,
      tokens: {
        promptTotal: usage.promptTokenCount ?? 0,
        textInputTokens,
        imageInputTokens,
        pdfInputTokens,
        outputTokens: usage.candidatesTokenCount ?? 0,
        thinkingTokens: usage.thoughtsTokenCount ?? 0,
        cachedTokens: usage.cachedContentTokenCount ?? 0,
        totalTokens: usage.totalTokenCount ?? 0
      },
      cost: rawArchive.costCalculation,
      promptSha256: rawArchive.requestFingerprint?.promptSha256,
      schemaSha256: rawArchive.requestFingerprint?.schemaSha256
    });

    const decompositions: V3DecompositionResult[] = tolerantDecode.cards.map((card) => decomposeV3OfferCard(card));
    const adapterResults: V3OfflineAdapterResult[] = decompositions.map((d) =>
      adaptV3DecompositionToOfflineMatching(d, { storageEnvironment: 'DEVELOPMENT_TEST' })
    );
    const adapterWithActiveContext: V3OfflineAdapterResult[] = decompositions.map((d) => {
      const cloned: V3DecompositionResult = {
        ...d,
        normalized_card: {
          ...d.normalized_card,
          source_card: {
            ...d.normalized_card.source_card,
            retailer_id: d.normalized_card.source_card.retailer_id || `pilot-${slotMeta.retailer.toLowerCase()}`,
            offer_start_date: '2026-11-10',
            offer_end_date: '2026-11-20'
          }
        }
      };
      return adaptV3DecompositionToOfflineMatching(cloned, { storageEnvironment: 'DEVELOPMENT_TEST' });
    });

    if (isCrop) {
      const gtCrop = gtByCropId.get(slotMeta.slotId);
      const baselineCanonical = cropSpec?.existing_extraction_json ? readJson(cropSpec.existing_extraction_json) : {};

      const rawOffers = parsedResponse.offers || [];
      const normalizedCards = decompositions.map((d) => d.normalized_card);
      const card = normalizedCards[0];
      const decomp = decompositions[0];
      const adapter = adapterResults[0];

      // Compare Arabic-only English title leakage across cards and sub_items (normalized Stage 2 vs raw)
      const isArabicOnlyCrop = gtCrop.title_en === null;
      const cardEnglishLeak = isArabicOnlyCrop && normalizedCards.some((c) => Boolean(c.source_card.raw_text.title_en));
      const subItemEnglishLeak =
        isArabicOnlyCrop &&
        normalizedCards.some((c) => c.sub_items.some((s) => Boolean(s.product_name_en && s.product_name_en.trim())));

      // Field accuracy checks
      let promoPriceMatch = false;
      let originalPriceMatch = false;
      let currencyMatch = false;
      let domainMatch = false;
      let excludedMatch = false;
      let sizeMatch = false;
      let packCountMatch = false;
      let bonusMatch = false;
      let multibuyMatch = false;
      let limitMatch = false;
      let loyaltyMatch = false;
      let skuCodesMatch = false;

      if (slotMeta.slotId === 'pilot_crop_08_fakieh_compound') {
        const tiers = gtCrop.compound_tiers;
        const offersSorted = [...normalizedCards].sort((a, b) => (b.pricing.promo_price ?? 0) - (a.pricing.promo_price ?? 0));
        promoPriceMatch =
          offersSorted.length === 2 &&
          approxEq(offersSorted[0].pricing.promo_price, tiers[0].promo_price) &&
          approxEq(offersSorted[1].pricing.promo_price, tiers[1].promo_price);
        originalPriceMatch =
          offersSorted.length === 2 &&
          approxEq(offersSorted[0].pricing.original_price, tiers[0].original_price) &&
          offersSorted[1].pricing.original_price === tiers[1].original_price;
        currencyMatch = offersSorted.every((o) => o.pricing.currency === 'SAR');
        domainMatch = offersSorted.every((o) => o.non_grocery_specs.domain === gtCrop.item_domain);
        excludedMatch = offersSorted.every((o) => o.non_grocery_specs.excluded_from_default_grocery_feed === gtCrop.excluded_from_default_grocery_feed);
        sizeMatch =
          offersSorted.length === 2 &&
          offersSorted[0].quantity_and_promo.each_size_value === 1000 &&
          offersSorted[0].quantity_and_promo.each_size_unit === 'g' &&
          offersSorted[1].quantity_and_promo.each_size_value === 1000 &&
          offersSorted[1].quantity_and_promo.each_size_unit === 'g';
        packCountMatch =
          offersSorted.length === 2 &&
          offersSorted[0].quantity_and_promo.manufacturer_pack_count === 10 &&
          offersSorted[1].quantity_and_promo.manufacturer_pack_count === 1;
        bonusMatch = true;
        multibuyMatch = true;
        limitMatch = true;
        loyaltyMatch = offersSorted.every((o) => o.quantity_and_promo.loyalty_required === false);
        skuCodesMatch = true;
      } else {
        promoPriceMatch = approxEq(card.pricing.promo_price, gtCrop.promo_price);
        originalPriceMatch =
          gtCrop.original_price == null
            ? card.pricing.original_price == null
            : approxEq(card.pricing.original_price, gtCrop.original_price);
        currencyMatch = card.pricing.currency === gtCrop.currency;
        domainMatch = card.non_grocery_specs.domain === gtCrop.item_domain;
        excludedMatch = card.non_grocery_specs.excluded_from_default_grocery_feed === gtCrop.excluded_from_default_grocery_feed;
        sizeMatch =
          gtCrop.each_size_value === undefined
            ? gtCrop.each_size_unit === undefined || card.quantity_and_promo.each_size_unit === gtCrop.each_size_unit
            : approxEq(card.quantity_and_promo.each_size_value, gtCrop.each_size_value) &&
              card.quantity_and_promo.each_size_unit === gtCrop.each_size_unit;
        packCountMatch =
          gtCrop.manufacturer_pack_count === undefined ||
          card.quantity_and_promo.manufacturer_pack_count === gtCrop.manufacturer_pack_count;
        bonusMatch =
          (gtCrop.factory_bonus_paid_qty === undefined || card.quantity_and_promo.factory_bonus_paid_qty === gtCrop.factory_bonus_paid_qty) &&
          (gtCrop.factory_bonus_free_qty === undefined || card.quantity_and_promo.factory_bonus_free_qty === gtCrop.factory_bonus_free_qty);
        multibuyMatch =
          gtCrop.retailer_checkout_multibuy_qty === undefined ||
          card.quantity_and_promo.retailer_checkout_multibuy_qty === gtCrop.retailer_checkout_multibuy_qty;
        limitMatch =
          gtCrop.customer_limit_pcs === undefined ||
          card.quantity_and_promo.customer_limit_pcs === gtCrop.customer_limit_pcs;
        loyaltyMatch =
          gtCrop.loyalty_required === undefined ||
          card.quantity_and_promo.loyalty_required === gtCrop.loyalty_required;
        skuCodesMatch =
          gtCrop.printed_retailer_sku_codes === undefined ||
          JSON.stringify([...(card.printed_retailer_sku_codes || [])].sort()) ===
            JSON.stringify([...gtCrop.printed_retailer_sku_codes].sort());
      }

      const decomposedActually = decompositions.some((d) => d.decomposed);
      const totalChildrenEmitted = decompositions.reduce((sum, d) => sum + d.children.length, 0);
      const totalMatchableChildren = adapterResults.reduce((sum, a) => sum + a.matchableChildren.length, 0);

      cropEvaluations.push({
        slotId: slotMeta.slotId,
        sourceOfferId: gtCrop.source_offer_id,
        retailer: slotMeta.retailer,
        strictSchemaValid: strictDecode.schemaValid,
        strictSchemaErrors: strictDecode.schemaErrors,
        tolerantDecodeValid: tolerantDecode.schemaValid,
        expectedOfferCount: gtCrop.expected_offer_count,
        extractedOfferCount: rawOffers.length,
        isArabicOnlyCrop,
        cardEnglishLeak,
        subItemEnglishLeak,
        fieldChecks: {
          promoPriceMatch,
          originalPriceMatch,
          currencyMatch,
          domainMatch,
          excludedMatch,
          sizeMatch,
          packCountMatch,
          bonusMatch,
          multibuyMatch,
          limitMatch,
          loyaltyMatch,
          skuCodesMatch
        },
        extractedSummary: normalizedCards.map((c, idx) => ({
          source_offer_id: c.source_card.source_offer_id,
          title_ar: c.source_card.raw_text.title_ar,
          title_en: c.source_card.raw_text.title_en,
          promo_price: c.pricing.promo_price,
          original_price: c.pricing.original_price,
          currency: c.pricing.currency,
          each_size_value: c.quantity_and_promo.each_size_value,
          each_size_unit: c.quantity_and_promo.each_size_unit,
          manufacturer_pack_count: c.quantity_and_promo.manufacturer_pack_count,
          sale_basis: c.quantity_and_promo.sale_basis,
          multibuy_qty: c.quantity_and_promo.retailer_checkout_multibuy_qty,
          bonus: c.quantity_and_promo.factory_bonus_paid_qty
            ? `${c.quantity_and_promo.factory_bonus_paid_qty}+${c.quantity_and_promo.factory_bonus_free_qty}`
            : null,
          customer_limit_pcs: c.quantity_and_promo.customer_limit_pcs,
          loyalty_required: c.quantity_and_promo.loyalty_required,
          sku_codes: c.printed_retailer_sku_codes,
          assortment_status: c.assortment.status,
          is_enumerated_list_complete: c.assortment.is_enumerated_list_complete,
          sub_items: c.sub_items.map((s) => ({
            brand_en: s.brand_en,
            brand_ar: s.brand_ar,
            name_en: s.product_name_en,
            name_ar: s.product_name_ar,
            variant: s.variant_or_flavor,
            size: s.each_size_value ? `${s.each_size_value}${s.each_size_unit}` : null,
            pack: s.manufacturer_pack_count,
            sku: s.printed_retailer_sku_code,
            safe_for_catalog_matching: s.safe_for_catalog_matching
          })),
          raw_conflicts: parsedResponse.offers[idx]?.evidence_conflicts || [],
          normalized_conflicts: decompositions[idx].conflict_codes,
          decomposition_basis: decompositions[idx].decomposition_basis,
          decomposed: decompositions[idx].decomposed,
          retention_mode: decompositions[idx].parent_offer_retention_mode,
          children_count: decompositions[idx].children.length,
          matchable_children_count: adapterResults[idx].matchableChildren.length,
          adapter_quarantine_reasons: adapterResults[idx].parentPublicationAssessment.quarantineReasons,
          active_context_outcome: adapterWithActiveContext[idx].parentPublicationAssessment.outcome,
          active_context_eligible: adapterWithActiveContext[idx].parentPublicationAssessment.isEligibleForNonCatalogPublication,
          active_context_category: adapterWithActiveContext[idx].parentPublicationAssessment.category,
          active_context_quarantine_reasons: adapterWithActiveContext[idx].parentPublicationAssessment.quarantineReasons,
          active_context_correction_reasons: adapterWithActiveContext[idx].parentPublicationAssessment.correctionReasons
        })),
        gtExpectations: {
          expected_assortment_status: gtCrop.expected_assortment_status ?? null,
          expected_is_enumerated_list_complete: gtCrop.expected_is_enumerated_list_complete ?? null,
          expected_decomposed: gtCrop.expected_decomposed ?? gtCrop.expected_decomposed_if_single_card ?? null,
          expected_sub_items_count: gtCrop.expected_sub_items?.length ?? (gtCrop.compound_tiers?.length ?? 0),
          expected_conflicts: gtCrop.expected_conflicts,
          expected_quarantine: gtCrop.expected_quarantine
        },
        decomposedActually,
        totalChildrenEmitted,
        totalMatchableChildren,
        legacyBaseline: {
          title_en: baselineCanonical.product?.title_en ?? null,
          title_ar: baselineCanonical.product?.title_ar ?? null,
          promo_price: baselineCanonical.prices?.offer_price ?? null,
          original_price: baselineCanonical.prices?.original_price ?? null,
          each_size_value: baselineCanonical.content?.each_size_value ?? null,
          each_size_unit: baselineCanonical.content?.each_size_unit ?? null,
          pack_quantity: baselineCanonical.content?.pack_quantity ?? null,
          bundle_quantity: baselineCanonical.content?.bundle_quantity ?? null,
          mechanic: baselineCanonical.promotion?.mechanic ?? null,
          publish_decision: baselineCanonical.quality?.publish_decision ?? null,
          blocking_errors: baselineCanonical.quality?.blocking_errors ?? [],
          item_domain: baselineCanonical.product?.item_domain ?? null
        }
      });
    } else {
      const gtPage = gtByPageId.get(slotMeta.slotId);
      const rawOffers: any[] = parsedResponse.offers || [];

      // Count legacy canonical files on this exact page
      const retailerDir = pageSpec.file_path.split('/')[1];
      const pageNumPad = String(pageSpec.page_number).padStart(3, '0');
      const jsonDir = join(REPO_ROOT, 'Extracts', retailerDir, 'json');
      const legacyPageFiles = existsSync(jsonDir)
        ? readdirSync(jsonDir).filter((f) => f.startsWith(`page-${pageNumPad}-`) && f.endsWith('.canonical.json')).sort()
        : [];
      const legacyCanonicals = legacyPageFiles.map((f) => JSON.parse(readFileSync(join(jsonDir, f), 'utf8')));

      // Evaluate every ground truth atomic offer against normalized V3 offers
      const normalizedPageCards = decompositions.map((d) => d.normalized_card);
      const gtOfferComparisons = gtPage.visual_offers.map((gtOffer: any) => {
        const matches = findMatchingAtomicOffers(gtOffer, rawOffers, normalizedPageCards);
        const m = matches[0] ?? null;
        return {
          cell: gtOffer.cell,
          gtTitle: gtOffer.title_en || gtOffer.title_ar,
          gtPromoPrice: gtOffer.promo_price,
          gtOriginalPrice: gtOffer.original_price ?? null,
          matched: Boolean(m),
          matchCount: matches.length,
          extractedPromoPrice: m?.promoPrice ?? null,
          extractedOriginalPrice: m?.originalPrice ?? null,
          promoPriceExact: m ? approxEq(m.promoPrice, gtOffer.promo_price) : false,
          originalPriceExact:
            gtOffer.original_price == null
              ? m?.originalPrice == null
              : Boolean(m && approxEq(m.originalPrice, gtOffer.original_price)),
          currencyExact: m ? m.currency === (gtOffer.currency || 'SAR') : false,
          sizeExact:
            gtOffer.each_size_value == null
              ? true
              : Boolean(
                  m &&
                    approxEq(m.eachSizeValue, gtOffer.each_size_value) &&
                    m.eachSizeUnit === gtOffer.each_size_unit
                ),
          packCountExact:
            gtOffer.manufacturer_pack_count == null
              ? true
              : Boolean(m && m.packCount === gtOffer.manufacturer_pack_count),
          multibuyExact:
            gtOffer.retailer_checkout_multibuy_qty == null
              ? true
              : Boolean(m && m.multibuyQty === gtOffer.retailer_checkout_multibuy_qty),
          customerLimitExact:
            gtOffer.customer_limit_pcs == null ? true : Boolean(m && m.customerLimit === gtOffer.customer_limit_pcs),
          loyaltyExact:
            gtOffer.loyalty_required == null ? true : Boolean(m && m.loyaltyRequired === gtOffer.loyalty_required),
          conflictsDetected: m?.evidenceConflicts ?? [],
          subItemsCount: m?.subItems?.length ?? 0,
          assortmentStatus: m?.assortmentStatus ?? null,
          isComplete: m?.isComplete ?? null,
          extractedTitleEn: m?.titleEn ?? null,
          extractedTitleAr: m?.titleAr ?? null,
          skuCodesExtracted: m?.skuCodes ?? []
        };
      });

      const englishLeakCountRawOnArabicPage = gtPage.all_titles_arabic_only
        ? rawOffers.reduce((cnt, o) => {
            let c = o.english_title ? 1 : 0;
            for (const s of o.sub_items || []) {
              if (s.product_name_en) c++;
            }
            return cnt + c;
          }, 0)
        : 0;

      const englishLeakCountOnArabicPage = gtPage.all_titles_arabic_only
        ? normalizedPageCards.reduce((cnt, card) => {
            let c = card.source_card.raw_text.title_en ? 1 : 0;
            for (const s of card.sub_items || []) {
              if (s.product_name_en) c++;
            }
            return cnt + c;
          }, 0)
        : 0;

      const bboxCompleteCount = rawOffers.filter(
        (o) =>
          o.components &&
          Array.isArray(o.components.product_graphic_box) &&
          Array.isArray(o.components.promo_price_box)
      ).length;

      pageEvaluations.push({
        slotId: slotMeta.slotId,
        retailer: slotMeta.retailer,
        strictSchemaValid: strictDecode.schemaValid,
        tolerantDecodeValid: tolerantDecode.schemaValid,
        expectedGridCells: gtPage.expected_source_grid_cells,
        expectedAtomicOffers: gtPage.visual_offers.length,
        extractedRawOfferObjects: rawOffers.length,
        matchedAtomicOffersCount: gtOfferComparisons.filter((c: any) => c.matched).length,
        bboxCompleteCount,
        englishLeakCountOnArabicPage,
        englishLeakCountRawOnArabicPage,
        pageMetadata: {
          is_loyalty_page: parsedResponse.is_loyalty_page,
          loyalty_program_name: parsedResponse.loyalty_program_name,
          validity_start_date: parsedResponse.validity_start_date,
          validity_end_date: parsedResponse.validity_end_date,
          page_currency: parsedResponse.page_currency
        },
        decompositions: decompositions.map((d, idx) => ({
          source_offer_id: d.parent_source_offer_id,
          title:
            d.normalized_card.source_card.raw_text.title_en ||
            d.normalized_card.source_card.raw_text.title_ar,
          promo_price: d.normalized_card.pricing.promo_price,
          assortment_status: d.normalized_card.assortment.status,
          is_enumerated_list_complete: d.normalized_card.assortment.is_enumerated_list_complete,
          sub_items: d.normalized_card.sub_items.map((s) => ({
            brand: s.brand_en || s.brand_ar,
            name_en: s.product_name_en,
            name_ar: s.product_name_ar,
            variant: s.variant_or_flavor,
            size: s.each_size_value ? `${s.each_size_value}${s.each_size_unit}` : null,
            pack: s.manufacturer_pack_count,
            independent_promo_price: s.independent_promo_price,
            safe_for_catalog_matching: s.safe_for_catalog_matching
          })),
          decomposed: d.decomposed,
          basis: d.decomposition_basis,
          retention_mode: d.parent_offer_retention_mode,
          children_count: d.children.length,
          matchable_children_count: adapterResults[idx].matchableChildren.length,
          active_context_outcome: adapterWithActiveContext[idx].parentPublicationAssessment.outcome,
          active_context_eligible: adapterWithActiveContext[idx].parentPublicationAssessment.isEligibleForNonCatalogPublication,
          active_context_category: adapterWithActiveContext[idx].parentPublicationAssessment.category,
          active_context_quarantine_reasons: adapterWithActiveContext[idx].parentPublicationAssessment.quarantineReasons,
          active_context_correction_reasons: adapterWithActiveContext[idx].parentPublicationAssessment.correctionReasons,
          conflict_codes: d.conflict_codes,
          rejection_reasons: d.rejection_reasons
        })),
        gtOfferComparisons,
        legacyPageSummary: {
          canonicalFileCount: legacyCanonicals.length,
          publishDecisionCounts: legacyCanonicals.reduce((acc: Record<string, number>, c: any) => {
            const k = c.quality?.publish_decision || 'unknown';
            acc[k] = (acc[k] || 0) + 1;
            return acc;
          }, {}),
          titles: legacyCanonicals.map((c: any) => ({
            id: c.source?.external_image_id,
            title_en: c.product?.title_en,
            title_ar: c.product?.title_ar,
            promo_price: c.prices?.offer_price,
            publish_decision: c.quality?.publish_decision,
            pack: c.content?.pack_quantity,
            each: `${c.content?.each_size_value ?? ''}${c.content?.each_size_unit ?? ''}`
          }))
        }
      });
    }
  }

  // Compute aggregate operational stats (Track D)
  const cropOps = operationalSlots.filter((s) => s.kind === 'crop');
  const pageOps = operationalSlots.filter((s) => s.kind === 'page');

  const latencyAll = stats(operationalSlots.map((s) => s.durationMs));
  const latencyCrops = stats(cropOps.map((s) => s.durationMs));
  const latencyPages = stats(pageOps.map((s) => s.durationMs));

  const costAll = stats(operationalSlots.map((s) => s.cost.totalCostUsd));
  const costCrops = stats(cropOps.map((s) => s.cost.totalCostUsd));
  const costPages = stats(pageOps.map((s) => s.cost.totalCostUsd));

  const totalExtractedPageAtomicOffers = pageEvaluations.reduce(
    (sum, p) => sum + p.matchedAtomicOffersCount,
    0
  );
  const totalGroundTruthPageAtomicOffers = pageEvaluations.reduce(
    (sum, p) => sum + p.expectedAtomicOffers,
    0
  );

  // WP5F Stage 2 summary metrics across saved 12 crops + 4 pages (before/after baseline diff against saved 005E report)
  const baselineReportPath = join(REPO_ROOT, 'Extracts', 'pilot_v3_005e', 'evaluation_report.json');
  const baselineReport = existsSync(baselineReportPath) ? JSON.parse(readFileSync(baselineReportPath, 'utf8')) : null;

  const summarizeQuarantineParity = (crops: any[], pages: any[]) => {
    const quarantinedCards: any[] = [];
    for (const c of crops || []) {
      for (const ex of c.extractedSummary || []) {
        if (ex.retention_mode === 'quarantined_do_not_publish') {
          quarantinedCards.push({ slot: c.slotId, id: ex.source_offer_id, eligible: ex.active_context_eligible, outcome: ex.active_context_outcome });
        }
      }
    }
    for (const p of pages || []) {
      for (const d of p.decompositions || []) {
        if (d.retention_mode === 'quarantined_do_not_publish') {
          quarantinedCards.push({ slot: p.slotId, id: d.source_offer_id, eligible: d.active_context_eligible, outcome: d.active_context_outcome });
        }
      }
    }
    return {
      totalQuarantinedCards: quarantinedCards.length,
      unsafeEligibleViolations: quarantinedCards.filter((x) => x.eligible !== false || x.outcome !== 'quarantined').length
    };
  };

  const countBindawoodFalseSkuConflicts = (pages: any[]) => {
    const bndw = (pages || []).find((p) => p.slotId === 'pilot_page_02_bndw_p004');
    return (bndw?.decompositions || []).filter((d: any) =>
      (d.conflict_codes || []).includes('RETAILER_SKU_WITHOUT_VARIANT_NAMES')
    ).length;
  };

  const countFalseProduceOrMeatOnPackagedCpg = (crops: any[], pages: any[]) => {
    const cpgTargets = ['al arabi', 'abu kass', 'mozzarella', 'mirinda', 'seara', 'fakieh', 'indomie'];
    const hits: string[] = [];
    for (const c of crops || []) {
      for (const ex of c.extractedSummary || []) {
        const title = `${ex.title_en || ''} ${ex.title_ar || ''}`.toLowerCase();
        if (
          cpgTargets.some((t) => title.includes(t)) &&
          (ex.active_context_category === 'loose_produce' || ex.active_context_category === 'meat_seafood_by_weight')
        ) {
          hits.push(`${c.slotId}:${ex.source_offer_id}->${ex.active_context_category}`);
        }
      }
    }
    for (const p of pages || []) {
      for (const d of p.decompositions || []) {
        const title = String(d.title || '').toLowerCase();
        if (
          cpgTargets.some((t) => title.includes(t)) &&
          (d.active_context_category === 'loose_produce' || d.active_context_category === 'meat_seafood_by_weight')
        ) {
          hits.push(`${p.slotId}:${d.source_offer_id}->${d.active_context_category}`);
        }
      }
    }
    return hits;
  };

  const afterQuarantineParity = summarizeQuarantineParity(cropEvaluations, pageEvaluations);
  const beforeQuarantineParity = baselineReport
    ? summarizeQuarantineParity(baselineReport.cropEvaluations, baselineReport.pageEvaluations)
    : null;

  const afterFalseProduceHits = countFalseProduceOrMeatOnPackagedCpg(cropEvaluations, pageEvaluations);
  const beforeFalseProduceHits = baselineReport
    ? countFalseProduceOrMeatOnPackagedCpg(baselineReport.cropEvaluations, baselineReport.pageEvaluations)
    : null;

  const findCrop = (list: any[], id: string) => (list || []).find((c) => c.slotId === id);
  const findPage = (list: any[], id: string) => (list || []).find((p) => p.slotId === id);

  const stage2Metrics = {
    quarantineParity: afterQuarantineParity,
    crop04MatchableChildren: findCrop(cropEvaluations, 'pilot_crop_04_al_khair_plyms')?.totalMatchableChildren ?? 0,
    crop06TideDecomposed: findCrop(cropEvaluations, 'pilot_crop_06_tide_partial_negative')?.decomposedActually ?? false,
    crop07PersilDecomposed: findCrop(cropEvaluations, 'pilot_crop_07_persil_sku_negative')?.decomposedActually ?? false,
    bindawoodFalseSkuConflicts: countBindawoodFalseSkuConflicts(pageEvaluations),
    bindawoodTideDecomposed:
      findPage(pageEvaluations, 'pilot_page_02_bndw_p004')
        ?.decompositions.find((d: any) => /tide/i.test(d.title || ''))?.decomposed ?? null,
    alwafaLorealComplete:
      findPage(pageEvaluations, 'pilot_page_04_alwafa_p001')
        ?.decompositions.find((d: any) => /loreal|l'oreal|garnier/i.test(d.title || ''))?.is_enumerated_list_complete ?? null,
    alwafaOskaEnArConflictDetected:
      (findPage(pageEvaluations, 'pilot_page_04_alwafa_p001')
        ?.decompositions.find((d: any) => /oska/i.test(d.title || ''))?.conflict_codes || []).includes('EN_AR_WEIGHT_VOLUME_CONFLICT'),
    pandaPepsiSubsetDecomposed:
      findPage(pageEvaluations, 'pilot_page_01_panda_p002')
        ?.decompositions.find((d: any) => /pepsi/i.test(d.title || ''))?.decomposed ?? null,
    eggTraysExact: ['pilot_page_03_noori_p001', 'pilot_page_04_alwafa_p001'].map((pid) => {
      const p = findPage(pageEvaluations, pid);
      const egg = (p?.gtOfferComparisons || []).find((g: any) => /egg|بيض/i.test(g.gtTitle || ''));
      return { page: pid, cell: egg?.cell ?? null, packCountExact: egg?.packCountExact ?? false };
    }),
    packagedCpgFalseProduceOrMeatHits: afterFalseProduceHits,
    arabicOnlyNormalizedEnglishLeaks: pageEvaluations.reduce((s, p) => s + p.englishLeakCountOnArabicPage, 0),
    arabicOnlyRawEnglishLeaks: pageEvaluations.reduce((s, p) => s + (p.englishLeakCountRawOnArabicPage ?? 0), 0),
    beforeAfter005eVs005f: baselineReport
      ? {
          quarantineUnsafeViolations: {
            before_005e: beforeQuarantineParity!.unsafeEligibleViolations,
            after_005f: afterQuarantineParity.unsafeEligibleViolations
          },
          crop04AlKhairMatchableChildren: {
            before_005e: findCrop(baselineReport.cropEvaluations, 'pilot_crop_04_al_khair_plyms')?.totalMatchableChildren ?? null,
            after_005f: findCrop(cropEvaluations, 'pilot_crop_04_al_khair_plyms')?.totalMatchableChildren ?? null
          },
          bindawoodFalseSkuConflicts: {
            before_005e: countBindawoodFalseSkuConflicts(baselineReport.pageEvaluations),
            after_005f: countBindawoodFalseSkuConflicts(pageEvaluations)
          },
          packagedCpgFalseProduceOrMeatCount: {
            before_005e: beforeFalseProduceHits!.length,
            before_hits: beforeFalseProduceHits,
            after_005f: afterFalseProduceHits.length,
            after_hits: afterFalseProduceHits
          },
          nooriArabicOnlySubItemEnglishLeaks: {
            before_005e: findPage(baselineReport.pageEvaluations, 'pilot_page_03_noori_p001')?.englishLeakCountOnArabicPage ?? null,
            after_005f_normalized: findPage(pageEvaluations, 'pilot_page_03_noori_p001')?.englishLeakCountOnArabicPage ?? null,
            after_005f_raw: findPage(pageEvaluations, 'pilot_page_03_noori_p001')?.englishLeakCountRawOnArabicPage ?? null
          },
          pandaPepsiCaptionSubsetDecomposed: {
            before_005e:
              findPage(baselineReport.pageEvaluations, 'pilot_page_01_panda_p002')
                ?.decompositions.find((d: any) => /pepsi/i.test(d.title || ''))?.decomposed ?? null,
            after_005f:
              findPage(pageEvaluations, 'pilot_page_01_panda_p002')
                ?.decompositions.find((d: any) => /pepsi/i.test(d.title || ''))?.decomposed ?? null
          },
          alwafaLorealAsstdCompleteFlag: {
            before_005e:
              findPage(baselineReport.pageEvaluations, 'pilot_page_04_alwafa_p001')
                ?.decompositions.find((d: any) => /loreal|l'oreal|garnier/i.test(d.title || ''))?.is_enumerated_list_complete ?? null,
            after_005f:
              findPage(pageEvaluations, 'pilot_page_04_alwafa_p001')
                ?.decompositions.find((d: any) => /loreal|l'oreal|garnier/i.test(d.title || ''))?.is_enumerated_list_complete ?? null
          },
          bindawoodTideFalseDecomposed: {
            before_005e:
              findPage(baselineReport.pageEvaluations, 'pilot_page_02_bndw_p004')
                ?.decompositions.find((d: any) => /tide/i.test(d.title || ''))?.decomposed ?? null,
            after_005f:
              findPage(pageEvaluations, 'pilot_page_02_bndw_p004')
                ?.decompositions.find((d: any) => /tide/i.test(d.title || ''))?.decomposed ?? null
          },
          alwafaOskaEnArConflictQuarantined: {
            before_005e:
              findPage(baselineReport.pageEvaluations, 'pilot_page_04_alwafa_p001')
                ?.decompositions.find((d: any) => /oska/i.test(d.title || ''))?.active_context_eligible ?? null,
            after_005f:
              findPage(pageEvaluations, 'pilot_page_04_alwafa_p001')
                ?.decompositions.find((d: any) => /oska/i.test(d.title || ''))?.active_context_eligible ?? null
          },
          eggTraysPackCountExactCount: {
            before_005e: ['pilot_page_03_noori_p001', 'pilot_page_04_alwafa_p001'].filter((pid) => {
              const p = findPage(baselineReport.pageEvaluations, pid);
              const egg = (p?.gtOfferComparisons || []).find((g: any) => /egg|بيض/i.test(g.gtTitle || ''));
              return Boolean(egg?.packCountExact);
            }).length,
            after_005f: ['pilot_page_03_noori_p001', 'pilot_page_04_alwafa_p001'].filter((pid) => {
              const p = findPage(pageEvaluations, pid);
              const egg = (p?.gtOfferComparisons || []).find((g: any) => /egg|بيض/i.test(g.gtTitle || ''));
              return Boolean(egg?.packCountExact);
            }).length
          },
          pageAtomicOfferRecall: {
            before_005e: baselineReport.trackA_summary?.pageAtomicOfferRecall ?? null,
            after_005f: `${totalExtractedPageAtomicOffers}/${totalGroundTruthPageAtomicOffers}`
          },
          cropOfferRecall: {
            before_005e: baselineReport.trackA_summary?.cropOfferRecall ?? null,
            after_005f: `${cropEvaluations.filter((c) => c.extractedOfferCount === c.expectedOfferCount).length}/${cropEvaluations.length}`
          }
        }
      : null
  };

  // Extrapolations explicitly marked as estimates (not observed live batch runs)
  const avgPageCostUsd = costPages.mean;
  const avgPageDurationMs = latencyPages.mean;
  const avgCropCostUsd = costCrops.mean;
  const avgCropDurationMs = latencyCrops.mean;
  const estimatedPagesFor100Offers = 10; // ~10 offers/page across real 9-13 offer pages (47/4 = 11.75 observed)

  const report = {
    generatedAt: new Date().toISOString(),
    verificationMode: 'STRICT_OFFLINE_EVALUATION_ZERO_PAID_CALLS',
    manifestCounters: manifest.counters,
    manifestStoppedReason: manifest.stoppedReason,
    integrityHashes: {
      pilotGroundTruthSha256: gtSha,
      pilotSpecSha256: specSha,
      promptSha256Set: Array.from(new Set(operationalSlots.map((s) => s.promptSha256))),
      schemaSha256Set: Array.from(new Set(operationalSlots.map((s) => s.schemaSha256)))
    },
    groundTruthConsistency: {
      frozenGroundTruthSha256: gtSha,
      passed: groundTruthConsistencyWarnings.length === 0,
      consistencyWarnings: groundTruthConsistencyWarnings
    },
    stage2HardeningSummary: stage2Metrics,
    trackA_summary: {
      strictZodValidAll: `${operationalSlots.filter((s) => s.strictSchemaValid).length}/${operationalSlots.length}`,
      tolerantDecodeValidAll: `${operationalSlots.filter((s) => s.tolerantDecodeValid).length}/${operationalSlots.length}`,
      cropCount: cropEvaluations.length,
      cropOfferRecall: `${cropEvaluations.filter((c) => c.extractedOfferCount === c.expectedOfferCount).length}/${cropEvaluations.length}`,
      pageCount: pageEvaluations.length,
      pageRawOfferObjectsExtracted: pageEvaluations.reduce((s, p) => s + p.extractedRawOfferObjects, 0),
      pageAtomicOfferRecall: `${totalExtractedPageAtomicOffers}/${totalGroundTruthPageAtomicOffers}`
    },
    trackD_operational: {
      latencyMs: {
        all16: latencyAll,
        crops12: latencyCrops,
        pages4: latencyPages
      },
      tokens: {
        totalPromptTokens: operationalSlots.reduce((s, x) => s + x.tokens.promptTotal, 0),
        totalTextInputTokens: operationalSlots.reduce((s, x) => s + x.tokens.textInputTokens, 0),
        totalImageInputTokens: operationalSlots.reduce((s, x) => s + x.tokens.imageInputTokens, 0),
        totalPdfInputTokens: operationalSlots.reduce((s, x) => s + x.tokens.pdfInputTokens, 0),
        totalOutputTokens: operationalSlots.reduce((s, x) => s + x.tokens.outputTokens, 0),
        totalThinkingTokens: operationalSlots.reduce((s, x) => s + x.tokens.thinkingTokens, 0),
        totalCachedTokens: operationalSlots.reduce((s, x) => s + x.tokens.cachedTokens, 0)
      },
      costUsd: {
        totalAll16: costAll.sum,
        totalCrops12: costCrops.sum,
        totalPages4: costPages.sum,
        meanPerCrop: avgCropCostUsd,
        meanPerPage: avgPageCostUsd,
        meanPerMatchedPageAtomicOffer: costPages.sum / Math.max(1, totalExtractedPageAtomicOffers),
        inputCostSum: operationalSlots.reduce((s, x) => s + x.cost.inputCostUsd, 0),
        outputCostSum: operationalSlots.reduce((s, x) => s + x.cost.outputCostUsd, 0),
        thinkingCostSum: operationalSlots.reduce((s, x) => s + x.cost.thinkingCostUsd, 0)
      },
      estimatesFor100OfferLeaflet: {
        note: 'ESTIMATE computed mathematically from observed Flex means (NOT observed on a 100-offer live run).',
        observedAvgAtomicOffersPerPage: totalGroundTruthPageAtomicOffers / 4,
        fullPage10PagesCostUsd: Number((avgPageCostUsd * estimatedPagesFor100Offers).toFixed(4)),
        fullPage10PagesSequentialSec: Number(((avgPageDurationMs * estimatedPagesFor100Offers) / 1000).toFixed(1)),
        hybrid10PagesPlus15SelectiveCropsCostUsd: Number(
          (avgPageCostUsd * estimatedPagesFor100Offers + avgCropCostUsd * 15).toFixed(4)
        ),
        hybrid10PagesPlus25SelectiveCropsCostUsd: Number(
          (avgPageCostUsd * estimatedPagesFor100Offers + avgCropCostUsd * 25).toFixed(4)
        )
      }
    },
    cropEvaluations,
    pageEvaluations,
    operationalSlots
  };

  mkdirSync(join(REPO_ROOT, 'Extracts', 'pilot_v3_005e'), { recursive: true });
  const outPath = join(REPO_ROOT, 'Extracts', 'pilot_v3_005e', 'evaluation_report_005f.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('Saved offline Stage 2 hardening replay report to:', outPath);
  console.log('Ground Truth Consistency:', JSON.stringify(report.groundTruthConsistency, null, 2));
  console.log('Stage 2 Before/After Comparison:', JSON.stringify(report.stage2HardeningSummary.beforeAfter005eVs005f, null, 2));
  console.log('Track A Summary:', JSON.stringify(report.trackA_summary, null, 2));
  console.log('Track D Latency Pages (ms):', JSON.stringify(report.trackD_operational.latencyMs.pages4));
  console.log('Track D Latency Crops (ms):', JSON.stringify(report.trackD_operational.latencyMs.crops12));
  console.log('Track D Cost USD:', JSON.stringify(report.trackD_operational.costUsd, null, 2));
  console.log('Track D 100-Offer Estimates:', JSON.stringify(report.trackD_operational.estimatesFor100OfferLeaflet, null, 2));
}

main();
