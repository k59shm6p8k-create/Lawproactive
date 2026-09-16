/**
 * Attorney territory lookup — who (if anyone) has rented a city/practice.
 * Returns the active attorney for the scope, or null (unclaimed → show the
 * "territory available" card). Defensive: null on any error.
 *
 * Matches the rule in the schema: at most one ACTIVE attorney per
 * (city, practice). A practice-specific rental wins over a city-wide one.
 */
import { supabaseServer } from '@/lib/supabase-server';
import type { AttorneyRow } from './database.types';

export async function getActiveAttorney(
  stateCode: string,
  citySlug: string,
  practiceSlug?: string | null,
): Promise<AttorneyRow | null> {
  try {
    // Resolve city + optional practice to ids.
    const { data: city } = await supabaseServer
      .from('cities').select('id')
      .eq('state_code', stateCode.toUpperCase())
      .eq('slug', citySlug.toLowerCase())
      .maybeSingle();
    if (!city) return null;

    let practiceId: string | null = null;
    if (practiceSlug) {
      const { data: pa } = await supabaseServer
        .from('practice_areas').select('id').eq('slug', practiceSlug).maybeSingle();
      practiceId = (pa as { id: string } | null)?.id ?? null;
    }

    // Prefer a practice-specific active rental, then a city-wide (practice null) one.
    const scopes = practiceId ? [practiceId, null] : [null];
    for (const scope of scopes) {
      let q = supabaseServer
        .from('territory_subscriptions')
        .select('attorney:attorneys(*)')
        .eq('city_id', (city as { id: string }).id)
        .eq('status', 'active')
        .limit(1);
      q = scope === null ? q.is('practice_area_id', null) : q.eq('practice_area_id', scope);
      const { data, error } = await q.maybeSingle();
      if (error) continue;
      const attorney = (data as { attorney: AttorneyRow | null } | null)?.attorney;
      if (attorney) return attorney;
    }
    return null;
  } catch {
    return null;
  }
}
