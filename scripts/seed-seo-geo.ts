#!/usr/bin/env -S npx tsx
/**
 * Seed the SEO + Geo schema (supabase/migrations/0002_seo_geo_schema.sql)
 * from the data already committed in this repo — so the new database comes
 * pre-populated instead of the dev entering 484 cities and thousands of SEO
 * rows by hand.
 *
 * Populates: states, cities, practice_areas, redirects, page_seo.
 * (location_page_configs / page_config_templates are left to the content
 *  pipeline — this script is the SEO + geo layer the schema was built for.)
 *
 * Idempotent: every write is an upsert on a natural key, so it's safe to re-run.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx tsx scripts/seed-seo-geo.ts [--state california] [--dry-run]
 */
import { promises as fs } from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { PRACTICE_AREAS } from '@/lib/data/practice-areas-config';

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const STATE = (argv[argv.indexOf('--state') + 1] && !argv[argv.indexOf('--state') + 1].startsWith('--'))
  ? argv[argv.indexOf('--state') + 1] : 'california';

// State metadata (extend as more states launch)
const STATES: Record<string, { code: string; name: string }> = {
  california: { code: 'CA', name: 'California' },
  texas:      { code: 'TX', name: 'Texas' },
  florida:    { code: 'FL', name: 'Florida' },
  'new-york': { code: 'NY', name: 'New York' },
};

// Literal (non-regex) redirects worth persisting for SEO. Pattern-based rewrites
// in next.config stay in code; these are the 1:1 canonical redirects.
const REDIRECTS: { source: string; destination: string; status: number }[] = [
  { source: '/home',  destination: '/', status: 301 },
  { source: '/index', destination: '/', status: 301 },
  { source: '/los-angeles',   destination: '/personal-injury-lawyer/california/los-angeles',   status: 301 },
  { source: '/san-francisco', destination: '/personal-injury-lawyer/california/san-francisco', status: 301 },
  { source: '/san-diego',     destination: '/personal-injury-lawyer/california/san-diego',     status: 301 },
  { source: '/sacramento',    destination: '/personal-injury-lawyer/california/sacramento',    status: 301 },
];

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.');
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function chunkedUpsert(db: any, table: string, rows: any[], onConflict: string) {
  if (DRY) { console.log(`  [dry-run] would upsert ${rows.length} -> ${table}`); return; }
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await db.from(table).upsert(batch, { onConflict });
    if (error) throw new Error(`${table} upsert failed at ${i}: ${error.message}`);
  }
  console.log(`  upserted ${rows.length} -> ${table}`);
}

async function main() {
  const meta = STATES[STATE];
  if (!meta) throw new Error(`Unknown state '${STATE}'`);
  const db = DRY ? null : client();
  console.log(`Seeding SEO+Geo for ${meta.name} (${meta.code})${DRY ? ' [DRY RUN]' : ''}`);

  // 1) state ------------------------------------------------------------------
  await chunkedUpsert(db, 'states',
    [{ code: meta.code, name: meta.name, slug: STATE, abbreviation: meta.code }],
    'code');

  // 2) practice areas ---------------------------------------------------------
  const practices = PRACTICE_AREAS.map((p: any, i: number) => ({
    slug: p.slug, name: p.name, icon: p.icon ?? null,
    description: p.longDescription ?? p.description ?? null, sort_order: i,
  }));
  await chunkedUpsert(db, 'practice_areas', practices, 'slug');

  // 3) cities -----------------------------------------------------------------
  const citiesRaw = JSON.parse(
    await fs.readFile(path.join(ROOT, 'data', 'states', `${STATE}-cities.json`), 'utf-8'),
  ) as any[];
  const cities = citiesRaw.map((c) => ({
    name: c.city,
    slug: c.slug ?? c.city.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    state_code: meta.code,
    population: c.population ?? null,
    landmark: c.landmark ?? null,
    latitude: c.latitude ?? null,
    longitude: c.longitude ?? null,
    is_incorporated: c.is_incorporated ?? true,
    status: 'active',
  }));
  await chunkedUpsert(db, 'cities', cities, 'state_code,slug');

  // 4) redirects --------------------------------------------------------------
  await chunkedUpsert(db, 'redirects',
    REDIRECTS.map((r) => ({ source_path: r.source, destination_path: r.destination, status_code: r.status })),
    'source_path');

  // 5) page_seo (from generated content) --------------------------------------
  // Resolve slug -> id maps so we can set the FKs.
  let cityIdBySlug = new Map<string, string>();
  let practiceIdBySlug = new Map<string, string>();
  if (!DRY) {
    const { data: cRows } = await db.from('cities').select('id,slug').eq('state_code', meta.code);
    (cRows ?? []).forEach((r: any) => cityIdBySlug.set(r.slug, r.id));
    const { data: pRows } = await db.from('practice_areas').select('id,slug');
    (pRows ?? []).forEach((r: any) => practiceIdBySlug.set(r.slug, r.id));
  }

  const contentDir = path.join(ROOT, 'data', 'content', STATE);
  const seoRows: any[] = [];
  const base = `/personal-injury-lawyer/${STATE}`;
  for (const entry of await fs.readdir(contentDir)) {
    const full = path.join(contentDir, entry);
    const st = await fs.stat(full);
    if (st.isFile() && entry.endsWith('.json')) {
      const citySlug = entry.slice(0, -5);
      const doc = JSON.parse((await fs.readFile(full, 'utf-8')).replace(/^﻿/, ''));
      seoRows.push({
        path: `${base}/${citySlug}`,
        city_id: cityIdBySlug.get(citySlug) ?? null,
        meta_title: doc?.seo?.metaTitle ?? null,
        meta_description: doc?.seo?.metaDescription ?? null,
        priority: 0.8, changefreq: 'weekly',
      });
    } else if (st.isDirectory()) {
      const citySlug = entry;
      for (const f of await fs.readdir(full)) {
        if (!f.endsWith('.json')) continue;
        const practiceSlug = f.slice(0, -5);
        const doc = JSON.parse((await fs.readFile(path.join(full, f), 'utf-8')).replace(/^﻿/, ''));
        seoRows.push({
          path: `${base}/${citySlug}/${practiceSlug}`,
          city_id: cityIdBySlug.get(citySlug) ?? null,
          practice_area_id: practiceIdBySlug.get(practiceSlug) ?? null,
          meta_title: doc?.seo?.metaTitle ?? null,
          meta_description: doc?.seo?.metaDescription ?? null,
          priority: 0.7, changefreq: 'weekly',
        });
      }
    }
  }
  await chunkedUpsert(db, 'page_seo', seoRows, 'path');

  console.log(`Done. states:1 practices:${practices.length} cities:${cities.length} redirects:${REDIRECTS.length} page_seo:${seoRows.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
