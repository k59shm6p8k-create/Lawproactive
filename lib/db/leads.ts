/**
 * Lead capture — write a row to `leads`.
 * Use this from the lead form's server action / API route. Returns
 * { ok, id? , error? } so the caller can show success/failure cleanly.
 *
 * Only whitelisted fields are written (see NewLead), so a malicious client
 * can't set status, routed_attorney_id, etc.
 */
import { createSupabaseServerClient } from '@/lib/supabase-server';
import type { NewLead } from './database.types';

const FIELDS: (keyof NewLead)[] = [
  'full_name', 'email', 'phone', 'case_type', 'city_slug', 'state_code',
  'message', 'source', 'page_path', 'utm_source', 'utm_medium', 'utm_campaign',
  'gclid', 'fbclid',
];

export async function createLead(
  input: NewLead,
  meta?: { ipHash?: string | null; userAgent?: string | null },
): Promise<{ ok: boolean; id?: string; error?: string }> {
  // Require at least one contact method.
  if (!input.email && !input.phone) {
    return { ok: false, error: 'A phone number or email is required.' };
  }
  const row: Record<string, unknown> = {};
  for (const f of FIELDS) if (input[f] !== undefined) row[f] = input[f];
  if (meta?.ipHash) row.ip_hash = meta.ipHash;
  if (meta?.userAgent) row.user_agent = meta.userAgent;

  try {
    const db = createSupabaseServerClient();
    const { data, error } = await db.from('leads').insert(row).select('id').single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: (data as { id: string }).id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
