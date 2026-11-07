We want to optimize AI token consumption in Step 2 by exporting short sequential offer references (`O1`, `O2`, `O3`...) in the Step 1 CSV instead of full 36-character UUIDs (`O<uuid>`), WITHOUT making any changes to the PostgreSQL database schema. 

Crucially, temporary short IDs must be automatically deleted from the local map once their Step 3 image import succeeds so mappings never pile up over time.

Implement a self-cleaning local short-ID translation layer in the Extractor App:

====================================================================
1. PERSISTENT & SELF-CLEANING LOCAL SHORT-ID MAPPER
====================================================================
Create a deterministic local mapping utility (or extend `productImageEnrichmentService.ts`) that stores a JSON lookup map on disk (e.g., `exports/offer-image-ref-map.json`):
- Structure: `{ nextSeq: number, shortToUuid: Record<string, string>, uuidToShort: Record<string, string> }`.
- Assignment (Step 1):
  - If an offer UUID is already in `uuidToShort`, reuse its existing `O<n>` reference.
  - Otherwise, assign `O${nextSeq}`, increment `nextSeq`, and persist the map.
- Cleanup / Deletion (Step 3):
  - Provide a helper to remove a mapped offer UUID (and its corresponding `O<n>` key) from `shortToUuid` and `uuidToShort`.
  - If `Object.keys(shortToUuid).length === 0` after cleanup, reset `nextSeq = 1` so the next batch starts cleanly from `O1` again.

====================================================================
2. STEP 1 EXPORT (`exportProductsForImageSearch`)
====================================================================
- Before assigning short IDs for the current export, prune any stale entries from the local map whose offers already have an image in `public.offer_display_images` or are now linked to a catalog product.
- For the remaining unresolved `O` rows being exported, replace `O<uuid>` in the CSV with its mapped short reference (`O1`, `O2`, etc.).
- Keep `P<id>` references unchanged (`P1`, `P2`, etc.).

====================================================================
3. STEP 3 VALIDATION, IMPORT & AUTO-PURGE
====================================================================
- In the reference parser (`parseImageRef` or equivalent), support BOTH formats for `O` references:
  1. Short format (`^O([1-9]\d*)$`): Resolve `O<n>` to the underlying offer UUID via the local map before querying `public.offers`. If not found in the local map, return a clear validation error (`unknown_product` / unmapped or expired short offer reference).
  2. Full UUID format (`^O([0-9a-f-]{36})$`): Continue supporting direct UUID resolution so existing test CSVs (like `Wifran_Step3_Full42_Candidates_TEST_ONLY.csv`) and existing unit tests pass 100%.
- In `uploadApprovedProductImagesToDb()`:
  - Whenever an `O` row completes successfully (`status === 'uploaded'` or `status === 'reused'`) OR is skipped because it already has an image associated in the DB, immediately delete its temporary `O<n>` <-> UUID entry from the local map and persist the cleaned map to disk.
  - Retain mappings ONLY for rows that failed (`status === 'failed'`) or had blank URLs so the operator can fix the broken URL and re-run Step 3 without losing the `O<n>` reference.

====================================================================
4. VERIFICATION
====================================================================
- Add a unit test in `wifran07jStep3Importer.test.ts` verifying:
  1. Step 1 exports `O1`, `O2`.
  2. Step 3 resolves `O1`, `O2` to their exact UUIDs during validation and upload.
  3. Completed `O` items are automatically purged from the local map after Step 3 upload, while failed items remain mapped for retry, and `nextSeq` resets to `1` once all items complete.
- Run `npm run typecheck` and the Vitest suite to confirm 0 regressions.