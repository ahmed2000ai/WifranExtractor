import "@/lib/security/assert-server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireServerEnv, requirePublicEnv } from "@/lib/security/env";

/**
 * Creates an elevated Supabase client that bypasses Row Level Security (RLS) policies.
 * 
 * WARNING:
 * - This uses the secret service_role key.
 * - NEVER import this file into Client Components.
 * - Only use this inside secure Server Components, Server Actions, or API Route Handlers.
 */
export function createAdminClient() {
  const supabaseUrl = requirePublicEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseServiceRoleKey = requireServerEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createSupabaseClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
