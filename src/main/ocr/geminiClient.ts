import { GoogleGenAI } from '@google/genai';
import { config as loadDotenv } from 'dotenv';
import { join, resolve, isAbsolute } from 'path';
import { existsSync } from 'fs';
import { loadEnvConfig } from '../config/env';

// Robustly ensure .env.local and .env are loaded across CLI, electron, and tests
const envPaths = [
  join(process.cwd(), '.env.local'),
  join(process.cwd(), '.env'),
  join(__dirname, '../../../../.env.local'),
  join(__dirname, '../../../../.env'),
  join(__dirname, '../../../.env.local'),
  join(__dirname, '../../../.env')
];
for (const p of envPaths) {
  loadDotenv({ path: p });
}

let cachedClient: GoogleGenAI | null = null;
let cachedClientMode: string | null = null;

export function getGeminiApiKey(): string {
  const config = loadEnvConfig();
  return (
    process.env.GEMINI_API_KEY ||
    (config as any).gemini?.apiKey ||
    ''
  );
}

export function isVertexAiConfigured(): boolean {
  const creds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const project = process.env.GCP_PROJECT_ID;
  return Boolean(creds && project);
}

export function isGeminiConfigured(): boolean {
  if (isVertexAiConfigured()) return true;
  const key = getGeminiApiKey();
  return Boolean(key && !key.includes('your_actual_gemini_api_key_here'));
}

export function getGeminiClient(customApiKey?: string): GoogleGenAI {
  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const projectId = process.env.GCP_PROJECT_ID;
  const location = process.env.GCP_LOCATION || 'global';

  // 1. IF GOOGLE_APPLICATION_CREDENTIALS and GCP_PROJECT_ID exist -> Vertex AI configuration
  if (credsPath && projectId && !customApiKey) {
    let resolvedCredsPath = credsPath;
    if (!isAbsolute(resolvedCredsPath)) {
      resolvedCredsPath = resolve(process.cwd(), resolvedCredsPath);
      process.env.GOOGLE_APPLICATION_CREDENTIALS = resolvedCredsPath;
    }

    if (!existsSync(resolvedCredsPath)) {
      throw new Error(
        `GOOGLE_APPLICATION_CREDENTIALS_NOT_FOUND: Service account key file not found at ${resolvedCredsPath}`
      );
    }

    // Ensure Google Cloud environment variables for gauth
    process.env.GOOGLE_CLOUD_PROJECT = projectId;
    process.env.GOOGLE_CLOUD_LOCATION = location;

    const cacheKey = `vertex_${projectId}_${location}`;
    if (cachedClient && cachedClientMode === cacheKey) {
      return cachedClient;
    }

    cachedClient = new GoogleGenAI({
      vertexai: true,
      project: projectId,
      location: location,
      ...({ vertexai: { project: projectId, location: location } } as any)
    });
    cachedClientMode = cacheKey;
    return cachedClient;
  }

  // 2. ELSE IF GEMINI_API_KEY exists -> Fallback to standard initialization
  const apiKey = customApiKey || getGeminiApiKey();
  if (apiKey && !apiKey.includes('your_actual_gemini_api_key_here')) {
    const cacheKey = `api_${apiKey}`;
    if (cachedClient && cachedClientMode === cacheKey) {
      return cachedClient;
    }

    cachedClient = new GoogleGenAI({ apiKey });
    cachedClientMode = cacheKey;
    return cachedClient;
  }

  // 3. ELSE -> Throw descriptive configuration error
  throw new Error(
    'MISSING_GEMINI_CONFIGURATION: Neither Vertex AI credentials (GOOGLE_APPLICATION_CREDENTIALS and GCP_PROJECT_ID) nor standard GEMINI_API_KEY were found. Please configure .env.local.'
  );
}
