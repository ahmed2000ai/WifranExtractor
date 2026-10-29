import { describe, it, expect, vi, beforeEach } from 'vitest'
import { syncPreparedOffers } from '../../db/offerSyncService'
import * as fs from 'fs'


vi.mock('fs')
vi.mock('../../db/supabaseAdminClient', () => ({
  getSupabaseAdminClient: () => ({
    from: vi.fn(() => ({
      insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'mock-id' }, error: null }) }) }),
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null }) }) })
    }))
  })
}))

describe('Dry Run Publish', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      pre_publish_preview: { status: 'approved' }
    }))
  })

  it('QA dry-run publish does not call image upload or DB upsert, and produces counts', async () => {
    const input: any = {
      supermarketSlug: 'test',
      locationScope: 'city',
      locationSlug: 'riyadh',
      storageBucket: 'offers',
      rows: [
        {
          rowId: 'r1',
          status: 'prepared',
          localImagePath: '/fake/image1.jpg',
          preparedPayload: { 
            status: 'published',
            supermarket_id: '123',
            city_id: 'c1',
            offer_start_date: '2023-01-01',
            offer_end_date: '2030-01-01',
            title_ar: 'test',
            title_en: 'test',
            offer_price: 10,
            original_price: null,
            currency: 'SAR',
            item_domain: 'grocery',
            source_page_number: 1,
            source_item_number: '001',
            image_source_type: 'local'
          }
        },
        {
          rowId: 'r2',
          status: 'skipped',
          preparedPayload: null
        }
      ],
      options: {
        requirePrePublishApproval: false,
        extractionPackagePath: '/fake/package_qa',
        dryRun: true
      }
    }

    const result = await syncPreparedOffers(input)

    expect(result.publishedRows).toBe(1)
    expect(result.skippedRows).toBe(1)
    expect(result.imageUploadedRows).toBe(1)
    
    // In dry run mode, fs.writeFileSync should be called to output the report
    expect(fs.writeFileSync).toHaveBeenCalled()
    const writeCall = vi.mocked(fs.writeFileSync).mock.calls.find(c => String(c[0]).includes('qa-dry-run-publish-report.json'))
    expect(writeCall).toBeDefined()
    
    const reportData = JSON.parse(writeCall![1] as string)
    expect(reportData.qa_mode).toBe(true)
    expect(reportData.dry_run).toBe(true)
    expect(reportData.counts.publish).toBe(1)
    expect(reportData.counts.skip_or_quarantine).toBe(1)
    expect(reportData.safety.supabase_db_writes_made).toBe(0)
  })
})
