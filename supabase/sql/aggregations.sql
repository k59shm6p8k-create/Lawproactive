-- ============================================================================
-- SWITRS aggregation SQL  (see switrs-pull-spec.md §2, §4, §6)
-- ============================================================================
-- Run order (also encoded in supabase/etl_switrs.py):
--   1. staging (below) — one-time DDL for the raw CSV loads
--   2. COPY the per-county Crashes/Parties/Victims CSVs into staging
--   3. agg city  (§4a)   — the ~80% that rolls up from Crashes alone
--   4. agg party (§4b)   — drug + distracted (join Parties)
--   5. agg victim (§4c)  — older-adult + unrestrained (join Victims)
--   6. agg county/state (§4d)
--   7. time profile + top roads + top intersections (§6)
-- Population + status are set separately (external data / CHP finalization).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Staging tables (native SWITRS column names; import the rest if you want the
-- option later — only the columns used below matter for the rollup).
-- ---------------------------------------------------------------------------
create table if not exists public.switrs_crashes_raw (
  case_id                text,
  accident_year          int,
  collision_time         text,
  day_of_week            text,
  city                   text,
  county                 text,
  primary_rd             text,
  secondary_rd           text,
  intersection           text,
  collision_severity     int,
  number_killed          int,
  number_injured         int,
  count_severe_inj       int,
  count_ped_killed       int,
  count_ped_injured      int,
  count_bicyclist_killed int,
  count_bicyclist_injured int,
  count_mc_killed        int,
  count_mc_injured       int,
  truck_accident         text,
  alcohol_involved       text,
  pcf_viol_category      text
);

create table if not exists public.switrs_parties_raw (
  case_id             text,
  party_drug_physical text,
  inattention         text,
  oaf_1               text,
  oaf_2               text
);

create table if not exists public.switrs_victims_raw (
  case_id                 text,
  party_number            text,
  victim_age              int,
  victim_degree_of_injury int,
  victim_safety_equip_1   text
);

create index if not exists switrs_parties_case_idx on public.switrs_parties_raw (case_id);
create index if not exists switrs_victims_case_idx on public.switrs_victims_raw (case_id);

-- ===========================================================================
-- 4a. City rollup from Crashes (the 80%)
-- ===========================================================================
insert into public.city_year (
  city, county, year,
  fatal_crashes, injury_crashes, fatalities, injuries, serious_injuries,
  occupant_f, occupant_i, ped_f, ped_i, bike_f, bike_i, moto_f, moto_i,
  truck_f, truck_i, alcohol_f, alcohol_i, speeding_f, speeding_i)
select
  city, county, accident_year,
  count(*) filter (where collision_severity = 1),
  count(*) filter (where collision_severity in (2,3,4)),
  coalesce(sum(number_killed), 0),
  coalesce(sum(number_injured), 0),
  coalesce(sum(count_severe_inj), 0),
  coalesce(sum(number_killed  - count_ped_killed  - count_bicyclist_killed  - count_mc_killed), 0),
  coalesce(sum(number_injured - count_ped_injured - count_bicyclist_injured - count_mc_injured), 0),
  coalesce(sum(count_ped_killed), 0),        coalesce(sum(count_ped_injured), 0),
  coalesce(sum(count_bicyclist_killed), 0),  coalesce(sum(count_bicyclist_injured), 0),
  coalesce(sum(count_mc_killed), 0),         coalesce(sum(count_mc_injured), 0),
  coalesce(sum(number_killed)  filter (where truck_accident   = 'Y'), 0),
  coalesce(sum(number_injured) filter (where truck_accident   = 'Y'), 0),
  coalesce(sum(number_killed)  filter (where alcohol_involved = 'Y'), 0),
  coalesce(sum(number_injured) filter (where alcohol_involved = 'Y'), 0),
  coalesce(sum(number_killed)  filter (where pcf_viol_category = '03'), 0),
  coalesce(sum(number_injured) filter (where pcf_viol_category = '03'), 0)
