# Antigravity Prompt Chunk 68: Page-First Mistral OCR 4.1 Structured Offer Extraction and Automatic Cropping

You are working inside the existing `wifran-offers-extractor` project.

This is Prompt Chunk 68.

The existing application already includes extensive extraction, normalization, validation, runtime-harness, preview, publishing-safety, crop-editor, local-CV, and local-detector infrastructure.

Do **not** rebuild the application from scratch.

This chunk changes the **primary extraction architecture** from:


detect or manually draw crop boxes
→ crop every item
→ call Mistral once per crop
→ validate item
```

to:


analyze the full rendered page with Mistral OCR 4.1
→ extract every independent offer on that page as structured JSON
→ use OCR blocks and bounding boxes to locate the evidence for each offer
→ generate individual item crops automatically
→ run deterministic completeness and safety checks
→ retry only suspicious pages
→ send only unresolved exceptions to review
```

The goal is:


No routine manual grid editing
No routine page-by-page operator review
No one-API-call-per-item workflow
At least 90% of pages processed without manual intervention
Strict prevention of unsafe offer-price publishing
Estimated annotated-OCR cost below USD 1.00 per leaflet
```

The page-first pipeline should become the normal extraction method.

The existing grid editor, templates, local CV detector, and local trained detector should remain available only as:


exception review tools
fallback tools
diagnostic tools
rollback compatibility
```

They must no longer be the primary path required before extraction.

---

## 1. Core Architectural Decision

The application should understand each **whole page** before creating individual offer crops.

The new primary workflow is:


Select PDF
→ parse filename metadata
→ render pages progressively
→ for each rendered page:
     send that page once to Mistral OCR 4.1
     request OCR blocks and structured offer annotation
     save raw OCR response
     save structured offer response
     locally match each structured offer to OCR evidence blocks
     determine one current-price anchor per independent offer
     generate automatic crop geometry
     generate item crop files
     normalize each offer into CanonicalOffer
     run deterministic checks
     calculate comparison and display-unit prices
     assign publish decision

→ automatically retry only suspicious pages
→ run automatic runtime accuracy harness
→ open Pre-Publish Preview
→ publish only after existing approval gates
```

There must be no normal workflow requirement to:


open every page in the crop editor
draw or accept a grid
accept Auto-Grid
mark every page complete manually
run item OCR one crop at a time
```

---

## 2. What Must Be Added

Implement:


page-first OCR 4.1 service
strict page-offer annotation schema
one-page-at-a-time OCR queue
OCR block storage
page offer-to-block evidence linker
automatic current-price-anchor matching
automatic offer crop construction
page completeness validation
automatic suspicious-page retry
page result reconciliation
resumable page processing
page-first cost/budget tracking
page-first progress UI
page-first extraction reports
page-first runtime-harness integration
legacy-pipeline fallback for unresolved exceptions
```

---

## 3. What Must Be Removed or Bypassed From the Primary Workflow

Do not permanently delete working code, but remove or bypass these from the normal path:


mandatory manual crop editor before OCR
mandatory grid setup
Auto-Suggest Grid as the primary extraction prerequisite
default fixed-grid concepts
brand-template selection as a primary prerequisite
page-by-page manual completion before extraction
local trained detector as primary offer identification
local CV region detection as primary offer identification
one extraction call per item crop
one validation call per item crop by default
separate Mistral page-style-profile calls
automatic local model training as a prerequisite for extraction
```

The following should become legacy/exception functionality:


Manual Crop Editor
Brand Templates
Local CV Suggestions
Local Detector Suggestions
Ctrl-drag box cloning
Manual Generate Row/Column/Grid
```

Normal operators should not see these tools during a successful page-first extraction.

Expose them only through an action such as:


Open Exception Crop Editor
```

for unresolved pages.

---

## 4. Do Not Delete Existing Safety Infrastructure

Preserve and reuse:


leaflet filename metadata parsing
supermarket/location code CSVs
CanonicalOffer
legacy field normalization
deterministic size/price checks
old-price/current-price checks
comparison safety
display-unit-price calculation
runtime accuracy harness
Pre-Publish Preview
dry-run publish
rehearsal mode
Supabase upload/upsert
idempotency
extraction manifest
reports
shared Mistral rate-limit queue
```

Adapt these components to consume page-first results instead of crop-first raw JSON.

---

# Part A — Page-First Mode and Rollout

## 5. Extraction Mode

Create a typed extraction mode:

```ts
export type ExtractionMode =
  | 'page_first_annotated_ocr'
  | 'legacy_crop_first';
```

The default for new extractions must be:


page_first_annotated_ocr
```

Do not require an environment variable.

Store the default in application configuration.

Keep `legacy_crop_first` only for:


rollback
diagnostics
unresolved-page fallback
older extraction packages
```

The operator should not need to choose a mode in ordinary use.

---

## 6. Safe Initial Rollout

Add a rollout status:

```ts
export type PageFirstRolloutMode =
  | 'pilot'
  | 'primary';
```

Default initially:


pilot
```

In `pilot` mode:


page-first processing runs fully
crops and canonical items are generated
reports and Pre-Publish Preview are generated
real DB publishing remains disabled
dry-run remains available
```

In `primary` mode:


page-first processing becomes eligible for the existing approved publish workflow
```

Do not require a new environment variable.

Store this in application config with a safe default.

