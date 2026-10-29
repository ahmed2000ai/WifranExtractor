# Antigravity Prompt Chunk 67: Price-Anchor Offer Splitting, Immediate Leaflet-Session Adaptation, and Ctrl-Drag Box Cloning

You are working inside the existing `wifran-offers-extractor` project.

This is Prompt Chunk 67.

Chunks 62–66 and the related hotfixes should already be implemented, especially:

```text
62-auto-detect-page-offer-blocks-and-suggest-crop-grid.md
63-remove-fixed-grid-reset-templates-and-collect-training-annotations.md
64-automatic-local-offer-block-detector-training-and-onnx-inference.md
65-automatic-high-confidence-page-acceptance-and-review-queue.md
66-replace-mocked-ml-subsystem-with-real-local-runtime.md
66A-empty-dataset-bootstrap-and-verifier-hotfix.md
66B-fix-auto-acceptance-safety-verifier.md
```

A real-page pilot exposed a serious weakness in the current local CV fallback:

```text
The detector identified one large rectangular middle region containing five independent offers and proposed it as one crop box.
```

The page had multiple visually independent current-price labels inside that proposed region. A complete offer-block detector must not treat several independent offer-price anchors as one offer.

This chunk must implement three connected improvements:

```text
1. Price-anchor-driven splitting and offer-box completeness checks.
2. Immediate within-leaflet learning after every confirmed page.
3. Ctrl-drag cloning for one or multiple crop boxes.
```

This chunk must not call Mistral.

This chunk must not use any external API or hosted service.

This chunk must not upload images or write to Supabase.

This chunk must not activate an unvalidated detector model.

This chunk must not retrain the permanent detector after every page.

---

## 1. Primary Goals

The crop suggestion system should move from:

```text
Find large connected visual regions
```

to:

```text
Detect likely independent offer-price anchors
→ associate product/title regions with each anchor
→ form one complete offer box per independent offer
→ split over-merged regions
→ verify that every visible offer-price anchor is covered exactly once
```

The app should also learn immediately within the current leaflet:

```text
Page confirmed
→ create/update a trusted layout prototype for that page’s visual cluster
→ automatically re-evaluate similar unreviewed pages
→ improve suggestions during the same leaflet session
```

The operator should also be able to duplicate boxes efficiently:

```text
Hold Ctrl
→ drag one selected box or a selected group
→ drop a cloned copy
```

---

## 2. Important Distinction: Immediate Adaptation vs Permanent Model Training

Implement two separate learning timescales.

### Immediate leaflet-session adaptation

Runs after every confirmed page.

It uses:

```text
confirmed boxes
page layout fingerprint
price-anchor positions
normalized box geometry
gutters and alignment
supermarket code
```

It improves suggestions for visually similar pages in the same leaflet immediately.

It does not retrain the ONNX detector.

### Permanent detector training

Continues using the controlled process implemented in Chunks 63–66:

```text
collect trusted annotations
→ reach minimum dataset threshold
→ train candidate locally
→ evaluate
→ export and verify ONNX
→ activate only if safety thresholds pass
```

Do not start permanent model training after page 1, page 2, or every individual edit.

---

## 3. Inspect These Areas First

Inspect the current implementations for:

```text
local CV crop suggestions
brand-template matching
active detector inference
CV boundary refinement
page review queue
crop box state and selection
pointer/drag interactions
undo/redo
page confirmation
training annotation collection
runtime accuracy harness
crop suggestion artifacts
page-level reports
```

Likely paths include:

```text
src/main/image/
src/main/crop-suggestions/
src/main/ml/
src/main/accuracy/
src/main/reporting/
src/main/workflow/
src/main/extraction/
src/renderer/src/components/manual-crop/
src/renderer/src/components/crop-suggestions/
src/renderer/src/pages/
src/shared/types/
```

Search for existing concepts such as:

```text
SuggestedCropBox
PageCropSuggestionResult
DetectorPageQualityResult
ManualCropEditor
selection
drag
pointerdown
pointermove
pointerup
clone
duplicate
undo
confirm page
training annotation
```

