import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { loadEnvConfig } from '../config/env'
import { error as logError } from '../logging/logger'
import WebSocket from 'ws'

if (typeof global.WebSocket === 'undefined') {
  ;(global as any).WebSocket = WebSocket
}

let supabaseAdminClient: SupabaseClient | null = null

export function getSupabaseAdminClient(): SupabaseClient {
  if (supabaseAdminClient) {
    return supabaseAdminClient
  }

  const config = loadEnvConfig()
  
  if (!config.supabase.url || !config.supabase.serviceRoleKey) {
    const errorMsg = 'Supabase URL or Service Role Key is missing in environment variables. Database operations will fail.'
    logError(errorMsg)
    throw new Error(errorMsg)
  }

  supabaseAdminClient = createClient(
    config.supabase.url,
    config.supabase.serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  )

  return supabaseAdminClient
}
