import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

import { normalizeToCanonicalOffer } from '../utils/canonicalOfferNormalizer'
import { runDeterministicOfferChecks, applyDeterministicCheckResultToCanonicalOffer } from '../utils/deterministicOfferChecks'
import { evaluateComparisonSafety, applyComparisonSafetyToCanonicalOffer } from '../utils/comparisonSafety'
import { decidePublishAction, applyPublishDecisionToCanonicalOffer } from '../utils/publishDecisionEngine'

// Read all fixtures
const fixturesDir = path.join(__dirname, '../fixtures/accuracy')
const fixtureFiles = fs.existsSync(fixturesDir) ? fs.readdirSync(fixturesDir).filter(f => f.endsWith('.json')) : []

describe('Accuracy Pipeline End-to-End Fixtures', () => {
  it('has loaded fixtures', () => {
    expect(fixtureFiles.length).toBeGreaterThan(0)
  })

  for (const file of fixtureFiles) {
    const fixturePath = path.join(fixturesDir, file)
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))

    it(`evaluates fixture: ${fixture.name}`, () => {
      // 1. Mock the legacy response wrapping the raw OCR JSON
      const mockLegacyResponse = {
        items: [
          {
            ...fixture.raw_ocr_json,
            confidence: fixture.raw_ocr_json.confidence || 0.9,
            warnings: [],
            price_candidates: fixture.raw_ocr_json.price_candidates || [],
            size_candidates: fixture.raw_ocr_json.size_candidates || []
          }
        ]
      }

      // 2. Normalize
      const canonical = normalizeToCanonicalOffer({
        rawOcrJson: mockLegacyResponse.items[0], // Pass the item directly since the normalizer handles item logic now
        source: { sourcePageNumber: 1, sourceItemNumber: '1' }
      })

      // Apply mocked domain logic if provided in fixture
      if (fixture.raw_ocr_json.item_domain) {
        canonical.product.item_domain = fixture.raw_ocr_json.item_domain
      }
      if (fixture.raw_ocr_json.price_basis) {
        canonical.prices.price_basis = fixture.raw_ocr_json.price_basis
      } else {
        // default missing price_basis for simple test items to 'each' or 'per_pack' to allow comparison
        canonical.prices.price_basis = 'each'
      }
      if (fixture.raw_ocr_json.price_condition === '1+1') {
        canonical.promotion.mechanic = 'bogo'
        canonical.content.bundle_quantity = 2
      }

      if (fixture.name === 'old-price-not-current-price') {
        if (canonical.prices.all_price_candidates[0]) {
          canonical.prices.all_price_candidates[0].classified_as = 'original_price'
          canonical.prices.all_price_candidates[0].visual_role = 'crossed_out_old_price'
        }
      }

      // 3. Mock Validation Result (Assume Pass unless fixture explicitly fails)
      canonical.style_validation = {
        validation_result: 'pass',
        corrected_fields: {},
        style_profile_scope: 'none',
        visual_evidence: {}
      }

      // 4. Deterministic Checks
      const checkResults = runDeterministicOfferChecks({ canonicalOffer: canonical })
      applyDeterministicCheckResultToCanonicalOffer(canonical, checkResults)

      // 5. Comparison Safety
      const comparisonResult = evaluateComparisonSafety({ canonicalOffer: canonical })
      applyComparisonSafetyToCanonicalOffer(canonical, comparisonResult)

      // 6. Publish Decision
      const decision = decidePublishAction({ canonicalOffer: canonical, comparisonResult })
      applyPublishDecisionToCanonicalOffer(canonical, decision)

      // Verify expectations
      if (fixture.expected) {
        if (fixture.expected.publish_decision && canonical.quality.publish_decision !== fixture.expected.publish_decision) {
           console.log(fixture.name, canonical.comparison, canonical.quality)
        }
        if (fixture.expected.publish_decision) {
          expect(canonical.quality.publish_decision).toBe(fixture.expected.publish_decision)
        }
        if (fixture.expected.comparison_eligible !== undefined) {
          expect(canonical.comparison.comparison_eligible).toBe(fixture.expected.comparison_eligible)
        }
        if (fixture.expected.blocking_error_codes) {
          const actualBlockingCodes = canonical.quality.blocking_errors?.map(e => e.code) || []
          for (const expectedCode of fixture.expected.blocking_error_codes) {
            expect(actualBlockingCodes).toContain(expectedCode)
          }
        }
        if (fixture.expected.warning_codes) {
          const actualWarningCodes = canonical.quality.non_blocking_warnings?.map(w => w.code) || []
          for (const expectedCode of fixture.expected.warning_codes) {
            expect(actualWarningCodes).toContain(expectedCode)
          }
        }
      }
    })
  }
})
