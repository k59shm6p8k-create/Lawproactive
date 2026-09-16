-- ============================================================================
-- 0002_seo_geo_schema.sql
-- SEO + GEO schema for the LawProactive programmatic-content platform.
--
-- Target: PostgreSQL 15+ / Supabase.  Safe to run on a fresh project.
-- Design goals:
--   * GEO hierarchy (state -> county -> city) with lat/lng + PostGIS geography
--     so "attorneys near me" / radius queries are fast.
--   * SEO owned in the DB: per-URL meta, canonical, robots, Open Graph,
--     JSON-LD, hreflang, plus a redirects table and a sitemap view.
--   * Programmatic content (jsonb) layered default -> state -> city -> practice,
--     matching how the app merges page config today.
--   * Lead capture + attorney territory rental, with RLS locked down.
--
-- Conventions: snake_case; uuid primary keys; timestamptz created_at/updated_at;
-- unique + indexed slugs for O(1) route lookups; every table RLS-enabled.
-- Columns the CURRENT app already queries are called out with  -- APP: notes
-- so the dev can wire the updated version without breaking existing reads.
-- ============================================================================

-- ── Extensions ──────────────────────────────────────────────────────────────
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists postgis;    -- geography(Point) + GIST geo index
create extension if not exists pg_trgm;    -- trigram fuzzy search on names/slugs
create extension if not exists citext;     -- case-insensitive emails/slugs

-- ── updated_at trigger helper ───────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ============================================================================
-- GEO
-- ============================================================================