from public.switrs_crashes_raw
where city is not null and city <> ''      -- unincorporated crashes have blank city
group by city, county, accident_year
on conflict (city, county, year) do update set
  fatal_crashes = excluded.fatal_crashes, injury_crashes = excluded.injury_crashes,
  fatalities = excluded.fatalities, injuries = excluded.injuries,
  serious_injuries = excluded.serious_injuries,
  occupant_f = excluded.occupant_f, occupant_i = excluded.occupant_i,
  ped_f = excluded.ped_f, ped_i = excluded.ped_i, bike_f = excluded.bike_f,
  bike_i = excluded.bike_i, moto_f = excluded.moto_f, moto_i = excluded.moto_i,
  truck_f = excluded.truck_f, truck_i = excluded.truck_i,
  alcohol_f = excluded.alcohol_f, alcohol_i = excluded.alcohol_i,
  speeding_f = excluded.speeding_f, speeding_i = excluded.speeding_i,
  updated_at = now();

-- ===========================================================================
-- 4b. Party-derived factors (drug, distracted) — attribute each crash once
-- ===========================================================================
with flagged as (
  select c.case_id, c.city, c.county, c.accident_year,
         c.number_killed, c.number_injured,
         bool_or(p.party_drug_physical = 'E')                              as drug,
         bool_or(p.inattention in
           ('A','B','C','D','E','F','G','H','I','J','K','P'))              as distracted
  from public.switrs_crashes_raw c
  join public.switrs_parties_raw p using (case_id)
  where c.city is not null and c.city <> ''
  group by c.case_id, c.city, c.county, c.accident_year,
           c.number_killed, c.number_injured
)
update public.city_year cy set
  drug_f       = agg.drug_f,       drug_i       = agg.drug_i,
  distracted_f = agg.distracted_f, distracted_i = agg.distracted_i,
  updated_at   = now()
from (
  select city, county, accident_year as year,
    coalesce(sum(number_killed)  filter (where drug), 0)        as drug_f,
    coalesce(sum(number_injured) filter (where drug), 0)        as drug_i,
    coalesce(sum(number_killed)  filter (where distracted), 0)  as distracted_f,
    coalesce(sum(number_injured) filter (where distracted), 0)  as distracted_i
  from flagged group by city, county, accident_year
) agg
where cy.city = agg.city and cy.county = agg.county and cy.year = agg.year;

-- ===========================================================================
-- 4c. Victim-derived (older adult 65+, unrestrained)
-- ===========================================================================
with v as (
  select c.city, c.county, c.accident_year as year,
    count(*) filter (where vc.victim_age between 65 and 125
                       and vc.victim_degree_of_injury = 1)                 as older_f,
    count(*) filter (where vc.victim_age between 65 and 125
                       and vc.victim_degree_of_injury in (2,3,4,5,6,7))    as older_i,
    count(*) filter (where vc.victim_safety_equip_1 in ('A','D','F','H','K','U')
                       and vc.victim_degree_of_injury = 1)                 as unrestrained_f,
    count(*) filter (where vc.victim_safety_equip_1 in ('A','D','F','H','K','U')
                       and vc.victim_degree_of_injury in (2,3,4,5,6,7))    as unrestrained_i
  from public.switrs_crashes_raw c
  join public.switrs_victims_raw vc using (case_id)
  where c.city is not null and c.city <> ''
  group by c.city, c.county, c.accident_year
)
update public.city_year cy set
  older_f = v.older_f, older_i = v.older_i,
  unrestrained_f = v.unrestrained_f, unrestrained_i = v.unrestrained_i,
  updated_at = now()
from v
where cy.city = v.city and cy.county = v.county and cy.year = v.year;

-- ===========================================================================
-- 4d. County benchmark (group by county, accident_year — NO city filter, so
--     unincorporated crashes are included in the county rollup).
-- ===========================================================================
insert into public.county_year (
  county, year,
  fatal_crashes, injury_crashes, fatalities, injuries, serious_injuries,
  occupant_f, occupant_i, ped_f, ped_i, bike_f, bike_i, moto_f, moto_i,
  truck_f, truck_i, alcohol_f, alcohol_i, speeding_f, speeding_i)
