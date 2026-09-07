-- ============================================================================
-- SWITRS accident-data hub — rollup tables
-- ============================================================================
-- Real geocoded California crash data (SWITRS via UC Berkeley SafeTREC / TIMS),
-- aggregated to city / county / state per year. Feeds
-- components/accident-data-hub.tsx (read server-side through the service role).
--
-- One row per (geography, year). Rates (per-100k) are DERIVED AT RENDER, never
-- stored — see switrs-pull-spec.md. Only `population` and `status` are external
-- to the SWITRS aggregation (population: CA DOF / Census; status: final|prov).
--
-- Column names mirror switrs-pull-spec.md §3 so the aggregation SQL and the
-- app's snake_case -> camelCase mapping line up 1:1.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Shared metric columns (documented once; repeated per table)
--   fatal_crashes    count(*) where collision_severity = 1
--   injury_crashes   count(*) where collision_severity in (2,3,4)
--   fatalities       sum(number_killed)
--   injuries         sum(number_injured)
--   serious_injuries sum(count_severe_inj)
--   *_f / *_i        killed / injured for each road-user class or factor
--   population       external (CA DOF E-1 / Census), NOT from SWITRS
--   status           'final' | 'prov'  (provisional years update quarterly)
-- ---------------------------------------------------------------------------

create table if not exists public.city_year (
  city              text    not null,
  county            text    not null,
  year              int     not null,

  fatal_crashes     int     not null default 0,
  injury_crashes    int     not null default 0,
  fatalities        int     not null default 0,
  injuries          int     not null default 0,
  serious_injuries  int     not null default 0,

  -- road-user classes (fatalities / injuries)
  occupant_f        int     not null default 0,
  occupant_i        int     not null default 0,
  ped_f             int     not null default 0,
  ped_i             int     not null default 0,
  bike_f            int     not null default 0,
  bike_i            int     not null default 0,
  moto_f            int     not null default 0,
  moto_i            int     not null default 0,
  truck_f           int     not null default 0,
  truck_i           int     not null default 0,
  older_f           int     not null default 0,   -- 65+  (from Victims)
  older_i           int     not null default 0,
  unrestrained_f    int     not null default 0,   -- belt not used (from Victims)
  unrestrained_i    int     not null default 0,

  -- contributing factors (fatalities / injuries)
  alcohol_f         int     not null default 0,
  alcohol_i         int     not null default 0,
  drug_f            int     not null default 0,   -- from Parties
  drug_i            int     not null default 0,
  distracted_f      int     not null default 0,   -- from Parties
  distracted_i      int     not null default 0,
  speeding_f        int     not null default 0,
  speeding_i        int     not null default 0,

  population        int,
  status            text    not null default 'final'
                            check (status in ('final', 'prov')),
  updated_at        timestamptz not null default now(),

  primary key (city, county, year)
);

create index if not exists city_year_city_idx on public.city_year (lower(city));
create index if not exists city_year_county_idx on public.city_year (lower(county));

-- ---------------------------------------------------------------------------
-- county_year — county benchmark (INCLUDES unincorporated crashes)
-- ---------------------------------------------------------------------------
create table if not exists public.county_year (
  county            text    not null,
  year              int     not null,

  fatal_crashes     int     not null default 0,
  injury_crashes    int     not null default 0,
  fatalities        int     not null default 0,
  injuries          int     not null default 0,
  serious_injuries  int     not null default 0,

  occupant_f int not null default 0, occupant_i int not null default 0,
  ped_f      int not null default 0, ped_i      int not null default 0,
  bike_f     int not null default 0, bike_i     int not null default 0,
  moto_f     int not null default 0, moto_i     int not null default 0,
  truck_f    int not null default 0, truck_i    int not null default 0,
  older_f    int not null default 0, older_i    int not null default 0,
  unrestrained_f int not null default 0, unrestrained_i int not null default 0,
  alcohol_f  int not null default 0, alcohol_i  int not null default 0,
  drug_f     int not null default 0, drug_i     int not null default 0,
  distracted_f int not null default 0, distracted_i int not null default 0,
  speeding_f int not null default 0, speeding_i int not null default 0,

  population        int,
  status            text    not null default 'final'
                            check (status in ('final', 'prov')),
  updated_at        timestamptz not null default now(),

  primary key (county, year)
);

