/**
 * Redirect lookup — DB-driven 301/302s from the `redirects` table.
 * Use in middleware.ts to redirect before rendering. Defensive: null on error.
 *
 *   // middleware.ts
 *   const r = await getRedirect(req.nextUrl.pathname);
 *   if (r) return NextResponse.redirect(new URL(r.destination_path, req.url), r.status_code);
 */
import { supabaseServer } from '@/lib/supabase-server';
import type { RedirectRow } from './database.types';

export async function getRedirect(path: string): Promise<RedirectRow | null> {
  try {
    const { data, error } = await supabaseServer
      .from('redirects')
      .select('*')
      .eq('source_path', path)
      .eq('is_active', true)
      .maybeSingle();
    if (error) return null;
    return (data as RedirectRow) ?? null;
  } catch {
    return null;
  }
}
