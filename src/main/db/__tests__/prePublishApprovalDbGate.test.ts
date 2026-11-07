import { describe, it, expect, vi, beforeEach } from 'vitest'
import { syncPreparedOffers } from '../offerSyncService'
import * as fs from 'fs'

vi.mock('fs', () => {
  const existsSync = vi.fn()
  const readFileSync = vi.fn()
  const promises = {
    readFile: vi.fn(),
    writeFile: vi.fn()
  }
  return {
    existsSync,
    readFileSync,
    promises,
    default: {
      existsSync,
      readFileSync,
      promises
    }
  }
})

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
    vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify({ pre_publish_preview: { status: 'opened' } }) as any)
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
    vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify({ pre_publish_preview: { status: 'approved' } }) as any)
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

  it('throws an error if manifest has db_update_status "completed" and forceRePublish is not enabled', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify({
      pre_publish_preview: { status: 'approved' },
      db_update_status: 'completed',
      extraction_folder_name: 'Test_Completed'
    }) as any)
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
    })).rejects.toThrow('DB publish blocked: Extraction package \'Test_Completed\' was already published to the database.')
  })

  it('proceeds if manifest has db_update_status "completed" but forceRePublish is true', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify({
      pre_publish_preview: { status: 'approved' },
      db_update_status: 'completed',
      extraction_folder_name: 'Test_Completed'
    }) as any)
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
        extractionPackagePath: '/fake/path',
        forceRePublish: true
      }
    })
    expect(result.ok).toBe(true)
  })
})
