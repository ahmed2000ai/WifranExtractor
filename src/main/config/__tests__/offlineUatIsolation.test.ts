import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {
  isOfflineUatMode,
  assertNotOfflineUat,
  isAllowedLocalUrlInOfflineUat,
  installOfflineUatFetchGuard
} from '../offlineUatGuard'
import { ocrSingleItemImage } from '../../ocr/itemImageOcrService'
import { generateLeafletStyleProfileFromSelectedPages } from '../../ocr/leafletStyleProfileService'
import { generatePageStyleProfile } from '../../ocr/pageStyleProfileService'
import { validateItemWithStyleAwareness } from '../../ocr/styleAwareItemValidationService'
import { generatePageStyleProfile as generateLegacyStyleProfile } from '../../ocr/styleProfileService'
import { replaceStagedOfferConsumerImage } from '../../db/stagedLeafletDraftService'
import { loadReferenceDataBundle, MASTER_SUPERMARKETS } from '../../db/referenceDataService'
import { listAvailableExtractions } from '../../extraction/extractionPackageService'
import { getGeminiClient } from '../../ocr/geminiClient'
import { getMistralClient } from '../../ocr/mistralClient'
import { getSupabaseAdminClient } from '../../db/supabaseAdminClient'

describe('Offline UAT Network & Service Isolation Guards', () => {
  const originalUatEnv = process.env.WIFRAN_OFFLINE_UAT
  const originalEnableLegacyStyle = process.env.ENABLE_STYLE_PROFILE_GENERATION
  const originalFetch = globalThis.fetch
  const tempRoot = path.join(process.cwd(), 'temp', 'test_offline_uat_guard')

  beforeEach(() => {
    process.env.WIFRAN_OFFLINE_UAT = '1'
    fs.mkdirSync(tempRoot, { recursive: true })
  })

  afterEach(() => {
    if (originalUatEnv === undefined) {
      delete process.env.WIFRAN_OFFLINE_UAT
    } else {
      process.env.WIFRAN_OFFLINE_UAT = originalUatEnv
    }
    if (originalEnableLegacyStyle === undefined) {
      delete process.env.ENABLE_STYLE_PROFILE_GENERATION
    } else {
      process.env.ENABLE_STYLE_PROFILE_GENERATION = originalEnableLegacyStyle
    }
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
    try {
      if (fs.existsSync(tempRoot)) {
        fs.rmSync(tempRoot, { recursive: true, force: true })
      }
    } catch {}
  })

  it('allows only local Electron/Vite URLs and rejects all external hosts', () => {
    expect(isAllowedLocalUrlInOfflineUat('http://localhost:5173/src/main.tsx')).toBe(true)
    expect(isAllowedLocalUrlInOfflineUat('http://127.0.0.1:5173/')).toBe(true)
    expect(isAllowedLocalUrlInOfflineUat('ws://localhost:5173/')).toBe(true)
    expect(isAllowedLocalUrlInOfflineUat('local-file:///?path=C%3A%2Fpage1.png')).toBe(true)
    expect(isAllowedLocalUrlInOfflineUat('file:///C:/app/index.html')).toBe(true)
    expect(isAllowedLocalUrlInOfflineUat('data:image/png;base64,AAAA')).toBe(true)

    expect(isAllowedLocalUrlInOfflineUat('https://api.mistral.ai/v1/chat/completions')).toBe(false)
    expect(isAllowedLocalUrlInOfflineUat('https://generativelanguage.googleapis.com/v1/models')).toBe(false)
    expect(isAllowedLocalUrlInOfflineUat('https://aiplatform.googleapis.com/v1/projects')).toBe(false)
    expect(isAllowedLocalUrlInOfflineUat('https://example.supabase.co/rest/v1/offers')).toBe(false)
    expect(isAllowedLocalUrlInOfflineUat('https://cdn.example.com/product.jpg')).toBe(false)
    expect(isAllowedLocalUrlInOfflineUat('not-a-valid-url')).toBe(false)
  })

  it('installs global fetch guard that blocks external HTTP requests while permitting localhost dev server', async () => {
    const mockUnderlyingFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    globalThis.fetch = mockUnderlyingFetch as unknown as typeof fetch

    installOfflineUatFetchGuard()

    await expect(globalThis.fetch('https://api.mistral.ai/v1/chat/completions', { method: 'POST' })).rejects.toThrow(
      /OFFLINE_UAT_GUARD/
    )
    expect(mockUnderlyingFetch).not.toHaveBeenCalled()

    const localRes = await globalThis.fetch('http://localhost:5173/')
    expect(localRes.ok).toBe(true)
    expect(mockUnderlyingFetch).toHaveBeenCalledTimes(1)
  })

  it('blocks SDK factories (Gemini, Mistral, Supabase) when WIFRAN_OFFLINE_UAT=1', async () => {
    expect(isOfflineUatMode()).toBe(true)
    expect(() => getGeminiClient()).toThrow(/OFFLINE_UAT_GUARD/)
    await expect(getMistralClient('dummy-key')).rejects.toThrow(/OFFLINE_UAT_GUARD/)
    expect(() => getSupabaseAdminClient()).toThrow(/OFFLINE_UAT_GUARD/)
    expect(() => assertNotOfflineUat('Test Operation')).toThrow(/OFFLINE_UAT_GUARD/)
  })

  it('blocks every direct fetch Mistral & remote image caller without issuing network fetch', async () => {
    const spyFetch = vi.fn()
    globalThis.fetch = spyFetch as unknown as typeof fetch

    await expect(
      ocrSingleItemImage({ localImagePath: 'missing.webp', itemNumber: '1', pageNumber: 1 })
    ).rejects.toThrow(/OFFLINE_UAT_GUARD/)

    await expect(
      generateLeafletStyleProfileFromSelectedPages({
        selectedPageNumbers: [1],
        pageImagePaths: ['missing.png'],
        extractionPackagePath: tempRoot
      })
    ).rejects.toThrow(/OFFLINE_UAT_GUARD/)

    await expect(
      generatePageStyleProfile({
        pageNumber: 1,
        pageImagePath: 'missing.png',
        extractionPackagePath: tempRoot,
        forceRegenerate: true
      })
    ).rejects.toThrow(/OFFLINE_UAT_GUARD/)

    await expect(
      validateItemWithStyleAwareness({
        sourceItemNumber: '1',
        cropPath: 'missing.jpg',
        rawExtractionJson: {},
        canonicalDraft: {},
        extractionPackagePath: tempRoot
      })
    ).rejects.toThrow(/OFFLINE_UAT_GUARD/)

    process.env.ENABLE_STYLE_PROFILE_GENERATION = 'true'
    await expect(
      generateLegacyStyleProfile({
        pageNumber: 1,
        pageImagePath: 'missing.png',
        extractionPackagePath: tempRoot
      })
    ).rejects.toThrow(/OFFLINE_UAT_GUARD/)

    const draftDir = path.join(tempRoot, 'draft_case')
    fs.mkdirSync(draftDir, { recursive: true })
    fs.writeFileSync(
      path.join(draftDir, 'staged-draft.json'),
      JSON.stringify({
        schemaVersion: 1,
        jobId: 'uat-draft',
        header: {
          leafletName: 'Test.pdf',
          supermarketId: 'sm-1',
          regionId: null,
          validFrom: '2026-11-01',
          validTo: '2026-11-15'
        },
        items: [
          {
            id: 'offer-1',
            pageNumber: 1,
            itemNumber: '1',
            rawTitleEn: 'Test Product',
            rawTitleAr: 'منتج',
            editedTitleEn: 'Test Product',
            editedTitleAr: 'منتج',
            selectedImageSource: 'none'
          }
        ]
      }),
      'utf8'
    )

    await expect(
      replaceStagedOfferConsumerImage(draftDir, 'offer-1', {
        mode: 'custom_url',
        customUrl: 'https://cdn.example.com/custom.png'
      })
    ).rejects.toThrow(/OFFLINE_UAT_GUARD/)

    expect(spyFetch).not.toHaveBeenCalled()
  })

  it('serves reference data from offline MASTER catalogs without invoking Supabase even when test env flags are absent', async () => {
    const prevNodeEnv = process.env.NODE_ENV
    const prevVitest = process.env.VITEST
    const prevWorker = process.env.VITEST_WORKER_ID

    try {
      process.env.NODE_ENV = 'development'
      delete process.env.VITEST
      delete process.env.VITEST_WORKER_ID
      process.env.WIFRAN_OFFLINE_UAT = '1'

      const bundle = await loadReferenceDataBundle()
      expect(bundle.supermarkets.length).toBe(MASTER_SUPERMARKETS.length)
      expect(bundle.regions.length).toBeGreaterThan(0)
    } finally {
      process.env.NODE_ENV = prevNodeEnv
      if (prevVitest !== undefined) process.env.VITEST = prevVitest
      if (prevWorker !== undefined) process.env.VITEST_WORKER_ID = prevWorker
    }
  })

  it('isolates listAvailableExtractions() to workspaces_uat/ rather than Extracts/ when WIFRAN_OFFLINE_UAT=1', async () => {
    const fakeCwd = path.join(tempRoot, 'cwd_isolation')
    const prodWs = path.join(fakeCwd, 'Extracts', 'ProdLeafletOnly')
    const uatWs = path.join(fakeCwd, 'workspaces_uat', 'UatLeafletOnly')
    fs.mkdirSync(prodWs, { recursive: true })
    fs.mkdirSync(uatWs, { recursive: true })

    vi.spyOn(process, 'cwd').mockReturnValue(fakeCwd)

    const items = await listAvailableExtractions()
    const folderNames = items.map((i) => i.folderName)

    expect(folderNames).toContain('UatLeafletOnly')
    expect(folderNames).not.toContain('ProdLeafletOnly')
  })
})
