import { AppConfig } from './env'

export function redactSecret(value: string | undefined | null): string {
  if (!value || value.trim() === '') {
    return '[MISSING]'
  }
  return '[REDACTED]'
}

export function redactConfigForLog(config: AppConfig): unknown {
  return {
    ...config,
    supabase: {
      ...config.supabase,
      url: redactSecret(config.supabase.url),
      anonKey: redactSecret(config.supabase.anonKey),
      serviceRoleKey: redactSecret(config.supabase.serviceRoleKey),
      accessToken: redactSecret(config.supabase.accessToken)
    },
    mistral: {
      ...config.mistral,
      apiKey: redactSecret(config.mistral.apiKey)
    }
  }
}