Extend the current system rather than creating a parallel crop-editor implementation.

---

# Part A — Price-Anchor Detection and Offer-Block Splitting

## 4. Price-Anchor Concept

A price anchor is a visually prominent current-offer-price region.

Exact OCR of the price value is not required for crop detection.

The local detector should identify likely price anchors using local visual signals such as:

```text
large digit-like glyph regions
high-contrast price-label regions
rounded or rectangular colored price blocks
currency-symbol proximity
repeated visual price-label style within the page
large current price near a smaller crossed-out/original price
position relative to nearby product image and description
```

Do not hardcode one color.

Price labels may be:

```text
red
purple
orange
green
gold
white on a colored background
another campaign-specific color
```

Use page-relative visual repetition and typography rather than a fixed color rule.

---

## 5. Price-Anchor Grouping

An offer often contains:

```text
one large current price
one smaller original price
one currency symbol
```

These must be treated as one price-anchor group, not multiple offers.

Create a type similar to:

```ts
export type PriceAnchorGroup = {
  id: string;
  pageNumber: number;

  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  currentPriceRegion: {
    bounds: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    confidence: number;
  } | null;

  originalPriceRegions: Array<{
    bounds: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    confidence: number;
    likelyCrossedOut: boolean;
  }>;

  currencyRegions: Array<{
    bounds: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    confidence: number;
  }>;

  confidence: number;

  reasonCodes: string[];
};
```

Group price-like regions when they are close enough to represent the same offer-price stack.

Do not group visually independent current-price labels separated by different product/title regions.

---

## 6. Local Price-Anchor Detection Pipeline

Implement a deterministic local pipeline.

Suggested stages:

```text
1. Load rendered page image.
2. Downscale for analysis while retaining coordinate scale.
3. Find saturated/high-contrast candidate label regions dynamically.
4. Find text/digit-like connected components.
5. Detect repeated prominent numeric-region styles.
6. Group current price, old price, and currency components into price-anchor groups.
7. Map anchor bounds back to original page coordinates.
8. Assign anchor confidence.
```

Use the project’s existing local CV stack.

Do not introduce external calls.

If OpenCV is already available, use suitable operations such as:

```text
connected components
morphological closing/opening
contour grouping
adaptive thresholding
edge density
color-space clustering
```

If the project uses another local image stack, implement equivalent operations.

---

## 7. Independent Current-Price Anchors

A proposed offer box should normally contain:

```text
exactly one independent current-price anchor group
```

Allowed exceptions must be explicit and conservative, for example:

```text
one price covering several variants within one offer
one bundle showing several products but one price
```

A proposed box containing several independent current-price anchors is suspicious.

Create diagnostics:

```ts
export type OfferBoxAnchorDiagnostic = {
  boxId: string;

  containedAnchorGroupIds: string[];
  containedIndependentCurrentPriceCount: number;

  uncoveredAnchorGroupIds: string[];

  status:
    | 'valid_single_anchor'
    | 'multi_anchor_requires_split'
    | 'no_anchor_requires_review'
    | 'ambiguous';

  reasonCodes: string[];
};
```

---

## 8. Split Over-Merged Regions

When one candidate box contains multiple independent current-price anchors:

```text
do not show the large box as one normal suggestion
```

Attempt to split it.

Recommended splitting approach:

```text
1. Treat current-price-anchor centers as seeds.
2. Examine whitespace valleys, edge-density valleys, product clusters, and text clusters.
3. Construct candidate partitions around each anchor.
4. Expand each partition to include nearby product image and title.
5. Use midlines or weighted Voronoi boundaries between neighboring anchors.
6. Refine boundaries using gutters/separators.
7. Prevent overlap between final offer boxes.
8. Verify that each independent anchor belongs to one resulting box.
```

For a layout with:

```text
two offers on the left
one large hero offer in the center
two offers on the right
```

the splitting system should preserve the large central offer while creating separate boxes for the four side offers.