create index if not exists county_year_county_idx on public.county_year (lower(county));

-- ---------------------------------------------------------------------------
-- state_year — statewide benchmark (whole file). `state` future-proofs for
-- non-CA sources; SWITRS itself is California-only.
-- ---------------------------------------------------------------------------
create table if not exists public.state_year (
  state             text    not null default 'CA',
  year              int     not null,

  fatal_crashes     int     not null default 0,
  injury_crashes    int     not null default 0,
  fatalities        int     not null default 0,
  injuries          int     not null default 0,
  serious_injuries  int     not null default 0,

  occupant_f int not null default 0, occupant_i int not null default 0,
  ped_f      int not null default 0, ped_i      int not null default 0,
  bike_f     int not null default 0, bike_i     int not null default 0,
  moto_f     int not null default 0, moto_i     int not null default 0,
  truck_f    int not null default 0, truck_i    int not null default 0,
  older_f    int not null default 0, older_i    int not null default 0,
  unrestrained_f int not null default 0, unrestrained_i int not null default 0,
  alcohol_f  int not null default 0, alcohol_i  int not null default 0,
  drug_f     int not null default 0, drug_i     int not null default 0,
  distracted_f int not null default 0, distracted_i int not null default 0,
  speeding_f int not null default 0, speeding_i int not null default 0,

  population        int,
  status            text    not null default 'final'
                            check (status in ('final', 'prov')),
  updated_at        timestamptz not null default now(),

  primary key (state, year)
);

-- ---------------------------------------------------------------------------
-- city_time_profile — hour-of-day + day-of-week distributions (multi-year
-- window). dim = 'hour' (bucket 0-23) | 'dow' (bucket 1=Mon..7=Sun).
-- ---------------------------------------------------------------------------
create table if not exists public.city_time_profile (
  city        text not null,
  county      text not null,
  dim         text not null check (dim in ('hour', 'dow')),
  bucket      int  not null,
  crashes     int  not null default 0,
  injuries    int  not null default 0,
  fatalities  int  not null default 0,
  primary key (city, county, dim, bucket)
);

create index if not exists city_time_profile_city_idx
  on public.city_time_profile (lower(city), lower(county));

-- ---------------------------------------------------------------------------
-- city_top_roads — roads with the most reported collisions (severity-weighted)
-- ---------------------------------------------------------------------------
create table if not exists public.city_top_roads (
  city        text not null,
  county      text not null,
  rank        int  not null,
  road        text not null,
  crashes     int  not null default 0,
  injuries    int  not null default 0,
  fatalities  int  not null default 0,
  primary key (city, county, rank)
);

create index if not exists city_top_roads_city_idx
  on public.city_top_roads (lower(city), lower(county));

-- ---------------------------------------------------------------------------
-- city_top_intersections — highest-collision junctions (strongest hyperlocal)
-- ---------------------------------------------------------------------------
create table if not exists public.city_top_intersections (
  city         text not null,
  county       text not null,
  rank         int  not null,
  intersection text not null,
  crashes      int  not null default 0,
  injuries     int  not null default 0,
  fatalities   int  not null default 0,
  primary key (city, county, rank)
);

create index if not exists city_top_intersections_city_idx
  on public.city_top_intersections (lower(city), lower(county));

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- The app reads these tables server-side with the service_role key, which
-- bypasses RLS. We still enable RLS and grant a read-only policy to the anon /
-- authenticated roles so the data is safe to expose (it is public record) and
-- could be read client-side later without opening writes.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'city_year','county_year','state_year',
    'city_time_profile','city_top_roads','city_top_intersections'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format(
      'drop policy if exists "public read %1$s" on public.%1$I;', t);
    execute format(
      'create policy "public read %1$s" on public.%1$I for select using (true);', t);
  end loop;
end $$;