Do not silently switch to `primary`.

The application may promote to `primary` later after QA or an explicit developer configuration change.

---

## 7. Disable Legacy Detector Activity in Page-First Mode

When extraction mode is page-first:


do not run brand-template auto-matching
do not run local CV grid suggestion automatically
do not run local ONNX detector automatically
do not run automatic detector training as part of the extraction
do not run auto-acceptance/review-queue logic for crop layouts
do not collect crop-layout annotations automatically
```

Do not delete:


training data
model registry
template archive
local detector source code
local CV source code
```

The detector may still be used later for optional crop-boundary refinement or fallback, but not for determining the number and identity of offers.

Set truthful status in page-first mode:


Primary offer detection: Mistral page-first OCR
Local offer detector: bypassed for this extraction
```

---

# Part B — Mistral OCR 4.1 Integration

## 8. Model and Endpoint

Use the Mistral OCR endpoint:


POST /v1/ocr
```

Default model:


mistral-ocr-4-1
```

Allow an internal code-level override to:


mistral-ocr-latest
```

but do not require the operator to configure it.

Do not reuse `mistral-large-2512` Chat Completions for this pipeline.

Do not use the old crop-level vision prompt in page-first mode.

Do not expose the API key to the renderer.

All requests must execute in the Electron main process through the existing secured Mistral provider architecture.

---

## 9. One Rendered Page Per Request

Send one rendered leaflet page image per OCR request.

Do not send:


the entire PDF in one annotation request
multiple unrelated pages in one item-extraction request
all pages with every offer
individual item crops in the primary pass
```

Use the rendered page image because:


its dimensions match the source used for automatic cropping
coordinates can be scaled deterministically
failures can be retried page by page
completed pages can be resumed
```

If the rendered page is excessively large, create a temporary OCR-analysis version while preserving the original for cropping.

Safe defaults:


maximum OCR analysis dimension: 2500 pixels on the longest side
preserve aspect ratio
use high-quality PNG or JPEG
record scale_x and scale_y
map all OCR coordinates back to the original rendered page
```

Do not overwrite the original rendered page.

---

## 10. OCR Request Parameters

Use the actual property names required by the installed Mistral SDK version.

The request must enable the API equivalents of:


include_blocks = true
confidence_scores_granularity = block
include_image_base64 = false
document_annotation_format = strict JSON schema
document_annotation_prompt = page-offer extraction prompt
```

Set:


extract_header = false
extract_footer = false
```

unless inspection proves those settings improve this leaflet use case.

Use an appropriate image limit without returning base64 payloads.

Do not log image bytes or base64.

Do not write the API key to logs or reports.

---

## 11. Shared Sequential Queue

Route all page-first requests through the existing shared Mistral queue.

Add request kinds:

```ts
export type MistralRequestKind =
  | 'page_offer_extraction'
  | 'page_offer_retry'
  | existing request kinds;
```

Free-tier-safe defaults:


maximum concurrent OCR requests = 1
minimum interval between request starts = 5000 ms
```

The queue must:


respect Retry-After
handle HTTP 429
handle transient 5xx failures
use bounded exponential backoff
never retry forever
persist completed pages
support cancellation
support resume
```

Maximum transport retries for one request:


3
```

Transport retries are separate from one semantic page re-extraction pass.

---

# Part C — Structured Page Annotation

## 12. Strict Page Offer Schema

Create:


