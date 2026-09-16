#!/usr/bin/env -S npx tsx
/**
 * Verify + populate REAL local resources for each California city hub page, using
 * Anthropic web search. Writes one file per city to
 *   data/local-resources/california/<slug>.json
 * consumed by lib/get-local-resources.ts -> components/local-resources.tsx.
 *
 * Everything is grounded ONLY in pages fetched during the run. A value we can't
 * ground is emitted as null, and the UI omits that card (never a guessed name).
 *
 *   npx tsx scripts/verify-local-resources.ts proof <slugs...>        # search, print JSON, NO write
 *   npx tsx scripts/verify-local-resources.ts proof --write <slugs...># search + write those files
 *   npx tsx scripts/verify-local-resources.ts run --limit N [--offset M]   # write a chunk
 *   npx tsx scripts/verify-local-resources.ts run --only a,b,c        # write specific slugs
 *
 * Cost controls: --model (default sonnet-5), --max-uses <n> (default 4 searches
 * per city), --sleep <ms> between cities. Prints per-city + running web-search
 * counts and token usage so cost is visible BEFORE committing to a big batch.
 *
 * Auth: PIPELINE_API_KEY (or ANTHROPIC_API_KEY).
 */
import Anthropic from '@anthropic-ai/sdk'
import { promises as fs } from 'fs'
import path from 'path'

const ROOT = process.cwd()
const OUT_DIR = path.join(ROOT, 'data', 'local-resources', 'california')
const CITIES = path.join(ROOT, 'data', 'states', 'california-cities.json')

const MODEL = argVal('--model') || 'claude-sonnet-5'
const MAX_USES = parseInt(argVal('--max-uses') || '4')
const SLEEP = parseInt(argVal('--sleep') || '1200')

// Web search tool version depends on model family (per Anthropic docs).
const NEW_SEARCH_MODELS = /opus-(4-8|4-7|4-6|5)|sonnet-(5|4-6)/
const SEARCH_TOOL = NEW_SEARCH_MODELS.test(MODEL) ? 'web_search_20260209' : 'web_search_20250305'

// Never accept a data-broker / aggregator as a source (per the verification spec).
const BLOCKED_DOMAINS = [
  'countyoffice.org', 'county-office.org', 'usacops.com', 'policedepartments.us',
  'hospital-data.com', 'yellowpages.com', 'yelp.com', 'mapquest.com',
  'city-data.com', 'homefacts.com', 'spokeo.com', 'whitepages.com',
  'buzzfile.com', 'chamberofcommerce.com', 'manta.com', 'bizapedia.com',
]

function argVal(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  const v = i >= 0 ? process.argv[i + 1] : undefined
  return v && !v.startsWith('--') ? v : undefined
}
function makeClient() {
  return new Anthropic({
    apiKey: (process.env.PIPELINE_API_KEY ?? process.env.ANTHROPIC_API_KEY) ?? null,
    baseURL: 'https://api.anthropic.com',
  })
}

