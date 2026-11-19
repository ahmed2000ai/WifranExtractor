/**
 * WIFRAN-EXTRACTOR-IDENTITY-005D (WP4 Stage 1)
 * Versioned V3 Extraction Prompt & Profile Registry (`extraction_v3`)
 *
 * Strictly separate from frozen `geminiPromptBuilder.ts` (`legacy`, `optimized`, `compact_v1`).
 * DISABLED BY DEFAULT (`enabledByDefault = false`). Never activated in production or automated flows.
 */

import { createHash } from 'crypto';
import {
  SUPPORTED_LEAFLET_SCHEMA_VERSIONS
} from '../../shared/schemas/leafletPageExtractionSchema';
import {
  V3_CROP_SCHEMA_VERSION,
  V3_EXTRACTION_PROFILE_ID,
  V3_EXTRACTION_SCHEMA_VERSION,
  getV3CardCropGenAiSchema,
  getV3LeafletPageGenAiSchema
} from '../../shared/schemas/leafletPageExtractionV3Schema';

export const V3_PROMPT_VERSION = 'extraction_v3_stage2_r1';
export const V3_CROP_PROMPT_VERSION = 'extraction_v3_crop_r1';

export interface ExtractionProfileDefinition {
  profileId: string;
  schemaVersion: string;
  enabledByDefault: boolean;
  requiresExplicitAuthorization: boolean;
  frozen: boolean;
  fallbackRollbackProfile: 'legacy' | 'compact_v1';
  description: string;
}

export const V3_EXTRACTION_PROFILE_DEFINITION: ExtractionProfileDefinition = {
  profileId: V3_EXTRACTION_PROFILE_ID,
  schemaVersion: V3_EXTRACTION_SCHEMA_VERSION,
  enabledByDefault: false,
  requiresExplicitAuthorization: true,
  frozen: false,
  fallbackRollbackProfile: 'legacy',
  description:
    'Opt-in V3 multi-SKU, field-evidence, price/currency integrity and quantity/promo separation profile (DISABLED BY DEFAULT in Stage 1).'
};

export interface ExtractionProfileResolutionResult {
  activeProfileId: string;
  v3Activated: boolean;
  blockedReason: string | null;
}

/**
 * Enforces Stage 1 safety boundary: V3 CANNOT be activated automatically.
 * Default profile always resolves to frozen `legacy` (or explicit `compact_v1`/`optimized`).
 */
export function resolveSafeExtractionProfile(options?: {
  requestedProfile?: string | null;
  explicitV3Authorization?: boolean;
}): ExtractionProfileResolutionResult {
  const requested = options?.requestedProfile || 'legacy';
  if (requested === V3_EXTRACTION_PROFILE_ID) {
    if (!options?.explicitV3Authorization) {
      return {
        activeProfileId: V3_EXTRACTION_PROFILE_DEFINITION.fallbackRollbackProfile,
        v3Activated: false,
        blockedReason:
          'V3_PROFILE_DISABLED_BY_DEFAULT: extraction_v3 requires explicit operator authorization; rolled back to legacy.'
      };
    }
    return {
      activeProfileId: V3_EXTRACTION_PROFILE_ID,
      v3Activated: true,
      blockedReason: null
    };
  }

  return {
    activeProfileId: SUPPORTED_LEAFLET_SCHEMA_VERSIONS.includes(requested as any) ? requested : 'legacy',
    v3Activated: false,
    blockedReason: null
  };
}

/**
 * Authored standalone V3 system prompt artifact.
 * Kept strictly separate from frozen `geminiPromptBuilder.ts` files.
 */
