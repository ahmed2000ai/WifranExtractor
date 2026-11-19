import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { PDFDocument } from 'pdf-lib'
import { syncPreparedOffers } from '../offerSyncService'
import { sanitizeOfferSyncIpcInput } from '../../ipc/offerSyncIpc'
import { sanitizePublishStagedDraftOptions } from '../../ipc/productEnrichmentIpc'
import { LeafletMetadataService } from '../../metadata/leafletMetadataService'
import { LeafletMetadataCacheService } from '../../metadata/leafletMetadataCacheService'

const PANDA_SUPERMARKET_ID = 'c2cc16c2-0001-4444-b000-c00000000001'

const dbCallTracker = {
  fromCalls: [] as string[],
  insertCalls: 0,
  updateCalls: 0
}

vi.mock('../supabaseAdminClient', () => ({
  getSupabaseAdminClient: () => ({
    from: vi.fn((table: string) => {
      dbCallTracker.fromCalls.push(table)
      return {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn(() => {
          dbCallTracker.insertCalls++
          return {
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: 'mock-offer-id' }, error: null })
          }
        }),
        update: vi.fn(() => {
          dbCallTracker.updateCalls++
          return {
            eq: vi.fn().mockResolvedValue({ data: null, error: null })
          }
        }),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        single: vi.fn().mockResolvedValue({ data: null, error: null })
      }
    })
  })
}))

vi.mock('../../storage/offerImageStorageService', () => ({
  uploadOfferImage: vi.fn().mockResolvedValue({ imageUrl: 'https://mock.storage/fake.webp', storagePath: 'fake.webp' })
}))