-- States (top of the geo hierarchy) ------------------------------------------
create table if not exists public.states (
  id          uuid primary key default gen_random_uuid(),
  code        char(2)     not null unique,            -- 'CA'
  name        text        not null,                   -- 'California'
  slug        citext      not null unique,            -- 'california'   APP: route [state]
  abbreviation char(2),                               -- APP: get-lawyer matches cities.state ~ abbr
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Counties (optional middle tier; useful for rollups + regional pages) --------
create table if not exists public.counties (
  id          uuid primary key default gen_random_uuid(),
  state_id    uuid not null references public.states(id) on delete cascade,
  name        text not null,                          -- 'Kern'
  slug        citext not null,
  fips_code   char(5),                                -- census FIPS, handy for data joins
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (state_id, slug)
);

-- Cities (the routing + geo core) --------------------------------------------
create table if not exists public.cities (
  id           uuid primary key default gen_random_uuid(),
  state_id     uuid not null references public.states(id) on delete restrict,
  county_id    uuid references public.counties(id) on delete set null,
  name         text   not null,                       -- 'California City'   APP: reads `city`
  slug         citext not null,                       -- 'california'        APP: route [city] / cities.slug
  state_code   char(2) not null,                      -- 'CA'   denormalized  APP: cities.state
  population   integer check (population >= 0),
  landmark     text,                                  -- e.g. 'California City Central Park'
  latitude     double precision check (latitude between -90 and 90),
  longitude    double precision check (longitude between -180 and 180),
  -- generated geography point for fast radius / nearest-neighbor queries
  geog         geography(Point, 4326)
               generated always as (
                 case when latitude is not null and longitude is not null
                      then st_setsrid(st_makepoint(longitude, latitude), 4326)::geography
                 end
               ) stored,
  timezone     text default 'America/Los_Angeles',
  is_incorporated boolean not null default true,      -- false = CDP/neighborhood (e.g. Oildale)
  status       text not null default 'active'
               check (status in ('active','draft','archived')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- one slug per state (so 'california' is unique within CA)  APP: lookup by (slug,state)
  unique (state_code, slug)
);

create index if not exists cities_slug_idx        on public.cities (slug);
create index if not exists cities_state_code_idx  on public.cities (state_code);
create index if not exists cities_county_idx      on public.cities (county_id);
create index if not exists cities_geog_gix        on public.cities using gist (geog);
create index if not exists cities_name_trgm_idx   on public.cities using gin (name gin_trgm_ops);

-- Practice areas (car-accident, slip-and-fall, ...) --------------------------
create table if not exists public.practice_areas (
  id          uuid primary key default gen_random_uuid(),
  slug        citext not null unique,                 -- 'car-accident'   APP: route [practice]
  name        text   not null,                        -- 'Car Accidents'
  icon        text,
  description text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ============================================================================
-- SEO
-- ============================================================================

-- Per-URL SEO metadata. One row per canonical path (city page or city+practice).
create table if not exists public.page_seo (
  id               uuid primary key default gen_random_uuid(),
  path             text not null unique,              -- '/personal-injury-lawyer/california/los-angeles/car-accident'
  city_id          uuid references public.cities(id) on delete cascade,
  practice_area_id uuid references public.practice_areas(id) on delete cascade,
  meta_title       text,                              -- <= 60 chars recommended
  meta_description text,                              -- <= 155 chars recommended
  canonical_url    text,                              -- absolute; self-canonical by default
  robots           text not null default 'index,follow',
  noindex          boolean not null default false,
  og_title         text,
  og_description   text,
  og_image         text,
  twitter_card     text default 'summary_large_image',
  json_ld          jsonb,                             -- schema.org LegalService / FAQPage / BreadcrumbList
  hreflang         jsonb,                             -- [{ "lang":"en-US", "href":"..." }]
  -- sitemap hints
  sitemap_include  boolean not null default true,
  priority         numeric(2,1) not null default 0.7 check (priority between 0 and 1),
  changefreq       text not null default 'weekly'
                   check (changefreq in ('always','hourly','daily','weekly','monthly','yearly','never')),
  lastmod          timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists page_seo_city_idx     on public.page_seo (city_id);
create index if not exists page_seo_practice_idx on public.page_seo (practice_area_id);
create index if not exists page_seo_json_ld_gin  on public.page_seo using gin (json_ld);

-- Redirects (301/302) — DB-driven so marketing can manage them without deploys.
create table if not exists public.redirects (
  id               uuid primary key default gen_random_uuid(),
  source_path      text not null unique,              -- '/personal-injury-lawyer/california/california'
  destination_path text not null,                     -- '/personal-injury-lawyer/california/california-city'
  status_code      integer not null default 301 check (status_code in (301,302,307,308)),
  is_active        boolean not null default true,
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ============================================================================
-- PROGRAMMATIC CONTENT  (jsonb, layered)   -- APP: getMergedPageConfig()
-- ============================================================================

-- Global/base templates keyed by page kind ('default','homepage', or a practice slug).
create table if not exists public.page_config_templates (
  id         uuid primary key default gen_random_uuid(),
  page_key   citext not null unique,                  -- APP: page_config_templates.page_key
  sections   jsonb  not null default '{}'::jsonb,     -- APP: .sections merged as base
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Location-level overrides. Precedence (low->high): state-general, state+practice,
-- city-general, city+practice. Nulls act as wildcards.  APP: location_page_configs.
create table if not exists public.location_page_configs (
  id            uuid primary key default gen_random_uuid(),
  state_slug    citext not null,                      -- APP: .state_slug
  city_slug     citext,                               -- APP: .city_slug  (null = whole state)
  practice_slug citext,                               -- APP: .practice_slug (null = all practices)
  sections      jsonb not null default '{}'::jsonb,   -- APP: .sections deep-merged
  is_published  boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Exactly one row per (state, city, practice) scope. COALESCE keeps the unique
-- index working when city/practice are NULL (wildcards).
create unique index if not exists location_page_configs_scope_uidx
  on public.location_page_configs
  (state_slug, coalesce(city_slug, ''), coalesce(practice_slug, ''));

-- ============================================================================
-- ATTORNEYS · TERRITORY RENTAL · LEADS   (business logic)
-- ============================================================================

create table if not exists public.attorneys (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,                           -- FK to auth.users(id) in Supabase
  full_name    text not null,
  firm_name    text,
  email        citext not null unique,
  phone        text,
  city         text,                                  -- APP: get-lawyer returns user.city
  state        char(2),                               -- APP: get-lawyer returns user.state
  bar_number   text,
  is_verified  boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- One attorney rents a city (optionally a specific practice) for a date window.
create table if not exists public.territory_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  attorney_id   uuid not null references public.attorneys(id) on delete cascade,
  city_id       uuid not null references public.cities(id)    on delete cascade,
  practice_area_id uuid references public.practice_areas(id)  on delete cascade, -- null = all practices
  status        text not null default 'active'
                check (status in ('active','paused','expired','pending')),
  starts_at     timestamptz not null default now(),
  ends_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists territory_active_idx
  on public.territory_subscriptions (city_id, practice_area_id)
  where status = 'active';

-- At most one ACTIVE attorney per (city, practice) at a time.
create unique index if not exists territory_one_active_per_scope
  on public.territory_subscriptions (city_id, coalesce(practice_area_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'active';

-- Lead capture (the two-step modal / sticky CTA post here). ------------------
create table if not exists public.leads (
  id             uuid primary key default gen_random_uuid(),
  full_name      text,
  email          citext,
  phone          text,
  case_type      text,                                -- practice slug or free text
  city_slug      citext,
  state_code     char(2),
  message        text,
  source         text,                                -- 'hero-car-accident', 'sticky-cta', ...
  page_path      text,                                -- where the lead was captured
  -- attribution
  utm_source     text,
  utm_medium     text,
  utm_campaign   text,
  gclid          text,
  fbclid         text,
  -- routing / lifecycle
  routed_attorney_id uuid references public.attorneys(id) on delete set null,
  status         text not null default 'new'
                 check (status in ('new','contacted','qualified','rejected','won','lost')),
  ip_hash        text,                                -- store a hash, never raw IP
  user_agent     text,
  created_at     timestamptz not null default now()
);

create index if not exists leads_created_idx on public.leads (created_at desc);
create index if not exists leads_city_idx    on public.leads (state_code, city_slug);
create index if not exists leads_status_idx  on public.leads (status);

-- ============================================================================
-- updated_at triggers
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'states','counties','cities','practice_areas','page_seo','redirects',
    'page_config_templates','location_page_configs','attorneys','territory_subscriptions'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at();', t);
  end loop;
end $$;

-- ============================================================================
-- SITEMAP view — one queryable source for sitemap.xml generation
-- ============================================================================
create or replace view public.sitemap_urls as
select
  s.path,
  s.lastmod,
  s.changefreq,
  s.priority
from public.page_seo s
where s.sitemap_include is true and s.noindex is false;

-- ============================================================================
-- ROW LEVEL SECURITY
--   * Geo / SEO / content / practice_areas  -> public READ (anon).
--   * leads   -> public INSERT only (no read) so the site can capture, but
--                visitors can never list other people's leads.
--   * attorneys / territory_subscriptions / leads reads -> service role only
--     (server uses the service_role key, which bypasses RLS).
-- ============================================================================
alter table public.states                 enable row level security;
alter table public.counties               enable row level security;
alter table public.cities                 enable row level security;
alter table public.practice_areas         enable row level security;
alter table public.page_seo               enable row level security;
alter table public.redirects              enable row level security;
alter table public.page_config_templates  enable row level security;
alter table public.location_page_configs  enable row level security;
alter table public.attorneys              enable row level security;
alter table public.territory_subscriptions enable row level security;
alter table public.leads                  enable row level security;

-- Public read for the content/geo/SEO layer
do $$
declare t text;
begin
  foreach t in array array[
    'states','counties','cities','practice_areas','page_seo','redirects',
    'page_config_templates','location_page_configs'
  ] loop
    execute format(
      'create policy %I on public.%I for select to anon, authenticated using (true);',
      t || '_read', t);
  end loop;
end $$;

-- Anonymous visitors can submit a lead, but cannot read leads.
create policy leads_insert on public.leads
  for insert to anon, authenticated with check (true);

-- (No anon policies on attorneys / territory_subscriptions / leads-select:
--  the server reads those with the service_role key, which bypasses RLS.
--  Add authenticated-attorney policies later if attorneys log in directly.)

-- ============================================================================
-- Helpful comments
-- ============================================================================
comment on table public.cities is 'Geo core: routable cities. geog is a generated PostGIS point for radius/nearest queries.';
comment on table public.page_seo is 'Per-URL SEO: meta, canonical, robots, OG, JSON-LD, hreflang, sitemap hints.';
comment on table public.location_page_configs is 'Programmatic content overrides, layered default->state->city->practice; nulls are wildcards.';
comment on table public.leads is 'Lead capture inbox. Public can INSERT only. Store ip_hash, never raw IP.';
comment on view  public.sitemap_urls is 'Flattened feed for sitemap.xml (indexable, sitemap-included pages).';