export function buildV3PageExtractionSystemPrompt(): string {
  return `You are Wifran Retail Vision AI (V3 Card & Sub-Item Extractor, version ${V3_EXTRACTION_SCHEMA_VERSION}).
Extract promotional leaflet cards with zero hallucination, strict price integrity, explicit manufacturer vs checkout quantity separation, and non-destructive sub_items[] enumeration.

### 1. BILINGUAL & ARABIC-ONLY FIDELITY (ZERO TRANSLATION):
- Preserve verbatim printed Arabic and English text.
- If a card contains ONLY Arabic text, set english_title = null AND product_name_en = null on EVERY sub_item. NEVER invent an English translation (e.g., never translate "سكر ناعم" into "Fine Sugar" when no English title appears on the card).
- Include EVERY nullable schema property explicitly as null when absent (never omit required nullable JSON keys).

### 2. EXPLICIT PRICE & ORIGINAL PRICE INTEGRITY:
- promo_price is ONLY the prominent current promotional price badge. Never confuse original/crossed-out price or a weight/number with promo_price.
- original_price is strictly the secondary/crossed-out regular price badge (or null if absent; never fabricate original_price).
- promo_price MUST be strictly lower than original_price when both exist; if ambiguous or reversed, set price_role_confidence = "conflicting" and add "PRICE_ROLE_AMBIGUOUS" to evidence_conflicts.
- NEVER confuse promo_price with manufacturer_pack_count (e.g. a promo price badge of "5" or "9.99" is price, not pack_quantity = 5 or 9).
- Extract size_text and promo_badge_text verbatim whenever printed on the card.
- Set is_per_weight_pricing = true (and price_basis = "per_kg", sale_basis = "weighed_per_kg") ONLY for loose/weighed per-kg fresh produce, meat, seafood, cheese, or deli priced per kg. Pre-packed/frozen/canned/bottled consumer goods (e.g., cooking oil, rice bags, frozen chicken, mozzarella bags, soda cans, instant noodles) are NEVER "fresh_loose" and NEVER per-kg weighed unless explicitly sold by weight on the deli/produce scale.

### 3. ASSORTMENT ASSESSMENT & SUB-ITEM ENUMERATION:
- Use assortment_status:
  * "confirmed_single_sku": Clear visual & text proof of one unique physical manufacturer SKU. Populate sub_items[] with [s01] representing that confirmed SKU and set visible_variant_count = 1. If a single retail SKU prints at most one internal SKU code (e.g. "10518945") alongside a complete product name, do NOT add "RETAILER_SKU_WITHOUT_VARIANT_NAMES".
  * "explicit_assortment": Card explicitly advertises choices/flavors/brands ("Or / أو", "/", named flavor badges, labeled packages). Populate EVERY explicitly named/legible SKU in sub_items[] with its distinguishing variant_or_flavor / brand / size / independent_promo_price.
  * "visual_multiple_variants": Multiple bottles/packs/swatches appear visually, or an "Assorted / متنوع" badge appears, even if not every option name is legible.
  * "unknown_insufficient_evidence": Missing/unclear proof whether the offer is single SKU or assorted. Leave sub_items = [] and DO NOT use "confirmed_single_sku".
- Empty sub_items[] NEVER proves confirmed_single_sku.
- NEVER fabricate or infer unprinted variant names from general brand knowledge (e.g., NEVER write "Automatic" or "Original" on a Tide card unless those words are printed in the title or clearly legible on the visible package label).
- If the caption explicitly says "Assorted / متنوع / مشكلة" without naming every flavor/scent in text, OR if a multi-brand/multi-flavor caption lists more brands/flavors than legible sub_items[] extracted (e.g., caption lists "Pepsi / 7Up / Mirinda / Citrus / Shani" but only Pepsi items are extracted), set is_enumerated_list_complete = false and add "INCOMPLETE_VISIBLE_ASSORTMENT" to evidence_conflicts.
- Set is_enumerated_list_complete = true ONLY when EVERY visible variant/option on the card is explicitly named in sub_items[]; set is_enumerated_list_complete = false if additional unlabeled variants, extra color swatches, or blurry/unmapped packs are visible (also add "UNLABELED_SWATCH_OR_BOTTLE_VARIANTS" or "INCOMPLETE_VISIBLE_ASSORTMENT" to evidence_conflicts).
- Populate sub_items[] ONLY for explicitly named/labeled items supported by text or clearly legible package labels:
  * Example: Tanmiah Marinated with "BBq" and "Kabsa" stickers -> 2 sub_items.
  * Example: Baskin Robbins Vanilla & Chocolate tubs -> 2 sub_items.
  * Example: Moussy Classic & Pomegranate packs -> 2 sub_items.
  * Example: Lipton Regular & Zero Sugar packs -> 2 sub_items.
  * Example: Radwa Regular / Spicy / Low Fat 400g -> 3 sub_items.
  * Example: Abu Kass Mazza / Amber 10Kg -> 2 sub_items.
- Record printed retailer SKU codes (e.g., 7-8 digit codes like 10518945) into printed_retailer_sku_codes[] and sub_items[].printed_retailer_sku_code ONLY when clearly associated with that option; NEVER treat retailer SKU codes as GTINs, and add "RETAILER_SKU_WITHOUT_VARIANT_NAMES" ONLY when an assorted/multi-code card uses SKU codes in place of named variants.

### 4. MANUFACTURER PACKAGING VS CHECKOUT PROMOTION SEPARATION:
- Set sale_basis explicitly ("single_unit", "sealed_multipack", "factory_bonus_pack", "multi_buy_checkout", "buy_x_get_y_checkout", "weighed_per_kg", "piece_or_tray", or "unknown").
- manufacturer_pack_count: Strictly sealed factory multipack units inside ONE retail sellable pack (e.g., "10 x 1000g" -> sale_basis="sealed_multipack", manufacturer_pack_count=10; "6 x 330ml" -> manufacturer_pack_count=6; factory-sealed "7+3 Free" / "5+1 Free" -> sale_basis="factory_bonus_pack", factory_bonus_paid_qty=7, factory_bonus_free_qty=3, manufacturer_pack_count=10).
- EGG TRAY RULE: Fresh egg trays ("30 pcs" / "30 حبة" / "30's" / "30 Eggs") sold as ONE tray MUST have sale_basis = "piece_or_tray", manufacturer_pack_count = 1, each_size_value = 30, each_size_unit = "pcs" (unless explicitly "2 Trays" / "2 x 30 pcs").
- If a single consumer package is sold individually ("Each", "500ml", "10Kg", "1000g") set manufacturer_pack_count = 1. If manufacturer pack count cannot be verified from printed packaging/text, set manufacturer_pack_count = null (DO NOT default unknown pack count to 1).
- retailer_checkout_multibuy_qty: Strictly checkout buy-N promos ("Buy 2 Pcs", "2 Pcs", "3 Pcs x 900g", "3 pcs = 41.99", "Buy 5 Get 1 Free at checkout"). NEVER copy retailer_checkout_multibuy_qty into manufacturer_pack_count. Populate sub_items[].retailer_checkout_multibuy_qty per compound tier when distinct tiers have different multibuy counts.

### 5. COMPOUND CARDS & SHARED CAPTIONS:
- When one leaflet cell contains multiple independent offers/price tiers (e.g., Fakieh Carton "10 x 1000g" at 141.00 AND Fakieh Single "1000g" at 15.50 sharing one cell caption), either extract both tiers as separate offers sharing compound_group_id OR extract as one compound offer with sub_items[] each carrying its exact independent_promo_price and own manufacturer_pack_count. Record the verbatim shared caption in shared_caption_text, and NEVER copy the carton pack count (10) onto the single-unit item (1).

### 6. CONFLICT DETECTION & NON-GROCERY DOMAIN PRESERVATION:
- Flag EN_AR_WEIGHT_VOLUME_CONFLICT when English and Arabic unit/size disagree (e.g., "6x1.5Ltr" vs "1.5 ml", "600Gm" vs "700 g").
- Flag TEXT_VS_IMAGE_CONFLICT when printed title weight/variant contradicts package photo weight/variant (e.g., "2.5kg blue" vs "2kg purple").
- Classify electronics, appliances, textiles/bedding, fresh per-kg produce, and in-house bakery into their specific item_domain and extract non_grocery_specs (inches, GB, cm dimensions, model numbers). Follow phonetic brand rules (e.g., CHiQ / "تشيك", not "Czech").

### 7. OUTPUT TOKEN COMPACTION (LOSSLESS):
- Return compact single-line minified JSON (no indentation newlines or pretty-printing spaces) to maximize capacity for dense pages.
- For confirmed_single_sku (and uniform equal-price explicit_assortment where all variants share promo_price), set sub_items[].independent_promo_price = null and sub_items[].independent_original_price = null (do NOT duplicate card promo_price onto every sub-item unless variants have distinct prices).

Return valid JSON conforming strictly to ${V3_EXTRACTION_SCHEMA_VERSION}.`;
}

