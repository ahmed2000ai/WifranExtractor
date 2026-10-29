You are operating as a Principal AI Vision & TypeScript Systems Architect inside Antigravity (running Gemini 3.8 Flash High).

Your mission is to upgrade our supermarket leaflet extraction pipeline from `Offer Extraction Mechanism - rev0.md` (which relied on Mistral OCR / Pixtral, downscaled pages to 2500px, and used a fragile Levenshtein text-evidence linker) to the new architecture specified in `Offer Extraction Mechanism - rev1.md`.

Our strict project priorities are:
1. ACCURACY ABOVE ALL ELSE (99%+ accuracy on bilingual text, pricing hierarchy, size/unit badges, and pixel-sharp native-resolution crops across shifting page layouts and invisible boundaries).
2. COST EFFICIENCY (Using `@google/genai` with `gemini-3.8-flash` configured to `thinkingLevel: "HIGH"`, supporting Flex/Batch inference, plus local atomic component detection).
3. CONTINUOUS SELF-IMPROVEMENT (Implementing the Confidence-Gated Active Learning dataset exporter, SKU memory auto-correction, Electron Exceptions Queue hooks, and Golden Benchmark validation gate).

Execute this refactoring methodically in 4 mandatory phases. Automatically create all required directories (`training_data/dataset/images/train`, `training_data/dataset/labels/train`, `models/`, `scripts/`, etc.) so no manual folder creation is required. Do NOT skip any requirement, do NOT leave placeholder/stub functions, and do NOT finish until you have run all verification tests in Phase 4.

====================================================================
PHASE 1: CODEBASE AUDIT & DIRECTORY INITIALIZATION
====================================================================
1. Read `Offer Extraction Mechanism - rev1.md` (and `Offer Extraction Mechanism - rev0.md` if present) thoroughly. (both files are available under 'docs' folder)
2. Search and map the entire existing TypeScript/Node.js/Electron codebase to locate:
   - The current AI provider client (`mistral-ocr-latest` / `pixtral-large-latest`), API queue, and rate-limiter.
   - The Step 1–2 schema definitions (Zod) and the heuristic Levenshtein text-to-layout evidence linker.
   - The Step 3–5 price anchor completeness audit, retry generator, and multi-pass deduplication logic.
   - The Step 6–7 `sharp` image preprocessing/cropping utilities (including the legacy 2500px downscale cap) and `CanonicalOffer` normalization service.
3. Automatically create any missing directories required for `rev1` (`training_data/dataset/images/train`, `training_data/dataset/labels/train`, `models`, `test-fixtures`, `scripts`).

====================================================================
PHASE 2: CORE PIPELINE REFACTORING (rev0 -> rev1)
====================================================================
Implement the complete `rev1` pipeline in clean, modular, strictly-typed TypeScript:

1. Provider Migration (`@google/genai` + `gemini-3.8-flash` High Thinking):
   - Install/configure `@google/genai` and replace the Mistral OCR / Pixtral client.
   - Configure the primary extraction client to use model `"gemini-3.8-flash"` with `thinkingConfig: { thinkingLevel: "HIGH" }`, `responseMimeType: "application/json"`, and strict `responseSchema` derived from our Zod schema.
   - Support both Standard Queue execution and Batch/Flex execution (for 50% cost reduction), plus optional escalation (`"gemini-4-argon"`) for Stage 6 diagnostic retries.

2. Dual-Stream Native Resolution Preservation & High-Res Slicing (`Sharp`):
   - REMOVE the legacy 2500px hard cap on the master image buffer. Preserve the 100% untouched original native resolution (`nativeWidth x nativeHeight`, even when 4000px–6000px+) in `Sharp` for final product/offer cropping, high-res horizontal row/quadrant strip slicing, and Stage 6 diagnostic retry crops.
   - If an overview working image is needed for global layout context, generate a separate working buffer while mapping all normalized `0–1000` `[ymin, xmin, ymax, xmax]` coordinates directly back to the untouched `nativeWidth x nativeHeight` buffer when cropping!
   - Add a `Sharp` SVG Set-of-Mark (SoM) overlay utility that draws crisp numbered component boxes (`#1`, `#2`...) onto a working copy of the page when local component detections are present.

