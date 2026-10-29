import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { loadEnvConfig } from '../config/env';
import { buildStyleProfilePrompt } from './styleProfilePromptBuilder';
import { buildStyleProfileJsonSchema, leafletStyleProfileModelSchema } from '../../shared/schemas/styleProfileSchema';
import type { LeafletStyleProfile } from '../../shared/types/styleProfile';
import { runWithMistralRateLimit } from './mistralRateLimitQueue';
import { warn, error as logError, info } from '../logging/logger';

export async function generatePageStyleProfile(input: {
  leafletId?: string | null;
  pageNumber: number;
  pageImagePath: string;
  extractionPackagePath: string;
}): Promise<LeafletStyleProfile | null> {
  const config = loadEnvConfig();
  
  if (process.env.ENABLE_STYLE_PROFILE_GENERATION !== 'true') {
    info('Style profile generation is disabled by default. Skipping.');
    return null;
  }

  const apiKey = config.mistral.apiKey;
  if (!apiKey) {
    warn('Missing Mistral API key for style profile generation.');
    return null;
  }

  try {
    const pageBuffer = await sharp(input.pageImagePath)
      .jpeg({ quality: 80 })
      .toBuffer();

    const imageDataUrl = `data:image/jpeg;base64,${pageBuffer.toString('base64')}`;
    const promptText = buildStyleProfilePrompt({
      leafletId: input.leafletId,
      scope: 'page',
      pageNumber: input.pageNumber
    });
    const schema = buildStyleProfileJsonSchema();

    const chatRes = await runWithMistralRateLimit(
      {
        kind: 'style_profile',
        label: `Style Profile for Page ${input.pageNumber}`,
        pageNumber: input.pageNumber
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
          const err: any = new Error(`Style Profile API failed: ${errText}`);
          err.status = res.status;
          throw err;
        }

        return res;
      }
    );

    const chatJson = await chatRes.json();
    const content = chatJson.choices?.[0]?.message?.content;

    if (!content) {
      warn('Mistral returned empty content for style profile.');
      return null;
    }

    const parsed = typeof content === 'string' ? JSON.parse(content) : content;
    
    // Validate strict schema (throws on invalid)
    const validatedData = leafletStyleProfileModelSchema.parse(parsed);

    const profile: LeafletStyleProfile = {
      ...(validatedData as any),
      schema_version: 1,
      profile_id: `style-profile-page-${input.pageNumber}-${Date.now()}`,
      leaflet_id: input.leafletId || null,
      scope: 'page',
      page_number: input.pageNumber,
      source_image_path: input.pageImagePath,
      created_at: new Date().toISOString(),
      model: 'pixtral-large-latest',
      raw_model_response: parsed
    };

    // Ensure metadata/style-profiles directory exists
    const profilesDir = path.join(input.extractionPackagePath, 'metadata', 'style-profiles');
    mkdirSync(profilesDir, { recursive: true });

    // Save artifact
    const paddedPage = String(input.pageNumber).padStart(3, '0');
    const artifactPath = path.join(profilesDir, `page-${paddedPage}-style-profile.json`);
    writeFileSync(artifactPath, JSON.stringify(profile, null, 2), 'utf8');

    info(`Saved page style profile to ${artifactPath}`);
    return profile;
  } catch (err: any) {
    logError(`Failed to generate page style profile for page ${input.pageNumber}: ${err.message}`);
    // Do not crash the app
    return null;
  }
}