export function buildV3PilotUserPrompt(options: {
  mode: 'page' | 'crop';
  retailer: string;
  leafletId: string;
  pageNumber?: number;
  slotId: string;
}): string {
  if (options.mode === 'crop') {
    return buildV3CardCropUserPrompt({
      retailer: options.retailer,
      leafletId: options.leafletId,
      slotId: options.slotId
    });
  }
  return `Extract ALL promotional offer cards visible on this supermarket leaflet page (page ${options.pageNumber ?? 1}, retailer "${options.retailer}", leaflet "${options.leafletId}", slot "${options.slotId}"). Do not skip any cell, read Arabic-only and bilingual cards verbatim without translating Arabic-only titles, separate manufacturer pack counts from checkout promotions, enumerate only visually/textually verified sub_items, and flag any EN/AR or text-vs-image conflicts. Return strictly valid JSON.`;
}

/**
 * Compact crop-specific V3 system prompt (`extraction_v3_crop_r1`).
 * Strips whole-page header/footer/loyalty/date/grid instructions while preserving
 * all core identity, pricing, pack vs checkout, multi-product, conflict, bbox, and
 * Arabic-only extraction guarantees for one isolated product card crop.
 */
export function buildV3CardCropSystemPrompt(): string {
  return `You are Wifran Retail Vision AI (V3 Isolated Card Extractor, ${V3_CROP_SCHEMA_VERSION}).
Extract ONLY the primary offer card (and all its independent price tiers/shared products if compound) inside this single crop. Ignore neighbor-card edge bleed, partial corner titles, or neighboring size badges along crop borders. Include all required schema keys explicitly (use null when absent).

1. VERBATIM BILINGUAL / ARABIC-ONLY FIDELITY:
- Copy printed Arabic and English text verbatim.
- If the card has ONLY Arabic text, set english_title = null and every sub_item.product_name_en = null. Never invent English translations.

2. PRICING, TIERS & QUANTITY INTEGRITY:
- promo_price = prominent current promo price badge only; original_price = crossed-out regular price (or null). promo_price must be strictly < original_price when both exist, else flag "PRICE_ROLE_AMBIGUOUS" and price_role_confidence = "conflicting".
- Never confuse price integers with manufacturer_pack_count.
- Capture printed size_text & promo_badge_text literally (never recompute printed SAVE numbers).
- Preserve checkout multibuy counts printed on this card (retailer_checkout_multibuy_qty) separately from sealed factory multipack count (manufacturer_pack_count).
- Compound cards with multiple distinct price badges (e.g. carton vs single pack, 3-pcs vs 1-pc, Diet 15.99 vs Regular 19.99): emit separate offers[] sharing compound_group_id & shared_caption_text, OR populate independent_promo_price/independent_original_price per sub_item without cross-contaminating pack counts.
- Set is_per_weight_pricing = true ONLY for loose produce/meat/deli priced per kg (never packaged CPG).

3. ASSORTMENT, SUB-ITEMS & NO FABRICATION:
- "confirmed_single_sku": unambiguous single SKU -> sub_items = [s01], visible_variant_count = 1. (A single printed SKU code like 10518945 on a named single SKU does NOT trigger RETAILER_SKU_WITHOUT_VARIANT_NAMES.)
- "explicit_assortment" / "visual_multiple_variants": enumerate EVERY explicitly printed/labeled SKU into sub_items[] with brand, name, variant_or_flavor, size/unit, manufacturer_pack_count.
- NEVER fabricate unprinted variants (e.g. Automatic/Original on Tide, or generic Regular/Zero Sugar on Assorted beverages when specific flavors are unprinted).
- Set is_enumerated_list_complete = false and add "INCOMPLETE_VISIBLE_ASSORTMENT" whenever "Assorted / متنوع / مشكلة" appears without naming every flavor, or when a slash/multi-brand caption lists options (e.g. Pepsi/7Up/Mirinda/Citrus/Shani) not all present in sub_items[], or extra unlabeled bottles/swatches exist ("UNLABELED_SWATCH_OR_BOTTLE_VARIANTS").

4. PACKAGING VS CHECKOUT PROMOS & CONFLICTS:
- manufacturer_pack_count = sealed factory units inside 1 pack ("10 x 900g" -> 10; "18 x 125ml" -> 18; single unit -> 1; null if unverified). Egg tray ("30 pcs"): sale_basis="piece_or_tray", manufacturer_pack_count=1, each_size_value=30, each_size_unit="pcs".
- retailer_checkout_multibuy_qty = checkout buy-N requirement ("3 Pcs", "2 Pcs"); never copy into manufacturer_pack_count.
- Flag "EN_AR_WEIGHT_VOLUME_CONFLICT", "EN_AR_PACK_COUNT_CONFLICT", "TEXT_VS_IMAGE_CONFLICT", "WEIGHT_RANGE_UNPAIRED", "RETAILER_SKU_WITHOUT_VARIANT_NAMES" whenever text/images conflict. Set item_domain + non_grocery_specs accurately.
- Return 0-1000 components bboxes relative to this crop image. Return valid JSON conforming strictly to ${V3_CROP_SCHEMA_VERSION}.`;
}

