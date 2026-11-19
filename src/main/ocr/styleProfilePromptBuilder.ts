export function buildStyleProfilePrompt(input: {
  leafletId?: string | null;
  scope: 'leaflet' | 'page';
  pageNumber?: number | null;
}): string {
  const scopeText = input.scope === 'page' ? `page ${input.pageNumber || 'unknown'}` : 'leaflet';
  
  return `You are analyzing a supermarket promotion ${scopeText} image to infer temporary visual style guidance.

Return strict valid JSON only.
Do not return markdown.
Do not return prose.
Do not include keys outside the expected schema.

Do not extract final item data.
Do not create permanent supermarket rules.
This style profile applies only to this ${scopeText}.

Your task is to identify visual patterns that help distinguish:
- current offer prices
- old/original/crossed-out prices
- product sizes/content values
- promotion mechanics
- condition labels
- non-price product attributes

Look for:
- text color
- price block color
- relative font size
- crossed-out text
- proximity to product title/package
- position on the crop/page
- whether values appear inside price blocks or descriptive text areas
- whether values are attached to L/ml/kg/g/pcs/inch
- whether values are screen sizes or product attributes

Important safety rules:
- 1.5L, 730ml, 10kg, 8x135g, and 30PCS are size/content/quantity indicators, not prices.
- 50 inch, 55 inch, 65 inch, 4K, HD, LED are product attributes, not prices.
- Old/crossed-out prices should be visually distinguished from current offer prices.
- If the page contains mixed visual styles, report that clearly.
- If you are uncertain, use low confidence.

Return a style profile only.
Do not decide whether any specific crop should be published.
Do not return final product offers.`;
}

export function buildLeafletStyleProfilePrompt(input: {
  leafletId?: string | null;
  selectedPageNumbers: number[];
}): string {
  const pagesText = input.selectedPageNumbers.length > 0 
    ? `pages ${input.selectedPageNumbers.join(', ')}` 
    : 'representative pages';

  return `You are analyzing ${input.selectedPageNumbers.length || '2-3'} representative ${pagesText} from the same Saudi supermarket leaflet.

Your task is to infer temporary leaflet-level visual style guidance.

Do not extract final item data.
Do not create permanent supermarket rules.

Identify the recurring style patterns for:
- current offer prices
- old/original/crossed-out prices
- size/content values
- pack and bundle indicators
- promotion badges
- condition labels
- non-price product attributes

Use evidence from all selected pages.
If the selected pages use mixed styles, report the differences.

Important safety rules:
- 1.5L, 730ml, 10kg, 8x135g, 30PCS, inch sizes, 4K, HD, LED are not prices.
- Old/crossed-out prices should be visually distinguished from current offer prices.
- If you are uncertain, use low confidence.

Return strict valid JSON only.
Do not return markdown.
Do not return prose.
Do not include keys outside the expected schema.`;
}
