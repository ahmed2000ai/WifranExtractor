import { describe, it, expect, vi, beforeEach } from 'vitest'
import { syncPreparedOffers } from '../offerSyncService'
import * as fs from 'fs'

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}))

vi.mock('../supabaseAdminClient', () => ({
  getSupabaseAdminClient: () => ({
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null })
  })
}))

vi.mock('../storage/offerImageStorageService', () => ({
  uploadOfferImage: vi.fn().mockResolvedValue({ imageUrl: 'fake', storagePath: 'fake' })
}))

describe('PrePublish Approval DB Gate', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('throws an error if requirePrePublishApproval is true but extractionPackagePath is missing', async () => {
    await expect(syncPreparedOffers({
      supermarketId: '123',
      locationScope: 'national',
      locationSlug: 'sa',
      cityId: 'c1',
      regionId: null,
      offerStartDate: '2023-01-01',
      offerEndDate: '2023-01-31',
      storageBucket: 'test',
      rows: [],
      options: {
        requireImageForDraft: false,
        defaultOfferStatus: 'published',
        importDefaultStatus: 'published',
        allowNeedsReviewFallback: true,
        publishWarningsAllowed: true,
        requirePrePublishApproval: true
      }
    })).rejects.toThrow('DB publish blocked: extractionPackagePath is required')
  })

  it('throws an error if manifest does not exist', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    await expect(syncPreparedOffers({
      supermarketId: '123',
      locationScope: 'national',
      locationSlug: 'sa',
      cityId: 'c1',
      regionId: null,
      offerStartDate: '2023-01-01',
      offerEndDate: '2023-01-31',
      storageBucket: 'test',
      rows: [],
      options: {
        requireImageForDraft: false,
        defaultOfferStatus: 'published',
        importDefaultStatus: 'published',
        allowNeedsReviewFallback: true,
        publishWarningsAllowed: true,
        requirePrePublishApproval: true,
        extractionPackagePath: '/fake/path'
      }
    })).rejects.toThrow('DB publish blocked: Manifest not found')
  })

  it('throws an error if manifest exists but not approved', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ pre_publish_preview: { status: 'opened' } }))
    await expect(syncPreparedOffers({
      supermarketId: '123',
      locationScope: 'national',
      locationSlug: 'sa',
      cityId: 'c1',
      regionId: null,
      offerStartDate: '2023-01-01',
      offerEndDate: '2023-01-31',
      storageBucket: 'test',
      rows: [],
      options: {
        requireImageForDraft: false,
        defaultOfferStatus: 'published',
        importDefaultStatus: 'published',
        allowNeedsReviewFallback: true,
        publishWarningsAllowed: true,
        requirePrePublishApproval: true,
        extractionPackagePath: '/fake/path'
      }
    })).rejects.toThrow('DB publish blocked: Pre-Publish Preview approval is required.')
  })

  it('proceeds if manifest exists and is approved', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ pre_publish_preview: { status: 'approved' } }))
    const result = await syncPreparedOffers({
      supermarketId: '123',
      locationScope: 'national',
      locationSlug: 'sa',
      cityId: 'c1',
      regionId: null,
      offerStartDate: '2023-01-01',
      offerEndDate: '2023-01-31',
      storageBucket: 'test',
      rows: [],
      options: {
        requireImageForDraft: false,
        defaultOfferStatus: 'published',
        importDefaultStatus: 'published',
        allowNeedsReviewFallback: true,
        publishWarningsAllowed: true,
        requirePrePublishApproval: true,
        extractionPackagePath: '/fake/path'
      }
    })
    expect(result.ok).toBe(true)
    expect(result.status).toBe('failed') // since 0 rows
  })
})