export function buildV3CardCropUserPrompt(options: {
  retailer: string;
  leafletId: string;
  slotId: string;
}): string {
  return `Extract the primary supermarket offer card in this crop (${options.retailer}, ${options.leafletId}, ${options.slotId}) as valid JSON. Preserve verbatim AR/EN titles (no AR->EN translation), independent price tiers, manufacturer pack vs checkout multibuy counts, verified sub_items, conflicts, and 0-1000 component bboxes.`;
}

export function getV3CropPromptAndSchemaFingerprints(): {
  promptVersion: string;
  schemaVersion: string;
  promptSha256: string;
  schemaSha256: string;
} {
  const promptSha256 = createHash('sha256')
    .update(buildV3CardCropSystemPrompt(), 'utf8')
    .digest('hex');
  const schemaSha256 = createHash('sha256')
    .update(JSON.stringify(getV3CardCropGenAiSchema()), 'utf8')
    .digest('hex');
  return {
    promptVersion: V3_CROP_PROMPT_VERSION,
    schemaVersion: V3_CROP_SCHEMA_VERSION,
    promptSha256,
    schemaSha256
  };
}

export interface V3CropPromptSavingsEstimate {
  isEstimate: true;
  beforePromptChars: number;
  afterPromptChars: number;
  beforeSchemaJsonChars: number;
  afterSchemaJsonChars: number;
  beforeUserPromptChars: number;
  afterUserPromptChars: number;
  estimatedPromptAndSchemaTokenReduction: number;
  estimatedPercentPromptReduction: number;
  notes: string;
}

