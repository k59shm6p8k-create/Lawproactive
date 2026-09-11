#!/usr/bin/env -S npx tsx
/**
 * Silo content generation pipeline (Claude Fable 5.1 + Batch API).
 *
 * Generates the 6 practice-area silo pages for each California city as unique,
 * SB-37-compliant JSON, written to data/content/california/<slug>/<practice>.json.
 * City PAGES are hand-authored separately; this pipeline covers the silos only.
 *
 * Requires: npm install @anthropic-ai/sdk   (zod + tsx already in the project)
 * Auth:     ANTHROPIC_API_KEY, or `ant auth login` (see README).
 * Note:     Fable 5.1 requires standard (30-day) data retention on your org.
 *
 * Commands:
 *   list                         population-ordered cities + how many silos exist
 *   prompts <slug> [practice]    print the exact prompts (no API spend)
 *   submit [opts]                create a Batch and print its id + est. cost
 *   status <batchId>             show batch processing status/counts
 *   fetch  <batchId>             download results, write files, report failures
 *
 * submit options:
 *   --limit N            only the N largest cities (by population)
 *   --only a,b,c         only these city slugs
 *   --practices x,y      only these practice slugs (default: all 6)
 *   --overwrite          regenerate silos that already exist (default: skip)
 *   --model ID           model override (default claude-fable-5-1; e.g. claude-sonnet-5 to test cheap)
 *   --dry-run            build + count requests, print est. cost, do NOT submit
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { promises as fs } from 'fs';
import path from 'path';
import { loadFacts, type CityFacts } from './facts';
import { PRACTICES, type Practice, SiloSchema, SYSTEM_PROMPT, buildUserPrompt, PRACTICE_LABEL } from './prompts';

const ROOT = process.cwd();
const ACCIDENT_DIR = path.join(ROOT, 'data', 'accident', 'california');
const CONTENT_DIR = path.join(ROOT, 'data', 'content', 'california');
const BATCH_DIR = path.join(ROOT, 'scripts', 'generate-silos', '.batches');
const MODEL = 'claude-fable-5-1';
// Fable 5.1 pricing ($/MTok). Batch API is 50% off both sides.
const PRICE_IN = 10, PRICE_OUT = 50;

function parseArgs(argv: string[]) {
  const o: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { o[key] = next; i++; } else { o[key] = true; }
    }
  }
  return o;
}

async function allSlugs(): Promise<string[]> {
  const files = await fs.readdir(ACCIDENT_DIR);
  return files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
}

async function citiesByPopulation(): Promise<CityFacts[]> {
  const slugs = await allSlugs();
  const facts: CityFacts[] = [];
  for (const s of slugs) {
    try { facts.push(await loadFacts(s, ACCIDENT_DIR)); } catch { /* skip unreadable */ }
  }
  facts.sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
  return facts;
}

async function siloExists(slug: string, practice: Practice): Promise<boolean> {
  try { await fs.access(path.join(CONTENT_DIR, slug, `${practice}.json`)); return true; } catch { return false; }
}

async function writeSilo(slug: string, practice: Practice, data: any, model: string) {
  const dir = path.join(CONTENT_DIR, slug);
  await fs.mkdir(dir, { recursive: true });
  const out = {
    _meta: { voice: 'brand-standard', model, generatedAt: new Date().toISOString().slice(0, 10), practice, note: `${slug} ${practice} silo (Fable pipeline).` },
    ...data,
  };
  await fs.writeFile(path.join(dir, `${practice}.json`), JSON.stringify(out, null, 2) + '\n', 'utf-8');
}

// { type: 'json_schema', schema, parse }. Only type+schema go on the wire —
// the parse fn can't serialize into a batch request, so pass just the schema.
const FORMAT_SCHEMA = (zodOutputFormat(SiloSchema) as any).schema;

function buildRequest(facts: CityFacts, practice: Practice, model: string) {
  return {
    custom_id: `${facts.slug}__${practice}`,
    params: {
      model,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user' as const, content: buildUserPrompt(facts, practice) }],
      output_config: { effort: 'medium' as const, format: { type: 'json_schema', schema: FORMAT_SCHEMA } },
    },
  };
}

function parseCustomId(id: string): { slug: string; practice: Practice } {
  const idx = id.lastIndexOf('__');
  return { slug: id.slice(0, idx), practice: id.slice(idx + 2) as Practice };
}

// ─────────────────────────── commands ───────────────────────────
async function cmdList() {
  const cities = await citiesByPopulation();
  let done = 0, total = 0;
  for (const c of cities) {
    let have = 0;
    for (const p of PRACTICES) if (await siloExists(c.slug, p)) have++;
    done += have; total += PRACTICES.length;
  }
  console.log(`Cities: ${cities.length} | silos generated: ${done}/${total}`);
  console.log('Top 20 by population:');
  for (const c of cities.slice(0, 20)) {
    let have = 0;
    for (const p of PRACTICES) if (await siloExists(c.slug, p)) have++;
    console.log(`  ${String(c.population ?? 0).padStart(9)}  ${c.slug.padEnd(22)} silos ${have}/6`);
  }
}

async function cmdPrompts(slug: string, practice?: string) {
  const facts = await loadFacts(slug, ACCIDENT_DIR);
  const list = practice ? [practice as Practice] : [...PRACTICES];
  for (const p of list) {
    console.log(`\n===== ${slug} / ${p} =====`);
    console.log('--- SYSTEM ---\n' + SYSTEM_PROMPT);
    console.log('\n--- USER ---\n' + buildUserPrompt(facts, p));
  }
}

