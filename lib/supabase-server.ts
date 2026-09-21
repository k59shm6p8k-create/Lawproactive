import { createClient } from '@supabase/supabase-js'

// Fallbacks keep `createClient` from throwing "supabaseUrl is required" at
// build/import time when env vars are not set (e.g. a Vercel content-preview
// deploy). Real credentials, when present, always take precedence. Requests
// made against the placeholder simply fail at runtime — which is fine for the
// content pages, whose copy is served from local JSON, not Supabase.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service-role-key'

/**
 * True only when real Supabase credentials are present. When false (e.g. a
 * fresh clone or a content-only preview with no env), callers MUST skip
 * queries and use their local-file fallback — otherwise every request makes
 * network calls to the placeholder host that hang for seconds before failing,
 * which is what made unconfigured pages take ~28s to render.
 */
export const isSupabaseConfigured =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY

// Hard cap every Supabase request so a slow/unreachable host can never block a
// render for more than a few seconds (belt-and-suspenders alongside the
// isSupabaseConfigured short-circuits in the callers).
const SUPABASE_FETCH_TIMEOUT_MS = 3500

const clientConfig = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  global: {
    fetch: (url: any, options: any) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), SUPABASE_FETCH_TIMEOUT_MS)
      return fetch(url, {
        ...options,
        cache: 'no-store',
        signal: controller.signal,
      }).finally(() => clearTimeout(timer))
    },
  },
}

/**
 * Server-side Supabase client using the service_role_key.
 * ⚠️ ONLY use this for stateless read operations in Server Components.
 * For operations that perform authentication (login, logout, auth checks) 
 * or writes, use createSupabaseServerClient() to avoid cross-request state contamination.
 */
export const supabaseServer = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  clientConfig
)

/**
 * Factory function returning a fresh, un-mutated server client.
 * Bypasses Row-Level Security (RLS) safely on the server side.
 */
export const createSupabaseServerClient = () => createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  clientConfig
)