Do not force all resulting boxes to have equal dimensions.

---

## 9. Product and Text Association

For each price anchor, associate nearby regions using weighted spatial rules:

```text
product image above or beside price
description/title near product or price
old price close to current price
currency symbol close to current price
local card boundary or whitespace
```

Avoid capturing a neighboring product merely because it shares the same background.

Prefer a complete offer box containing:

```text
product image
product name/description
size/pack label
current price
original price if present
promotion badge if part of that offer
```

---

## 10. Page-Level Completeness Validation

Before showing or accepting suggestions, run page-level checks.

Required checks:

```text
every independent current-price anchor belongs to exactly one suggested box
no independent current-price anchor is left outside all boxes
no suggested box contains multiple independent current-price anchors without an explicit valid exception
no two boxes claim the same anchor
all boxes remain within page bounds
no giant box contains several visually separated offer clusters
no suspiciously large visible content region remains uncovered
```

Create a result similar to:

```ts
export type PageOfferCompletenessResult = {
  pageNumber: number;

  status:
    | 'complete'
    | 'review_required'
    | 'failed';

  priceAnchorCount: number;
  suggestedBoxCount: number;

  uncoveredAnchorIds: string[];
  duplicateAnchorIds: string[];
  multiAnchorBoxIds: string[];
  anchorlessBoxIds: string[];

  largeUncoveredRegions: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;

  score: number;
  reasonCodes: string[];
};
```

---

## 11. Safety Gate

A page must not proceed automatically to cropping or OCR when:

```text
uncoveredAnchorIds.length > 0
duplicateAnchorIds.length > 0
multiAnchorBoxIds.length > 0
invalid geometry exists
completeness status is failed
```

Send such pages to:

```text
Review Required
```

A low-confidence one-box suggestion containing several independent prices must never become trusted training data.

---

## 12. Suggestion Provenance

Add suggestion sources such as:

```text
local_cv_initial
local_detector_initial
price_anchor_split
leaflet_session_adapted
brand_template
operator_manual
```

Preserve:

```text
original detector/CV output
price anchors
post-split suggestion output
session-adapted output
final confirmed boxes
```

Do not overwrite earlier stages.

Suggested artifact paths:

```text
metadata/price-anchors/page-001-price-anchors.json
metadata/crop-suggestions/page-001-initial-suggestions.json
metadata/crop-suggestions/page-001-anchor-split-suggestions.json
metadata/crop-suggestions/page-001-session-adapted-suggestions.json
metadata/crop-completeness/page-001-completeness.json
```

---

# Part B — Immediate Within-Leaflet Adaptation

## 13. Page Fingerprints

Create a local page-layout fingerprint without external APIs.

The fingerprint may include:

```text
page aspect ratio
normalized color histogram
edge-density map
whitespace/gutter map
price-anchor count
normalized price-anchor positions
candidate product-cluster positions
major panel boundaries
background color distribution
```

Create a type similar to:

```ts
export type LeafletPageLayoutFingerprint = {
  pageNumber: number;
  pageImagePath: string;

  pageWidth: number;
  pageHeight: number;

  perceptualHash: string | null;
  colorHistogram: number[];
  edgeGrid: number[];
  whitespaceGrid: number[];

  normalizedPriceAnchorCenters: Array<{
    x: number;
    y: number;
  }>;

  priceAnchorCount: number;

  createdAt: string;
};
```

---

## 14. Layout Clustering

Group visually similar pages within the current leaflet.

Do not assume consecutive pages belong to the same layout.

A leaflet may contain:

```text
regular product-grid pages
hero-offer pages
brand-campaign pages
premium product pages
cover/advertisement pages
```

Create session clusters using weighted similarity of:

```text
fingerprint
price-anchor arrangement
gutter structure
aspect ratio
major panel geometry
```

Suggested type:

