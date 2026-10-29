export function buildPageStyleProfilePrompt(input: {
  pageNumber: number;
}): string {
  return `You are analyzing rendered page ${input.pageNumber} from a Saudi supermarket leaflet.

Your task is to infer temporary visual style guidance for this page only.

Do not extract final item data.
Do not create permanent supermarket rules.
Do not infer rules for other pages.

Identify the page's visual patterns for:
- current offer prices
- old/original/crossed-out prices
- size/content values
- pack and bundle indicators
- promotion badges
- condition labels
- non-price product attributes

Use visual evidence from this page only.

Important safety rules:
- 1.5L, 730ml, 10kg, 8x135g, 30PCS, inch sizes, 4K, HD, LED are not prices.

Return strict valid JSON only.
Do not return markdown.
Do not return prose.
Do not include keys outside the expected schema.`;
}
