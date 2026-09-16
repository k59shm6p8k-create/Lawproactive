/**
 * Turnkey data-access layer for the SEO + Geo schema
 * (supabase/migrations/0002_seo_geo_schema.sql).
 *
 * Import from '@/lib/db' — every function is typed and fails safe (returns
 * null / [] / {ok:false} on error) so the site never crashes on a DB hiccup.
 *
 *   import { getPageSeo, toNextMetadata, getCityBySlug, getNearbyCities,
 *            createLead, getActiveAttorney, getRedirect } from '@/lib/db';
 */
export * from './database.types';
export { getPageSeo, toNextMetadata, getJsonLd } from './seo';
export { getCityBySlug, listCities, getNearbyCities } from './geo';
export { createLead } from './leads';
export { getActiveAttorney } from './territory';
export { getRedirect } from './redirects';
