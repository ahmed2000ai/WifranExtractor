import * as fs from 'fs'
import * as path from 'path'
import { info as logInfo } from '../logging/logger'
import { detectorTrainingRunnerService } from './detectorTrainingRunnerService'

export type TrainingSchedulerState = {
  eligible_annotations: number;
  annotations_used_by_active_model: number;
  new_annotations_since_active_model: number;
  last_training_started_at: string | null;
  last_training_completed_at: string | null;
  last_failure: string | null;
}

class DetectorTrainingSchedulerService {
  private statePath: string
  private MIN_ELIGIBLE_PAGES_FOR_FIRST_TRAINING = 50
  private MIN_NEW_ANNOTATIONS_FOR_RETRAINING = 25

  constructor() {
    this.statePath = path.join(process.cwd(), 'models', 'offer-block-detector', 'training-state.json')
  }

  public getState(): TrainingSchedulerState {
    if (!fs.existsSync(this.statePath)) {
      return {
        eligible_annotations: 0,
        annotations_used_by_active_model: 0,
        new_annotations_since_active_model: 0,
        last_training_started_at: null,
        last_training_completed_at: null,
        last_failure: null
      }
    }
    try {
      return JSON.parse(fs.readFileSync(this.statePath, 'utf8'))
    } catch {
      return {
        eligible_annotations: 0,
        annotations_used_by_active_model: 0,
        new_annotations_since_active_model: 0,
        last_training_started_at: null,
        last_training_completed_at: null,
        last_failure: null
      }
    }
  }

  public saveState(state: TrainingSchedulerState): void {
    const dir = path.dirname(this.statePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2))
  }

  public checkAndTriggerTraining(eligibleCount: number, datasetIndexPath: string): boolean {
    const state = this.getState()
    state.eligible_annotations = eligibleCount
    state.new_annotations_since_active_model = eligibleCount - state.annotations_used_by_active_model

    let shouldTrain = false
    if (state.annotations_used_by_active_model === 0) {
      if (state.eligible_annotations >= this.MIN_ELIGIBLE_PAGES_FOR_FIRST_TRAINING) {
        shouldTrain = true
      }
    } else {
      if (state.new_annotations_since_active_model >= this.MIN_NEW_ANNOTATIONS_FOR_RETRAINING) {
        shouldTrain = true
      }
    }

    // Since we are mocking/testing locally and might not have 50 annotations,
    // let's allow it to train if it's explicitly called via some testing flag, 
    // but in normal behavior it shouldn't train.
    // However, the prompt says "Do not train too early... Safe default thresholds: MIN_ELIGIBLE_PAGES_FOR_FIRST_TRAINING=50".
    // I will stick to the thresholds.

    this.saveState(state)

    if (shouldTrain) {
      if (detectorTrainingRunnerService.getStatus() === 'idle') {
        state.last_training_started_at = new Date().toISOString()
        this.saveState(state)
        
        // Fire and forget training pipeline
        detectorTrainingRunnerService.runTrainingPipeline(datasetIndexPath).then((success) => {
          const finalState = this.getState()
          finalState.last_training_completed_at = new Date().toISOString()
          if (success) {
            finalState.annotations_used_by_active_model = eligibleCount
            finalState.new_annotations_since_active_model = 0
            finalState.last_failure = null
          } else {
            finalState.last_failure = "Pipeline failed or candidate rejected"
          }
          this.saveState(finalState)
        }).catch(err => {
          const finalState = this.getState()
          finalState.last_training_completed_at = new Date().toISOString()
          finalState.last_failure = err.message
          this.saveState(finalState)
        })
        return true
      } else {
        logInfo('Training scheduler: Pipeline already running.')
      }
    }

    return false
  }
}

export const detectorTrainingSchedulerService = new DetectorTrainingSchedulerService()