describe('PrePublish Approval & Authoritative Metadata DB Gate', () => {
  const createdDirs: string[] = []
  const createdFingerprints: string[] = []

  async function createGateWorkspace(options?: {
    manifest?: Record<string, any> | null
    confirmMetadata?: boolean
    withPdf?: boolean
  }): Promise<{ wsDir: string; pdfFingerprint: string | null }> {
    const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wifran-prepub-gate-'))
    createdDirs.push(wsDir)
    fs.mkdirSync(path.join(wsDir, 'metadata'), { recursive: true })

    let pdfFingerprint: string | null = null
    if (options?.withPdf !== false) {
      const pdfDoc = await PDFDocument.create()
      pdfDoc.addPage([400, 600])
      const pdfBytes = Buffer.from(await pdfDoc.save())
      fs.writeFileSync(path.join(wsDir, 'original.pdf'), pdfBytes)
      pdfFingerprint = new LeafletMetadataCacheService().computeFingerprint(pdfBytes)
      createdFingerprints.push(pdfFingerprint)
    }

    if (options?.manifest !== null && options?.manifest !== undefined) {
      fs.writeFileSync(
        path.join(wsDir, 'extraction_manifest.json'),
        JSON.stringify(options.manifest, null, 2),
        'utf8'
      )
    }

    if (options?.confirmMetadata && pdfFingerprint) {
      new LeafletMetadataService().confirmMetadata({
        leafletFingerprint: pdfFingerprint,
        sourceFileName: 'original.pdf',
        supermarketId: PANDA_SUPERMARKET_ID,
        supermarketSlug: 'panda',
        startDate: '2026-10-01',
        endDate: '2026-10-15',
        locationScope: 'national',
        operatorId: 'operator_test',
        workspacePath: wsDir
      })
    }

    return { wsDir, pdfFingerprint }
  }

  function buildPreparedSampleRow() {
    return {
      rowId: 'row-1',
      pageNumber: 1,
      status: 'prepared' as const,
      normalizedData: {},
      preparedPayload: {
        supermarket_id: PANDA_SUPERMARKET_ID,
        coverage_scope: 'national',
        city_id: null,
        offer_start_date: '2026-10-01',
        offer_end_date: '2026-10-15',
        title_ar: 'حليب المراعي ١ لتر',
        title_en: 'Almarai Milk 1L',
        offer_price: 5.5,
        original_price: 7.0,
        currency: 'SAR',
        item_domain: 'grocery',
        source_page_number: 1,
        source_item_number: '001',
        image_source_type: 'local',
        status: 'published'
      }
    }
  }

  beforeEach(() => {
    dbCallTracker.fromCalls = []
    dbCallTracker.insertCalls = 0
    dbCallTracker.updateCalls = 0
  })

  afterEach(() => {
    const cacheService = new LeafletMetadataCacheService()
    for (const fp of createdFingerprints) {
      try {
        cacheService.invalidate(fp)
      } catch {
        // ignore cleanup errors
      }
    }
    createdFingerprints.length = 0

    for (const dir of createdDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        // ignore cleanup errors
      }
    }
    createdDirs.length = 0
  })

  it('throws an error if requirePrePublishApproval is true but extractionPackagePath is missing', async () => {
    await expect(syncPreparedOffers({
      supermarketId: PANDA_SUPERMARKET_ID,
      locationScope: 'national',
      locationSlug: 'national',
      cityId: null,
      regionId: null,
      offerStartDate: '2026-10-01',
      offerEndDate: '2026-10-15',
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
    const { wsDir } = await createGateWorkspace({ manifest: null, withPdf: false })
    await expect(syncPreparedOffers({
      supermarketId: PANDA_SUPERMARKET_ID,
      locationScope: 'national',
      locationSlug: 'national',
      cityId: null,
      regionId: null,
      offerStartDate: '2026-10-01',
      offerEndDate: '2026-10-15',
      storageBucket: 'test',
      rows: [],
      options: {
        requireImageForDraft: false,
        defaultOfferStatus: 'published',
        importDefaultStatus: 'published',
        allowNeedsReviewFallback: true,
        publishWarningsAllowed: true,
        requirePrePublishApproval: true,
        extractionPackagePath: wsDir
      }
    })).rejects.toThrow('DB publish blocked: Manifest not found')
  })

  it('throws an error if manifest exists but Pre-Publish Preview is not approved', async () => {
    const { wsDir } = await createGateWorkspace({
      manifest: {
        pre_publish_preview: { status: 'opened' },
        supermarket: { id: PANDA_SUPERMARKET_ID }
      }
    })
    await expect(syncPreparedOffers({
      supermarketId: PANDA_SUPERMARKET_ID,
      locationScope: 'national',
      locationSlug: 'national',
      cityId: null,
      regionId: null,
      offerStartDate: '2026-10-01',
      offerEndDate: '2026-10-15',
      storageBucket: 'test',
      rows: [],
      options: {
        requireImageForDraft: false,
        defaultOfferStatus: 'published',
        importDefaultStatus: 'published',
        allowNeedsReviewFallback: true,
        publishWarningsAllowed: true,
        requirePrePublishApproval: true,
        extractionPackagePath: wsDir
      }
    })).rejects.toThrow('DB publish blocked: Pre-Publish Preview approval is required.')
  })

  it('rejects approved Pre-Publish manifest when authoritative metadata confirmation is missing and strips renderer IPC bypass flags', async () => {
    const { wsDir, pdfFingerprint } = await createGateWorkspace({
      manifest: {
        pre_publish_preview: { status: 'approved' },
        supermarket: { id: PANDA_SUPERMARKET_ID }
      },
      confirmMetadata: false
    })

    // 1. Direct sync with Pre-Publish approved but UNCONFIRMED metadata MUST be blocked
    await expect(syncPreparedOffers({
      supermarketId: PANDA_SUPERMARKET_ID,
      locationScope: 'national',
      locationSlug: 'national',
      cityId: null,
      regionId: null,
      offerStartDate: '2026-10-01',
      offerEndDate: '2026-10-15',
      leafletId: pdfFingerprint!,
      storageBucket: 'test',
      rows: [buildPreparedSampleRow()],
      options: {
        requireImageForDraft: false,
        defaultOfferStatus: 'published',
        importDefaultStatus: 'published',
        allowNeedsReviewFallback: true,
        publishWarningsAllowed: true,
        requirePrePublishApproval: true,
        extractionPackagePath: wsDir
      }
    })).rejects.toThrow(/DB publish blocked: PUBLISH_BLOCKED/i)

    expect(dbCallTracker.insertCalls).toBe(0)
    expect(dbCallTracker.fromCalls).toHaveLength(0)

    // 2. Renderer IPC boundary sanitization MUST block requirePrePublishApproval:false & strip spoofed supabaseClient
    const spoofedIpcInput = sanitizeOfferSyncIpcInput({
      supermarketId: PANDA_SUPERMARKET_ID,
      locationScope: 'national',
      locationSlug: 'national',
      cityId: null,
      regionId: null,
      offerStartDate: '2026-10-01',
      offerEndDate: '2026-10-15',
      leafletId: pdfFingerprint!,
      storageBucket: 'test',
      rows: [buildPreparedSampleRow()],
      options: {
        requireImageForDraft: false,
        defaultOfferStatus: 'published',
        importDefaultStatus: 'published',
        allowNeedsReviewFallback: true,
        publishWarningsAllowed: true,
        requirePrePublishApproval: false,
        dryRun: false,
        supabaseClient: { fake: true } as any,
        extractionPackagePath: wsDir
      } as any
    })

    expect(spoofedIpcInput.options.requirePrePublishApproval).toBe(true)
    expect((spoofedIpcInput.options as any).supabaseClient).toBeUndefined()
    await expect(syncPreparedOffers(spoofedIpcInput)).rejects.toThrow(/DB publish blocked: PUBLISH_BLOCKED/i)
    expect(dbCallTracker.insertCalls).toBe(0)

    // 3. Staged-draft publish IPC boundary strips spoofed supabaseClient & authorizedCanaryAutoLink
    const sanitizedStageOpts = sanitizePublishStagedDraftOptions({
      operatorConfirmedPublish: true,
      supabaseClient: { fake: true },
      authorizedCanaryAutoLink: true,
      reviewedBy: 'operator'
    })
    expect(sanitizedStageOpts.operatorConfirmedPublish).toBe(true)
    expect(sanitizedStageOpts.reviewedBy).toBe('operator')
    expect(sanitizedStageOpts.supabaseClient).toBeUndefined()
    expect(sanitizedStageOpts.authorizedCanaryAutoLink).toBeUndefined()
  })

  it('blocks publish when leaflet fingerprint mismatches the workspace PDF even with confirmed metadata', async () => {
    const { wsDir } = await createGateWorkspace({
      manifest: {
        pre_publish_preview: { status: 'approved' },
        supermarket: { id: PANDA_SUPERMARKET_ID }
      },
      confirmMetadata: true
    })

    await expect(syncPreparedOffers({
      supermarketId: PANDA_SUPERMARKET_ID,
      locationScope: 'national',
      locationSlug: 'national',
      cityId: null,
      regionId: null,
      offerStartDate: '2026-10-01',
      offerEndDate: '2026-10-15',
      leafletId: 'a'.repeat(64),
      storageBucket: 'test',
      rows: [buildPreparedSampleRow()],
      options: {
        requireImageForDraft: false,
        defaultOfferStatus: 'published',
        importDefaultStatus: 'published',
        allowNeedsReviewFallback: true,
        publishWarningsAllowed: true,
        requirePrePublishApproval: true,
        extractionPackagePath: wsDir
      }
    })).rejects.toThrow(/DB publish blocked: PUBLISH_BLOCKED.*Cryptographic fingerprint mismatch/i)

    expect(dbCallTracker.insertCalls).toBe(0)
  })

  it('proceeds if manifest exists, Pre-Publish Preview is approved, and metadata is authoritatively confirmed', async () => {
    const { wsDir, pdfFingerprint } = await createGateWorkspace({
      manifest: {
        pre_publish_preview: { status: 'approved' },
        supermarket: { id: PANDA_SUPERMARKET_ID }
      },
      confirmMetadata: true
    })

    const result = await syncPreparedOffers({
      supermarketId: PANDA_SUPERMARKET_ID,
      locationScope: 'national',
      locationSlug: 'national',
      cityId: null,
      regionId: null,
      offerStartDate: '2026-10-01',
      offerEndDate: '2026-10-15',
      leafletId: pdfFingerprint!,
      storageBucket: 'test',
      rows: [],
      options: {
        requireImageForDraft: false,
        defaultOfferStatus: 'published',
        importDefaultStatus: 'published',
        allowNeedsReviewFallback: true,
        publishWarningsAllowed: true,
        requirePrePublishApproval: true,
        extractionPackagePath: wsDir
      }
    })
    expect(result.ok).toBe(true)
    expect(result.status).toBe('failed') // since 0 rows
  })

  it('throws an error if manifest has db_update_status "completed" and forceRePublish is not enabled', async () => {
    const { wsDir } = await createGateWorkspace({
      manifest: {
        pre_publish_preview: { status: 'approved' },
        db_update_status: 'completed',
        extraction_folder_name: 'Test_Completed',
        supermarket: { id: PANDA_SUPERMARKET_ID }
      },
      confirmMetadata: true
    })

    await expect(syncPreparedOffers({
      supermarketId: PANDA_SUPERMARKET_ID,
      locationScope: 'national',
      locationSlug: 'national',
      cityId: null,
      regionId: null,
      offerStartDate: '2026-10-01',
      offerEndDate: '2026-10-15',
      storageBucket: 'test',
      rows: [],
      options: {
        requireImageForDraft: false,
        defaultOfferStatus: 'published',
        importDefaultStatus: 'published',
        allowNeedsReviewFallback: true,
        publishWarningsAllowed: true,
        requirePrePublishApproval: true,
        extractionPackagePath: wsDir
      }
    })).rejects.toThrow("DB publish blocked: Extraction package 'Test_Completed' was already published to the database.")
  })

  it('blocks forceRePublish if manifest is "completed" and metadata confirmation is missing', async () => {
    const { wsDir } = await createGateWorkspace({
      manifest: {
        pre_publish_preview: { status: 'approved' },
        db_update_status: 'completed',
        extraction_folder_name: 'Test_Completed',
        supermarket: { id: PANDA_SUPERMARKET_ID }
      },
      confirmMetadata: false
    })

    await expect(syncPreparedOffers({
      supermarketId: PANDA_SUPERMARKET_ID,
      locationScope: 'national',
      locationSlug: 'national',
      cityId: null,
      regionId: null,
      offerStartDate: '2026-10-01',
      offerEndDate: '2026-10-15',
      storageBucket: 'test',
      rows: [],
      options: {
        requireImageForDraft: false,
        defaultOfferStatus: 'published',
        importDefaultStatus: 'published',
        allowNeedsReviewFallback: true,
        publishWarningsAllowed: true,
        requirePrePublishApproval: true,
        extractionPackagePath: wsDir,
        forceRePublish: true
      }
    })).rejects.toThrow(/DB publish blocked: PUBLISH_BLOCKED/i)
  })

  it('proceeds if manifest has db_update_status "completed", forceRePublish is true, and metadata is authoritatively confirmed', async () => {
    const { wsDir, pdfFingerprint } = await createGateWorkspace({
      manifest: {
        pre_publish_preview: { status: 'approved' },
        db_update_status: 'completed',
        extraction_folder_name: 'Test_Completed',
        supermarket: { id: PANDA_SUPERMARKET_ID }
      },
      confirmMetadata: true
    })

    const result = await syncPreparedOffers({
      supermarketId: PANDA_SUPERMARKET_ID,
      locationScope: 'national',
      locationSlug: 'national',
      cityId: null,
      regionId: null,
      offerStartDate: '2026-10-01',
      offerEndDate: '2026-10-15',
      leafletId: pdfFingerprint!,
      storageBucket: 'test',
      rows: [],
      options: {
        requireImageForDraft: false,
        defaultOfferStatus: 'published',
        importDefaultStatus: 'published',
        allowNeedsReviewFallback: true,
        publishWarningsAllowed: true,
        requirePrePublishApproval: true,
        extractionPackagePath: wsDir,
        forceRePublish: true
      }
    })
    expect(result.ok).toBe(true)
  })
})
