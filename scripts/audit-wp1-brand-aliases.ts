import { readFileSync } from 'fs'
import { join } from 'path'
import { BrandGroupingService } from '../src/main/db/brandGroupingService'
import { getCanonicalBrandId } from '../src/shared/utils/bilingualTokenNormalizer'

const EXECUTION_TIMEOUT_MS = 15000

const BRAND_CANDIDATES: Array<[string, string]> = [
  ['Coca Cola', 'كوكا كولا'],
  ['Coca-Cola', 'كوكاكولا'],
  ['Sadia', 'ساديا'],
  ['Sadia', 'سادية'],
  ['Fairy', 'فيري'],
  ['Lays', 'لايز'],
  ['Doritos', 'دوريتوس'],
  ['Ulker', 'اولكر'],
  ['Snickers', 'سنيكرز'],
  ['Oreo', 'اوريو'],
  ['Pepsi', 'بيبسي'],
  ['Kitco', 'كتكو'],
  ['Nescafe', 'نسكافيه'],
  ['Cadbury', 'كادبوري'],
  ['Haley', 'هالي']
]

async function runBrandAliasAudit(): Promise<void> {
  const timeoutHandle = setTimeout(() => {
    console.error(`[WP1BrandAudit] TIMEOUT: exceeded ${EXECUTION_TIMEOUT_MS}ms.`)
    process.exit(1)
  }, EXECUTION_TIMEOUT_MS)

  try {
    console.log(`[WP1BrandAudit] Starting offline audit for ${BRAND_CANDIDATES.length} candidate pairs...`)
    const svc = new BrandGroupingService()

    for (let i = 0; i < BRAND_CANDIDATES.length; i++) {
      const [en, ar] = BRAND_CANDIDATES[i]
      try {
        const resEnOnly = svc.normalizeBrand({ brandEn: en })
        const resArOnly = svc.normalizeBrand({ brandAr: ar })
        const resBoth = svc.normalizeBrand({ brandEn: en, brandAr: ar })
        const dictEn = getCanonicalBrandId(en)
        const dictAr = getCanonicalBrandId(ar)
        console.log(
          `[${i + 1}/${BRAND_CANDIDATES.length}] ${en} / ${ar} -> enOnly=${resEnOnly.brandKey}(${resEnOnly.status}) arOnly=${resArOnly.brandKey}(${resArOnly.status}) both=${resBoth.brandKey}(${resBoth.status}) dictEn=${dictEn} dictAr=${dictAr}`
        )
      } catch (err) {
        console.error(`[WP1BrandAudit] Error evaluating (${en}, ${ar}):`, err)
      }
    }

    // Also inspect unknown-brand entries in audit_003_pipeline_190_records.json (read-only)
    const audit190Path = join(process.cwd(), 'Extracts', 'audit_003_pipeline_190_records.json')
    const audit190 = JSON.parse(readFileSync(audit190Path, 'utf8'))
    const unknownRecords = (audit190.records || []).filter((r: any) => r.brandStatus === 'unknown')
    console.log(`[WP1BrandAudit] Offline 190-corpus unknown brand count: ${unknownRecords.length}`)
  } finally {
    clearTimeout(timeoutHandle)
  }
}

runBrandAliasAudit()
  .then(() => {
    const activeHandles = (process as any)._getActiveHandles?.() || []
    console.log(
      `[WP1BrandAudit] Finished cleanly. Active handles before exit: ${activeHandles.length}`,
      activeHandles.map((h: any) => h?.constructor?.name || typeof h)
    )
    process.exit(0)
  })
  .catch((err) => {
    console.error('[WP1BrandAudit] Fatal error:', err)
    process.exit(1)
  })

