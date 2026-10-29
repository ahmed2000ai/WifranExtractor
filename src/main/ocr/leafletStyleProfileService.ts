import { mkdirSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { loadEnvConfig } from '../config/env';
import { buildLeafletStyleProfilePrompt } from './styleProfilePromptBuilder';
import { buildStyleProfileJsonSchema, leafletStyleProfileModelSchema } from '../../shared/schemas/styleProfileSchema';
import type { LeafletStyleProfile, LeafletStyleProfileSelectionMetadata } from '../../shared/types/styleProfile';
import { runWithMistralRateLimit } from './mistralRateLimitQueue';
import { warn, error as logError, info } from '../logging/logger';
import { updateExtractionManifest } from '../extraction/extractionManifestService';

export async function generateLeafletStyleProfileFromSelectedPages(input: {
  leafletId?: string | null;
  selectedPageNumbers: number[];
  pageImagePaths: string[];
  extractionPackagePath: string;
}): Promise<LeafletStyleProfile> {
  const config = loadEnvConfig();
  
  const profilesDir = path.join(input.extractionPackagePath, 'metadata', 'style-profiles');
  mkdirSync(profilesDir, { recursive: true });
  
  const selectionPath = path.join(profilesDir, 'leaflet-style-profile-selection.json');
  const profilePath = path.join(profilesDir, 'leaflet-style-profile.json');

  let selectionMetadata: LeafletStyleProfileSelectionMetadata = {
    schema_version: 1,
    created_at: new Date().toISOString(),
    leaflet_id: input.leafletId || null,
    selected_page_numbers: input.selectedPageNumbers,
    selected_page_image_paths: input.pageImagePaths,
    status: 'generating',
    profile_path: null,
    error_message: null
  };

  const apiKey = config.mistral.apiKey;
  if (!apiKey) {
    const errMsg = 'Missing Mistral API key for leaflet style profile generation.';
    warn(errMsg);
    selectionMetadata.status = 'failed';
    selectionMetadata.error_message = errMsg;
    writeFileSync(selectionPath, JSON.stringify(selectionMetadata, null, 2), 'utf8');
    await updateExtractionManifest(input.extractionPackagePath, {
      style_profile_selection: {
        status: 'failed',
        selected_page_numbers: input.selectedPageNumbers,
        profile_path: null,
        selection_path: 'metadata/style-profiles/leaflet-style-profile-selection.json',
        started_at: selectionMetadata.created_at,
        completed_at: null,
        skipped_at: null,
        error_message: errMsg
      }
    });
    throw new Error(errMsg);
  }

  // Update manifest to generating
  await updateExtractionManifest(input.extractionPackagePath, {
    style_profile_selection: {
      status: 'generating',
      selected_page_numbers: input.selectedPageNumbers,
      profile_path: null,
      selection_path: 'metadata/style-profiles/leaflet-style-profile-selection.json',
      started_at: selectionMetadata.created_at,
      completed_at: null,
      skipped_at: null,
      error_message: null
    }
  });

  try {
    const contents: Array<any> = [];
    const promptText = buildLeafletStyleProfilePrompt({
      leafletId: input.leafletId,
      selectedPageNumbers: input.selectedPageNumbers
    });
    const schema = buildStyleProfileJsonSchema();

    contents.push({ type: 'text', text: promptText + '\n\nEXPECTED JSON SCHEMA:\n' + JSON.stringify(schema, null, 2) });

    for (const imgPath of input.pageImagePaths) {
      if (!existsSync(imgPath)) {
        throw new Error(`Selected page image missing: ${imgPath}`);
      }
      const pageBuffer = await sharp(imgPath).jpeg({ quality: 80 }).toBuffer();
      const imageDataUrl = `data:image/jpeg;base64,${pageBuffer.toString('base64')}`;
      contents.push({ type: 'image_url', image_url: { url: imageDataUrl } });
    }

    const chatRes = await runWithMistralRateLimit(
      {
        kind: 'style_profile',
        label: `Leaflet style profile from representative pages`,
        pageNumber: null
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
          const err: any = new Error(`Leaflet Style Profile API failed: ${errText}`);
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
      profile_id: `style-profile-leaflet-${Date.now()}`,
      leaflet_id: input.leafletId || null,
      scope: 'leaflet',
      page_number: null,
      selected_page_numbers: input.selectedPageNumbers,
      source_image_path: null, // represents multiple
      created_at: new Date().toISOString(),
      model: 'pixtral-large-latest',
      raw_model_response: parsed
    };

    writeFileSync(profilePath, JSON.stringify(profile, null, 2), 'utf8');

    selectionMetadata.status = 'generated';
    selectionMetadata.profile_path = 'metadata/style-profiles/leaflet-style-profile.json';
    writeFileSync(selectionPath, JSON.stringify(selectionMetadata, null, 2), 'utf8');

    await updateExtractionManifest(input.extractionPackagePath, {
      style_profile_selection: {
        status: 'generated',
        selected_page_numbers: input.selectedPageNumbers,
        profile_path: selectionMetadata.profile_path,
        selection_path: 'metadata/style-profiles/leaflet-style-profile-selection.json',
        started_at: selectionMetadata.created_at,
        completed_at: new Date().toISOString(),
        skipped_at: null,
        error_message: null
      }
    });

    info(`Saved leaflet style profile to ${profilePath}`);
    return profile;
  } catch (err: any) {
    logError(`Failed to generate leaflet style profile: ${err.message}`);
    
    selectionMetadata.status = 'failed';
    selectionMetadata.error_message = err.message;
    writeFileSync(selectionPath, JSON.stringify(selectionMetadata, null, 2), 'utf8');
    
    await updateExtractionManifest(input.extractionPackagePath, {
      style_profile_selection: {
        status: 'failed',
        selected_page_numbers: input.selectedPageNumbers,
        profile_path: null,
        selection_path: 'metadata/style-profiles/leaflet-style-profile-selection.json',
        started_at: selectionMetadata.created_at,
        completed_at: null,
        skipped_at: null,
        error_message: err.message
      }
    });

    throw err;
  }
}

export async function skipLeafletStyleProfile(extractionPackagePath: string): Promise<void> {
  const profilesDir = path.join(extractionPackagePath, 'metadata', 'style-profiles');
  mkdirSync(profilesDir, { recursive: true });
  const selectionPath = path.join(profilesDir, 'leaflet-style-profile-selection.json');

  const selectionMetadata: LeafletStyleProfileSelectionMetadata = {
    schema_version: 1,
    created_at: new Date().toISOString(),
    leaflet_id: null,
    selected_page_numbers: [],
    selected_page_image_paths: [],
    status: 'skipped',
    profile_path: null,
    error_message: null
  };

  writeFileSync(selectionPath, JSON.stringify(selectionMetadata, null, 2), 'utf8');

  await updateExtractionManifest(extractionPackagePath, {
    style_profile_selection: {
      status: 'skipped',
      selected_page_numbers: [],
      profile_path: null,
      selection_path: 'metadata/style-profiles/leaflet-style-profile-selection.json',
      started_at: null,
      completed_at: null,
      skipped_at: new Date().toISOString(),
      error_message: null
    }
  });

  info('Skipped leaflet style profile generation.');
}
