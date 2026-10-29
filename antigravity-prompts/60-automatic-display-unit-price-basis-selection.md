# Antigravity Prompt Chunk 60: Automatic Display Unit Price Basis Selection

You are working inside the existing `wifran-offers-extractor` project.

This is Prompt Chunk 60.

Chunks 56–59 should already have completed and passed, especially:

```text
56-replace-representative-style-profile-with-page-level-profiling.md
57-offline-extraction-and-wifran-utilization-accuracy-harness.md
58-automatic-runtime-accuracy-harness-and-self-improving-quality-gate.md
59-reconcile-harnesses-after-page-level-style-profile-migration.md
```

This chunk adds automatic user-facing unit price display selection.

The goal is for Wifran to show a readable price-per-unit label under offer cards, such as:

```text
0.50 ر.س / 100 مل
3.76 ر.س / 100 جم
4.50 ر.س / 1 كجم
2.25 ر.س / قطعة
```

The display basis must be selected automatically from the item’s normalized measurement.

Do not rely on Mistral to generate the final display label.

Do not store untrusted free-text unit-price labels from OCR as final truth.

Do not write to Supabase during tests.

Do not upload images during tests.

---

## 1. Core Rule

Implement this display rule:

```text
Choose the smallest readable unit basis where the displayed unit price is >= SAR 0.50.
```

The threshold applies to the user-facing display unit price only.

It must not change internal comparison ranking.

Internal comparison and user display must remain separate concepts.

---

## 2. Conceptual Separation

Keep these separate:

```text
comparison_unit_price
  Used internally for ranking, recommendations, best-value calculations.

display_unit_price
  Shown to the user under the item card.
```

Example:

```text
Milk 1L at SAR 5

Internal:
comparison_unit = liter
comparison_unit_price = SAR 5 / liter

Display:
display_unit_basis_value = 100
display_unit_basis_unit = ml
display_unit_price = SAR 0.50
display label = 0.50 ر.س / 100 مل
```

---

## 3. Candidate Display Bases

Use these default candidate bases.

### Mass

```text
1g
10g
100g
1kg
```

### Volume

```text
1ml
10ml
100ml
1L
```

### Count

```text
1 piece
10 pieces
100 pieces
```

Do not add unsupported dimensions in this chunk.

Unsupported dimensions should hide display unit price safely.

---

## 4. Selection Algorithm

Create a deterministic selector.

Recommended function:

```ts
export function selectDisplayUnitPriceBasis(input: {
  offerPrice: number;
  totalContentValue: number;
  totalContentUnit: string;
  comparisonEligible: boolean;
  itemDomain?: string | null;
  categorySlug?: string | null;
  minDisplayUnitPriceSar?: number;
}): DisplayUnitPriceResult
```

Default:

```ts
minDisplayUnitPriceSar = 0.5
```

Algorithm:

```text
1. If comparisonEligible is false, return hidden.
2. If offerPrice is missing, invalid, or <= 0, return hidden.
3. If totalContentValue is missing, invalid, or <= 0, return hidden.
4. Normalize totalContentUnit into a supported unit family:
   - mass
   - volume
   - count
5. Convert total content into the smallest base unit:
   - mass → grams
   - volume → milliliters
   - count → pieces
6. Iterate candidate bases from smallest to largest.
7. For each basis:
   displayUnitPrice = offerPrice * basisBaseQuantity / totalContentBaseQuantity
8. Choose the first candidate where displayUnitPrice >= 0.50.
9. If no candidate reaches 0.50, choose the largest candidate only if it is still useful, and mark below_threshold=true.
10. Return rounded display price and localized label inputs.
```

Rounding:

```text
Round display_unit_price to 2 decimals for storage/display.
Keep unrounded value internally if useful.
```

---

## 5. Output Type

Create or extend a type:

