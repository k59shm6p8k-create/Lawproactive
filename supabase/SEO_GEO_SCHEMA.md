# SEO + Geo schema — handoff

A production-ready Postgres/Supabase schema for the programmatic personal-injury
platform, plus a seeder that fills it from the data already in this repo.

## Files
- `migrations/0002_seo_geo_schema.sql` — the schema (tables, indexes, RLS, a sitemap view).
- `../scripts/seed-seo-geo.ts` — populates it from repo data (idempotent; safe to re-run).

## Apply it (2 steps)
```bash
# 1) create the schema  (Supabase CLI, or paste the SQL in the SQL editor)
supabase db execute -f supabase/migrations/0002_seo_geo_schema.sql
#    or: psql "$DATABASE_URL" -f supabase/migrations/0002_seo_geo_schema.sql

# 2) seed it from the repo data
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  npx tsx scripts/seed-seo-geo.ts --state california
```
Seeds: 1 state · 6 practice areas · 484 cities · redirects · 3,388 page-SEO rows.

## What's in it

**Geo** (`states` → `counties` → `cities`)
- `cities` has `slug`, `state_code`, `population`, `landmark`, `latitude`,
  `longitude`, and a **generated PostGIS `geog` point** (+ GIST index) so
  radius / nearest-attorney queries are fast. Unique on `(state_code, slug)`.

**SEO**
- `page_seo` — one row per canonical URL: `meta_title`, `meta_description`,
  `canonical_url`, `robots`/`noindex`, Open Graph, `json_ld` (schema.org),
  `hreflang`, plus sitemap `priority`/`changefreq`/`lastmod`.
- `redirects` — DB-driven 301/302s (marketing can edit without a deploy).
- `sitemap_urls` view — flattened feed for generating `sitemap.xml`.

**Content** (jsonb, layered — matches the current app)
- `page_config_templates` (`page_key`, `sections`) — base templates.
- `location_page_configs` (`state_slug`, `city_slug`, `practice_slug`, `sections`)
  — overrides layered default → state → city → practice; NULLs are wildcards.

**Business**
- `attorneys`, `territory_subscriptions` (one active attorney per city/practice),
  `leads` (public INSERT only via RLS — capture, never list).

## Security (RLS)
- Public **read** on geo / SEO / content / practice areas.
- `leads`: public **insert only** (no read).
- `attorneys` / `territory_subscriptions` / reading `leads`: server-side via the
  `service_role` key (bypasses RLS). Add attorney-login policies later if needed.

## Compatibility with the current app
The columns the existing code already queries are preserved, so reads keep working:
- `cities.slug`, `cities.state_code` (`get-lawyer-for-territory`)
- `location_page_configs.state_slug` / `city_slug` / `practice_slug` / `sections`
- `page_config_templates.page_key` / `sections`
- `territory_subscriptions` linked to `cities`

Everything else (page_seo, redirects, PostGIS geo, sitemap view) is additive.