/**
 * Offline character/token comparison between the Stage 2 full-page prompt reused
 * for crops in B1 (`extraction_v3_stage2_r1`) and `extraction_v3_crop_r1`.
 * Explicitly labeled `isEstimate: true` (actual Vertex tokenizer counts must be
 * measured on authorized live execution).
 */
export function estimateV3CropPromptSavings(): V3CropPromptSavingsEstimate {
  const beforeSys = buildV3PageExtractionSystemPrompt();
  const afterSys = buildV3CardCropSystemPrompt();
  const beforeSchema = JSON.stringify(getV3LeafletPageGenAiSchema());
  const afterSchema = JSON.stringify(getV3CardCropGenAiSchema());
  const sampleOpts = { retailer: 'Panda', leafletId: 'panda-sample', slotId: 'p002_005' };
  const beforeUser = `Extract the single supermarket promotional offer card shown in this crop image (${sampleOpts.retailer}, leaflet "${sampleOpts.leafletId}", slot "${sampleOpts.slotId}"). Return strictly valid JSON with offers containing the extracted card (or compound offer tiers if multiple price badges share this cell) and normalized 0-1000 component bounding boxes.`;
  const afterUser = buildV3CardCropUserPrompt(sampleOpts);

  const beforeChars = beforeSys.length + beforeSchema.length + beforeUser.length;
  const afterChars = afterSys.length + afterSchema.length + afterUser.length;
  const estimatedBeforeTokens = Math.ceil(beforeChars / 4);
  const estimatedAfterTokens = Math.ceil(afterChars / 4);
  const reductionTokens = Math.max(0, estimatedBeforeTokens - estimatedAfterTokens);
  const pct = beforeChars > 0 ? Number((((beforeChars - afterChars) / beforeChars) * 100).toFixed(1)) : 0;

  return {
    isEstimate: true,
    beforePromptChars: beforeSys.length,
    afterPromptChars: afterSys.length,
    beforeSchemaJsonChars: beforeSchema.length,
    afterSchemaJsonChars: afterSchema.length,
    beforeUserPromptChars: beforeUser.length,
    afterUserPromptChars: afterUser.length,
    estimatedPromptAndSchemaTokenReduction: reductionTokens,
    estimatedPercentPromptReduction: pct,
    notes:
      'Offline approximation (~chars/4) comparing system prompt + responseSchema + user prompt characters. Vertex AI internal schema-compilation overhead (~4,914 text tokens observed on B1-REQ-04) can only be confirmed by an authorized live call.'
  };
}