```ts
export type DisplayUnitPriceResult = {
  show_display_unit_price: boolean;

  display_unit_price: number | null;
  display_unit_price_unrounded?: number | null;

  display_unit_basis_value: number | null;
  display_unit_basis_unit:
    | 'g'
    | 'kg'
    | 'ml'
    | 'l'
    | 'piece'
    | 'pieces'
    | null;

  display_unit_family: 'mass' | 'volume' | 'count' | null;

  display_unit_price_label_ar: string | null;
  display_unit_price_label_en: string | null;

  below_min_display_price_threshold: boolean;
  min_display_unit_price_sar: number;

  hidden_reason:
    | 'comparison_not_eligible'
    | 'missing_offer_price'
    | 'missing_total_content'
    | 'unsupported_unit'
    | 'non_grocery_item'
    | 'unsafe_conversion'
    | null;
};
```

Use existing project naming conventions if different.

---

## 6. Arabic and English Labels

Generate labels deterministically.

Arabic examples:

```text
0.50 ر.س / 100 مل
3.76 ر.س / 100 جم
4.50 ر.س / 1 كجم
2.25 ر.س / قطعة
```

English examples:

```text
SAR 0.50 / 100ml
SAR 3.76 / 100g
SAR 4.50 / 1kg
SAR 2.25 / piece
```

Do not use Mistral for labels.

Keep label generation in shared utility code so both extractor and Wifran UI can use the same logic.

---

## 7. Examples That Must Work

### Tuna

Input:

```text
offer_price = 6.95
total_content = 185g
```

Expected:

```text
per 1g = 0.04 SAR, below threshold
per 10g = 0.38 SAR, below threshold
per 100g = 3.76 SAR, chosen
```

### Milk

Input:

```text
offer_price = 5
total_content = 1000ml
```

Expected:

```text
per 100ml = 0.50 SAR, chosen
```

### Fairy 730ml 1+1

Input:

```text
offer_price = 10
total_content = 1460ml
```

Expected:

```text
per 100ml = 0.68 SAR, chosen
```

### Rice 10kg

Input:

```text
offer_price = 45
total_content = 10kg
```

Expected:

```text
per 1kg = 4.50 SAR, chosen
```

### 30 pieces

Input:

```text
offer_price = 15
total_content = 30 pieces
```

Expected:

```text
per piece = 0.50 SAR, chosen
```

### 100 tissues

Input:

```text
offer_price = 10
total_content = 100 pieces
```

Expected:

```text
per piece = 0.10 SAR, below threshold
per 10 pieces = 1.00 SAR, chosen
```

---

## 8. Integration With Canonical Offer

Extend canonical offer or derived metadata with:

```text
display_unit_price
display_unit_price_unrounded
display_unit_basis_value
display_unit_basis_unit
display_unit_family
display_unit_price_label_ar
display_unit_price_label_en
below_min_display_price_threshold
min_display_unit_price_sar
display_unit_price_hidden_reason
```

Only populate these fields when the calculation is safe.

If the current Supabase schema does not support these fields, keep them in local extraction metadata and dry-run/report output first.

Do not add a DB migration unless the existing project already has a safe schema-change workflow for this.

---

## 9. Runtime Harness Integration

The runtime accuracy harness must verify:

```text
display unit price is hidden when comparison_eligible=false
display unit price is hidden when total content is missing
display unit price is hidden for non-grocery/electronics
display unit basis stays in the same unit family
display unit price is >= 0.50 when a suitable basis exists
display unit price does not affect internal comparison ranking
```

If a display unit price is shown with unsafe input, flag it as suspicious.

If a display unit price is below SAR 0.50 while a larger candidate basis would satisfy the threshold, flag it as a display calculation error.

---

## 10. Offline Harness Fixtures

Update the accuracy harness fixtures to include expected display-unit output for:

```text
tuna 185g
milk 1L
Fairy 730ml 1+1
rice 10kg
30 pieces
100 tissues
electronics/TV hidden
unclear pack size hidden
```

Add threshold checks:

```text
shown display_unit_price should be >= 0.50 when possible
shown display basis should be the smallest candidate that satisfies threshold
hidden display unit price should include hidden_reason
```