src/shared/types/pageFirstOfferExtraction.ts
src/shared/schemas/pageFirstOfferExtractionSchema.ts
```

Use a strict top-level object.

Recommended shape:

```ts
export type PageFirstOfferExtraction = {
  schema_version: 1;

  page_number: number;

  page_classification:
    | 'offer_page'
    | 'cover'
    | 'advertisement'
    | 'terms'
    | 'blank'
    | 'mixed'
    | 'unknown';

  offers: PageFirstExtractedOffer[];

  uncertain_regions: Array<{
    region_hint:
      | 'top_left'
      | 'top'
      | 'top_right'
      | 'middle_left'
      | 'middle'
      | 'middle_right'
      | 'bottom_left'
      | 'bottom'
      | 'bottom_right'
      | 'unknown';

    reason:
      | 'possible_unread_offer'
      | 'ambiguous_price'
      | 'ambiguous_product_group'
      | 'possible_shared_price'
      | 'low_visual_confidence'
      | 'other';

    description: string;
  }>;

  page_summary: {
    independent_offer_count: number;
    independent_current_price_anchor_count: number;
    offers_with_original_price_count: number;
    offers_with_size_or_content_count: number;
    bundle_or_multi_buy_count: number;
    low_confidence_offer_count: number;
    final_completeness_check_performed: boolean;
  };
};
```

---

## 13. Offer Schema

Use:

```ts
export type PageFirstExtractedOffer = {
  temporary_offer_id: string;

  region_hint:
    | 'top_left'
    | 'top'
    | 'top_right'
    | 'middle_left'
    | 'middle'
    | 'middle_right'
    | 'bottom_left'
    | 'bottom'
    | 'bottom_right'
    | 'unknown';

  product: {
    title_ar: string | null;
    title_en: string | null;
    brand_text: string | null;
    description_ar: string | null;
    description_en: string | null;

    item_domain:
      | 'grocery'
      | 'household'
      | 'personal_care'
      | 'electronics'
      | 'appliance'
      | 'other_non_grocery'
      | 'unknown';

    variant_names: string[];
  };

  price_candidates: Array<{
    raw_text: string;
    normalized_value: number | null;
    currency: 'SAR' | null;

    role:
      | 'current_offer_price'
      | 'original_old_price'
      | 'multi_buy_total_price'
      | 'loyalty_price'
      | 'ambiguous_price'
      | 'not_a_price';

    is_crossed_out: boolean | null;
    confidence: 'high' | 'medium' | 'low';
    evidence_text: string;
  }>;

  selected_prices: {
    offer_price: number | null;
    original_price: number | null;
    currency: 'SAR' | null;

    offer_price_raw_text: string | null;
    original_price_raw_text: string | null;

    confidence: 'high' | 'medium' | 'low';
  };

  content: {
    size_text: string | null;

    each_size_value: number | null;
    each_size_unit:
      | 'liter'
      | 'milliliter'
      | 'kilogram'
      | 'gram'
      | 'piece'
      | 'dozen'
      | 'inch'
      | 'other'
      | null;

    pack_quantity: number | null;
    bundle_quantity: number | null;

    total_content_value: number | null;
    total_content_unit:
      | 'liter'
      | 'milliliter'
      | 'kilogram'
      | 'gram'
      | 'piece'
      | 'dozen'
      | 'other'
      | null;
  };

  price_basis: {
    basis:
      | 'each'
      | 'per_pack'
      | 'per_box'
      | 'per_bag'
      | 'per_kg'
      | 'per_2kg'
      | 'per_dozen'
      | 'bundle'
      | 'multi_buy'
      | 'unknown';

    raw_text: string | null;
  };

  promotion: {
    mechanic:
      | 'standard_price'
      | 'bogo'
      | 'bundle'
      | 'multi_buy'
      | 'loyalty_required'
      | 'selected_branches'
      | 'unknown';

    raw_text: string | null;
    condition_text: string | null;
  };

  evidence: {
    title_texts: string[];
    description_texts: string[];

    current_price_texts: string[];
    original_price_texts: string[];

    size_content_texts: string[];
    promotion_texts: string[];

    final_evidence_summary: string;
  };

  confidence: {
    overall: 'high' | 'medium' | 'low';
    product_identity: 'high' | 'medium' | 'low';
    current_price: 'high' | 'medium' | 'low';
    original_price: 'high' | 'medium' | 'low';
    size_content: 'high' | 'medium' | 'low';
    promotion: 'high' | 'medium' | 'low';
  };

  warnings: Array<{
    code: string;
    message: string;
    blocking: boolean;
  }>;
};
```

Do not allow arbitrary top-level keys.

Preserve the full raw annotation separately.

---

## 14. Page Offer Extraction Prompt

Create:


src/main/ocr/pageFirstOfferPromptBuilder.ts
```

The prompt must instruct Mistral approximately as follows:


You are analyzing one complete rendered page from a Saudi supermarket promotional leaflet.

Return strict JSON conforming exactly to the supplied schema.

Your primary requirement is completeness:
identify every independent product offer visible on this page.

Scan the page systematically:
top to bottom,
left to right,
including large hero offers,
small side offers,
top and bottom rows,
irregular offer panels,
and products placed on continuous shared backgrounds.

Offer grouping rules:

1. Create one offer entry for each independent current-offer price anchor.

2. If one visual region contains five separate current prices for five products,
   return five offer entries, not one grouped entry.

3. If several product variants share one current price and are clearly one offer,
   return one offer entry and place the variants in variant_names.

4. If several products form one bundle with one shared price,
   return one bundle offer.

5. A smaller crossed-out or old price is not a separate offer.
   Classify it as original_old_price.

6. Product size and content values are not prices:
   1.5L, 730ml, 10kg, 8×135g, 30PCS, inch measurements,
   4K, HD, FHD, UHD and similar product attributes must not be
   selected as current offer prices.

7. Discount percentages, loyalty points and product quantities
   are not current offer prices unless the page explicitly displays
   them as a payable price.

8. Every selected current offer price must be supported by exact visible evidence text.

9. Preserve the exact visible evidence text for:
   title,
   current price,
   original price,
   size/content,
   and promotion condition.

10. Do not add supermarket, location, leaflet filename or date metadata.
    Those values come from trusted application context.

11. Do not invent missing values.
    Use null and add a warning when unclear.

Before returning:
- count the independent current-price anchors;
- verify that every independent current-price anchor is represented;
- verify that no one offer contains several unrelated current-price anchors;
- scan all page edges and corners;
- set final_completeness_check_performed=true only after completing this audit.

Return JSON only.
```

Append or supply the strict JSON schema through `document_annotation_format`.

---

# Part D — Raw OCR Blocks and Artifacts

## 15. Store the Complete Raw OCR Response

For every page, preserve:


raw OCR response
page markdown
page dimensions
blocks
block labels
block confidence scores
image metadata
structured document annotation
usage information
request model
request timestamps
```

Recommended package paths:


metadata/page-first-ocr/page-001/raw-response.json
metadata/page-first-ocr/page-001/blocks.json
metadata/page-first-ocr/page-001/annotation.json
metadata/page-first-ocr/page-001/request-metadata.json
```

Do not store image base64.

Do not overwrite these files during retries.

Retry files:


metadata/page-first-ocr/page-001/retry-001/raw-response.json
metadata/page-first-ocr/page-001/retry-001/annotation.json
```

