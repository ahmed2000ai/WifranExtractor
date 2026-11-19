import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { loadEnvConfig } from '../config/env';
import { buildPageStyleProfilePrompt } from './styleProfilePromptBuilder.page';
import { buildStyleProfileJsonSchema, leafletStyleProfileModelSchema } from '../../shared/schemas/styleProfileSchema';
import type { LeafletStyleProfile } from '../../shared/types/styleProfile';
import { runWithMistralRateLimit } from './mistralRateLimitQueue';
import { warn, error as logError, info } from '../logging/logger';
import { assertNotOfflineUat } from '../config/offlineUatGuard';

export async function generatePageStyleProfile(input: {
  leafletId?: string | null;
  pageNumber: number;
  pageImagePath: string;
  extractionPackagePath: string;
  forceRegenerate?: boolean;
}): Promise<LeafletStyleProfile> {
  const config = loadEnvConfig();
  
  const profilesDir = path.join(input.extractionPackagePath, 'metadata', 'style-profiles');
  mkdirSync(profilesDir, { recursive: true });
  
  const paddedPage = String(input.pageNumber).padStart(3, '0');
  const profilePath = path.join(profilesDir, `page-${paddedPage}-style-profile.json`);

  if (!input.forceRegenerate && existsSync(profilePath)) {
    try {
      const data = JSON.parse(readFileSync(profilePath, 'utf8'));
      info(`Loaded existing page style profile for page ${input.pageNumber}`);
      return data as LeafletStyleProfile;
    } catch (e) {
      warn(`Failed to parse existing page style profile for page ${input.pageNumber}, regenerating...`);
    }
  }

  assertNotOfflineUat('Live Mistral Page Style Profile API calls');

  const apiKey = config.mistral.apiKey;
  if (!apiKey) {
    const errMsg = 'Missing Mistral API key for page style profile generation.';
    warn(errMsg);
    throw new Error(errMsg);
  }

  try {
    const contents: Array<any> = [];
    const promptText = buildPageStyleProfilePrompt({
      pageNumber: input.pageNumber
    });
    const schema = buildStyleProfileJsonSchema();

    contents.push({ type: 'text', text: promptText + '\n\nEXPECTED JSON SCHEMA:\n' + JSON.stringify(schema, null, 2) });

    if (!existsSync(input.pageImagePath)) {
      throw new Error(`Page image missing: ${input.pageImagePath}`);
    }
    const pageBuffer = await sharp(input.pageImagePath).jpeg({ quality: 80 }).toBuffer();
    const imageDataUrl = `data:image/jpeg;base64,${pageBuffer.toString('base64')}`;
    contents.push({ type: 'image_url', image_url: { url: imageDataUrl } });

    const chatRes = await runWithMistralRateLimit(
      {
        kind: 'style_profile',
        label: `Page style profile`,
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
                content: contents
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
          const err: any = new Error(`Page Style Profile API failed: ${errText}`);
          err.status = res.status;
          throw err;
        }

        return res;
      }
    );

    const chatJson = await chatRes.json();
    const content = chatJson.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('Mistral returned empty content for style profile.');
    }

    const parsed = typeof content === 'string' ? JSON.parse(content) : content;
    const validatedData = leafletStyleProfileModelSchema.parse(parsed);

    const profile: LeafletStyleProfile = {
      ...(validatedData as any),
      schema_version: 1,
      profile_id: `style-profile-page-${input.pageNumber}-${Date.now()}`,
      leaflet_id: input.leafletId || null,
      scope: 'page',
      page_number: input.pageNumber,
      selected_page_numbers: null,
      source_image_path: input.pageImagePath,
      created_at: new Date().toISOString(),
      model: 'pixtral-large-latest',
      raw_model_response: parsed
    };

    writeFileSync(profilePath, JSON.stringify(profile, null, 2), 'utf8');
    info(`Saved page style profile to ${profilePath}`);
    
    return profile;
  } catch (err: any) {
    logError(`Failed to generate page style profile for page ${input.pageNumber}: ${err.message}`);
    throw err;
  }
}

export async function loadOrGeneratePageStyleProfile(input: {
  leafletId?: string | null;
  pageNumber: number;
  pageImagePath: string;
  extractionPackagePath: string;
  forceRegenerate?: boolean;
}): Promise<LeafletStyleProfile | null> {
  const mode = process.env.PAGE_STYLE_PROFILE_MODE || 'all_pages';
  
  if (mode === 'disabled') {
    info('Page style profile generation is disabled by PAGE_STYLE_PROFILE_MODE config.');
    return null;
  }

  return generatePageStyleProfile(input);
}
