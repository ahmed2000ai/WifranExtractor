# Test Fixtures

This directory contains JSON files used by `validateFixtures.ts` to assert that the OCR normalization and validation pipeline behaves correctly on various edge cases and valid scenarios.

- **valid-ocr-response.json**: A perfect extraction.
- **empty-ocr-response.json**: An empty result `{ items: [] }` testing robustness.
- **promotional-filter-edge-cases-response.json**: A complex array of items testing the regex heuristics to differentiate between real product offers (e.g. `1+1`) and generic banners.
- **missing-price-response.json**: Tests fatal error behavior.
- **missing-product-name-response.json**: Tests fatal error behavior.
- **missing-bounding-box-response.json**: Tests warning behavior (still allows processing without a crop).
- **invalid-original-price-response.json**: Original price is lower than offer price, producing a warning and preventing negative discount calculations.
- **loyalty-offer-response.json**: Validates `is_loyalty_required` passthrough.
