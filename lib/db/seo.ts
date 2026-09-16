/**
 * SEO data access — reads per-URL metadata from `page_seo`.
 * Every function is defensive: on any error (table missing, no row, no DB) it
 * returns null so the page still renders and you can fall back to defaults.
 *
 * Typical use in a route:
 *   export async function generateMetadata({ params }) {
 *     const p = await params;
 *     const seo = await getPageSeo(`/personal-injury-lawyer/${p.state}/${p.city}`);
 *     return toNextMetadata(seo) ?? { title: `...default...` };
 *   }
 */
import type { Metadata } from 'next';
import { supabaseServer } from '@/lib/supabase-server';
import type { PageSeoRow } from './database.types';

export async function getPageSeo(path: string): Promise<PageSeoRow | null> {
  try {
    const { data, error } = await supabaseServer
      .from('page_seo')
      .select('*')
      .eq('path', path)
      .maybeSingle();
    if (error) return null;
    return (data as PageSeoRow) ?? null;
  } catch {
    return null;
  }
}

/** Map a page_seo row to a Next.js Metadata object. Returns null if no row. */
export function toNextMetadata(seo: PageSeoRow | null): Metadata | null {
  if (!seo) return null;
  const md: Metadata = {
    title: seo.meta_title ?? undefined,
    description: seo.meta_description ?? undefined,
    robots: seo.noindex ? { index: false, follow: false } : seo.robots ?? undefined,
    alternates: seo.canonical_url ? { canonical: seo.canonical_url } : undefined,
    openGraph: (seo.og_title || seo.og_description || seo.og_image)
      ? {
          title: seo.og_title ?? seo.meta_title ?? undefined,
          description: seo.og_description ?? seo.meta_description ?? undefined,
          images: seo.og_image ? [seo.og_image] : undefined,
        }
      : undefined,
  };
  return md;
}

/** JSON-LD object for the page, if any — render with a <script type="application/ld+json">. */
export function getJsonLd(seo: PageSeoRow | null): Record<string, unknown> | null {
  return seo?.json_ld ?? null;
}