---

## 11. Pre-Publish Preview

In Pre-Publish Preview, show the display unit price under each item when available.

Example:

```text
10.00 ر.س
0.68 ر.س / 100 مل
```

Also show hidden reason in debug/details mode:

```text
Display unit price hidden: unclear total content
```

Do not block publishing only because display unit price is hidden.

But if comparison_eligible=true and display unit calculation fails unexpectedly, add a warning.

---

## 12. Wifran UI Rendering

If this repository includes Wifran UI card rendering, add the label under the offer price.

If Wifran UI is in another repository, create shared output fields and document how Wifran should render:

```text
display_unit_price_label_ar
display_unit_price_label_en
```

UI rule:

```text
Show display unit price only when show_display_unit_price=true.
```

---

## 13. Tests

Add tests for:

```text
tuna 185g chooses 100g
milk 1L chooses 100ml
Fairy 730ml 1+1 chooses 100ml
rice 10kg chooses 1kg
30 pieces chooses piece
100 tissues chooses 10 pieces
comparison_eligible=false hides display unit price
missing total content hides display unit price
unsupported unit hides display unit price
electronics hides display unit price
display unit price does not change comparison_unit_price
runtime harness flags unsafe shown display price
offline harness validates expected display output
Arabic label formatting
English label formatting
```

Do not call Mistral.

Do not call Supabase.

---

## 14. Reports

Update reports to include:

```text
display_unit_price_visible_count
display_unit_price_hidden_count
display_unit_price_hidden_reasons
display_unit_price_below_threshold_count
display_unit_price_calculation_error_count
```

Add these to:

```text
accuracy-run-report.json
runtime-accuracy-harness-report.json
qa-dry-run-publish-report.json
pre-publish-preview-summary.json
```

where appropriate.

---

## 15. Security Rules

Follow these rules:

* Do not create `.env.local`.
* Do not print or expose secrets.
* Do not expose Mistral API key.
* Do not expose Supabase service role key.
* Do not call Mistral.
* Do not upload images.
* Do not write to Supabase.
* Do not publish offers.
* Do not add DB migrations unless the project already has a safe migration plan and tests.
* Do not expose raw `ipcRenderer`.
* Do not delete extraction folders.

---

## 16. Acceptance Criteria

This chunk is complete when:

* Automatic display unit basis selector exists.
* Minimum display unit price threshold defaults to SAR 0.50.
* Selector chooses the smallest valid basis where display price is >= SAR 0.50.
* Selector hides display unit price for unsafe/unsupported rows.
* Canonical or derived offer metadata includes display unit price fields.
* Pre-Publish Preview shows display unit price when available.
* Runtime harness validates display unit price safety.
* Offline harness fixtures validate display unit price outputs.
* Reports include display unit price metrics.
* Tests cover mass, volume, count, hidden, and threshold behavior.
* TypeScript compiles.
* Existing tests pass.
* No real Mistral/Supabase calls are made.

---

## 17. Autonomy Rule

Proceed autonomously through the entire chunk without asking me for intermediate approvals, confirmations, or permission to continue.

Make the automatic display unit price selection changes needed for this chunk, keep the app runnable, then stop.

Do not perform real OCR, real Mistral calls, image upload, DB writes, or real publishing during tests.

---

## 18. Final Response Required From Antigravity

After finishing, provide:

```text
files modified
files created
display unit basis selection behavior
minimum threshold behavior
examples verified
canonical metadata changes
Pre-Publish Preview changes
Wifran UI/output changes
runtime harness changes
offline harness fixture changes
report changes
tests added/updated
commands run
commands skipped and why
whether typecheck passed
whether tests passed
confirmation no real Mistral/Supabase calls were run
remaining risks
recommended next step
```

The recommended next step should be:

```text
Run QA extraction/dry-run and confirm offer cards show readable unit prices such as SAR/100g, SAR/100ml, SAR/kg, or SAR/piece only when safe.