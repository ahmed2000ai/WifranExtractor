import * as fs from 'fs'
import * as path from 'path'

export type DetectorEvaluationMetrics = {
  precision_at_iou_50: number;
  recall_at_iou_50: number;
  f1_at_iou_50: number;
  mean_iou: number;
  missed_offer_count: number;
  false_box_count: number;
  missed_offer_rate: number;
  false_box_rate: number;
  page_perfect_layout_rate: number;
  per_supermarket_precision: Record<string, number>;
  per_supermarket_recall: Record<string, number>;
  per_supermarket_missed_offer_rate: Record<string, number>;
}

export type OfferBlockDetectorModelRegistryEntry = {
  model_id: string;
  version: string;
  status: 'training' | 'candidate' | 'active' | 'previous' | 'rejected' | 'failed' | 'archived';
  created_at: string;
  activated_at?: string | null;
  rejected_at?: string | null;
  architecture: string;
  training_dataset_version: string;
  native_model_path: string | null;
  onnx_model_path: string | null;
  model_hash: string | null;
  metrics: DetectorEvaluationMetrics | null;
  comparison_to_active?: {
    candidate_better: boolean;
    reasons: string[];
  } | null;
  rejection_reasons?: string[];
  evaluation_kind?: 'mock' | 'real';
  onnx_verification_kind?: 'mock' | 'real';
  training_backend?: 'mock' | 'cpu' | 'cuda' | 'other';
  fixture_only?: boolean;
}

export type DetectorModelRegistry = {
  schema_version: 1;
  updated_at: string | null;
  active_model_id: string | null;
  previous_active_model_id: string | null;
  candidate_model_id: string | null;
  models: OfferBlockDetectorModelRegistryEntry[];
}

class DetectorModelRegistryService {
  private registryPath: string

  constructor() {
    this.registryPath = path.join(process.cwd(), 'models', 'offer-block-detector', 'registry.json')
  }

  public setTestWorkspace(workspacePath: string): void {
    this.registryPath = path.join(workspacePath, 'registry.json')
  }

  public getRegistry(): DetectorModelRegistry {
    if (!fs.existsSync(this.registryPath)) {
      return {
        schema_version: 1,
        updated_at: null,
        active_model_id: null,
        previous_active_model_id: null,
        candidate_model_id: null,
        models: []
      }
    }
    try {
      return JSON.parse(fs.readFileSync(this.registryPath, 'utf8'))
    } catch {
      return {
        schema_version: 1,
        updated_at: null,
        active_model_id: null,
        previous_active_model_id: null,
        candidate_model_id: null,
        models: []
      }
    }
  }

  public saveRegistry(registry: DetectorModelRegistry): void {
    const dir = path.dirname(this.registryPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    registry.updated_at = new Date().toISOString()
    fs.writeFileSync(this.registryPath, JSON.stringify(registry, null, 2))
  }

  public addModel(entry: OfferBlockDetectorModelRegistryEntry): void {
    const reg = this.getRegistry()
    reg.models.push(entry)
    if (entry.status === 'candidate' || entry.status === 'training') {
      reg.candidate_model_id = entry.model_id
    }
    this.saveRegistry(reg)
  }

  public updateModel(modelId: string, updates: Partial<OfferBlockDetectorModelRegistryEntry>): void {
    const reg = this.getRegistry()
    const idx = reg.models.findIndex(m => m.model_id === modelId)
    if (idx >= 0) {
      reg.models[idx] = { ...reg.models[idx], ...updates }
      this.saveRegistry(reg)
    }
  }

  public getActiveModel(): OfferBlockDetectorModelRegistryEntry | null {
    const reg = this.getRegistry()
    return reg.models.find(m => m.model_id === reg.active_model_id) || null
  }
}

export const detectorModelRegistryService = new DetectorModelRegistryService()