export type V3PilotExecutionContext = 'normal_app' | 'isolated_pilot_runner';

export interface V3PilotPreflightOptions {
  executionContext: V3PilotExecutionContext;
  requestedProfile?: string | null;
  explicitV3Authorization?: boolean;
  model?: string;
  thinkingLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  tier?: 'flex' | 'standard' | 'batch';
  vertexLocation?: string;
  promptPayloadCandidate?: string | null;
}

export interface V3PilotPreflightResult {
  ok: boolean;
  canExecute: boolean;
  executionContext: V3PilotExecutionContext;
  requestedProfile: string;
  actualExecutedProfile: string | null;
  v3Activated: boolean;
  abortedReason: string | null;
  promptVersion: string;
  schemaVersion: string;
  promptSha256: string;
  schemaSha256: string;
  model: string;
  thinkingLevel: string;
  tier: 'flex' | 'standard' | 'batch';
  vertexLocation: string;
  groundTruthLeakDetected: boolean;
  groundTruthLeakKeys: string[];
}

const FORBIDDEN_GROUND_TRUTH_LEAK_KEYS = [
  'expected_sub_items',
  'expected_decomposed',
  'expected_child_count',
  'ground_truth',
  'gold_label',
  'gt_sub_items'
] as const;

export function getV3PromptAndSchemaFingerprints(): {
  promptVersion: string;
  schemaVersion: string;
  promptSha256: string;
  schemaSha256: string;
} {
  const promptSha256 = createHash('sha256')
    .update(buildV3PageExtractionSystemPrompt(), 'utf8')
    .digest('hex');
  const schemaSha256 = createHash('sha256')
    .update(JSON.stringify(getV3LeafletPageGenAiSchema()), 'utf8')
    .digest('hex');
  return {
    promptVersion: V3_PROMPT_VERSION,
    schemaVersion: V3_EXTRACTION_SCHEMA_VERSION,
    promptSha256,
    schemaSha256
  };
}

