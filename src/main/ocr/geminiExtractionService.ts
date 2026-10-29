import sharp from 'sharp';
import { readFileSync } from 'fs';
import { getGeminiClient, isGeminiConfigured } from './geminiClient';
import {
  buildRev1PageExtractionSystemPrompt,
  buildRev1DiagnosticRetryPrompt
} from './geminiPromptBuilder';
import { getLeafletPageGenAiSchema } from '../../shared/schemas/leafletPageExtractionSchema';
import type { LeafletPageExtractionRev1 } from '../../shared/types/leafletExtraction';
import { normalizeExtractedOffer } from '../../shared/utils/priceAndUnitNormalizer';

export type GeminiExtractionOptions = {
  imagePath: string;
  pageNumber?: number;
  overrideModel?: string;
  executionMode?: 'standard' | 'batch' | 'flex';
  isDiagnosticRetry?: boolean;
  failureReasons?: string[];
};

export class GeminiExtractionService {
  /**
   * Executes rev1 page extraction using Gemini via Vertex AI or Google AI Studio.
   * 100% live API execution with zero mock fallbacks.
   */
  async extractLeafletPage(options: GeminiExtractionOptions): Promise<LeafletPageExtractionRev1> {
    const {
      imagePath,
      overrideModel,
      isDiagnosticRetry,
      failureReasons
    } = options;

    if (!isGeminiConfigured()) {
      throw new Error(
        'GEMINI_NOT_CONFIGURED: Please configure GOOGLE_APPLICATION_CREDENTIALS and GCP_PROJECT_ID (or GEMINI_API_KEY) in your .env.local file to run live extractions.'
      );
    }

    const client = getGeminiClient();

    // Prepare JPEG buffer for multimodal payload
    const imageBuffer = readFileSync(imagePath);
    const jpegBuffer = await sharp(imageBuffer)
      .jpeg({ quality: 92 })
      .toBuffer();

    const base64Image = jpegBuffer.toString('base64');

    // Model selection: Stage 3 defaults to GEMINI_MODEL || 'gemini-3.8-flash'
    // Stage 6 Targeted Diagnostic Retry escalates to GEMINI_RETRY_MODEL || 'gemini-4-argon'
    const defaultModel = isDiagnosticRetry
      ? (process.env.GEMINI_RETRY_MODEL || 'gemini-4-argon')
      : (process.env.GEMINI_MODEL || 'gemini-3.8-flash');
    const model = overrideModel || defaultModel;

    const promptText =
      isDiagnosticRetry && failureReasons && failureReasons.length > 0
        ? buildRev1DiagnosticRetryPrompt(failureReasons)
        : 'Analyze this promotional supermarket leaflet page. Extract all offers with exact 2D component bounding boxes.';

    const response = await client.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: base64Image
              }
            },
            {
              text: promptText
            }
          ]
        }
      ],
      config: {
        systemInstruction: buildRev1PageExtractionSystemPrompt(),
        thinkingConfig: {
          thinkingLevel: 'HIGH'
        } as any,
        responseMimeType: 'application/json',
        responseSchema: getLeafletPageGenAiSchema()
      }
    });

    const responseText = response.text || '';
    if (!responseText) {
      throw new Error('GEMINI_EMPTY_RESPONSE: Model returned an empty extraction response.');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(responseText);
    } catch (err: any) {
      throw new Error(`GEMINI_JSON_PARSE_ERROR: Failed to parse JSON response: ${err.message}`);
    }

    const normalizedOffers = (parsed.offers || []).map(normalizeExtractedOffer);

    return {
      is_loyalty_page: Boolean(parsed.is_loyalty_page),
      loyalty_program_name: parsed.loyalty_program_name ?? null,
      validity_start_date: parsed.validity_start_date ?? null,
      validity_end_date: parsed.validity_end_date ?? null,
      ignored_banners: parsed.ignored_banners || [],
      page_number: options.pageNumber,
      offers: normalizedOffers
    };
  }
}

export const sharedGeminiExtractionService = new GeminiExtractionService();