Use atomic writes.

---

## 16. OCR Block Type

Create a normalized local OCR block type:

```ts
export type NormalizedOcrBlock = {
  block_id: string;
  page_number: number;

  block_type: string | null;
  text: string;

  normalized_text: string;

  confidence: number | null;

  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  source_dimensions: {
    width: number;
    height: number;
  };

  rendered_page_bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};
```

Map all block coordinates to the original rendered page.

Validate that all coordinates remain inside page boundaries.

---

# Part E — Evidence Linking

## 17. Offer-to-Block Evidence Linker

Create:


src/main/page-first/evidenceLinkerService.ts
src/shared/types/pageOfferEvidenceLink.ts
```

For every structured offer, link its evidence strings to OCR blocks.

Recommended result:

```ts
export type PageOfferEvidenceLink = {
  temporary_offer_id: string;

  linked_block_ids: string[];

  title_block_ids: string[];
  description_block_ids: string[];

  current_price_block_ids: string[];
  original_price_block_ids: string[];

  size_content_block_ids: string[];
  promotion_block_ids: string[];

  current_price_anchor_block_id: string | null;

  confidence: number;

  unmatched_evidence: Array<{
    field: string;
    evidence_text: string;
  }>;

  warnings: string[];
};
```

---

## 18. Text Normalization for Matching

Implement local matching normalization for:


Arabic-Indic digits
Western digits
Arabic decimal separators
Western decimal points
commas
currency abbreviations
Arabic and English currency text
whitespace
line breaks
Unicode presentation forms
Arabic diacritics where appropriate
common OCR punctuation differences
```

Preserve original text.

Use normalized text only for matching.

Examples that should match:


١٠
10
10.00
١٠٫٠٠
```

when they represent the same price.

Do not use loose normalization that turns:


1.5L
```

into a match for:


1.51
```

Size/price distinction must remain strict.

---

## 19. Matching Strategy

Use weighted matching:


exact normalized evidence-text match
substring match
token overlap
controlled fuzzy text similarity
region_hint agreement
spatial relationship to current price
block confidence
field-specific expected positioning
```

Price matching must be stricter than product-title matching.

A current-price block should require:


strong numeric match
price role evidence
no attached size unit
spatial agreement
```

If several blocks match the same price:


use region hint
product-title proximity
old/current price relationship
neighboring offer anchors
```

If a current price cannot be linked confidently, the offer is unresolved.

---

# Part F — Price Anchors and Page Completeness

## 20. Current-Price Anchor Construction

Construct independent current-price anchors from:


structured selected current prices
price evidence texts
matched OCR price blocks
local block geometry
```

Do not rely only on classical color segmentation.

One offer should normally link to one independent current-price anchor.

Original-price blocks must remain attached to the same offer anchor.

---

## 21. Page Completeness Rules

Create:


src/main/page-first/pageCompletenessValidator.ts
```

Required checks:


structured independent_offer_count equals offers.length
every offer has one linked current-price anchor, unless explicitly unresolved
no current-price anchor is linked to multiple unrelated offers
no offer contains multiple unrelated current-price anchors
no high-confidence current-price-like OCR block remains uncovered
no selected offer price resembles a size/content value
no original price is selected as the current price
all crops can be constructed inside page bounds
all critical evidence blocks fit in their intended crop
```

Recommended result:

```ts
export type PageFirstCompletenessResult = {
  page_number: number;

  status:
    | 'pass'
    | 'pass_with_warnings'
    | 'retry_required'
    | 'unresolved'
    | 'failed';

  structured_offer_count: number;
  linked_offer_count: number;
  current_price_anchor_count: number;

  uncovered_current_price_anchor_block_ids: string[];
  duplicate_anchor_assignments: string[];
  offers_missing_current_price_link: string[];
  offers_with_multiple_current_price_links: string[];

  crop_geometry_failures: string[];

  blocking_issues: Array<{
    code: string;
    message: string;
  }>;

  warnings: Array<{
    code: string;
    message: string;
  }>;

  score: number;
};
```

---

## 22. Retry Conditions

Automatically retry the page once when:


a high-confidence current-price anchor is uncovered
an offer lacks a linked current-price anchor
one structured offer appears to contain several independent current prices
one OCR region appears to contain offers missed by the annotation
selected offer price resembles size/content
old/current price classification is inconsistent
structured offer count and current-price-anchor count differ materially
block confidence is too low for critical price evidence
crop geometry cannot separate neighboring offers
annotation schema validation fails
```

Default:


maximum semantic retry passes per page = 1
```

Do not retry every page.

---

## 23. Retry Prompt

Create a stricter completeness-audit prompt that includes local diagnostics but not image bytes in logs.

It should say approximately:


This is a second completeness audit of the same full leaflet page.

The first pass returned N offers.
Local evidence analysis found:
- X independent current-price anchors
- Y uncovered anchors
- Z offers without matched current-price evidence
- the following approximate page regions may contain missed offers: ...

Re-examine the entire page.

Return every independent offer using the same strict schema.

Pay special attention to:
- all uncovered price-anchor regions;
- side offers around large hero products;
- products sharing one continuous background;
- small top and bottom row offers;
- offers whose old price is visually close to the current price.

Do not preserve a first-pass grouping if it combines several independent prices.

Return a complete corrected page result.
```