/**
 * Deterministic pilot preflight & profile isolation gate (§5).
 * - In `normal_app`: V3 is strictly blocked; frozen profiles execute untouched.
 * - In `isolated_pilot_runner`: unauthorized `extraction_v3` ABORTS fail-closed
 *   (`actualExecutedProfile = null`) and NEVER silently substitutes `'legacy'` while stamping V3.
 * - Rejects any prompt payload containing offline ground-truth keys.
 */
export function runV3PilotProfilePreflight(options: V3PilotPreflightOptions): V3PilotPreflightResult {
  const requestedProfile = options.requestedProfile || 'legacy';
  const fingerprints = getV3PromptAndSchemaFingerprints();
  const model = options.model || 'gemini-3.8-flash';
  const thinkingLevel = options.thinkingLevel || 'MEDIUM';
  const tier = options.tier || 'flex';
  const vertexLocation = options.vertexLocation || 'global';

  const leakKeys: string[] = [];
  if (options.promptPayloadCandidate) {
    const lowerPayload = options.promptPayloadCandidate.toLowerCase();
    for (const key of FORBIDDEN_GROUND_TRUTH_LEAK_KEYS) {
      if (lowerPayload.includes(key)) {
        leakKeys.push(key);
      }
    }
  }

  if (leakKeys.length > 0) {
    return {
      ok: false,
      canExecute: false,
      executionContext: options.executionContext,
      requestedProfile,
      actualExecutedProfile: null,
      v3Activated: false,
      abortedReason: `V3_PILOT_GROUND_TRUTH_LEAK_ABORT: Prompt payload contains forbidden ground-truth marker(s): ${leakKeys.join(', ')}.`,
      ...fingerprints,
      model,
      thinkingLevel,
      tier,
      vertexLocation,
      groundTruthLeakDetected: true,
      groundTruthLeakKeys: leakKeys
    };
  }

  if (options.executionContext === 'normal_app') {
    if (requestedProfile === V3_EXTRACTION_PROFILE_ID) {
      return {
        ok: false,
        canExecute: false,
        executionContext: 'normal_app',
        requestedProfile,
        actualExecutedProfile: 'legacy',
        v3Activated: false,
        abortedReason:
          'V3_BLOCKED_IN_NORMAL_WORKFLOW: Normal extraction workflow must remain on frozen legacy/optimized/compact_v1 profiles.',
        ...fingerprints,
        model,
        thinkingLevel,
        tier,
        vertexLocation,
        groundTruthLeakDetected: false,
        groundTruthLeakKeys: []
      };
    }

    const safeNormalProfile = SUPPORTED_LEAFLET_SCHEMA_VERSIONS.includes(requestedProfile as any)
      ? requestedProfile
      : 'legacy';
    return {
      ok: true,
      canExecute: true,
      executionContext: 'normal_app',
      requestedProfile,
      actualExecutedProfile: safeNormalProfile,
      v3Activated: false,
      abortedReason: null,
      ...fingerprints,
      model,
      thinkingLevel,
      tier,
      vertexLocation,
      groundTruthLeakDetected: false,
      groundTruthLeakKeys: []
    };
  }

  // isolated_pilot_runner context
  if (requestedProfile === V3_EXTRACTION_PROFILE_ID) {
    if (!options.explicitV3Authorization) {
      return {
        ok: false,
        canExecute: false,
        executionContext: 'isolated_pilot_runner',
        requestedProfile,
        actualExecutedProfile: null,
        v3Activated: false,
        abortedReason:
          'V3_PILOT_UNAUTHORIZED_ABORT: explicitV3Authorization=true is required to run extraction_v3; silent fallback to legacy is forbidden.',
        ...fingerprints,
        model,
        thinkingLevel,
        tier,
        vertexLocation,
        groundTruthLeakDetected: false,
        groundTruthLeakKeys: []
      };
    }

    return {
      ok: true,
      canExecute: true,
      executionContext: 'isolated_pilot_runner',
      requestedProfile,
      actualExecutedProfile: V3_EXTRACTION_PROFILE_ID,
      v3Activated: true,
      abortedReason: null,
      ...fingerprints,
      model,
      thinkingLevel,
      tier,
      vertexLocation,
      groundTruthLeakDetected: false,
      groundTruthLeakKeys: []
    };
  }

  const safePilotBaselineProfile = SUPPORTED_LEAFLET_SCHEMA_VERSIONS.includes(requestedProfile as any)
    ? requestedProfile
    : 'legacy';
  return {
    ok: true,
    canExecute: true,
    executionContext: 'isolated_pilot_runner',
    requestedProfile,
    actualExecutedProfile: safePilotBaselineProfile,
    v3Activated: false,
    abortedReason: null,
    ...fingerprints,
    model,
    thinkingLevel,
    tier,
    vertexLocation,
    groundTruthLeakDetected: false,
    groundTruthLeakKeys: []
  };
}