const SYSTEM = `You verify REAL local resources for a specific California city, to display on a personal-injury help page. Accuracy and honesty are paramount.

STRICT RULES:
- Ground every populated value ONLY in a web page you fetched THIS run. If you cannot verify a value from a fetched page, return null for it. NEVER guess, infer, or fill from prior knowledge.
- For EVERY populated resource include "source_url" (the exact page the value came from) and "snippet" (a short verbatim quote from that page containing the value, with the exact digits for phone/address). No snippet -> the value must be null.
- SOURCE HIERARCHY (prefer, in order): official .gov / official agency site > the institution's official Google Business/Maps listing > an established, reputable directory. NEVER use data-broker / aggregator sites (e.g. countyoffice.org, city-data.com, usacops.com, yellowpages, yelp, spokeo, whitepages and similar) as a source for any value.
- PHONE confidence: "high" only if the number is on the institution's official .gov/agency page OR two independent non-official sources agree. Otherwise "review".
- Prefer information updated within ~2 years; note in snippet if a page shows an older date.

POLICE (do NOT assume "<City> Police Department" exists):
- Many CA cities have no municipal PD and are served by the county Sheriff or a contract city PD. Determine the agency that ACTUALLY provides law-enforcement/patrol services to THIS city and its accident-report/records function.
- Set "type" to one of: "city_pd" (the city runs its own department), "sheriff" (county sheriff serves the city), or "contract_pd" (another city's/agency's PD under contract). Return null if you cannot verify the serving agency.

COURT (California superior courts are COUNTY-level — there are 58, one per county; there is no "<City> Superior Court"):
- Resolve which COUNTY the city is in, then the Superior Court of California, County of <County>, and the specific BRANCH/courthouse that serves this city (civil filings). Verify via courts.ca.gov ("Find My Court") or the county superior court's official site.
- For cities in Los Angeles County, use the civil filing-district courthouse that serves the city.
- "court_name" = e.g. "Superior Court of California, County of X"; "branch" = the courthouse/branch name; "serves_note" = short note on who/what area it serves. Return null if you cannot verify.

OUTPUT: Return ONLY one strict JSON object, no prose, no code fences:
{
  "city_slug": string,
  "county": string|null,
  "hospital": {"name":string,"address":string|null,"phone":string|null,"source_url":string,"snippet":string,"confidence":"high"|"review"}|null,
  "police": {"name":string,"type":"city_pd"|"sheriff"|"contract_pd","address":string|null,"phone":string|null,"source_url":string,"snippet":string,"confidence":"high"|"review"}|null,
  "court": {"court_name":string,"branch":string|null,"serves_note":string|null,"address":string|null,"phone":string|null,"source_url":string,"snippet":string,"confidence":"high"|"review"}|null,
  "chp_or_dmv": {"name":string,"address":string|null,"phone":string|null,"source_url":string,"snippet":string,"confidence":"high"|"review"}|null
}
Any field you cannot verify from a fetched page THIS run must be null (or the whole resource null). Better null than wrong.`

function userPrompt(c: any): string {
  return `City: ${c.city}, California
city_slug: ${c.slug}
Approx coordinates: ${c.latitude}, ${c.longitude}
Task: verify (1) the nearest hospital / ER, (2) the law-enforcement agency that actually serves this city (city PD, county sheriff, or contract PD) and its records/report contact, (3) the county Superior Court branch that serves this city for civil filings, and (4) the nearest CHP office (or DMV) serving this city. Follow every rule. Return the strict JSON only.`
}

function stripFence(s: string) {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
}
function extractJson(text: string): any {
  const t = stripFence(text)
  try { return JSON.parse(t) } catch {}
  const m = t.match(/\{[\s\S]*\}/)
  if (m) return JSON.parse(m[0])
  throw new Error('no JSON in response')
}

async function loadCities(): Promise<any[]> {
  const d = JSON.parse((await fs.readFile(CITIES, 'utf8')).replace(/^﻿/, ''))
  return Array.isArray(d) ? d : d.cities || d.data || []
}

let totalSearches = 0
let totalIn = 0
let totalOut = 0

async function verifyCity(client: Anthropic, c: any): Promise<any> {
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    tools: [{ type: SEARCH_TOOL as any, name: 'web_search', max_uses: MAX_USES, blocked_domains: BLOCKED_DOMAINS } as any],
    messages: [{ role: 'user', content: userPrompt(c) }],
  })
  const u: any = resp.usage || {}
  const searches = u.server_tool_use?.web_search_requests ?? 0
  totalSearches += searches
  totalIn += (u.input_tokens ?? 0)
  totalOut += (u.output_tokens ?? 0)
  const text = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
  const json = extractJson(text)
  json.city_slug = json.city_slug || c.slug
  json._meta = { model: MODEL, verifiedAt: new Date().toISOString(), searches }
  console.log(`  ${c.slug}: ${searches} searches | in ${u.input_tokens} out ${u.output_tokens} | ` +
    `H:${json.hospital ? '✓' : '—'} P:${json.police ? json.police.type : '—'} ` +
    `C:${json.court ? '✓' : '—'} CHP:${json.chp_or_dmv ? '✓' : '—'}`)
  return json
}

