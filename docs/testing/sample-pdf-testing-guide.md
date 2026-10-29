# Sample PDF Testing Guide

Use this guide to systematically test the Wifran Offers Extractor pipeline using real-world supermarket PDFs of increasing complexity.

## Progression Strategy

1. **Short PDFs (1-3 Pages)**: Start here to validate Mistral performance and ensure the end-to-end flow is intact without long processing times.
2. **Dense Weekly Leaflets**: Test PDFs with many items per page to validate bounding box scaling, OCR pagination, and entity matching bulk processing.
3. **Cover Pages**: Test PDFs with large banners or branding on the first/last pages to validate promotional filtering logic.
4. **Layout Diversity Check**
Ensure testing covers:
- **Hero Offers**: Huge image, massive text on cover pages.
- **Clean Grid Cards**: Highly separated product blocks.
- **Dense Product Grids**: Tiny images clustered closely with text spanning vertically.

#### Dense Product Grid Testing
**Chunk Size Guidance**: 
- For highly dense pages with dozens of small items, it's recommended to set `OCR_CHUNK_SIZE=1` in your `.env.local` or testing configs to ensure Mistral doesn't drop items due to context length limits. 
- For standard leaflets, use `OCR_CHUNK_SIZE=2`.
- If you notice missing items, re-run with `OCR_CHUNK_SIZE=1`.

When testing dense grids, verify that the extractor adheres to the **Product Offer Block Association Rules**:
- Verify every visible product item was extracted.
- Verify large prices above product images were associated with the correct product names.
- Verify old prices were not extracted as separate rows.
- Verify discount badges were attached to products, not extracted separately.
- Verify SKU/item codes were not used as product names.
- Verify branch notes were saved as notes, not product names.
- Verify per kg/per bag/per plate labels were saved as pack/unit/notes.
- Verify neighboring products were not merged incorrectly.

5. **Large Banners & Generic 1+1**: Ensure the promotional heuristic correctly drops generic campaign banners but preserves real 1+1 product combinations.
6. **Arabic-only Leaflets**: Ensure Arabic text is preserved, right-to-left layout does not break bounding boxes, and numerals are accurately converted if written in Arabic numbers.
7. **Mixed Arabic/English Leaflets**: Ensure Mistral can handle bilingual text gracefully.

## Metrics to Record

For every PDF tested, record the following details to track extraction success rates:

- **Supermarket Name**: (e.g., Carrefour, Lulu)
- **PDF Page Count**: (e.g., 20)
- **OCR Chunk Size**: (e.g., 2 pages per chunk)
- **Render DPI**: (e.g., 200)
- **OCR Extracted Item Count**: Total raw items retrieved from Mistral.
- **Skipped Promotional Count**: Number of rows dropped correctly.
- **Cropped Image Count**: Number of successfully generated images.
- **Imported Offers Count**: Final count of offers synced to the database.
- **Errors/Warnings**: Note any prevalent issue codes (`MISSING_OFFER_PRICE`, `INVALID_ORIGINAL_PRICE`, etc.).
- **Manual Notes**: Any false positives (a banner treated as a product) or false negatives (a product treated as a banner).
