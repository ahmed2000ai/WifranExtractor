import type { Mistral } from '@mistralai/mistralai';

/**
 * Dynamic import helper that prevents bundlers (e.g. Vite/Rollup CJS)
 * from converting import() to require(), allowing CommonJS bundles to load ESM-only packages.
 */
const dynamicImport = new Function('specifier', 'return import(specifier)') as <T = any>(
  specifier: string
) => Promise<T>;

let MistralConstructor: (new (opts: { apiKey?: string }) => Mistral) | null = null;

export async function getMistralClient(apiKey?: string): Promise<Mistral> {
  if (process.env.WIFRAN_OFFLINE_UAT === '1') {
    throw new Error('OFFLINE_UAT_GUARD: Live Mistral API network calls are strictly blocked in Offline UAT Mode.');
  }
  const resolvedKey = apiKey || process.env.MISTRAL_API_KEY;
  if (!resolvedKey) {
    throw new Error('MISSING_MISTRAL_API_KEY: Mistral API key is not configured.');
  }

  if (!MistralConstructor) {
    const mistralModule = await dynamicImport('@mistralai/mistralai');
    MistralConstructor = mistralModule.Mistral || mistralModule.default?.Mistral || mistralModule.default;
    if (!MistralConstructor) {
      throw new Error('Failed to resolve Mistral constructor from @mistralai/mistralai');
    }
  }

  return new MistralConstructor({ apiKey: resolvedKey });
}
