import { promises as fs } from 'fs'
import path from 'path'
import { supabaseServer } from '@/lib/supabase-server'
import { StateDataLoader } from '@/lib/data/state-loader'

/**
 * Server-side reader for the SWITRS accident-data hub.
 *
 * Reads the rollup tables created by supabase/migrations/0001_switrs_accident_data.sql
 * (populated by supabase/etl_switrs.py) and maps the snake_case DB columns to the
 * camelCase keys that components/accident-data-hub.tsx renders.
 *
 * Rates are NEVER stored — they are derived at render from injuries|fatalities /
 * population. Only `population` and `status` are external to the SWITRS aggregation.
 *
 * Returns `null` when the city has no `city_year` rows (no data loaded yet, or a
 * non-California city — SWITRS is California-only). The city page falls back to the
 * modeled estimate (`data/accident-stats.ts`) in that case.
 */

export interface FI {
  f: number
  i: number
}

export interface CityYear {
  year: number
  population: number | null
  fatalCrashes: number
  injuryCrashes: number
  fatalities: number
  injuries: number
  seriousInjuries: number
  status: 'final' | 'prov' | 'partial'
  // road-user classes
  occupant: FI
  pedestrian: FI
  bicyclist: FI
  motorcyclist: FI
  truck: FI
  olderAdult: FI
  unrestrained: FI
  // contributing factors
  alcohol: FI
  drug: FI
  distracted: FI
  speeding: FI
}

export interface BenchYear {
  year: number
  population: number | null
  injuries: number
  fatalities: number
}

export interface TimeBucket {
  bucket: number
  crashes: number
  injuries: number
  fatalities: number
}

export interface RoadRow {
  rank: number
  road: string
  crashes: number
  injuries: number
  fatalities: number
}

export interface IntersectionRow {
  rank: number
  intersection: string
  crashes: number
  injuries: number
  fatalities: number
}

export interface AccidentData {
  city: string
  county: string
  state: string
  stateAbbr: string
  source?: string                         // e.g. "CCRS · data.ca.gov + CA population"
  years: CityYear[]                       // ascending by year
  county_benchmark: Record<number, BenchYear>
  state_benchmark: Record<number, BenchYear>
  timeProfile: {
    span: string | null
    hours: TimeBucket[]                   // bucket 0-23
    dow: TimeBucket[]                     // bucket 1=Mon .. 7=Sun
  }
  topRoads: RoadRow[]
  topIntersections: IntersectionRow[]
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0)
const pair = (r: any, base: string): FI => ({ f: num(r[`${base}_f`]), i: num(r[`${base}_i`]) })

function mapCityYear(r: any): CityYear {
  return {
    year: num(r.year),
    population: r.population == null ? null : num(r.population),
    fatalCrashes: num(r.fatal_crashes),
    injuryCrashes: num(r.injury_crashes),
    fatalities: num(r.fatalities),
    injuries: num(r.injuries),
    seriousInjuries: num(r.serious_injuries),
    status: r.status === 'prov' ? 'prov' : 'final',
    occupant: pair(r, 'occupant'),
    pedestrian: pair(r, 'ped'),
    bicyclist: pair(r, 'bike'),
    motorcyclist: pair(r, 'moto'),
    truck: pair(r, 'truck'),
    olderAdult: pair(r, 'older'),
    unrestrained: pair(r, 'unrestrained'),
    alcohol: pair(r, 'alcohol'),
    drug: pair(r, 'drug'),
    distracted: pair(r, 'distracted'),
    speeding: pair(r, 'speeding'),
  }
}

function benchIndex(rows: any[] | null): Record<number, BenchYear> {
  const out: Record<number, BenchYear> = {}
  for (const r of rows ?? []) {
    const year = num(r.year)
    out[year] = {
      year,
      population: r.population == null ? null : num(r.population),
      injuries: num(r.injuries),
      fatalities: num(r.fatalities),
    }
  }
  return out
}

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/**
 * Read a committed static-JSON payload for a city, if one exists.
 * Path: data/accident/<stateSlug>/<citySlug>.json — a full AccidentData object.
 * This is the no-database path: real aggregates live in the repo and render at
 * build time, exactly like data/states/*.json. Returns null when absent.
 */
async function readStaticAccidentData(
  stateSlug: string,
  citySlug: string,
): Promise<AccidentData | null> {
  try {
    const file = path.join(process.cwd(), 'data', 'accident', stateSlug.toLowerCase(), `${citySlug}.json`)
    const raw = await fs.readFile(file, 'utf-8')
    const data = JSON.parse(raw.replace(/^﻿/, '')) as AccidentData
    if (!data?.years?.length) return null
    return data
  } catch {
    return null
  }
}

