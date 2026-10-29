import * as fs from 'fs'
import * as path from 'path'
import { info as logInfo } from '../logging/logger'
import { CropAutoAcceptanceMode } from '../../shared/types/autoAcceptance'

export type AutoAcceptanceBrandState = {
  mode: CropAutoAcceptanceMode;
  evidence: {
    shadow_evaluated_pages: number;
    shadow_would_auto_accept_pages: number;
    shadow_unchanged_layouts: number;
    shadow_missed_offer_count: number;

    assisted_evaluated_pages: number;
    assisted_recommended_accept_pages: number;
    assisted_missed_offer_count: number;
    assisted_page_perfect_count: number;

    automatic_evaluated_pages: number;
    automatic_missed_offer_count: number;
  };
  last_transition_at: string | null;
  transition_reasons: string[];
}

export type AutoAcceptanceState = {
  schema_version: 1;
  updated_at: string | null;
  active_model_id: string | null;
  global_mode: CropAutoAcceptanceMode;
  brands: Record<string, AutoAcceptanceBrandState>;
  history: Array<{
    timestamp: string;
    model_id: string | null;
    brand_code: string | null;
    from_mode: CropAutoAcceptanceMode;
    to_mode: CropAutoAcceptanceMode;
    reason: string;
  }>;
}

class DetectorAutoAcceptanceModeService {
  private statePath: string

  constructor() {
    this.statePath = path.join(process.cwd(), 'models', 'offer-block-detector', 'auto-acceptance-state.json')
  }

  public setTestWorkspace(workspacePath: string): void {
    this.statePath = path.join(workspacePath, 'auto-acceptance-state.json')
  }

  public getState(): AutoAcceptanceState {
    if (!fs.existsSync(this.statePath)) {
      return this.getInitialState()
    }
    try {
      return JSON.parse(fs.readFileSync(this.statePath, 'utf8'))
    } catch {
      return this.getInitialState()
    }
  }

  private getInitialState(): AutoAcceptanceState {
    return {
      schema_version: 1,
      updated_at: null,
      active_model_id: null,
      global_mode: 'disabled',
      brands: {},
      history: []
    }
  }

  public saveState(state: AutoAcceptanceState): void {
    state.updated_at = new Date().toISOString()
    const dir = path.dirname(this.statePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2))
  }

  public getModeForBrand(supermarketCode: string): CropAutoAcceptanceMode {
    const state = this.getState()
    if (state.global_mode === 'disabled') return 'disabled'
    if (!state.brands[supermarketCode]) return 'shadow'
    return state.brands[supermarketCode].mode
  }

  public handleModelActivation(modelId: string, modelMaturity: string) {
    const state = this.getState()
    if (state.active_model_id !== modelId) {
      // New model activated -> reset modes or move to shadow globally depending on maturity
      state.active_model_id = modelId
      state.global_mode = modelMaturity === 'validated' || modelMaturity === 'highly_validated' ? 'shadow' : 'disabled'
      
      // Keep existing evidence but downgrade to shadow or assisted if needed
      for (const brand in state.brands) {
        if (state.brands[brand].mode === 'automatic') {
          this.transitionBrandMode(state, brand, 'assisted', 'New model activation downgrade')
        }
      }
      this.saveState(state)
    }
  }

  public handleModelRollback() {
    const state = this.getState()
    state.global_mode = 'disabled'
    state.history.push({
      timestamp: new Date().toISOString(),
      model_id: state.active_model_id,
      brand_code: null,
      from_mode: state.global_mode,
      to_mode: 'disabled',
      reason: 'Model rollback detected'
    })
    this.saveState(state)
  }

  public recordShadowEvidence(supermarketCode: string, wouldAutoAccept: boolean, unchanged: boolean, missedOffers: number) {
    const state = this.getState()
    this.ensureBrand(state, supermarketCode)
    const ev = state.brands[supermarketCode].evidence
    
    ev.shadow_evaluated_pages++
    if (wouldAutoAccept) {
      ev.shadow_would_auto_accept_pages++
      if (unchanged) ev.shadow_unchanged_layouts++
      ev.shadow_missed_offer_count += missedOffers
    }

    if (ev.shadow_missed_offer_count > 0) {
      // Don't promote
    } else if (ev.shadow_would_auto_accept_pages >= 30) {
      const pagePerfectRate = ev.shadow_unchanged_layouts / ev.shadow_would_auto_accept_pages
      if (pagePerfectRate >= 0.98) {
        this.transitionBrandMode(state, supermarketCode, 'assisted', 'Shadow thresholds met')
      }
    }
    this.saveState(state)
  }

  public recordAssistedEvidence(supermarketCode: string, recommendedAccept: boolean, unchanged: boolean, missedOffers: number) {
    const state = this.getState()
    this.ensureBrand(state, supermarketCode)
    const ev = state.brands[supermarketCode].evidence

    ev.assisted_evaluated_pages++
    if (recommendedAccept) {
      ev.assisted_recommended_accept_pages++
      if (unchanged) ev.assisted_page_perfect_count++
      ev.assisted_missed_offer_count += missedOffers
    }

    if (ev.assisted_missed_offer_count > 0) {
      this.transitionBrandMode(state, supermarketCode, 'shadow', 'Missed offer in assisted mode')
    } else if (ev.assisted_recommended_accept_pages >= 50) {
      const pagePerfectRate = ev.assisted_page_perfect_count / ev.assisted_recommended_accept_pages
      if (pagePerfectRate >= 0.99) {
        this.transitionBrandMode(state, supermarketCode, 'automatic', 'Assisted thresholds met')
      }
    }
    this.saveState(state)
  }

  public recordAutomaticEvidence(supermarketCode: string, missedOffers: number) {
    const state = this.getState()
    this.ensureBrand(state, supermarketCode)
    const ev = state.brands[supermarketCode].evidence

    ev.automatic_evaluated_pages++
    ev.automatic_missed_offer_count += missedOffers

    if (missedOffers > 0) {
      this.transitionBrandMode(state, supermarketCode, 'shadow', 'Missed offer in automatic mode')
    }
    this.saveState(state)
  }

  private ensureBrand(state: AutoAcceptanceState, code: string) {
    if (!state.brands[code]) {
      state.brands[code] = {
        mode: 'shadow',
        evidence: {
          shadow_evaluated_pages: 0, shadow_would_auto_accept_pages: 0, shadow_unchanged_layouts: 0, shadow_missed_offer_count: 0,
          assisted_evaluated_pages: 0, assisted_recommended_accept_pages: 0, assisted_missed_offer_count: 0, assisted_page_perfect_count: 0,
          automatic_evaluated_pages: 0, automatic_missed_offer_count: 0
        },
        last_transition_at: new Date().toISOString(),
        transition_reasons: ['Initial brand discovery']
      }
    }
  }

  private transitionBrandMode(state: AutoAcceptanceState, code: string, to: CropAutoAcceptanceMode, reason: string) {
    const from = state.brands[code].mode
    if (from === to) return
    state.brands[code].mode = to
    state.brands[code].last_transition_at = new Date().toISOString()
    state.brands[code].transition_reasons.push(reason)
    
    state.history.push({
      timestamp: new Date().toISOString(),
      model_id: state.active_model_id,
      brand_code: code,
      from_mode: from,
      to_mode: to,
      reason
    })
    logInfo(`Brand ${code} auto-acceptance mode transitioned: ${from} -> ${to}. Reason: ${reason}`)
  }
}

export const detectorAutoAcceptanceModeService = new DetectorAutoAcceptanceModeService()
