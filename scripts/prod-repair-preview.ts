/**
 * Read-Only Preflight Preview for Production Data Repair (Stage B)
 *
 * Inspects all published offers in batch-2026-11-16T08-39-30-dacbb8 against
 * live PRODUCTION Supabase (swratbmclahjyekouned).
 *
 * Performs ZERO writes and ZERO storage mutations.
 */

import path from 'path'
import {
  assertProductionMaintenanceAuthorized,
  createGuardedPgClient,
  resolveDatabaseConfig
} from '../src/main/db/databaseEnvironmentResolver'
import { BatchOrchestrationService } from '../src/main/batch/batchOrchestrationService'

async function runPreview() {
  assertProductionMaintenanceAuthorized('prod-repair-preview.ts')

  const config = resolveDatabaseConfig('PRODUCTION_UI')
  console.log('=================================================================')
  console.log('  STAGE B — PRODUCTION REPAIR PREFLIGHT PREVIEW (READ ONLY)       ')
  console.log(`  Target Project: ${config.projectRef} (${config.dbHost})`)
  console.log('=================================================================\n')

  const batchId = 'batch-2026-11-16T08-39-30-dacbb8'
  const batchesDir = path.resolve(process.cwd(), 'Extracts', 'batches')
  const service = new BatchOrchestrationService(batchesDir)

  const pgClient = createGuardedPgClient('PRODUCTION_UI')
  await pgClient.connect()
  console.log('Connected to Production PostgreSQL.')

  try {
    const preview = await service.previewPublishedOfferImageRepairs({
      batchId,
      databaseContext: 'PRODUCTION_UI',
      pgClient
    })

    console.log('\n--- PREVIEW SUMMARY ---')
    console.log(`Batch ID: ${preview.batchId}`)
    console.log(`Success: ${preview.success}`)
    console.log(`Total Published Offers: ${preview.totalPublishedOffers}`)
    console.log(`Missing Consumer Images: ${preview.missingImageOffersCount}`)
    console.log(`Missing ODI Associations: ${preview.missingOdiAssociationCount}`)
    console.log(`Ready for Repair: ${preview.readyForRepairCount}`)
    console.log(`Awaiting Identity Correction: ${preview.awaitingIdentityCorrectionCount}`)
    console.log(`Awaiting Crop Correction: ${preview.awaitingCropCorrectionCount}`)
    console.log(`Requires Operator Attention: ${preview.requiresOperatorAttentionCount}`)

    console.log('\n--- DETAILED OFFER REPAIR PREVIEWS ---')
    for (const r of preview.repairs) {
      console.log(`\n[${r.repairEligibility.toUpperCase()}] Source: ${r.sourceOfferId} (Offer ID: ${r.offerId})`)
      console.log(`  Title: ${r.titleEn} / ${r.titleAr}`)
      console.log(`  Current Product: ${r.currentProductLabel} (ID: ${r.productId})`)
      console.log(`  Pack Size: ${r.packSizeLabel}`)
      console.log(`  Identity Issue: ${r.identityIssueKind} -> Action: ${r.proposedIdentityAction}`)
      if (r.proposedProductLabel) console.log(`  Proposed Product: ${r.proposedProductLabel}`)
      console.log(`  Target Bucket: ${r.targetBucket}`)
      console.log(`  Repair Action Kind: ${r.repairActionKind}`)
      console.log(`  Crop Type: ${r.cropType} (usable: ${!r.requiresReplacementImage && r.cropType !== 'none'})`)
      if (r.visiblePackageWeightLabel) console.log(`  Visible Package Weight: ${r.visiblePackageWeightLabel}`)
      console.log(`  Reason: ${r.reason}`)
      console.log(`  Planned Changes:`)
      for (const ch of r.plannedDbChanges) {
        console.log(`    - ${ch}`)
      }
    }
  } finally {
    await pgClient.end()
  }
}

runPreview().catch((err) => {
  console.error('Fatal error during repair preview:', err)
  process.exit(1)
})