3. Component-First Zod Schema & Spatial Grounding (Replaces Levenshtein Linker):
   - Deprecate and remove the Levenshtein text-matching evidence linker for bounding box calculation.
   - Define the strict `LeafletPageExtractionSchema` in Zod requiring:
     * Page-level metadata: `is_loyalty_page` (boolean), `loyalty_program_name` (e.g., `"Iktissab"` or `null`), `validity_start_date`, `validity_end_date`, and `ignored_banners` (array of decorative/hero banners like the `"5 10 15"` stadium header or `"Iktissab"` QR banner so the model explicitly accounts for and filters them out).
     * Offer-level fields: `offer_number`, `arabic_title` (verbatim printed Arabic, NEVER translated from English—e.g. keep `"حبحب"`, never output `"بطيخ"`), `english_title`, `brand`, `is_multi_brand_or_variant` (boolean for `"Or / أو"` offers), `size_value` (e.g., `"270g"`, `"8x135g"`, `"30PCS"`, `"500 gram"`), `unit_type` (e.g., `"Each / للحبة"`, `"Per Pack / للربطة"`, `"Per Plate / للطبق"`, `"Per Box / للكرتون"`, `"Kg / كيلو"`), `promo_price` (number), `original_price` (number or `null`), `promo_condition` (`"STANDARD"` | `"LOYALTY_CARD_REQUIRED"` | `"MULTI_BUY"`), and `confidence` (0–1).
     * Atomic Component Grounding (`components`): Require `[ymin, xmin, ymax, xmax]` (normalized `0–1000` integers) for each visible atomic component of the offer:
       - `product_graphic_box` (bounding box of the physical product image/cutout only)
       - `promo_price_box` (bounding box of the primary promotional price badge)
       - `original_price_box` (nullable bounding box of the crossed-out/secondary price badge)
       - `unit_and_size_badge_box` (bounding box of the circular unit and rectangular size badge, whether located at top-left or bottom-right)
       - `title_text_box` (bounding box of the bilingual title text)

4. Deterministic Price & Unit Normalization Rules:
   - Write a deterministic parser/normalizer that cleans hyphenated prices (`"18-99"` -> `18.99`, `"6-99"` -> `6.99`) and superscript halalas (`"14 95"` -> `14.95`).
   - Enforce in both the system prompt and post-processor that if no separate secondary price badge (`original_price_box`) exists on an offer, `original_price` MUST be `null` (preventing single prices from being duplicated or inverted).

5. Mathematical Union Box, Dynamic Layout Adaptation & Neighbor-Bleed Clamping:
   - Implement `computeOfferUnionAndThumbBoxes()` which computes the exact pixel union rectangle (`[xmin, ymin, xmax, ymax]`) across all non-null atomic component boxes (`product_graphic_box`, `promo_price_box`, `original_price_box`, `unit_and_size_badge_box`, `title_text_box`) scaled to the image's exact `(nativeWidth, nativeHeight)`.
   - Implement pairwise overlap clamping: if two adjacent offers' union boxes overlap beyond a minor threshold, clamp their shared edge along the Voronoi midpoint between their inner atomic components so neither crop bleeds into its neighbor.
   - Update the `Sharp` cropping step (Stage 8) to generate and save TWO native-resolution crops per offer:
     1) `offer_card_crop.webp` (full union bounding box with 1.5% clamped safety padding)
     2) `product_thumb_crop.webp` (cropped strictly to `product_graphic_box` from the untouched native-resolution buffer)

6. Spatial & Price Completeness Audit + Native-Res Targeted Retry (Stages 5–7):
   - Upgrade the Completeness Audit to verify:
     a) Every detected `promo_price` anchor (excluding `ignored_banners`) belongs to a valid extracted offer.
     b) Whenever `original_price !== null`, `promo_price < original_price` (auto-flag price inversions).
     c) Bounding box sanity: `width >= 40`, `height >= 40`, and pairwise offer `IoU < 0.15`.
     d) Non-empty bilingual title, valid positive `promo_price`, and valid `size_value`.
   - When an offer or region fails the audit, automatically crop the suspect region directly from the native-resolution image via `Sharp`, run a Stage 6 Targeted Diagnostic Retry with `gemini-3.8-flash` (High Thinking), and reconcile via spatial IoU and price-anchor matching.

====================================================================
PHASE 3: ACTIVE LEARNING, SKU MEMORY & EXCEPTIONS QUEUE (Stages 8–10)
====================================================================
Implement the self-improving learning infrastructure so accuracy climbs continuously as more pages are processed:

1. Local Atomic Component Detector Interface (`YOLOv11s` ONNX + Set-of-Mark):
   - Create a pluggable `ComponentDetectorService` that supports:
     * `GeminiNativeGroundingDetector` (Cold-start default using `gemini-3.8-flash` High Thinking).
     * `YoloOnnxComponentDetector` (Loads trained `yolov11s-leaflet-components.onnx` at `imgsz=1280` when weights exist in `/models/`, detects the 5 atomic component classes, and uses the Spatial Graph + Set-of-Mark overlay).