select
  county, accident_year,
  count(*) filter (where collision_severity = 1),
  count(*) filter (where collision_severity in (2,3,4)),
  coalesce(sum(number_killed), 0),
  coalesce(sum(number_injured), 0),
  coalesce(sum(count_severe_inj), 0),
  coalesce(sum(number_killed  - count_ped_killed  - count_bicyclist_killed  - count_mc_killed), 0),
  coalesce(sum(number_injured - count_ped_injured - count_bicyclist_injured - count_mc_injured), 0),
  coalesce(sum(count_ped_killed), 0),        coalesce(sum(count_ped_injured), 0),
  coalesce(sum(count_bicyclist_killed), 0),  coalesce(sum(count_bicyclist_injured), 0),
  coalesce(sum(count_mc_killed), 0),         coalesce(sum(count_mc_injured), 0),
  coalesce(sum(number_killed)  filter (where truck_accident   = 'Y'), 0),
  coalesce(sum(number_injured) filter (where truck_accident   = 'Y'), 0),
  coalesce(sum(number_killed)  filter (where alcohol_involved = 'Y'), 0),
  coalesce(sum(number_injured) filter (where alcohol_involved = 'Y'), 0),
  coalesce(sum(number_killed)  filter (where pcf_viol_category = '03'), 0),
  coalesce(sum(number_injured) filter (where pcf_viol_category = '03'), 0)
from public.switrs_crashes_raw
where county is not null and county <> ''
group by county, accident_year
on conflict (county, year) do update set
  fatal_crashes = excluded.fatal_crashes, injury_crashes = excluded.injury_crashes,
  fatalities = excluded.fatalities, injuries = excluded.injuries,
  serious_injuries = excluded.serious_injuries,
  occupant_f = excluded.occupant_f, occupant_i = excluded.occupant_i,
  ped_f = excluded.ped_f, ped_i = excluded.ped_i, bike_f = excluded.bike_f,
  bike_i = excluded.bike_i, moto_f = excluded.moto_f, moto_i = excluded.moto_i,
  truck_f = excluded.truck_f, truck_i = excluded.truck_i,
  alcohol_f = excluded.alcohol_f, alcohol_i = excluded.alcohol_i,
  speeding_f = excluded.speeding_f, speeding_i = excluded.speeding_i,
  updated_at = now();

-- ===========================================================================
-- 4d. State benchmark (group by accident_year only — the whole file).
-- ===========================================================================
insert into public.state_year (
  state, year,
  fatal_crashes, injury_crashes, fatalities, injuries, serious_injuries,
  occupant_f, occupant_i, ped_f, ped_i, bike_f, bike_i, moto_f, moto_i,
  truck_f, truck_i, alcohol_f, alcohol_i, speeding_f, speeding_i)
select
  'CA', accident_year,
  count(*) filter (where collision_severity = 1),
  count(*) filter (where collision_severity in (2,3,4)),
  coalesce(sum(number_killed), 0),
  coalesce(sum(number_injured), 0),
  coalesce(sum(count_severe_inj), 0),
  coalesce(sum(number_killed  - count_ped_killed  - count_bicyclist_killed  - count_mc_killed), 0),
  coalesce(sum(number_injured - count_ped_injured - count_bicyclist_injured - count_mc_injured), 0),
  coalesce(sum(count_ped_killed), 0),        coalesce(sum(count_ped_injured), 0),
  coalesce(sum(count_bicyclist_killed), 0),  coalesce(sum(count_bicyclist_injured), 0),
  coalesce(sum(count_mc_killed), 0),         coalesce(sum(count_mc_injured), 0),
  coalesce(sum(number_killed)  filter (where truck_accident   = 'Y'), 0),
  coalesce(sum(number_injured) filter (where truck_accident   = 'Y'), 0),
  coalesce(sum(number_killed)  filter (where alcohol_involved = 'Y'), 0),
  coalesce(sum(number_injured) filter (where alcohol_involved = 'Y'), 0),
  coalesce(sum(number_killed)  filter (where pcf_viol_category = '03'), 0),
  coalesce(sum(number_injured) filter (where pcf_viol_category = '03'), 0)
