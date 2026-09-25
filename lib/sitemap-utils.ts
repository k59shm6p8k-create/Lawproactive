import { promises as fs } from 'fs'
import path from 'path'
import { getAllPracticeAreaSlugs } from '@/lib/data/practice-areas-config'

/**
 * Shared source of truth for every sitemap route.
 *
 * Scope: California only — the state we've actually built out with per-city
 * content, verified local resources, and (rolling out) the CCRS crash-data
 * module. Other states in data/states/*.json have no per-city content and are
 * intentionally excluded so we don't advertise empty templated pages.
 *
 * <lastmod> is derived from real content timestamps baked into the JSON files
 * (never build/request time), so it only moves when a city's content actually
 * changes — the credible recrawl signal Google needs.
 */

const ROOT = process.cwd()
const CA = 'california'
const CONTENT_DIR = path.join(ROOT, 'data', 'content', CA)
const RESOURCES_DIR = path.join(ROOT, 'data', 'local-resources', CA)
// Real CCRS crash data (via data.ca.gov), read by lib/get-accident-data.ts and
// rendered by the AccidentDataHub. Presence of meaningful data here = the
// genuine per-city crash-data module is live for that city.
const ACCIDENT_DIR = path.join(ROOT, 'data', 'accident', CA)
const CITIES_FILE = path.join(ROOT, 'data', 'states', 'california-cities.json')
const PRUNE_FILE = path.join(ROOT, 'data', 'seo', 'pruned-cities.json')

export const STATE_SLUG = CA
export const PRACTICE_SLUGS = getAllPracticeAreaSlugs()

export interface SitemapCity {
  slug: string
  population: number | null
  lastmod: string // hub page lastmod (ISO)
  hasCrashData: boolean
  crashLastmod: string | null
}

async function readJson(p: string): Promise<any | null> {
  try {
    return JSON.parse((await fs.readFile(p, 'utf8')).replace(/^﻿/, ''))
  } catch {
    return null
  }
}

async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true } catch { return false }
}

/** Parse a date-ish value ("2026-09-08" or ISO) to epoch ms, or 0 if invalid. */
function ms(v: unknown): number {
  if (!v || typeof v !== 'string') return 0
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : 0
}

/** Newest of several date-ish values as a W3C ISO string; falls back to epoch 0's ISO only if nothing valid. */
function newestIso(...vals: unknown[]): string {
  const max = Math.max(0, ...vals.map(ms))
  return new Date(max || Date.now()).toISOString()
}

/** True when an accident file carries real injury/crash data (not just an empty shell). */
function hasMeaningfulCrash(a: any): boolean {
  return Array.isArray(a?.cityYears) &&
    a.cityYears.some((y: any) => (y?.injuryCrashes || 0) > 0 || (y?.injuries || 0) > 0)
}

let prunedCache: { at: number; set: Set<string> } | null = null
/** Slugs to exclude from every sitemap (pruned/low-value). Editable at data/seo/pruned-cities.json. */
async function getPrunedSet(): Promise<Set<string>> {
  if (prunedCache && Date.now() - prunedCache.at < 60_000) return prunedCache.set
  const raw = await readJson(PRUNE_FILE)
  const list: string[] = Array.isArray(raw) ? raw : Array.isArray(raw?.pruned) ? raw.pruned : []
  const set = new Set(list.map((s) => String(s).trim().toLowerCase()).filter(Boolean))
  prunedCache = { at: Date.now(), set }
  return set
}

/**
 * The definitive list of indexable California cities for the sitemaps:
 * every CA city that has a content hub file, minus pruned slugs, minus any
 * city flagged noindex in its content _meta. Includes low-population cities
 * (we intentionally keep the full California footprint).
 */
export async function getSitemapCities(): Promise<SitemapCity[]> {
  const [cities, pruned] = await Promise.all([readJson(CITIES_FILE), getPrunedSet()])
  if (!Array.isArray(cities)) return []

  const out: SitemapCity[] = []
  for (const c of cities) {
    const slug: string = c?.slug
    if (!slug || pruned.has(slug.toLowerCase())) continue

    const content = await readJson(path.join(CONTENT_DIR, `${slug}.json`))
    if (!content) continue // no content -> don't advertise it
    if (content?._meta?.noindex === true) continue // honor per-city noindex

    const resources = await readJson(path.join(RESOURCES_DIR, `${slug}.json`))
    const accident = await readJson(path.join(ACCIDENT_DIR, `${slug}.json`))
    // The crash-data module is "live" for a city when it has real CCRS data
    // (or is explicitly flagged in content _meta).
    const hasCrashData = hasMeaningfulCrash(accident) || content?._meta?.crashDataLive === true

    const lastmod = newestIso(
      content?._meta?.generatedAt,
      resources?._meta?.verifiedAt,
      accident?._meta?.updatedAt,
      accident?._meta?.generatedAt,
    )

    out.push({
      slug,
      population: typeof c?.population === 'number' ? c.population : null,
      lastmod,
      hasCrashData,
      // Accident files carry no own timestamp; use the page's content-tied lastmod.
      crashLastmod: hasCrashData ? lastmod : null,
    })
  }
  return out
}

/** lastmod for a city/practice silo page, from the practice file's own timestamp (falls back to the hub's). */
export async function practiceLastmod(slug: string, practice: string, hubLastmod: string): Promise<string> {
  const doc = await readJson(path.join(CONTENT_DIR, slug, `${practice}.json`))
  const iso = newestIso(doc?._meta?.generatedAt)
  // If the practice file has no usable date, inherit the hub's lastmod.
  return ms(doc?._meta?.generatedAt) ? iso : hubLastmod
}

/** True when the practice silo file actually exists (don't advertise missing pages). */
export async function practiceExists(slug: string, practice: string): Promise<boolean> {
  return fileExists(path.join(CONTENT_DIR, slug, `${practice}.json`))
}

export function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_DOMAIN || 'https://personalinjury.lawproactive.com').replace(/\/$/, '')
}

export function xmlResponse(xml: string): Response {
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  })
}

/** Escape a URL for safe inclusion in XML (ampersands etc.). */
export function xmlLoc(url: string): string {
  return url.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