```ts
export type LeafletLayoutCluster = {
  clusterId: string;

  memberPageNumbers: number[];
  confirmedPageNumbers: number[];
  unreviewedPageNumbers: number[];

  prototypeConfidence: number;

  prototype: {
    normalizedConfirmedBoxes: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>;

    normalizedPriceAnchors: Array<{
      x: number;
      y: number;
    }>;

    expectedBoxCountRange: {
      min: number;
      max: number;
    };
  } | null;
};
```

---

## 15. Adapt Immediately After Every Confirmed Page

When the operator confirms a page:

```text
1. Save/update its trusted training annotation.
2. Calculate or update its layout cluster.
3. Update the cluster prototype using confirmed boxes.
4. Re-evaluate all unreviewed pages in the same cluster.
5. Regenerate only their suggestion layer.
6. Do not overwrite accepted/manual/dirty pages.
7. Record what changed.
```

This adaptation should happen after the first confirmed page.

However, confidence should increase gradually:

```text
1 confirmed page in cluster:
  prototype available but low confidence
  adapted suggestions remain review-required

2 confirmed pages in cluster:
  stronger prototype

3 or more confirmed pages in cluster:
  robust median/consensus prototype may be used confidently
```

Do not auto-accept pages based solely on one confirmed prototype page.

---

## 16. Prototype Construction

Use robust normalized geometry.

Do not simply copy absolute coordinates.

Recommended approach:

```text
normalize confirmed boxes by page width/height
match boxes to price-anchor positions
calculate robust median geometry across confirmed pages
retain layout variation ranges
align prototype to current page’s detected anchors and gutters
```

Session adaptation should guide splitting, matching, and box boundaries.

It must not suppress new offers visible on a target page.

Price-anchor completeness checks remain mandatory after applying a prototype.

---

## 17. Bootstrap Review Policy

For a new leaflet:

```text
the first confirmed page may immediately improve similar pages
the first 3 confirmed pages provide stronger initial adaptation
every newly detected layout cluster must have at least one confirmed page before that cluster can be treated as learned
```

Do not force the first three physical pages if they belong to the same layout.

Prefer:

```text
at least one confirmed page from each detected layout cluster
```

The app should automatically guide the operator to high-value review pages:

```text
first unresolved page from an unconfirmed cluster
page with most multi-anchor conflicts
page with highest suspected missed-offer risk
```

---

## 18. Re-Evaluation Safety

Do not replace suggestions on pages that have:

```text
confirmed boxes
accepted boxes
manual edits
dirty unsaved changes
explicitly rejected adaptation
```

For unreviewed pages, preserve versions:

```text
initial suggestions
session-adapted suggestions
```

Show a non-blocking message:

```text
Confirmed layout improved suggestions on 6 similar pages.
```

If no similar pages exist, do nothing.

---

## 19. Session Learning Artifact

Create:

```text
metadata/session-layout-learning/leaflet-layout-session.json
```

Recommended structure:

```ts
export type LeafletLayoutSession = {
  schema_version: 1;

  leafletId: string | null;
  supermarketCode: string | null;

  createdAt: string;
  updatedAt: string;

  fingerprints: Record<string, LeafletPageLayoutFingerprint>;

  clusters: LeafletLayoutCluster[];

  adaptationEvents: Array<{
    eventId: string;
    confirmedPageNumber: number;
    clusterId: string;
    affectedPageNumbers: number[];
    createdAt: string;
    resultSummary: string;
  }>;
};
```

Session adaptation must persist across app restarts for that extraction package.

It should not be treated as permanent cross-leaflet model training.

---

# Part C — Ctrl-Drag Box Cloning

## 20. Required Interaction

Implement standard Ctrl-drag cloning in the crop editor.

### Single box

```text
Hold Ctrl
→ pointer down on a box
→ drag
→ original remains
→ clone preview follows pointer
→ release to place cloned box
```

### Multiple selected boxes

If multiple boxes are selected and the drag begins on one selected box:

```text
Hold Ctrl
→ drag
→ duplicate the entire selected group
→ preserve relative spacing
→ release to place all clones
```