---

## 24. First/Retry Reconciliation

Create:


src/main/page-first/pageExtractionReconciliationService.ts
```

Do not blindly append both offer arrays.

Match first- and retry-pass offers by:


current price
title similarity
region hint
linked current-price anchor
evidence blocks
```

Prefer the pass with:


better anchor coverage
fewer duplicate anchors
fewer missing critical links
higher block confidence
valid crop geometry
fewer blocking warnings
```

If both remain inconsistent:


mark page unresolved
generate exception review data
do not publish unresolved offers automatically
```

---

# Part G — Automatic Crop Construction

## 25. Crop Construction Service

Create:


src/main/page-first/automaticOfferCropService.ts
src/shared/types/automaticOfferCrop.ts
```

Recommended output:

```ts
export type AutomaticOfferCrop = {
  page_number: number;
  source_offer_key: string;
  source_item_number: string;

  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  included_block_ids: string[];
  included_image_region_ids: string[];

  current_price_anchor_block_id: string;

  crop_confidence: number;

  strategy:
    | 'evidence_union'
    | 'price_anchor_partition'
    | 'gutter_refined'
    | 'exception_fallback';

  warnings: string[];
};
```

---

## 26. Crop Geometry Algorithm

For each offer:


1. Start from the linked current-price anchor.
2. Include title blocks.
3. Include product description and size blocks.
4. Include original-price and promotion blocks.
5. Associate nearby product-image regions.
6. Create the union of the evidence.
7. Expand with safe padding.
8. Limit expansion using neighboring current-price anchors.
9. Use local whitespace/gutters to refine edges.
10. Ensure another offer’s current-price anchor is not inside the crop.
11. Ensure all critical evidence remains inside.
12. Clip to page bounds.
```

Use neighboring current-price anchors as partition seeds.

Weighted Voronoi-style page partitioning is acceptable as an intermediate geometry constraint.

Do not require equal rows, equal columns, or a global grid.

---

## 27. Product Image Association

Use:


OCR response image metadata where useful
local connected visual regions
product-image-like regions
distance to title and current price
neighboring anchor boundaries
```

Do not use the local trained detector as the primary offer identity source.

It may optionally help identify product-image extents only if a real active detector exists, but the page-first pipeline must work without it.

---

## 28. Crop Validation

A crop is safe only if:


current price anchor is inside
title or product identity evidence is inside
critical size/promotion evidence is inside when present
no unrelated current-price anchor is inside
crop is inside page bounds
crop dimensions are nonzero
crop does not heavily overlap an adjacent crop
```

If crop validation fails:


retry/refine locally
then mark unresolved if still unsafe
```

Do not produce a publishable item from an invalid crop.

---

## 29. Crop Filenames

Preserve the established naming convention:


{pdf-base-name}_{PPP}_{BBB}.webp
```

Where:


PPP = zero-padded page number
BBB = zero-padded offer number on the page
```

Store under:


crops/page-PPP/
```

Sort offers deterministically:


top-to-bottom
then left-to-right
```

Use current-price-anchor center as the main sorting reference.

---

## 30. Stable Item Identity on Rerun

Do not create duplicates when a page is reprocessed.

Create a stable source-offer key using:


leaflet identity
page number
normalized current-price-anchor position
normalized product title
offer price
```

When rerunning:


match new offers to prior page artifacts
preserve existing source_item_number when confidence is high
assign new numbers only to genuinely new offers
mark removed offers as superseded in local artifacts
```

Do not renumber every item unnecessarily.

---

# Part H — Canonical Offer and Existing Safety Pipeline

## 31. Convert Page Offers to CanonicalOffer

Create:


src/main/page-first/pageOfferCanonicalMapper.ts
```

Map page-first structured offers into the existing `CanonicalOffer`.

Preserve:


full raw OCR response
full raw annotation
evidence links
block IDs
crop geometry
completeness results
retry results
```

Trusted context still comes from:


leaflet filename metadata
selected supermarket
location metadata
offer dates
```

Do not take supermarket/location/date from OCR output.

---

## 32. Reuse Existing Checks

After mapping, run the existing:


deterministic price/size checks
old-price/current-price checks
trusted-context checks
comparison-safety calculation
display-unit-price calculation
publish decision engine
runtime accuracy harness
```

Do not run the old per-crop Mistral extraction call again.

Do not run the old per-item style-aware Mistral validation call by default.

The page retry serves as the model-level validation pass.

---

## 33. Unresolved Items

When an offer is unresolved:


preserve it in reports
show it in Pre-Publish Preview
set publish_decision = skip_or_quarantine
do not upload its image
do not upsert it
```

When the page is unresolved but some offers are individually safe:


retain the safe offers locally
default to preventing publish until the page-level completeness issue is resolved
```

The system should optimize for:


zero unsafe published price errors
```

not maximum row count at any cost.

---

# Part I — UI and Workflow

## 34. Import Page Changes

In page-first mode, the main operator flow should show:


Select PDF
Start Automatic Extraction
```

After the PDF is selected, show parsed:


supermarket
location
promotion start date
page count
estimated annotated OCR cost
estimated processing time
```

Do not show normal-path controls for:


