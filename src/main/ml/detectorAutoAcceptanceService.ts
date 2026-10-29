import * as path from 'path'
import * as fs from 'fs'
import { detectorAutoAcceptanceModeService } from './detectorAutoAcceptanceModeService'
import { PageAutoAcceptanceDecision } from '../../shared/types/autoAcceptance'

export const AUTO_ACCEPT_DEFAULTS = {
  AUTO_ACCEPT_PAGE_QUALITY_MIN: 0.97,
  AUTO_ACCEPT_MIN_BOX_CONFIDENCE: 0.92,
  AUTO_ACCEPT_AVERAGE_BOX_CONFIDENCE: 0.96,
  AUTO_ACCEPT_MAX_CV_DISAGREEMENT: 0.05
}

class DetectorAutoAcceptanceService {
  public calculateDecision(input: {
    pageNumber: number;
    supermarketCode: string;
    modelId: string | null;
    modelVersion: string | null;
    modelMaturity: 'no_active_model' | 'immature' | 'validated' | 'highly_validated';
    boxes: Array<{ confidence: number }>;
    pageQualityScore: number;
    overlapConflictCount: number;
    suspiciousLargeBoxCount: number;
    suspiciousSmallBoxCount: number;
    uncoveredContentWarningCount: number;
    detectorCvDisagreementScore: number;
    invalidCoordinateCount: number;
    mlRuntimeStatus: string;
    modelEvaluationKind?: string | null;
    modelOnnxVerificationKind?: string | null;
    modelFixtureOnly?: boolean;
  }): PageAutoAcceptanceDecision {
    const mode = detectorAutoAcceptanceModeService.getModeForBrand(input.supermarketCode)
    
    const requiredChecks: Array<{ code: string; passed: boolean; actual: unknown; required: unknown }> = []
    
    // 1. Active model requirements
    requiredChecks.push({ code: 'active_model_loaded', passed: !!input.modelId, actual: !!input.modelId, required: true })
    requiredChecks.push({ code: 'model_maturity_valid', passed: input.modelMaturity === 'validated' || input.modelMaturity === 'highly_validated', actual: input.modelMaturity, required: 'validated+' })
    
    // 1b. Real ML Runtime and Real Evaluation Checks
    requiredChecks.push({ code: 'real_ml_runtime', passed: input.mlRuntimeStatus === 'ready', actual: input.mlRuntimeStatus, required: 'ready' })
    requiredChecks.push({ code: 'real_evaluation', passed: input.modelEvaluationKind === 'real', actual: input.modelEvaluationKind, required: 'real' })
    requiredChecks.push({ code: 'real_onnx_verification', passed: input.modelOnnxVerificationKind === 'real', actual: input.modelOnnxVerificationKind, required: 'real' })
    requiredChecks.push({ code: 'not_fixture_only', passed: input.modelFixtureOnly === false, actual: input.modelFixtureOnly, required: false })
    
    // 2. Page-level requirements
    requiredChecks.push({ code: 'page_quality', passed: input.pageQualityScore >= AUTO_ACCEPT_DEFAULTS.AUTO_ACCEPT_PAGE_QUALITY_MIN, actual: input.pageQualityScore, required: AUTO_ACCEPT_DEFAULTS.AUTO_ACCEPT_PAGE_QUALITY_MIN })
    requiredChecks.push({ code: 'invalid_coordinates', passed: input.invalidCoordinateCount === 0, actual: input.invalidCoordinateCount, required: 0 })
    requiredChecks.push({ code: 'overlap_conflicts', passed: input.overlapConflictCount === 0, actual: input.overlapConflictCount, required: 0 })
    requiredChecks.push({ code: 'suspicious_large_boxes', passed: input.suspiciousLargeBoxCount === 0, actual: input.suspiciousLargeBoxCount, required: 0 })
    requiredChecks.push({ code: 'suspicious_small_boxes', passed: input.suspiciousSmallBoxCount === 0, actual: input.suspiciousSmallBoxCount, required: 0 })
    requiredChecks.push({ code: 'uncovered_content', passed: input.uncoveredContentWarningCount === 0, actual: input.uncoveredContentWarningCount, required: 0 })
    requiredChecks.push({ code: 'cv_disagreement', passed: input.detectorCvDisagreementScore <= AUTO_ACCEPT_DEFAULTS.AUTO_ACCEPT_MAX_CV_DISAGREEMENT, actual: input.detectorCvDisagreementScore, required: AUTO_ACCEPT_DEFAULTS.AUTO_ACCEPT_MAX_CV_DISAGREEMENT })
    
    const minConf = input.boxes.length > 0 ? Math.min(...input.boxes.map(b => b.confidence)) : 0
    const avgConf = input.boxes.length > 0 ? input.boxes.reduce((s, b) => s + b.confidence, 0) / input.boxes.length : 0
    
    requiredChecks.push({ code: 'min_box_confidence', passed: minConf >= AUTO_ACCEPT_DEFAULTS.AUTO_ACCEPT_MIN_BOX_CONFIDENCE, actual: minConf, required: AUTO_ACCEPT_DEFAULTS.AUTO_ACCEPT_MIN_BOX_CONFIDENCE })
    requiredChecks.push({ code: 'avg_box_confidence', passed: avgConf >= AUTO_ACCEPT_DEFAULTS.AUTO_ACCEPT_AVERAGE_BOX_CONFIDENCE, actual: avgConf, required: AUTO_ACCEPT_DEFAULTS.AUTO_ACCEPT_AVERAGE_BOX_CONFIDENCE })
    requiredChecks.push({ code: 'has_boxes', passed: input.boxes.length > 0, actual: input.boxes.length, required: '>0' })

    const allPassed = requiredChecks.every(c => c.passed)
    
    let decision: PageAutoAcceptanceDecision['decision'] = 'review_required'
    
    if (input.invalidCoordinateCount > 0) {
      decision = 'blocked'
    } else if (allPassed) {
      if (mode === 'automatic') {
        decision = 'auto_accept'
      } else if (mode === 'assisted') {
        decision = 'recommend_accept'
      }
    }

    return {
      schema_version: 1,
      page_number: input.pageNumber,
      decision,
      mode,
      would_auto_accept_in_automatic_mode: allPassed,
      score: input.pageQualityScore,
      model: {
        model_id: input.modelId,
        model_version: input.modelVersion,
        maturity: input.modelMaturity
      },
      metrics: {
        box_count: input.boxes.length,
        minimum_box_confidence: minConf,
        average_box_confidence: avgConf,
        page_quality_score: input.pageQualityScore,
        overlap_conflict_count: input.overlapConflictCount,
        suspicious_large_box_count: input.suspiciousLargeBoxCount,
        suspicious_small_box_count: input.suspiciousSmallBoxCount,
        uncovered_content_warning_count: input.uncoveredContentWarningCount,
        detector_cv_disagreement_score: input.detectorCvDisagreementScore,
        invalid_coordinate_count: input.invalidCoordinateCount
      },
      required_checks: requiredChecks,
      reason_codes: requiredChecks.filter(c => !c.passed).map(c => `FAILED_${c.code.toUpperCase()}`),
      warnings: [],
      decided_at: new Date().toISOString()
    }
  }

  public saveDecision(manifestDir: string, decision: PageAutoAcceptanceDecision) {
    const dir = path.join(manifestDir, 'metadata', 'auto-acceptance')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `page-${String(decision.page_number).padStart(3, '0')}-decision.json`), JSON.stringify(decision, null, 2))
  }
}

export const detectorAutoAcceptanceService = new DetectorAutoAcceptanceService()