If the clicked box is not part of the existing multi-selection:

```text
clone only the clicked box
```

Determine clone mode at pointer-down using `event.ctrlKey`.

Support both left and right Ctrl keys through the normal pointer event modifier state.

---

## 21. Clone Preview

During Ctrl-drag:

```text
show translucent clone outlines
keep originals unchanged
use existing snapping/guides
show copy cursor or small plus indicator
```

Do not commit clones until pointer-up.

Allow:

```text
Esc → cancel cloning
```

If the pointer does not cross the normal drag threshold:

```text
do not create a clone
```

This prevents accidental duplicates.

---

## 22. Box IDs and Numbering

Every cloned box must receive:

```text
new unique internal ID
new available box/item number
```

Do not reuse source IDs.

Do not renumber existing boxes automatically.

For a cloned group:

```text
assign new numbers in the group’s visual top-to-bottom, left-to-right order
```

The existing `Renumber All` action may remain available.

---

## 23. Clone State Rules

Clone editable crop properties and geometry, but reset all derived processing state.

Reset:

```text
crop image path
crop generation status
OCR JSON path
OCR status
validation result
deterministic check result
comparison result
publish decision
DB sync state
runtime harness state
error state
```

Mark clone source:

```text
operator_ctrl_drag_clone
```

Mark the page:

```text
layout dirty
crop artifacts stale
OCR artifacts stale
validation stale
preview stale
```

Do not copy a source box’s completed extraction or publishing state.

---

## 24. Bounds and Placement

The cloned group must remain inside the rendered page.

Preferred behavior:

```text
clamp the complete cloned group so all clones remain inside page bounds
```

If the group cannot fit:

```text
cancel placement
show a non-blocking warning
```

Do not silently produce out-of-bounds boxes.

Preserve existing snapping behavior.

Overlapping placement may be allowed because the operator may intentionally position a clone before adjusting it, but show existing overlap warnings where applicable.

---

## 25. Selection After Clone

After successful drop:

```text
new clones are selected
originals are deselected
```

This allows the operator to continue moving or resizing the copied group.

---

## 26. Undo/Redo

One Ctrl-drag operation must create one undo transaction.

For group cloning:

```text
all cloned boxes are undone together
```

Redo should restore the clones with the same IDs, numbers, and geometry where consistent with the existing undo architecture.

---

## 27. Training Annotation Interaction

Do not immediately save cloned boxes as trusted training data.

They become trusted only when the operator confirms the completed page layout.

When the page is confirmed:

```text
include cloned boxes in final confirmed annotation
record that the operator created them through Ctrl-drag cloning
```

This may be reflected in correction statistics.

---

# Part D — UI, Harness, Artifacts, and Reports

## 28. Crop Editor Diagnostics

Show a compact page diagnostic such as:

```text
Price anchors detected: 13
Offer boxes suggested: 13
Uncovered anchors: 0
Multi-price boxes: 0
Completeness: Ready for review
```

If unsafe:

```text
Price anchors detected: 13
Offer boxes suggested: 9
Uncovered anchors: 4
Multi-price boxes: 1
Completeness: Review required
```

Do not show technical detail unless helpful, but make the reason for review visible.

---

## 29. Suggestion Labels

Use labels such as:

```text
CV Suggestion
Price-Anchor Split
Session-Adapted Suggestion
Detector + CV
Manual
Ctrl-Drag Clone
```

The operator should be able to tell how a box was created.

---

## 30. Review Queue Integration

Prioritize pages with:

```text
multi-anchor merged boxes
uncovered price anchors
low anchor-to-box agreement
new unconfirmed layout clusters
large detector/CV disagreement
```

The first page shown should be the page with the highest likely missed-offer risk, not necessarily the lowest page number.

---

## 31. Runtime Accuracy Harness

Extend the runtime harness to detect:

```text
accepted box containing several independent current-price anchors
visible current-price anchor outside every accepted box
same current-price anchor claimed by several boxes
accepted page with incomplete anchor coverage
session adaptation overwriting manual/confirmed boxes
session adaptation suppressing a new anchor
clone retaining stale OCR/publish state
clone created outside page bounds
```