Default Grid Rows
Default Grid Columns
Auto-Suggest Grid
Accept Auto-Grid
Mark Complete for every page
brand-template selection
```

The grid editor remains accessible through:


Advanced
→ Legacy / Exception Crop Editor
```

---

## 35. Page-First Test Actions

Add safe testing actions:


Test Current Page
Test Selected Pages
Process Entire Leaflet
Resume Processing
Retry Failed Pages
```

`Test Current Page` should process one rendered page and generate:


raw OCR
structured offers
evidence links
automatic crops
validation report
visual page result
```

It must not write to Supabase.

---

## 36. Progress UI

Show:


Pages rendered: 42 / 66
Primary OCR completed: 31 / 66
Page retries completed: 2 / 4
Offers detected: 487
Offers linked to evidence: 479
Crops generated: 472
Unresolved pages: 3
Estimated annotated OCR cost: $0.18
Elapsed: 27m
Estimated remaining: 22m
```

Page statuses:


not_started
queued
ocr_running
ocr_completed
linking
cropping
validating
completed
retry_pending
retry_running
unresolved
failed
```

---

## 37. Resumability

Persist page state after every stage.

On restart:


load manifest
skip completed pages
resume first incomplete page
preserve retry counts
preserve already generated crops
do not duplicate items
```

Add actions:


Retry Failed Pages
Retry Selected Page
Rebuild Crops From Existing OCR
```

Rebuilding crops from existing OCR must not make a new API call.

---

## 38. Pre-Publish Preview

Continue using the existing preview.

Each card should show:


automatic crop
page number
item number
product title
offer price
original price
size/content
promotion
comparison metadata
display-unit price
page extraction confidence
crop confidence
warnings
publish decision
```

Add page-first diagnostics:


OCR block confidence
evidence-link confidence
current-price-anchor match
page completeness status
primary or retry source
```

Add filters:


Unresolved Page
Unmatched Evidence
Low Crop Confidence
Retried Page
Uncovered Price Anchor
```

---

## 39. Exception Review

Only unresolved pages should require operator attention.

Add:


Open Exception Review
```

The exception view should show:


full page
structured offer list
OCR price anchors
generated crops
uncovered anchors
ambiguous evidence
```

Allow the operator to:


accept a safe crop
adjust a crop
split one crop
merge evidence into one offer
mark an offer as missed
mark page as no offers
```

Do not require opening this view for completed pages.

---

# Part J — Cost and Free-Tier Safety

## 40. Cost Budget

Add internal defaults:


ANNOTATED_OCR_ESTIMATED_USD_PER_PAGE = 0.005
LEAFLET_ANNOTATED_OCR_BUDGET_USD = 0.95
MAX_SEMANTIC_RETRY_PASSES_PER_PAGE = 1
```

These should not be required environment variables.

Estimate:

```ts
estimated_cost_usd =
  total_annotated_page_requests * estimated_price_per_page;
```

Count:


primary page calls
semantic retry page calls
```

Do not count transport retries that Mistral does not bill separately unless usage indicates otherwise.

---

## 41. Budget Gate

Before processing:


calculate projected primary-pass cost
```

Before every semantic retry:


calculate projected total cost
```

Rules:


if primary pass exceeds $0.95:
  block and show estimated cost

if retry would exceed $0.95:
  do not run retry
  mark page unresolved_due_to_budget
```

Do not silently exceed the configured budget.

Show:


Projected annotated OCR cost: $0.33
Maximum budget: $0.95
```

Record both:


list-price-equivalent cost estimate
Mistral usage_info pages processed
```

Do not claim actual billing if the account uses free-tier allowance.

---

# Part K — Package Structure and Manifest

## 42. Package Artifacts

Add:


metadata/page-first-ocr/
metadata/page-offer-links/
metadata/page-completeness/
metadata/automatic-crops/
metadata/page-reconciliation/
metadata/reports/page-first-extraction-report.json
metadata/reports/page-first-extraction-report.md
```

Keep existing:


pages/
crops/
json/
metadata/
logs/
```

Per-item JSON files should still be written under:


json/page-PPP/{item-file-name}.json
```

These should contain the final canonical page-first item result for compatibility.

---

## 43. Manifest Section

Add:

```json
{
  "extraction_mode": "page_first_annotated_ocr",

  "page_first_ocr": {
    "status": "not_started",
    "rollout_mode": "pilot",
    "model": "mistral-ocr-4-1",

    "total_pages": 0,
    "primary_completed_pages": 0,
    "retry_completed_pages": 0,
    "completed_pages": 0,
    "unresolved_pages": 0,
    "failed_pages": 0,

    "offers_detected": 0,
    "offers_linked": 0,
    "crops_generated": 0,

    "estimated_cost_usd": 0,
    "budget_usd": 0.95,

    "started_at": null,
    "completed_at": null,

    "page_state_path": "metadata/page-first-ocr/page-state.json",
    "report_path": "metadata/reports/page-first-extraction-report.json"
  }
}
```

Older manifests must load safely.

Legacy extraction packages must remain accessible.

---

# Part L — Runtime Accuracy Harness

## 44. Page-First Runtime Gate

Extend the runtime harness.

Critical page-first failures:


publishable offer without current-price-anchor link
publishable offer with current price resembling size/content
publishable offer using old price as current price
high-confidence current-price anchor left uncovered
same current-price anchor assigned to multiple offers
one crop contains unrelated current-price anchors
invalid crop geometry
comparison_eligible=true with unsafe calculation
page marked completed despite blocking completeness issue
```

Any such condition must produce:


block_publish
```