from public.switrs_crashes_raw
group by accident_year
on conflict (state, year) do update set
  fatal_crashes = excluded.fatal_crashes, injury_crashes = excluded.injury_crashes,
  fatalities = excluded.fatalities, injuries = excluded.injuries,
  serious_injuries = excluded.serious_injuries,
  occupant_f = excluded.occupant_f, occupant_i = excluded.occupant_i,
  ped_f = excluded.ped_f, ped_i = excluded.ped_i, bike_f = excluded.bike_f,
  bike_i = excluded.bike_i, moto_f = excluded.moto_f, moto_i = excluded.moto_i,
  truck_f = excluded.truck_f, truck_i = excluded.truck_i,
  alcohol_f = excluded.alcohol_f, alcohol_i = excluded.alcohol_i,
  speeding_f = excluded.speeding_f, speeding_i = excluded.speeding_i,
  updated_at = now();

-- ===========================================================================
-- 6a. Time profile — hour-of-day + day-of-week (multi-year window).
--     Filter the staging load to your chosen finalized window before running,
--     or add `and accident_year between 2019 and 2023` to each query.
-- ===========================================================================
-- hour of day (collision_time HHMM 24h; drop unknown >= 2400; no leading zero ok)
insert into public.city_time_profile
select city, county, 'hour', (collision_time::int / 100) as bucket,
       count(*), coalesce(sum(number_injured),0), coalesce(sum(number_killed),0)
from public.switrs_crashes_raw
where city <> '' and collision_time is not null and collision_time <> ''
  and collision_time::int >= 0 and collision_time::int < 2400
group by city, county, (collision_time::int / 100)
on conflict (city, county, dim, bucket) do update
  set crashes=excluded.crashes, injuries=excluded.injuries, fatalities=excluded.fatalities;

-- day of week (1=Mon .. 7=Sun)
insert into public.city_time_profile
select city, county, 'dow', day_of_week::int,
       count(*), coalesce(sum(number_injured),0), coalesce(sum(number_killed),0)
from public.switrs_crashes_raw
where city <> '' and day_of_week between '1' and '7'
group by city, county, day_of_week::int
on conflict (city, county, dim, bucket) do update
  set crashes=excluded.crashes, injuries=excluded.injuries, fatalities=excluded.fatalities;

-- ===========================================================================
-- 6b. Top roads — severity-weighted (a fatality counts as 10 injuries).
-- ===========================================================================
insert into public.city_top_roads
select city, county, rank, road, crashes, injuries, fatalities
from (
  select city, county, road, crashes, injuries, fatalities,
         row_number() over (partition by city, county
           order by (injuries + fatalities*10) desc, crashes desc) as rank
  from (
    select city, county,
           upper(btrim(regexp_replace(primary_rd, '\s+', ' ', 'g'))) as road,
           count(*) as crashes, coalesce(sum(number_injured),0) as injuries,
           coalesce(sum(number_killed),0) as fatalities
    from public.switrs_crashes_raw
    where city <> '' and primary_rd is not null and btrim(primary_rd) <> ''
    group by city, county, road
  ) g
) r
where rank <= 5
on conflict (city, county, rank) do update
  set road=excluded.road, crashes=excluded.crashes,
      injuries=excluded.injuries, fatalities=excluded.fatalities;

-- ===========================================================================
-- 6c. Top intersections — strongest hyperlocal hook.
-- ===========================================================================
insert into public.city_top_intersections
select city, county, rank, intersection, crashes, injuries, fatalities
from (
  select city, county, intersection, crashes, injuries, fatalities,
         row_number() over (partition by city, county
           order by (injuries + fatalities*10) desc, crashes desc) as rank
  from (
    select city, county,
           upper(btrim(regexp_replace(primary_rd,'\s+',' ','g'))) || ' & ' ||
           upper(btrim(regexp_replace(secondary_rd,'\s+',' ','g'))) as intersection,
           count(*) as crashes, coalesce(sum(number_injured),0) as injuries,
           coalesce(sum(number_killed),0) as fatalities
    from public.switrs_crashes_raw
    where city <> '' and intersection = 'Y'
      and primary_rd   is not null and btrim(primary_rd)   <> ''
      and secondary_rd is not null and btrim(secondary_rd) <> ''
    group by city, county, intersection
  ) g
) r
where rank <= 5
on conflict (city, county, rank) do update
  set intersection=excluded.intersection, crashes=excluded.crashes,
      injuries=excluded.injuries, fatalities=excluded.fatalities;