Treat these as critical crop-layout regressions where appropriate.

No page with unresolved anchor completeness errors may proceed to OCR.

---

## 32. Reports

Add metrics:

```text
price_anchor_count
price_anchor_group_count
multi_anchor_box_count
uncovered_price_anchor_count
duplicate_anchor_assignment_count
anchor_split_operation_count
anchor_split_generated_box_count
session_layout_cluster_count
session_adaptation_event_count
pages_improved_by_session_adaptation
session_adapted_boxes_created
ctrl_drag_clone_operations
ctrl_drag_boxes_created
```

Update where appropriate:

```text
accuracy-run-report.json
runtime-accuracy-harness-report.json
local-detector-run-report.json
crop-auto-acceptance-report.json
qa-dry-run-publish-report.json
```

---

## 33. Manifest Integration

Add or extend:

```json
{
  "price_anchor_detection": {
    "status": "not_started",
    "pages_completed": 0,
    "pages_failed": 0,
    "anchors_detected": 0,
    "multi_anchor_boxes_split": 0,
    "uncovered_anchor_count": 0
  },
  "leaflet_session_adaptation": {
    "status": "not_started",
    "cluster_count": 0,
    "confirmed_pages": 0,
    "adaptation_events": 0,
    "session_path": "metadata/session-layout-learning/leaflet-layout-session.json"
  }
}
```

Older manifests must load safely.

---

## 34. Configuration Defaults

Add safe defaults:

```text
PRICE_ANCHOR_DETECTION_ENABLED=true
PRICE_ANCHOR_SPLITTING_ENABLED=true
PRICE_ANCHOR_COMPLETENESS_REQUIRED=true

LEAFLET_SESSION_ADAPTATION_ENABLED=true
LEAFLET_SESSION_MIN_SIMILARITY=0.82
LEAFLET_SESSION_STRONG_PROTOTYPE_MIN_CONFIRMED_PAGES=3

CTRL_DRAG_BOX_CLONING_ENABLED=true
```

Do not expose these as ordinary operator settings unless the project already has an advanced diagnostics section.

Do not require environment variables.

---

## 35. Tests

Add unit and integration tests for all three features.

### Price-anchor tests

Required:

```text
one current price plus one old price forms one anchor group
two independent current prices form two anchor groups
box with five independent current-price anchors is flagged for splitting
multi-anchor region is split into separate offer boxes
uncovered current-price anchor is detected
duplicate anchor assignment is detected
anchorless giant region requires review
colors are dynamically detected rather than hardcoded
old price does not become a separate offer
all output coordinates remain within page bounds
```

### Synthetic mixed-layout fixture

Create a lightweight synthetic fixture resembling:

```text
4 offers across the top
2 stacked offers on the left
1 large hero offer in the center
2 stacked offers on the right
4 offers across the bottom
continuous/shared middle background
13 independent current-price anchors
```

Expected:

```text
13 independent price-anchor groups
no single middle box containing all 5 middle offers
five separate middle offer suggestions
no uncovered anchors
```

Do not hardcode this layout into production code.

### Session-adaptation tests

Required:

```text
first confirmed page creates cluster prototype
confirmation triggers re-evaluation of similar unreviewed pages
dissimilar pages are not adapted
second and third confirmed pages strengthen prototype
adaptation preserves new price anchors
adaptation never overwrites confirmed boxes
adaptation never overwrites manual dirty pages
session state persists across restart
one confirmed page does not enable unsafe auto-acceptance
each layout cluster requires its own confirmed example
```

### Ctrl-drag tests

Required:

```text
Ctrl-drag clones one box
normal drag moves without cloning
Ctrl-drag selected group clones entire group
relative spacing is preserved
original boxes remain unchanged
clones receive unique IDs
clones receive new available numbers
derived OCR/crop/validation/publish state is reset
clones become selected after drop
Esc cancels cloning
drag below threshold creates no clone
clones remain inside page bounds
group clone creates one undo transaction
undo removes all group clones
training data is not saved until page confirmation
```