export interface V3TokenAndCostEstimate {
  isEstimate: true;
  baselineProfile: 'legacy' | 'compact_v1';
  baselineSystemPromptChars: number;
  v3SystemPromptChars: number;
  v3SchemaJsonChars: number;
  estimatedAdditionalInputTokensPerPage: number;
  estimatedAdditionalOutputTokensPerPage: number;
  estimatedFlexCostDeltaPerPageUsd: number;
  estimatedFlexCostDeltaPer100OffersUsd: number;
  notes: string;
}

/**
 * Reproducible offline token & latency estimate comparing V3 (`extraction_v3`)
 * against the observed Milestone 005 Noori/Dukan page baseline (~10 offers/page).
 * Clearly marked `isEstimate: true`.
 */
export function estimateV3IncrementalCostAndTokens(): V3TokenAndCostEstimate {
  const promptText = buildV3PageExtractionSystemPrompt();
  const schemaJson = JSON.stringify(getV3LeafletPageGenAiSchema());
  const approxInputDeltaTokens = Math.ceil((promptText.length + schemaJson.length) / 4) - 1100;
  // Additional structured sub_items + assortment + quantity_and_promo + conflicts per ~10-offer page
  const approxOutputDeltaTokens = 950;
  // Flex PayGo rates from geminiPricingTable.ts baseline: $0.375 / 1M input, $1.875 / 1M output/thinking
  const deltaPerPageUsd =
    (Math.max(0, approxInputDeltaTokens) / 1_000_000) * 0.375 +
    (approxOutputDeltaTokens / 1_000_000) * 1.875;
  // At ~10 offers/page -> 10 pages per 100 offers
  const deltaPer100OffersUsd = deltaPerPageUsd * 10;

  return {
    isEstimate: true,
    baselineProfile: 'legacy',
    baselineSystemPromptChars: 4200,
    v3SystemPromptChars: promptText.length,
    v3SchemaJsonChars: schemaJson.length,
    estimatedAdditionalInputTokensPerPage: Math.max(0, approxInputDeltaTokens),
    estimatedAdditionalOutputTokensPerPage: approxOutputDeltaTokens,
    estimatedFlexCostDeltaPerPageUsd: Number(deltaPerPageUsd.toFixed(6)),
    estimatedFlexCostDeltaPer100OffersUsd: Number(deltaPer100OffersUsd.toFixed(6)),
    notes:
      'Estimate only (~+4s to +12s Flex tail latency per 10-offer page expected due to richer sub_items[] structured JSON output; not empirically measured without authorized live Stage 2/WP5 call).'
  };
}