async function selectTargets(o: Record<string, string | boolean>) {
  let cities = await citiesByPopulation();
  if (typeof o.only === 'string') {
    const set = new Set(o.only.split(','));
    cities = cities.filter((c) => set.has(c.slug));
  }
  if (typeof o.limit === 'string') cities = cities.slice(0, parseInt(o.limit, 10));
  const practices: Practice[] = typeof o.practices === 'string'
    ? (o.practices.split(',') as Practice[])
    : [...PRACTICES];
  const targets: { facts: CityFacts; practice: Practice }[] = [];
  for (const c of cities) {
    for (const p of practices) {
      if (!o.overwrite && (await siloExists(c.slug, p))) continue;
      targets.push({ facts: c, practice: p });
    }
  }
  return targets;
}

async function cmdSubmit(o: Record<string, string | boolean>) {
  const model = typeof o.model === 'string' ? o.model : MODEL;
  const targets = await selectTargets(o);
  if (!targets.length) { console.log('Nothing to generate (all selected silos already exist; use --overwrite).'); return; }

  const requests = targets.map((t) => buildRequest(t.facts, t.practice, model));
  // Rough cost estimate: ~700 input + ~1000 output tokens per silo (batch = 50% off).
  const estIn = requests.length * 700, estOut = requests.length * 1000;
  const cost = ((estIn / 1e6) * PRICE_IN + (estOut / 1e6) * PRICE_OUT) * 0.5;
  console.log(`Targets: ${requests.length} silos across ${new Set(targets.map((t) => t.facts.slug)).size} cities.`);
  console.log(`Model: ${model}  |  rough batch cost estimate: ~$${cost.toFixed(2)} (Fable rates; a cheaper --model lowers this).`);

  if (o['dry-run']) { console.log('Dry run — not submitted.'); return; }

  const client = new Anthropic();
  const batch = await client.messages.batches.create({ requests: requests as any });
  await fs.mkdir(BATCH_DIR, { recursive: true });
  await fs.writeFile(path.join(BATCH_DIR, `${batch.id}.json`), JSON.stringify({ id: batch.id, model, count: requests.length, createdAt: new Date().toISOString() }, null, 2));
  console.log(`\nSubmitted batch: ${batch.id}`);
  console.log(`Track with:  npx tsx scripts/generate-silos/index.ts status ${batch.id}`);
  console.log(`Fetch with:  npx tsx scripts/generate-silos/index.ts fetch ${batch.id}`);
}

async function cmdStatus(id: string) {
  const client = new Anthropic();
  const b = await client.messages.batches.retrieve(id);
  console.log(`Batch ${id}: ${b.processing_status}`);
  console.log(JSON.stringify(b.request_counts, null, 2));
}

async function cmdFetch(id: string) {
  const client = new Anthropic();
  let b = await client.messages.batches.retrieve(id);
  while (b.processing_status !== 'ended') {
    console.log(`  status: ${b.processing_status} — waiting 30s…`);
    await new Promise((r) => setTimeout(r, 30_000));
    b = await client.messages.batches.retrieve(id);
  }
  const manifestPath = path.join(BATCH_DIR, `${id}.json`);
  let model = MODEL;
  try { model = JSON.parse(await fs.readFile(manifestPath, 'utf-8')).model ?? MODEL; } catch { /* ok */ }

  let ok = 0;
  const failures: { custom_id: string; reason: string }[] = [];
  for await (const entry of await client.messages.batches.results(id)) {
    const { slug, practice } = parseCustomId(entry.custom_id);
    if (entry.result.type !== 'succeeded') { failures.push({ custom_id: entry.custom_id, reason: entry.result.type }); continue; }
    const msg = entry.result.message;
    if (msg.stop_reason === 'refusal') { failures.push({ custom_id: entry.custom_id, reason: 'refusal' }); continue; }
    const text = msg.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { failures.push({ custom_id: entry.custom_id, reason: 'json_parse' }); continue; }
    const check = SiloSchema.safeParse(parsed);
    if (!check.success) { failures.push({ custom_id: entry.custom_id, reason: 'schema' }); continue; }
    await writeSilo(slug, practice, check.data, model);
    ok++;
  }
  console.log(`\nWrote ${ok} silos.`);
  if (failures.length) {
    const failFile = path.join(BATCH_DIR, `${id}.failures.json`);
    await fs.writeFile(failFile, JSON.stringify(failures, null, 2));
    const slugs = [...new Set(failures.map((f) => parseCustomId(f.custom_id).slug))];
    console.log(`${failures.length} failed (see ${failFile}).`);
    console.log(`Retry those cities with:\n  npx tsx scripts/generate-silos/index.ts submit --only ${slugs.join(',')} --overwrite`);
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const o = parseArgs(rest);
  switch (cmd) {
    case 'list': return cmdList();
    case 'prompts': return cmdPrompts(rest[0], rest[1]);
    case 'submit': return cmdSubmit(o);
    case 'status': return cmdStatus(rest[0]);
    case 'fetch': return cmdFetch(rest[0]);
    default:
      console.log('Usage: index.ts <list|prompts|submit|status|fetch> [args]\nSee the header comment for options.');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
