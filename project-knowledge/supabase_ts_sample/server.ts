import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Creates a server-side Supabase client for Next.js App Router components,
 * actions, and route handlers. Manages authorization cookies correctly.
 */
export async function createClient() {
  const cookieStore = await cookies();

  const url = supabaseUrl || "https://placeholder-url.supabase.co";
  const anonKey = supabaseAnonKey || "placeholder-anon-key";

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Ignores write errors when invoked inside read-only Server Components
        }
      },
    },
  });
}