Do not call Mistral.

Do not call Supabase.

Do not run heavy model training.

---

## 36. Verification Commands

Run:

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

Add a safe fixture diagnostic if useful:

```text
npm run crop:price-anchor:verify
npm run crop:session-adaptation:verify
npm run crop:clone-interaction:verify
```

These must use synthetic fixtures and mocks only.

---

## 37. Security and Safety Rules

Follow these rules:

* Do not call external APIs.
* Do not call Mistral.
* Do not upload images.
* Do not write to Supabase.
* Do not publish offers.
* Do not activate an unvalidated model.
* Do not retrain the detector after every page.
* Do not treat session prototypes as permanent model truth.
* Do not save unconfirmed suggestions as trusted annotations.
* Do not overwrite confirmed or manually edited page layouts.
* Do not allow unresolved price-anchor completeness errors to proceed to OCR.
* Do not copy stale extraction or publishing state into cloned boxes.
* Do not run heavy production training in tests.

---

## 38. Acceptance Criteria

This chunk is complete when:

* Local price-anchor detection exists.
* Current and old prices can be grouped into one price-anchor group.
* Independent current-price anchors are distinguished.
* Over-merged boxes containing multiple offers are split.
* Every detected current-price anchor is checked for box coverage.
* Unsafe anchor/box mismatches force review.
* Page-level completeness diagnostics exist.
* Immediate leaflet-session adaptation runs after every confirmed page.
* Similar pages are clustered locally.
* Confirmed layouts improve unreviewed similar pages.
* Dissimilar pages are not incorrectly adapted.
* Session adaptation persists across restart.
* Permanent detector training thresholds remain unchanged.
* Ctrl-drag cloning works for one box.
* Ctrl-drag cloning works for multiple selected boxes.
* Clones reset all derived processing state.
* Ctrl-drag cloning integrates with undo/redo.
* Runtime harness checks the new safety conditions.
* Reports and manifest are updated.
* TypeScript compiles.
* Existing tests pass.
* Accuracy harness passes.
* ML diagnostics remain truthful and pass.
* No external API, Mistral, Supabase, publishing, or heavy training occurs.

---

## 39. Autonomy Rule

Proceed autonomously through the entire chunk without requesting intermediate approval.

Implement:

```text
price-anchor detection
price-anchor grouping
multi-anchor box splitting
anchor completeness validation
page layout fingerprints
within-leaflet layout clustering
immediate session prototype updates
safe re-evaluation of similar pages
Ctrl-drag single/group box cloning
undo/redo and stale-state handling
review queue, runtime harness, reports, and manifest integration
```

Keep the app runnable.

Do not run real extraction, external APIs, Mistral, Supabase operations, publishing, or heavy production training during automated verification.

---

## 40. Final Response Required From Antigravity

After finishing, report:

```text
files modified
files created
price-anchor detection approach
price grouping approach
multi-anchor splitting behavior
page completeness behavior
synthetic mixed-layout fixture result
session fingerprint and clustering behavior
after-confirmation adaptation behavior
protection of confirmed/manual pages
Ctrl-drag single-box behavior
Ctrl-drag multi-selection behavior
undo/redo behavior
derived-state reset behavior
artifact paths
manifest/report changes
runtime harness changes
tests added/updated
commands run
commands skipped and why
whether typecheck passed
whether tests passed
whether harness passed
whether ML diagnostics passed
confirmation no external API/Mistral/Supabase calls were made
confirmation no heavy production training was run
remaining risks
recommended next step
```

The recommended next step should be:

```text
Test the same real leaflet page that previously produced one five-item middle box. Confirm the app now detects/splits the independent price anchors, correct any remaining boxes, confirm the page, then verify that similar unreviewed pages are automatically re-evaluated. Also test Ctrl-drag cloning with one box and a multi-box selection.
```