---

## 45. Page-First Quality Metrics

Track:


total pages
offer pages
non-offer pages
primary OCR pages
retry OCR pages
offers detected
offers linked
offers missing current-price anchors
uncovered current-price anchors
duplicate anchor assignments
automatic crops generated
valid crops
invalid crops
pages passed without retry
pages passed after retry
unresolved pages
estimated cost
processing time
```

Accuracy targets to report:


page automation rate
offer-anchor-link rate
valid-crop rate
page retry rate
manual-review rate
publishable-row rate
critical-error count
```

Do not claim 90% accuracy without measured labeled results.

---

# Part M — Reports

## 46. Page-First Extraction Report

Create:


metadata/reports/page-first-extraction-report.json
metadata/reports/page-first-extraction-report.md
```

Include per-page:


page classification
structured offer count
current-price-anchor count
linked offer count
uncovered anchors
primary/retry status
crop count
unresolved reason
request usage
estimated cost
```

Include per-offer:


title
offer price
original price
size
evidence links
crop path
confidence
warnings
publish decision
```

---

## 47. Update Existing Reports

Update:


accuracy-run-report.json
runtime-accuracy-harness-report.json
pre-publish-preview-summary.json
qa-dry-run-publish-report.json
```

Add:


extraction_mode
page_first_primary_requests
page_first_retry_requests
page_first_estimated_cost_usd
page_first_offers_detected
page_first_offers_linked
page_first_uncovered_anchors
page_first_valid_crops
page_first_unresolved_pages
page_first_manual_review_rate
```

Mark local-detector metrics as:


not_used_in_page_first_mode
```

when applicable.

---

# Part N — Legacy Cleanup and Compatibility

## 48. Normal UI Cleanup

In page-first mode, hide or move under Advanced:


Auto-Suggest Grid
Accept Auto-Grid
Default Grid Rows
Default Grid Columns
brand template pane
template * cycling
local detector status
auto-acceptance status
training-data counters
```

Do not delete the functionality.

The operator should not be confused into believing grid setup is required.

---

## 49. Disable Redundant API Calls

In page-first mode, do not run:


separate page style-profile Mistral call
per-crop Mistral extraction call
per-item Mistral validation call
```

Use:


one annotated OCR request per page
one retry request only for suspicious pages
local deterministic processing
```

This requirement is essential for the cost target.

---

## 50. Existing Crop Editor

Rename normal entry points to make the role clear:


Manual Crop Editor
```

becomes:


Exception Crop Editor
```

or:


Legacy / Exception Crop Editor
```

Opening it must not automatically discard page-first data.

Manual crop corrections should update only the selected unresolved offer/page.

---

# Part O — Tests

## 51. Unit Tests

Add tests for:


strict page annotation schema
prompt contains independent-price-anchor rules
prompt distinguishes one shared bundle price from several independent offers
Arabic/Western digit normalization
size text cannot match offer price
offer evidence linking
price block matching
old-price block linking
page completeness calculation
retry conditions
first/retry reconciliation
crop boundary construction
neighboring anchor exclusion
stable item sorting
stable item identity
cost estimation
budget enforcement
manifest backward compatibility
```

No unit test may call Mistral.

---

## 52. Synthetic Page Tests

Create synthetic fixtures:


regular 4-column grid
large center hero offer with two side offers on each side
13-offer mixed page
shared-background campaign page
bundle offer with one shared price
several variants sharing one price
electronics page
advertisement-only page
blank page
```

For the mixed 13-offer fixture, verify:


13 structured offers
13 independent current-price anchors
13 offer-anchor links
13 generated crops
0 uncovered anchors
0 multi-anchor crops
```

---

## 53. Mock OCR Response Fixtures

Create saved fixture responses containing:


pages[].blocks
block confidence
page dimensions
document_annotation
usage_info
```

Test the complete local chain:


mock raw OCR
→ parse annotation
→ normalize blocks
→ link evidence
→ validate completeness
→ build crops
→ build canonical offers
→ run deterministic checks
```

---

## 54. Live Pilot Command

Add an explicitly opt-in live command:


npm run pilot:page-first-ocr -- --package "Extracts_QA/<package>" --pages "2"
```

or an equivalent safe app action.

Requirements:


requires existing Mistral API key
uses the real sequential queue
processes only specified pages
never writes to Supabase
never publishes
writes complete pilot reports
prints estimated cost before starting
```

Do not run this command during automated verification.

---

## 55. Integration Tests

Using mocks, test:


progressive rendering enqueues each page once
completed page is skipped on resume
failed page retries safely
retry result reconciles
unresolved page is quarantined
completed page generates item crops
no crop-first API request occurs
no separate style-profile API request occurs
no item-validation API request occurs
legacy mode remains callable
pilot mode blocks real DB publishing
```

---

# Part P — First Live Test and Acceptance Stages

## 56. Stage 1: One Difficult Page

The first live test must use the previously problematic mixed-layout page.

Known manual benchmark:


13 independent offers
```

The test should report:


offers returned
current-price anchors found
offers linked
crops generated
uncovered anchors
duplicate anchors
estimated cost
processing time
```

Do not publish.

Do not change the known expected count just to make the test pass.

