# Production Environment Verification

Before launching, verify all environment variables in the Vercel production environment.

> **IMPORTANT:** `NEXT_PUBLIC_ANALYTICS_DEBUG` should normally be `false` or completely unset in production to prevent console spam.

| Variable | Purpose | Type | Required for Prod? | Verification Method |
| :--- | :--- | :--- | :--- | :--- |
| `NEXT_PUBLIC_SITE_URL` | Canonical URL for SEO, OG tags, and redirects. | Public | Yes | Check source HTML for canonical `<link>`. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API endpoint. | Public | Yes | Monitor Network tab for successful API calls. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase public anonymous key. | Public | Yes | Ensure user login works. |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin bypass key for backend mutations. | **Secret** | Yes | Do NOT print. Ensure bulk imports work. |
| `NEXT_PUBLIC_POSTHOG_KEY` | Analytics ingestion key. | Public | Yes | Check PostHog dashboard for live events. |
| `NEXT_PUBLIC_POSTHOG_HOST` | Analytics host (usually eu.i.posthog.com). | Public | Yes | Check Network tab for tracking calls. |
| `SENTRY_DSN` | Sentry project endpoint. | Public | Yes | Intentionally trigger an error and check Sentry. |
| `SENTRY_AUTH_TOKEN` | Sentry token for uploading sourcemaps during build. | **Secret** | Yes | Check Vercel build logs for Sentry success. |
| `RESEND_API_KEY` | Email sending service key. | **Secret** | Yes (If using emails) | Trigger an email and verify receipt. |
| `NEXT_PUBLIC_APP_ENV` | Identifies the environment (`production`). | Public | Yes | Verify via `/admin/monitoring` page. |
| `NEXT_PUBLIC_ANALYTICS_DEBUG` | Prints analytics payloads to console. | Public | **NO** | Ensure browser console is clean on navigation. |

## How to Verify Secrets Safely
- Never `console.log()` secrets.
- Verify them by observing the success of the functionality they power (e.g., if CSV import succeeds, the Service Role Key is correct).
