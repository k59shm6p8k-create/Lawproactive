/**
 * Row types for the SEO + Geo schema (supabase/migrations/0002_seo_geo_schema.sql).
 * Hand-maintained to match the migration. If you change the SQL, update these too
 * (or regenerate with `supabase gen types typescript`).
 */

export interface StateRow {
  id: string;
  code: string;          // 'CA'
  name: string;
  slug: string;          // 'california'
  abbreviation: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CountyRow {
  id: string;
  state_id: string;
  name: string;
  slug: string;
  fips_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface CityRow {
  id: string;
  state_id: string;
  county_id: string | null;
  name: string;
  slug: string;
  state_code: string;    // 'CA'
  population: number | null;
  landmark: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  is_incorporated: boolean;
  status: 'active' | 'draft' | 'archived';
  created_at: string;
  updated_at: string;
}

export interface PracticeAreaRow {
  id: string;
  slug: string;          // 'car-accident'
  name: string;
  icon: string | null;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PageSeoRow {
  id: string;
  path: string;                       // '/personal-injury-lawyer/california/los-angeles'
  city_id: string | null;
  practice_area_id: string | null;
  meta_title: string | null;
  meta_description: string | null;
  canonical_url: string | null;
  robots: string;
  noindex: boolean;
  og_title: string | null;
  og_description: string | null;
  og_image: string | null;
  twitter_card: string | null;
  json_ld: Record<string, unknown> | null;
  hreflang: Array<{ lang: string; href: string }> | null;
  sitemap_include: boolean;
  priority: number;
  changefreq: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  lastmod: string;
  created_at: string;
  updated_at: string;
}

export interface RedirectRow {
  id: string;
  source_path: string;
  destination_path: string;
  status_code: 301 | 302 | 307 | 308;
  is_active: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttorneyRow {
  id: string;
  auth_user_id: string | null;
  full_name: string;
  firm_name: string | null;
  email: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  bar_number: string | null;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface TerritorySubscriptionRow {
  id: string;
  attorney_id: string;
  city_id: string;
  practice_area_id: string | null;
  status: 'active' | 'paused' | 'expired' | 'pending';
  starts_at: string;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadRow {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  case_type: string | null;
  city_slug: string | null;
  state_code: string | null;
  message: string | null;
  source: string | null;
  page_path: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  gclid: string | null;
  fbclid: string | null;
  routed_attorney_id: string | null;
  status: 'new' | 'contacted' | 'qualified' | 'rejected' | 'won' | 'lost';
  ip_hash: string | null;
  user_agent: string | null;
  created_at: string;
}

/** Result row from the nearby_cities(lat,lng,radius_km,max_rows) SQL function. */
export interface NearbyCity {
  id: string;
  name: string;
  slug: string;
  state_code: string;
  latitude: number;
  longitude: number;
  distance_m: number;
}

/** Payload accepted by createLead() — only what a public form should send. */
export interface NewLead {
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  case_type?: string | null;
  city_slug?: string | null;
  state_code?: string | null;
  message?: string | null;
  source?: string | null;
  page_path?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
}
