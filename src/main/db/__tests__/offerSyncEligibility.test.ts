import { describe, it, expect } from 'vitest'
import { buildPreparedOfferPayload } from '../offerPayloadBuilder'

describe('offerSyncEligibility', () => {
  it('maps publish_decision = skip_or_quarantine to error payload', () => {
    const { payload, issues } = buildPreparedOfferPayload({
      normalizedData: {
        offer: {
          title_en: 'Test',
          offer_price: 10
        },
        canonical: {
          quality: {
            publish_decision: 'skip_or_quarantine'
          }
        }
      },
      supermarketId: '123',
      locationScope: 'national',
      cityId: null,
      regionId: null,
      sourceId: null,
      offerStartDate: '2023-01-01',
      offerEndDate: '2023-01-31',
      defaultOfferStatus: 'published',
      importDefaultStatus: 'published',
      allowNeedsReviewFallback: true,
      publishWarningsAllowed: true,
      dataQualityNeedsReviewThreshold: 0,
      requireImageForDraft: false
    })

    expect(payload).toBeNull()
    expect(issues.some(i => i.code === 'PUBLISH_DECISION_SKIP_OR_QUARANTINE')).toBe(true)
  })

  it('allows publish_but_exclude_from_comparison to generate a published payload', () => {
    const { payload, issues } = buildPreparedOfferPayload({
      normalizedData: {
        offer: {
          title_en: 'Test',
          offer_price: 10
        },
        canonical: {
          quality: {
            publish_decision: 'publish_but_exclude_from_comparison'
          }
        }
      },
      supermarketId: '123',
      locationScope: 'city',
      cityId: 'c1',
      regionId: null,
      sourceId: null,
      offerStartDate: '2023-01-01',
      offerEndDate: '2030-01-31',
      defaultOfferStatus: 'published',
      importDefaultStatus: 'published',
      allowNeedsReviewFallback: true,
      publishWarningsAllowed: true,
      dataQualityNeedsReviewThreshold: 0,
      requireImageForDraft: false
    })

    if (payload === null) {
      console.log('ISSUES:', issues)
    }
    expect(payload).not.toBeNull()
    expect(payload?.status).toBe('published')
    // comparison_eligible isn't saved to payload, so we only care it's published.
    expect(issues.some(i => i.code === 'PUBLISH_DECISION_SKIP_OR_QUARANTINE')).toBe(false)
  })
})
