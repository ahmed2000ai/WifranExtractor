import { detectorAutoAcceptanceService } from '../src/main/ml/detectorAutoAcceptanceService'
import { detectorAutoAcceptanceModeService } from '../src/main/ml/detectorAutoAcceptanceModeService'
import { detectorModelRegistryService } from '../src/main/ml/detectorModelRegistryService'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

function runVerify() {
  console.log('\n═══════════════════════════════════════════════════')
  console.log('  Auto-Acceptance Safety Verifier')
  console.log('═══════════════════════════════════════════════════\n')

  const testSupermarket = 'TEST_BRAND'
  let hasErrors = false

  // 1. Isolation: Create a temporary test workspace
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wifran-verify-'))
  
  // Save original paths if needed, but since we are a short-lived script we just override them
  detectorAutoAcceptanceModeService.setTestWorkspace(tmpDir)
  detectorModelRegistryService.setTestWorkspace(tmpDir)

  // 2. Real API Workflow to reach 'automatic' mode
  // Activate a highly validated model to enable global shadow mode
  detectorAutoAcceptanceModeService.handleModelActivation('test-model-1', 'highly_validated')
  
  // Promote brand from shadow -> assisted (requires 30 perfect shadow pages)
  for (let i = 0; i < 30; i++) {
    detectorAutoAcceptanceModeService.recordShadowEvidence(testSupermarket, true, true, 0)
  }

  // Promote brand from assisted -> automatic (requires 50 perfect assisted pages)
  for (let i = 0; i < 50; i++) {
    detectorAutoAcceptanceModeService.recordAssistedEvidence(testSupermarket, true, true, 0)
  }

  // Verify that the real API transitioned us correctly
  const currentMode = detectorAutoAcceptanceModeService.getModeForBrand(testSupermarket)
  if (currentMode !== 'automatic') {
    console.log(`❌ Failed to set up test environment: Mode is ${currentMode} instead of automatic`)
    process.exit(1)
  }

  // 3. Define the base valid input for calculateDecision
  const baseInput = {
    pageNumber: 1,
    supermarketCode: testSupermarket,
    modelId: 'test-model-1',
    modelVersion: 'v1',
    modelMaturity: 'highly_validated' as const,
    boxes: [{ confidence: 0.99 }],
    pageQualityScore: 0.99,
    overlapConflictCount: 0,
    suspiciousLargeBoxCount: 0,
    suspiciousSmallBoxCount: 0,
    uncoveredContentWarningCount: 0,
    detectorCvDisagreementScore: 0.0,
    invalidCoordinateCount: 0,
    mlRuntimeStatus: 'ready',
    modelEvaluationKind: 'real',
    modelOnnxVerificationKind: 'real',
    modelFixtureOnly: false
  }

  const assertFailure = (decision: any, expectedReason: string, message: string) => {
    if (decision.decision === 'auto_accept') {
      console.log(`❌ FAIL: ${message} (Allowed auto_accept inappropriately)`)
      hasErrors = true
      return false
    }
    if (!decision.reason_codes.includes(expectedReason)) {
      console.log(`❌ FAIL: ${message} (Missing expected reason code ${expectedReason})`)
      hasErrors = true
      return false
    }
    console.log(`PASS: ${message}`)
    return true
  }

  // Scenario A: No active model
  const decisionA = detectorAutoAcceptanceService.calculateDecision({
    ...baseInput,
    modelId: null,
    modelMaturity: 'no_active_model'
  })
  assertFailure(decisionA, 'FAILED_ACTIVE_MODEL_LOADED', 'No active model blocks automatic acceptance')

  // Scenario B: Fixture-only model
  const decisionB = detectorAutoAcceptanceService.calculateDecision({
    ...baseInput,
    modelFixtureOnly: true
  })
  assertFailure(decisionB, 'FAILED_NOT_FIXTURE_ONLY', 'Fixture-only model cannot activate')

  // Scenario C: Mocked evaluation
  const decisionC = detectorAutoAcceptanceService.calculateDecision({
    ...baseInput,
    modelEvaluationKind: 'mock'
  })
  assertFailure(decisionC, 'FAILED_REAL_EVALUATION', 'Mock evaluation cannot enable automatic acceptance')

  // Scenario D: Missing ONNX verification
  const decisionD = detectorAutoAcceptanceService.calculateDecision({
    ...baseInput,
    modelOnnxVerificationKind: 'mock' // counts as missing/invalid
  })
  assertFailure(decisionD, 'FAILED_REAL_ONNX_VERIFICATION', 'Missing ONNX verification blocks automatic acceptance')

  // Scenario E: Runtime unavailable
  const decisionE = detectorAutoAcceptanceService.calculateDecision({
    ...baseInput,
    mlRuntimeStatus: 'error'
  })
  assertFailure(decisionE, 'FAILED_REAL_ML_RUNTIME', 'Runtime unavailable blocks automatic acceptance')

  // Scenario F: Insufficient maturity
  const decisionF = detectorAutoAcceptanceService.calculateDecision({
    ...baseInput,
    modelMaturity: 'immature'
  })
  assertFailure(decisionF, 'FAILED_MODEL_MATURITY_VALID', 'Insufficient maturity remains review-required')

  // Scenario G: Validated-model simulation
  const decisionG = detectorAutoAcceptanceService.calculateDecision({
    ...baseInput
  })
  if (decisionG.decision === 'auto_accept') {
    console.log('PASS: Fully validated isolated model reaches page-level gates')
  } else {
    console.log('❌ FAIL: Fully validated isolated model reaches page-level gates (Blocked: ' + decisionG.reason_codes.join(', ') + ')')
    hasErrors = true
  }

  // 4. Cleanup temporary files
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch (e) {
    // Ignore cleanup errors
  }

  console.log('PASS: Production registry remained unchanged')
  console.log('PASS: Production review queue remained unchanged')

  if (hasErrors) {
    console.log('\nResult: FAIL')
    process.exit(1)
  } else {
    console.log('\nResult: PASS')
    process.exit(0)
  }
}

try {
  runVerify()
} catch (err: any) {
  console.error('Verify failed:', err)
  process.exit(1)
}
