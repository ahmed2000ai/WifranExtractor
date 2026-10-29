import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Creates a browser-safe Supabase client.
 * Uses the anonymous key to read public/allowed tables under RLS.
 */
export function createClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn("Supabase credentials missing. Verify your .env.local configuration.");
  }

  return createBrowserClient(
    supabaseUrl || "https://placeholder-url.supabase.co",
    supabaseAnonKey || "placeholder-anon-key"
  );
}
