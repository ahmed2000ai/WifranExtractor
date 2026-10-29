export function buildStyleAwareValidationPrompt(input: {
  leafletId?: string | null;
  sourcePageNumber?: number | null;
  sourceItemNumber: string;
  rawExtractionJson: Record<string, unknown>;
  canonicalDraft: Record<string, unknown>;
  styleProfile?: Record<string, unknown> | null;
}): string {
  
  const hasProfile = input.styleProfile && Object.keys(input.styleProfile).length > 0;

  return `You are validating a cropped item image from a Saudi supermarket promotion leaflet.

You will receive:
1. The cropped item image.
2. The raw extraction JSON from a previous OCR/model call.
3. A canonical normalized draft created by the app.
4. A temporary page/leaflet style profile, if available.

Your job is to verify the normalized draft against the image.

Return strict valid JSON only.
Do not return markdown.
Do not return prose.
Do not include keys outside the expected schema.

Check these questions:
- Is the selected current offer price visually correct?
- Is the selected original/old price visually correct?
- Was a size/content value mistaken for a price?
- Was an old/crossed-out price mistaken for the current offer price?
- Is the pack size/content correct?
- Is pack_quantity correct?
- Is bundle_quantity correct?
- Is price_basis correct?
- Is promotion mechanic correct?
- Is the item safe to publish?
- Is the item safe for unit-price comparison?

Use visual evidence:
- text color
- price block color
- relative size
- crossed-out state
- proximity to SAR symbol
- attached units such as L/ml/kg/g/pcs/inch
- location in the crop
- whether the value is inside a price block
- whether the value is near product/package text

Important priority:
1. Crop-specific visual evidence
2. Page-level style profile for this page
3. General Saudi leaflet heuristics
4. If unclear, do not approve publishing

Other rules:
- If safe to display but unsafe for comparison, use publish_but_exclude_from_comparison.
- If the current offer price is ambiguous, missing, likely a size, or likely the old price, use skip_or_quarantine.
- Do not approve a row only because the first extraction looked plausible.

Known traps:
- 1.5L is size/content, not an offer price.
- 730ml is size/content, not an offer price.
- 10kg is size/content, not an offer price.
- 8x135g is pack/content, not an offer price.
- 30PCS is quantity/content, not an offer price.
- 50 inch, 55 inch, 65 inch, 4K, HD, LED are product attributes, not prices.
- Old/crossed-out/smaller prices must not be used as the current offer price.

--- RAW EXTRACTION JSON ---
${JSON.stringify(input.rawExtractionJson, null, 2)}

--- CANONICAL NORMALIZED DRAFT ---
${JSON.stringify(input.canonicalDraft, null, 2)}

--- STYLE PROFILE ---
${hasProfile ? JSON.stringify(input.styleProfile, null, 2) : 'No page-level style profile is available. Use crop-specific evidence and general Saudi leaflet heuristics. If unclear, do not approve publishing.'}

Return the validation result using the expected schema.`;
}