async function proof() {
  const write = process.argv.includes('--write')
  const slugs = process.argv.slice(3).filter((a) => !a.startsWith('--') &&
    process.argv[process.argv.indexOf(a) - 1] !== '--model' &&
    process.argv[process.argv.indexOf(a) - 1] !== '--max-uses' &&
    process.argv[process.argv.indexOf(a) - 1] !== '--sleep')
  const cities = await loadCities()
  const client = makeClient()
  if (write) await fs.mkdir(OUT_DIR, { recursive: true })
  console.log(`Model: ${MODEL} | search tool: ${SEARCH_TOOL} | max_uses: ${MAX_USES}\n`)
  for (const slug of slugs) {
    const c = cities.find((x) => x.slug === slug)
    if (!c) { console.error(`  ${slug}: NOT in city list`); continue }
    const json = await verifyCity(client, c)
    console.log(JSON.stringify(json, null, 2))
    if (write) { await fs.writeFile(path.join(OUT_DIR, `${slug}.json`), JSON.stringify(json, null, 2) + '\n') ; console.log('  (written)') }
    await sleep(SLEEP)
  }
  summary()
}

async function run() {
  const only = argVal('--only')?.split(',').map((s) => s.trim())
  const limit = argVal('--limit') ? parseInt(argVal('--limit')!) : undefined
  const offset = argVal('--offset') ? parseInt(argVal('--offset')!) : 0
  let cities = await loadCities()
  if (only) cities = cities.filter((c) => only.includes(c.slug))
  else cities = cities.slice(offset, limit ? offset + limit : undefined)
  const client = makeClient()
  await fs.mkdir(OUT_DIR, { recursive: true })
  console.log(`Model: ${MODEL} | search tool: ${SEARCH_TOOL} | max_uses: ${MAX_USES} | cities: ${cities.length}\n`)
  let ok = 0, fail = 0
  for (const c of cities) {
    try {
      const json = await verifyCity(client, c)
      await fs.writeFile(path.join(OUT_DIR, `${c.slug}.json`), JSON.stringify(json, null, 2) + '\n')
      ok++
    } catch (e) { fail++; console.error(`  ${c.slug}: FAIL ${(e as Error).message}`) }
    await sleep(SLEEP)
  }
  console.log(`\nwrote ${ok}, failed ${fail}`)
  summary()
}

function summary() {
  // Rough cost estimate. Search fee ~$0.01/search; token prices vary by model.
  const price: Record<string, [number, number]> = {
    'claude-sonnet-5': [2, 10], 'claude-haiku-4-5-20251001': [1, 5],
    'claude-haiku-4-5': [1, 5], 'claude-opus-4-8': [5, 25],
  }
  const [pin, pout] = price[MODEL] || [2, 10]
  const tokenCost = (totalIn / 1e6) * pin + (totalOut / 1e6) * pout
  const searchCost = totalSearches * 0.01
  console.log(`\n── usage ──\n  web searches: ${totalSearches} (~$${searchCost.toFixed(2)})` +
    `\n  tokens: in ${totalIn} / out ${totalOut} (~$${tokenCost.toFixed(2)})` +
    `\n  est. total: ~$${(tokenCost + searchCost).toFixed(2)}`)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const cmd = process.argv[2]
;({ proof, run } as any)[cmd]?.().catch((e: any) => { console.error(e); process.exit(1) }) ??
  console.log('cmd: proof <slugs...> [--write] | run [--limit N --offset M | --only a,b]  [--model .. --max-uses ..]')
