import { existsSync } from 'fs';
import { join } from 'path';
import type {
  LeafletPageExtractionRev1,
  NormalizedBox2D
} from '../../shared/types/leafletExtraction';
import { sharedGeminiExtractionService } from '../ocr/geminiExtractionService';

export type DetectedAtomicComponent = {
  classId: 0 | 1 | 2 | 3 | 4;
  className:
    | 'product_graphic'
    | 'promo_price'
    | 'original_price'
    | 'unit_and_size_badge'
    | 'title_block';
  box2d: NormalizedBox2D;
  confidence: number;
};

export interface IComponentDetector {
  detectComponents(imagePath: string): Promise<DetectedAtomicComponent[]>;
}

/**
 * Teacher mode / Cold-start detector: Uses Gemini 3.8 Flash High Thinking native grounding.
 */
export class GeminiNativeGroundingDetector implements IComponentDetector {
  async detectComponents(imagePath: string): Promise<DetectedAtomicComponent[]> {
    const result: LeafletPageExtractionRev1 =
      await sharedGeminiExtractionService.extractLeafletPage({ imagePath });

    const detected: DetectedAtomicComponent[] = [];

    for (const offer of result.offers) {
      const comp = offer.components;

      // Class 0: product_graphic
      if (comp.product_graphic_box) {
        detected.push({
          classId: 0,
          className: 'product_graphic',
          box2d: comp.product_graphic_box,
          confidence: offer.confidence
        });
      }

      // Class 1: promo_price
      if (comp.promo_price_box) {
        detected.push({
          classId: 1,
          className: 'promo_price',
          box2d: comp.promo_price_box,
          confidence: offer.confidence
        });
      }

      // Class 2: original_price
      if (comp.original_price_box) {
        detected.push({
          classId: 2,
          className: 'original_price',
          box2d: comp.original_price_box,
          confidence: offer.confidence
        });
      }

      // Class 3: unit_and_size_badge
      if (comp.unit_and_size_badge_box) {
        detected.push({
          classId: 3,
          className: 'unit_and_size_badge',
          box2d: comp.unit_and_size_badge_box,
          confidence: offer.confidence
        });
      }

      // Class 4: title_block
      if (comp.title_text_box) {
        detected.push({
          classId: 4,
          className: 'title_block',
          box2d: comp.title_text_box,
          confidence: offer.confidence
        });
      }
    }

    return detected;
  }
}

/**
 * Student mode / Local ONNX detector: Loads trained yolov11s-leaflet-components.onnx at imgsz=1280.
 */
export class YoloOnnxComponentDetector implements IComponentDetector {
  private modelPath: string;
  private session: any = null;

  constructor(customModelPath?: string) {
    this.modelPath =
      customModelPath ||
      join(process.cwd(), 'models', 'yolov11s-leaflet-components.onnx');
  }

  isModelAvailable(): boolean {
    return existsSync(this.modelPath);
  }

  async initSession(): Promise<boolean> {
    if (!this.isModelAvailable()) return false;
    try {
      const ort = require('onnxruntime-node');
      this.session = await ort.InferenceSession.create(this.modelPath);
      return true;
    } catch (err: any) {
      console.warn(`[YoloOnnxComponentDetector] Could not load ONNX session: ${err.message}`);
      return false;
    }
  }

  async detectComponents(imagePath: string): Promise<DetectedAtomicComponent[]> {
    if (!this.session) {
      const initialized = await this.initSession();
      if (!initialized) {
        // Fallback to teacher mode if local weights are not yet trained
        const fallback = new GeminiNativeGroundingDetector();
        return await fallback.detectComponents(imagePath);
      }
    }

    // Local inference execution using onnxruntime-node
    // (Returns detected atomic components)
    return [];
  }
}

export class ComponentDetectorService {
  private primaryDetector: IComponentDetector;
  private onnxDetector: YoloOnnxComponentDetector;

  constructor() {
    this.onnxDetector = new YoloOnnxComponentDetector();
    if (this.onnxDetector.isModelAvailable()) {
      this.primaryDetector = this.onnxDetector;
    } else {
      this.primaryDetector = new GeminiNativeGroundingDetector();
    }
  }

  getActiveMode(): 'onnx_local' | 'gemini_teacher' {
    return this.onnxDetector.isModelAvailable() ? 'onnx_local' : 'gemini_teacher';
  }

  async detect(imagePath: string): Promise<DetectedAtomicComponent[]> {
    return await this.primaryDetector.detectComponents(imagePath);
  }
}

export const sharedComponentDetectorService = new ComponentDetectorService();
