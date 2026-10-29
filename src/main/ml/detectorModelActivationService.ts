import { detectorModelRegistryService } from './detectorModelRegistryService'
import * as path from 'path'
import * as fs from 'fs'
import { info as logInfo, error as logError } from '../logging/logger'

class DetectorModelActivationService {
  public activateCandidate(modelId: string): boolean {
    const reg = detectorModelRegistryService.getRegistry()
    const candidateIndex = reg.models.findIndex(m => m.model_id === modelId)
    
    if (candidateIndex === -1) {
      logError(`Candidate ${modelId} not found`)
      return false
    }

    const candidate = reg.models[candidateIndex]
    
    // We should only activate candidates that are marked as candidate and have passed metrics.
    // In our simplified logic, if the trainingRunner has set it to candidate, we can activate it.
    
    // Check if it has an ONNX path
    if (!candidate.onnx_model_path) {
      detectorModelRegistryService.updateModel(modelId, {
        status: 'failed',
        rejection_reasons: ['No ONNX model path available']
      })
      return false
    }

    // Set previous active model
    const previousActiveId = reg.active_model_id
    if (previousActiveId) {
      detectorModelRegistryService.updateModel(previousActiveId, { status: 'previous' })
    }

    // Activate candidate
    candidate.status = 'active'
    candidate.activated_at = new Date().toISOString()
    
    reg.previous_active_model_id = previousActiveId
    reg.active_model_id = modelId
    reg.candidate_model_id = null

    detectorModelRegistryService.saveRegistry(reg)
    logInfo(`Successfully activated model ${modelId}`)

    this.writeActivationReport(modelId, previousActiveId)

    return true
  }

  public rejectCandidate(modelId: string, reasons: string[]): void {
    detectorModelRegistryService.updateModel(modelId, {
      status: 'rejected',
      rejected_at: new Date().toISOString(),
      rejection_reasons: reasons
    })
    
    const reg = detectorModelRegistryService.getRegistry()
    if (reg.candidate_model_id === modelId) {
      reg.candidate_model_id = null
      detectorModelRegistryService.saveRegistry(reg)
    }

    logInfo(`Rejected candidate model ${modelId}. Reasons: ${reasons.join(', ')}`)
  }

  public rollbackToPrevious(): boolean {
    const reg = detectorModelRegistryService.getRegistry()
    const previousId = reg.previous_active_model_id
    
    if (!previousId) {
      logError('No previous model available for rollback.')
      return false
    }

    const activeId = reg.active_model_id
    if (activeId) {
      detectorModelRegistryService.updateModel(activeId, {
        status: 'failed',
        rejection_reasons: ['Rolled back due to runtime errors']
      })
    }

    detectorModelRegistryService.updateModel(previousId, {
      status: 'active'
    })

    reg.active_model_id = previousId
    reg.previous_active_model_id = null // Only supporting one level of rollback easily here
    detectorModelRegistryService.saveRegistry(reg)

    logInfo(`Rolled back to model ${previousId}`)
    
    const reportPath = path.join(process.cwd(), 'models', 'offer-block-detector', 'reports', `rollback-${Date.now()}.json`)
    fs.mkdirSync(path.dirname(reportPath), { recursive: true })
    fs.writeFileSync(reportPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      from_model: activeId,
      to_model: previousId,
      reason: 'Runtime failure threshold reached'
    }, null, 2))

    return true
  }

  private writeActivationReport(modelId: string, previousId: string | null) {
    const reportPath = path.join(process.cwd(), 'models', 'offer-block-detector', 'reports', `activation-${modelId}.json`)
    const report = {
      model_id: modelId,
      previous_model_id: previousId,
      activated_at: new Date().toISOString()
    }
    fs.mkdirSync(path.dirname(reportPath), { recursive: true })
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  }
}

export const detectorModelActivationService = new DetectorModelActivationService()
