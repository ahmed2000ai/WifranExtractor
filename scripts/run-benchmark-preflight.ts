import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { LiveCatalogMatchingBenchmarkRunner } from '../src/main/ocr/liveCatalogMatchingBenchmarkRunner'

async function main() {
  console.log('=========================================================================')
  console.log('  WIFRAN-EXTRACTOR-CATALOG-MATCH-002: LIVE BENCHMARK PREFLIGHT RUNNER    ')
  console.log('=========================================================================')

  const runner = new LiveCatalogMatchingBenchmarkRunner()

  // 1. Assert Environment Isolation
  console.log('[1/4] Verifying Environment Isolation...')
  runner.assertEnvironmentIsolation()
  console.log('✓ Development Isolation Verified: gykrbpykjhpyrdrinkuk')

  // 2. Seed Controlled Development Catalog
  console.log('[2/4] Seeding Controlled Development Catalog (gykrbpykjhpyrdrinkuk)...')
  const catalogIdMap = await runner.seedDevelopmentCatalog()
  console.log(`✓ Seeded ${catalogIdMap.size} development catalog products with PostgreSQL-generated IDs:`)
  for (const [name, id] of catalogIdMap.entries()) {
    console.log(`    - ID ${id}: ${name}`)
  }

  // 3. Run Offline Candidate Retrieval Preflight
  console.log('[3/4] Running Candidate Retrieval Preflight Offline...')
  const preflightReport = await runner.runRetrievalPreflight(catalogIdMap)

  // 4. Save and Display Preflight Report
  console.log('[4/4] Generating Preflight Report...')
  const outPath = path.resolve(process.cwd(), 'Extracts', 'live_benchmark_preflight_report.json')
  require('fs').writeFileSync(outPath, JSON.stringify(preflightReport, null, 2))
  console.log(`✓ Saved preflight report to: ${outPath}`)

  console.log('\n=========================================================================')
  console.log('  MANDATORY OPERATOR PREFLIGHT SUMMARY (SECTION 7)')
  console.log('=========================================================================')
  console.log(`• Total Verified Real Source Identities: ${preflightReport.dataset.totalRealSourceIdentities}`)
  console.log(`  - Gemini-Evaluated Subset: ${preflightReport.coveragePartitioning.geminiEvaluatedIdentitiesCount} (${preflightReport.coveragePartitioning.geminiEvaluatedBrands.join(', ')}) -> ${preflightReport.coveragePartitioning.geminiEvaluatedBreakdown.existing} existing, ${preflightReport.coveragePartitioning.geminiEvaluatedBreakdown.temporary} temp, ${preflightReport.coveragePartitioning.geminiEvaluatedBreakdown.unresolved} unresolved`)
  console.log(`  - Locally-Handled Subset: ${preflightReport.coveragePartitioning.locallyHandledIdentitiesCount} -> ${preflightReport.coveragePartitioning.locallyHandledBreakdown.absentInTestCatalogOnly} absent in test catalog, ${preflightReport.coveragePartitioning.locallyHandledBreakdown.policyFlaggedUnresolved} policy unresolved`)
  console.log(`  - Cross-Request Temp Reconciliation Tested: ${preflightReport.coveragePartitioning.crossRequestTempReconciliationTested ? 'YES' : 'NO (distinct single-brand scopes)'}`)
  console.log(`• Total Brands/Groups: ${preflightReport.dataset.brandCount} (${preflightReport.dataset.brands.join(', ')})`)
  console.log(`• Paid Gemini Matching Requests: ${preflightReport.requestBudget.matchingRequestsCount} (Seara & Sadia)`)
  console.log(`• Global Flex Rates (valid through ${preflightReport.pricingDocumentation.validThrough}): Input $${preflightReport.pricingDocumentation.inputPerMillionUsd}/1M | Output+Thinking $${preflightReport.pricingDocumentation.outputIncludingThinkingPerMillionUsd}/1M`)
  console.log(`• Estimated Input Tokens: ${preflightReport.requestBudget.estimatedInputTokens}`)
  console.log(`• Estimated Output + Thinking Tokens: ${preflightReport.requestBudget.estimatedOutputTokens + preflightReport.requestBudget.estimatedThinkingTokens} (${preflightReport.requestBudget.estimatedOutputTokens} output + ${preflightReport.requestBudget.estimatedThinkingTokens} thinking)`)
  console.log(`• Estimated Total Tokens: ${preflightReport.requestBudget.estimatedTotalTokens}`)
  console.log(`• Estimated Flex API Cost: $${preflightReport.requestBudget.estimatedFlexCostUsd} USD`)
  console.log(`• Conservative Upper-Bound Cost: $${preflightReport.requestBudget.conservativeUpperBoundCostUsd} USD (Cap: $0.05)`)
  console.log(`• Candidate Retrieval Recall: ${(preflightReport.retrievalPreflight.retrievalRecall * 100).toFixed(1)}%`)
  console.log(`• Target Database: DEVELOPMENT (${preflightReport.environment.targetProjectRef})`)
  console.log(`• Production Writes Blocked: ${preflightReport.environment.isProductionBlocked ? 'YES (swratbmclahjyekouned pristine)' : 'NO'}`)
  console.log(`• Model & Execution Mode: ${preflightReport.modelConfig.model} | Thinking: ${preflightReport.modelConfig.thinkingLevel} | Mode: ${preflightReport.modelConfig.executionMode} | Location: ${preflightReport.modelConfig.location}`)
  console.log('=========================================================================')

  console.log('\nExpected Matches Retrieval Verification:')
  preflightReport.retrievalPreflight.expectedMatchesVerified.forEach((m) => {
    console.log(`  - [${m.brand}] ${m.titleEn} -> Target ID ${m.targetCatalogId} (${m.targetCatalogNameEn}): Status = ${m.retrievedStatus} (Rank #${m.shortlistRank})`)
  })

  console.log('\nProof of Absence (Offline $0.00 Verification):')
  preflightReport.retrievalPreflight.absenceProofsVerified.forEach((a) => {
    console.log(`  - [${a.brand}] Catalog products: ${a.catalogProductsCount}, Offers: ${a.offersCount}, Absence Proven: ${a.absenceProven}`)
  })

  console.log('\nDeliberately Unresolved Policies Verification:')
  preflightReport.retrievalPreflight.unresolvedPoliciesVerified.forEach((u) => {
    console.log(`  - Offer: ${u.sourceOfferId} -> Reason: ${u.reason}`)
  })

  console.log('\nExact Gemini Matching Request Drafts:')
  preflightReport.provenance.exactRequestDrafts.forEach((r) => {
    console.log(`  - Request #${r.requestNumber} [Brand: ${r.brandKey}]: ${r.itemCount} extracted items vs ${r.candidateCount} catalog candidates`)
  })
}

main().catch((err) => {
  console.error('Preflight error:', err)
  process.exit(1)
})
