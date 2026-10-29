import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { loadEnvConfig } from '../config/env';
import { buildStyleAwareValidationPrompt } from './styleAwareValidationPromptBuilder';
import { buildStyleAwareValidationJsonSchema, styleAwareValidationModelSchema } from '../../shared/schemas/styleAwareValidationSchema';
import type { StyleAwareValidationResult } from '../../shared/types/styleAwareValidation';
import { runWithMistralRateLimit } from './mistralRateLimitQueue';
import { warn, error as logError, info } from '../logging/logger';

export async function validateItemWithStyleAwareness(input: {
  leafletId?: string | null;
  sourcePageNumber?: number | null;
  sourceItemNumber: string;
  cropPath: string;
  rawExtractionJson: Record<string, unknown>;
  canonicalDraft: Record<string, unknown>;
  styleProfile?: Record<string, unknown> | null;
  extractionPackagePath: string;
}): Promise<StyleAwareValidationResult | null> {
  const config = loadEnvConfig();
  
  if (process.env.VALIDATE_EVERY_ITEM === 'false') {
    info(`Validation skipped by config for item ${input.sourceItemNumber}`);
    return null;
  }

  const apiKey = config.mistral.apiKey;
  if (!apiKey) {
    warn('Missing Mistral API key for style-aware validation.');
    return null;
  }

  try {
    const cropBuffer = readFileSync(input.cropPath);
    const imageDataUrl = `data:image/jpeg;base64,${cropBuffer.toString('base64')}`;
    const promptText = buildStyleAwareValidationPrompt({
      leafletId: input.leafletId,
      sourcePageNumber: input.sourcePageNumber,
      sourceItemNumber: input.sourceItemNumber,
      rawExtractionJson: input.rawExtractionJson,
      canonicalDraft: input.canonicalDraft,
      styleProfile: input.styleProfile
    });
    const schema = buildStyleAwareValidationJsonSchema();

    const chatRes = await runWithMistralRateLimit(
      {
        kind: 'item_validation',
        label: `Item Validation for ${input.sourceItemNumber}`,
        pageNumber: input.sourcePageNumber,
        itemNumber: input.sourceItemNumber
      },
      async () => {
        const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': `Bearer ${apiKey}`,
            'Accept': 'application/json; charset=utf-8'
          },
          body: JSON.stringify({
            model: 'pixtral-large-latest',
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: promptText + '\n\nEXPECTED JSON SCHEMA:\n' + JSON.stringify(schema, null, 2) },
                  { type: 'image_url', image_url: { url: imageDataUrl } }
                ]
              }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.1
          })
        });

        if (res.status === 429) {
          const errText = await res.text();
          const err: any = new Error('Mistral 429 Rate Limit');
          err.status = 429;
          err.statusCode = 429;
          err.body = errText;
          err.headers = res.headers;
          err.retryAfter = res.headers?.get('retry-after');
          throw err;
        }

        if (!res.ok) {
          const errText = await res.text();
          const err: any = new Error(`Item Validation API failed: ${errText}`);
          err.status = res.status;
          throw err;
        }

        return res;
      }
    );

    const chatJson = await chatRes.json();
    const content = chatJson.choices?.[0]?.message?.content;

    if (!content) {
      warn(`Mistral returned empty content for validation of item ${input.sourceItemNumber}`);
      return null;
    }

    const parsed = typeof content === 'string' ? JSON.parse(content) : content;
    
    // Validate strict schema (throws on invalid)
    const validatedData = styleAwareValidationModelSchema.parse(parsed);

    const result: StyleAwareValidationResult = {
      ...validatedData,
      schema_version: 1,
      validation_id: `val-${input.sourceItemNumber}-${Date.now()}`,
      leaflet_id: input.leafletId || null,
      source_page_number: input.sourcePageNumber || null,
      source_item_number: input.sourceItemNumber,
      crop_path: input.cropPath,
      created_at: new Date().toISOString(),
      model: 'pixtral-large-latest',
      raw_model_response: parsed
    };

    // Ensure metadata/validation/page-XXX directory exists
    const paddedPage = input.sourcePageNumber ? String(input.sourcePageNumber).padStart(3, '0') : 'unknown';
    const validationDir = path.join(input.extractionPackagePath, 'metadata', 'validation', `page-${paddedPage}`);
    mkdirSync(validationDir, { recursive: true });

    // Save artifact
    const cropName = path.basename(input.cropPath, path.extname(input.cropPath));
    const artifactPath = path.join(validationDir, `${cropName}.validation.json`);
    writeFileSync(artifactPath, JSON.stringify(result, null, 2), 'utf8');

    info(`Saved style-aware validation result to ${artifactPath}`);
    return result;
  } catch (err: any) {
    logError(`Failed to run style-aware validation for item ${input.sourceItemNumber}: ${err.message}`);
    return null; // Return null so the caller can mark validation as failed instead of crashing
  }
}
