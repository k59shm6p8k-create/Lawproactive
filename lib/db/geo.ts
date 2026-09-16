/**
 * Geo data access — cities + radius search.
 * Defensive: returns null / [] on any error so pages never crash on geo.
 */
import { supabaseServer } from '@/lib/supabase-server';
import type { CityRow, NearbyCity } from './database.types';

/** One city by slug within a state (e.g. 'california', 'los-angeles'). */
export async function getCityBySlug(stateCode: string, slug: string): Promise<CityRow | null> {
  try {
    const { data, error } = await supabaseServer
      .from('cities')
      .select('*')
      .eq('state_code', stateCode.toUpperCase())
      .eq('slug', slug.toLowerCase())
      .maybeSingle();
    if (error) return null;
    return (data as CityRow) ?? null;
  } catch {
    return null;
  }
}

/** All active cities for a state, alphabetical. */
export async function listCities(stateCode: string): Promise<CityRow[]> {
  try {
    const { data, error } = await supabaseServer
      .from('cities')
      .select('*')
      .eq('state_code', stateCode.toUpperCase())
      .eq('status', 'active')
      .order('name', { ascending: true });
    if (error) return [];
    return (data as CityRow[]) ?? [];
  } catch {
    return [];
  }
}

/**
 * Nearest active cities to a point (PostGIS). Great for "attorneys near me"
 * and internal-linking nearby city pages.
 *   const near = await getNearbyCities(34.05, -118.24, 50);
 */
export async function getNearbyCities(
  lat: number,
  lng: number,
  radiusKm = 80,
  max = 20,
): Promise<NearbyCity[]> {
  try {
    const { data, error } = await supabaseServer.rpc('nearby_cities', {
      lat, lng, radius_km: radiusKm, max_rows: max,
    });
    if (error) return [];
    return (data as NearbyCity[]) ?? [];
  } catch {
    return [];
  }
}
