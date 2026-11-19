import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { resolveDatabaseConfig } from './databaseEnvironmentResolver'
import { error as logError } from '../logging/logger'
import WebSocket from 'ws'

if (typeof global.WebSocket === 'undefined') {
  ;(global as any).WebSocket = WebSocket
}

let supabaseAdminClient: SupabaseClient | null = null

export function resetSupabaseAdminClient(): void {
  supabaseAdminClient = null
}

export function setSupabaseAdminClient(client: SupabaseClient | null | any): void {
  supabaseAdminClient = client
}

export function getSupabaseAdminClient(): SupabaseClient {
  if (process.env.WIFRAN_OFFLINE_UAT === '1') {
    throw new Error('OFFLINE_UAT_GUARD: Remote Supabase database operations are strictly blocked in Offline UAT Mode.')
  }

  if (supabaseAdminClient) {
    return supabaseAdminClient
  }

  try {
    const config = resolveDatabaseConfig('PRODUCTION_UI')

    supabaseAdminClient = createClient(
      config.cleanUrl,
      config.serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    return supabaseAdminClient
  } catch (err: any) {
    const errorMsg = `[SupabaseAdminClient] Failed to initialize guarded PRODUCTION client: ${err?.message || err}`
    logError(errorMsg)
    throw new Error(errorMsg)
  }
}