---

## 57. Stage 2: Five Diverse Pages

After Stage 1:


regular grid page
mixed hero page
dense page
bundle/multi-buy page
unusual campaign-style page
```

Measure:


offer-detection recall against manual count
offer-price accuracy
original-price accuracy
size accuracy
crop accuracy
pages needing retry
pages needing exception review
```

---

## 58. Stage 3: Full Leaflet

Only after Stage 1 and Stage 2 are acceptable:


process the entire leaflet sequentially
resume safely after interruption
produce all reports
open Pre-Publish Preview
run dry-run publish only
```

Do not enable real publishing merely because the full run completes.

---

# Part Q — Security and Safety

## 59. Security Rules

Follow these rules:

- Do not expose the Mistral API key to the renderer.
- Do not log authorization headers.
- Do not log page image base64.
- Do not include `.env.local` in reports.
- Do not create new required operator environment settings.
- Do not call Supabase during pilot tests.
- Do not publish during pilot mode.
- Do not silently exceed the OCR cost budget.
- Do not fabricate successful OCR output.
- Do not treat schema-invalid annotation as success.
- Do not publish unresolved pages.
- Do not delete the local detector code or training data.
- Do not use the local detector as the primary offer-identity source.
- Do not run old crop-level API calls in page-first mode.
- Do not overwrite raw OCR or retry artifacts.
- Do not allow a partial page result to look complete.

---

# Part R — Acceptance Criteria

## 60. Implementation Acceptance Criteria

This chunk is complete when:

- Page-first annotated OCR mode exists.
- New extractions default to page-first mode.
- Mistral OCR 4.1 is used through `/v1/ocr`.
- One rendered page is processed per request.
- OCR blocks, block labels and block confidence are requested.
- A strict page-offer document-annotation schema exists.
- The prompt requires every independent offer and independent current-price anchor.
- Raw OCR and annotation artifacts are stored.
- Structured offers are linked to OCR blocks.
- Current-price anchors are matched locally.
- Individual crops are generated automatically.
- Crop geometry is validated.
- Suspicious pages retry automatically once.
- Completed pages resume without duplicate calls.
- Unresolved pages are quarantined.
- CanonicalOffer and existing safety checks are reused.
- Cost estimation and a sub-$1 budget gate exist.
- Progress UI exists.
- Pre-Publish Preview shows page-first results.
- Normal workflow no longer requires grid editing.
- Local detector/template/manual grid systems are bypassed in normal page-first mode.
- Legacy/exception editor remains available.
- Separate style-profile calls are disabled in page-first mode.
- Per-crop extraction calls are disabled in page-first mode.
- Per-item validation calls are disabled by default in page-first mode.
- Pilot mode blocks real DB publishing.
- TypeScript compiles.
- Existing tests pass.
- Accuracy harness passes.
- Automated tests make no real Mistral or Supabase calls.

---

## 61. Operational Target Metrics

The pilot must report, but not falsely guarantee:


offer detection recall
offer price accuracy
original price accuracy
size/content accuracy
automatic crop accuracy
page automation rate
manual exception rate
estimated API cost
processing time
```

Required critical safety target:


wrong offer price published = 0
size-as-price published = 0
old-price-as-current published = 0
unsafe comparison published = 0
```

Desired automation target:


at least 90% of pages completed without manual crop editing
```

Do not promote to primary publishing mode unless measured results justify it.

---

## 62. Commands to Run

Run only offline/mocked verification:

```bash
npm run typecheck
npm test
npm run harness:accuracy
npm run ml:doctor
npm run ml:dataset:verify
npm run ml:model:registry:verify
npm run ml:inference:fixture
npm run ml:auto-acceptance:verify
```

Add and run a mock-only page-first test command if useful:


npm run test:page-first-ocr
```

Do not run the live pilot automatically.

Do not make real OCR calls in `npm test`.

---

## 63. Autonomy Rule

Proceed autonomously through the entire chunk without requesting intermediate approval.

Inspect the existing architecture first.

Implement the complete page-first pipeline while preserving existing safety, reporting, preview and publishing modules.

Remove or bypass obsolete primary-flow dependencies.

Keep the application runnable.

Do not perform a real live OCR request automatically.

Do not write to Supabase.

Do not publish offers.

---

## 64. Final Response Required From Antigravity

After finishing, report:


files modified
files created

new extraction-mode behavior
what was removed from the normal workflow
what was retained as legacy/exception fallback

Mistral OCR 4.1 request implementation
strict annotation schema
page-offer prompt
block-confidence configuration
shared queue behavior

raw artifact paths
evidence-linking behavior
current-price-anchor behavior
page-completeness checks
retry and reconciliation behavior
automatic crop-generation behavior
stable item-identity behavior

canonical normalization integration
deterministic-check integration
runtime-harness integration
Pre-Publish Preview changes

cost-estimation and budget-gate behavior
progress and resumability behavior
manifest/report changes

tests and fixtures added
commands run
commands skipped and why
whether typecheck passed
whether tests passed
whether accuracy harness passed
whether ML diagnostics remained safe

confirmation that:
- no real Mistral request was run automatically
- no Supabase call was made
- no real publishing occurred
- local detector code/data was not deleted

remaining risks

exact instructions for running:
1. one-page live pilot,
2. five-page pilot,
3. full-leaflet pilot