/**
 * Fetch the multi-year accident-data hub payload for a city, or null if none.
 *
 * Resolution order:
 *   1. Committed static JSON (data/accident/<state>/<city>.json) — no DB needed.
 *   2. Supabase rollup tables (city_year etc.).
 *   3. null → the city page falls back to the modeled estimate.
 *
 * The Supabase path matches on city name (case-insensitive) because location
 * records don't carry a county; the county is derived from the returned rows.
 * If the city name maps to more than one county (rare), the county with the
 * most rows wins.
 */
export async function getAccidentData(
  cityName: string,
  stateSlug: string,
  citySlug?: string,
): Promise<AccidentData | null> {
  // 1. Static JSON first (no database required).
  const staticData = await readStaticAccidentData(stateSlug, citySlug || slugify(cityName))
  if (staticData) return staticData

  try {
    // 2. City rows across all years (the required signal — no rows => fall back).
    const { data: cityRows, error: cityErr } = await supabaseServer
      .from('city_year')
      .select('*')
      .ilike('city', cityName)
      .order('year', { ascending: true })

    if (cityErr || !cityRows || cityRows.length === 0) return null

    // Resolve the dominant county for this city name.
    const countyCounts = new Map<string, number>()
    for (const r of cityRows as any[]) {
      const c = (r.county ?? '').trim()
      if (c) countyCounts.set(c, (countyCounts.get(c) ?? 0) + 1)
    }
    const county =
      [...countyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
      ((cityRows as any[])[0].county ?? '')

    const dbCity = (cityRows as any[])[0].city ?? cityName
    const years = (cityRows as any[])
      .filter((r) => (r.county ?? '').trim() === county || !county)
      .map(mapCityYear)

    // State abbreviation / display name from the state config.
    let stateName = stateSlug
    let stateAbbr = stateSlug.toUpperCase().slice(0, 2)
    try {
      const cfg = await StateDataLoader.getStateConfig(stateSlug)
      if (cfg?.name) stateName = cfg.name
      if (cfg?.abbreviation) stateAbbr = cfg.abbreviation
    } catch {
      /* keep fallbacks */
    }

    // 2-6. Benchmarks + where/when data, in parallel. All are optional.
    const [countyRes, stateRes, timeRes, roadsRes, intxRes] = await Promise.all([
      supabaseServer.from('county_year').select('year, population, injuries, fatalities').ilike('county', county),
      supabaseServer.from('state_year').select('year, population, injuries, fatalities'),
      supabaseServer.from('city_time_profile').select('dim, bucket, crashes, injuries, fatalities').ilike('city', dbCity).ilike('county', county),
      supabaseServer.from('city_top_roads').select('rank, road, crashes, injuries, fatalities').ilike('city', dbCity).ilike('county', county).order('rank', { ascending: true }),
      supabaseServer.from('city_top_intersections').select('rank, intersection, crashes, injuries, fatalities').ilike('city', dbCity).ilike('county', county).order('rank', { ascending: true }),
    ])

    const timeRows = (timeRes.data ?? []) as any[]
    const hours = timeRows
      .filter((r) => r.dim === 'hour')
      .map((r) => ({ bucket: num(r.bucket), crashes: num(r.crashes), injuries: num(r.injuries), fatalities: num(r.fatalities) }))
      .sort((a, b) => a.bucket - b.bucket)
    const dow = timeRows
      .filter((r) => r.dim === 'dow')
      .map((r) => ({ bucket: num(r.bucket), crashes: num(r.crashes), injuries: num(r.injuries), fatalities: num(r.fatalities) }))
      .sort((a, b) => a.bucket - b.bucket)

    return {
      city: dbCity,
      county,
      state: stateName,
      stateAbbr,
      years,
      county_benchmark: benchIndex(countyRes.data as any[]),
      state_benchmark: benchIndex(stateRes.data as any[]),
      timeProfile: {
        span: null, // derived window; left null unless you track it explicitly
        hours,
        dow,
      },
      topRoads: ((roadsRes.data ?? []) as any[]).map((r) => ({
        rank: num(r.rank), road: r.road, crashes: num(r.crashes), injuries: num(r.injuries), fatalities: num(r.fatalities),
      })),
      topIntersections: ((intxRes.data ?? []) as any[]).map((r) => ({
        rank: num(r.rank), intersection: r.intersection, crashes: num(r.crashes), injuries: num(r.injuries), fatalities: num(r.fatalities),
      })),
    }
  } catch {
    return null
  }
}