2. Confidence-Gated Dataset Exporter (Teacher-Student Distillation):
   - Create `ActiveLearningExporter`: whenever a page passes Stage 5 Audit with `confidence >= 0.95`, automatically write the normalized YOLO format annotations (`<class_id> <x_center> <y_center> <width> <height>`) for all 5 atomic component classes into `training_data/dataset/labels/train/` and save the training image into `training_data/dataset/images/train/`.

3. Electron Exceptions Queue & 3x Weighted Human Feedback:
   - Create `ExceptionsQueueService` for the 1%–2% of offers that fail Stage 5 Audit even after Stage 6 retry.
   - Expose clean TypeScript methods/IPC handlers (`getPendingExceptions()`, `submitHumanCorrection(offerId, correctedDataAndBoxes)`) for the Electron UI.
   - When `submitHumanCorrection` is called, update the `CanonicalOffer` record and export the corrected component boxes to the YOLO training pool with a `3x` oversampling multiplier.

4. Canonical SKU Memory Auto-Correction:
   - Enhance `CanonicalOfferMapper` with a lookup against previously verified SKUs (matched by normalized brand + Arabic/English title). If a high-trust historical SKU exists, use it to validate and auto-correct minor OCR ambiguities in `size_value` and `unit_type`.

5. Automated Fine-Tuning Runner & Golden Benchmark Gate:
   - Create a background script/service (`TrainingOrchestrator`) that triggers when `new_verified_pages >= 200`, runs `yolo detect train model=yolo11s.pt data=leaflet_components.yaml imgsz=1280 epochs=30`, exports to ONNX, and validates against our Golden Benchmark before hot-swapping the active model.

====================================================================
PHASE 4: MANDATORY VERIFICATION, TESTING & SELF-AUDIT
====================================================================
You MUST thoroughly test and verify your implementation before concluding. Do not skip any of these checks:

1. Static & Type Verification:
   - Run `npx tsc --noEmit` (and linter/build checks) and fix every single TypeScript, import, or schema type error until the build is 100% clean.

2. Unit Tests for Deterministic Math & Normalizers:
   - Write and run automated tests verifying:
     * Hyphenated price normalization (`"18-99"` -> `18.99`, `"6-99"` -> `6.99`) and superscript price parsing.
     * Union box calculation across both top-left badge layouts (Page 1 style) and bottom-right badge layouts (Page 4 style) mapped to arbitrary native image resolutions (e.g. `960x1280` and `4000x5333`).
     * Neighbor-bleed Voronoi clamping when two adjacent boxes overlap.
     * Stage 5 Audit detection of inverted prices (`promo_price > original_price`) and overlapping boxes (`IoU >= 0.15`).
     * YOLO normalized coordinate export (`[ymin, xmin, ymax, xmax]` 0–1000 -> `<class> <xc> <yc> <w> <h>` 0.0–1.0).

3. End-to-End Golden Benchmark Test on `page1_small.jpg` and `page4_small.jpg`:
   - Locate `page1_small.jpg` and `page4_small.jpg` in the workspace (e.g., under `test-fixtures/` or project root) and run a live verification script (`scripts/verify-golden-benchmark.ts`):
     * On `page1_small.jpg` (Al-Othaim 3x3 layout):
       - Assert exactly 9 offers are extracted and the top `"5 10 15"` stadium banner is ignored (`ymin` of Row 1 offers must be `> 590px` on a `960x1280` scale, never cropping into the stadium grass).
       - Assert Offer #1 (`Sadia Nuggets Chicken`) has `size_value: "270g"`, `promo_price: 5`, `original_price: 11.25`.
       - Assert Offer #2 (`Watermelon / حبحب`) preserves the exact Arabic word `"حبحب"` (not `"بطيخ"`), `size_value: "2 Kg"`, `promo_price: 5`, `original_price: null`.
       - Assert Offer #5 (`KDD Tomato Paste`) has `size_value: "8x135g"`, `promo_price: 10`, `original_price: 14.25`.
       - Assert Offer #7 (`Eggs 30PCS`) captures the multi-brand title and `promo_price: 15`, `original_price: 22.50`.
     * On `page4_small.jpg` (Al-Othaim Multi-Layout 2-col / 3-col / 4-col Iktissab loyalty page):
       - Assert exactly 11 offers are extracted and the center vertical `"Iktissab / اكتساب"` QR banner is ignored.
       - Assert page metadata flags `is_loyalty_page: true` (`"Iktissab"`).
       - Assert Row 4 hyphenated prices (`18-99`, `16-99`, `10-99`, `6-99`) are parsed as `18.99`, `16.99`, `10.99`, `6.99`.
       - Assert `Sharp` successfully writes both `offer_card_crop.webp` and `product_thumb_crop.webp` at full native resolution for all 20 offers across both pages.

4. Final Self-Audit Report:
   - After all tests pass, provide a summary table showing the verification results for every module and confirm zero remaining TODOs or broken references.