# SWITRS accident-data hub — database

Real California crash data (SWITRS via UC Berkeley SafeTREC / **TIMS**),
aggregated to `city_year`, `county_year`, and `state_year` rollups plus
`city_time_profile`, `city_top_roads`, and `city_top_intersections`. These
tables feed `components/accident-data-hub.tsx`, read server-side through the
Supabase service role (`lib/get-accident-data.ts`).

See `switrs-pull-spec.md` (repo root) for the full derivation and the SWITRS
codebook key codes.

## Files

| File | What it is |
|---|---|
| `migrations/0001_switrs_accident_data.sql` | Rollup table DDL + indexes + read-only RLS |
| `sql/aggregations.sql` | Staging DDL + the county→city/county/state rollup SQL and §6 time/roads/intersections |
| `etl_switrs.py` | One-shot loader: county CSVs → staging → aggregations |

## Workflow

1. **Export from TIMS** (SWITRS Query & Map), one county at a time, all years in
   one window. Download **Crashes**, **Parties**, **Victims** for each county and
   name them `crashes_<county>.csv`, `parties_<county>.csv`, `victims_<county>.csv`
   in `supabase/data/` (git-ignored — raw exports are large).
2. **Apply the schema** — run `migrations/0001_switrs_accident_data.sql` against
   the Supabase Postgres (SQL editor, or the ETL does it for you).
3. **Load + aggregate**:
   ```bash
   export SUPABASE_DB_URL="postgresql://...supabase-direct-connection..."
   python supabase/etl_switrs.py           # loads ./data/*.csv, runs aggregations
   python supabase/etl_switrs.py --agg-only # re-aggregate existing staging only
   ```
4. **Set the two external fields** the aggregation cannot derive:
   - `population` — per city/county/state/year from CA Dept. of Finance (E-1) or
     Census/ACS. Rates recompute cleanly at render when population updates.
   - `status` — `'final'` vs `'prov'` per year. CHP marks a year final only after
     its Annual Report ships; 2024+ is provisional. The component suppresses the
     "vs prior year" delta on provisional years.

## Contract with the app

- The component/fetcher never store rates — **rates are derived at render** from
  `injuries|fatalities / population * 100000`.
- `lib/get-accident-data.ts` matches a page's city by name (case-insensitive) and
  derives the county from the returned rows, so no county lookup is needed on the
  page. When a city has no `city_year` rows, the fetcher returns `null` and the
  page falls back to the modeled estimate (`data/accident-stats.ts`).
- Column names here are the exact snake_case the fetcher maps to the component's
  camelCase keys (`fatalCrashes`, `injuryCrashes`, the `{f,i}` pairs, etc.).

## Accuracy caveats (from the pull spec)

- **Population is external** — SWITRS `POPULATION` is deprecated; use DOF/Census.
- **Provisional years** shouldn't be compared directly to finalized years.
- **Unincorporated** crashes have a blank `city` and roll up to county/state only.
- **drug / distracted / unrestrained** are analyst-defined code sets; spot-check
  against the TIMS Summary tool if you need exact parity.
- **Cross-check fatalities against NHTSA FARS**; divergence usually means a
  geocoding / jurisdiction issue to resolve before publishing.
