#!/usr/bin/env -S npx tsx
/**
 * White-label rewrite: strip the "LawProactive" brand + all middleman framing
 * from funnel content and rewrite into neutral, sender-agnostic first-person
 * voice ("we / our team / us"), so any attorney or firm that rents the funnel
 * reads it as their own. Preserves stats, streets, city/county, dates, CACI/FAQ
 * substance, meta keywords, and JSON structure.
 *
 *   npx tsx scripts/whitelabel-llm.ts proof <files...>     # sync, prints before/after, NO write
 *   npx tsx scripts/whitelabel-llm.ts proof --write <f...> # sync + write those files
 *   npx tsx scripts/whitelabel-llm.ts submit [--limit N] [--only a,b]   # batch the rest
 *   npx tsx scripts/whitelabel-llm.ts status <batchId>
 *   npx tsx scripts/whitelabel-llm.ts fetch  <batchId>     # writes rewritten files
 *
 * Auth: PIPELINE_API_KEY (or ANTHROPIC_API_KEY). Model: --model (default sonnet).
 */
import Anthropic from '@anthropic-ai/sdk';
import { promises as fs } from 'fs';
import path from 'path';

const CA = path.join(process.cwd(), 'data', 'content', 'california');
const MODEL = argVal('--model') || 'claude-sonnet-5';

function argVal(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : undefined;
}
function makeClient() {
  return new Anthropic({ apiKey: (process.env.PIPELINE_API_KEY ?? process.env.ANTHROPIC_API_KEY) ?? null, baseURL: 'https://api.anthropic.com' });
}

const SYSTEM = `You are white-labeling marketing copy for a California personal-injury lead-generation web page. The page is RENTED by different law firms/attorneys, so the copy must read as if the attorney or firm wrote it themselves — sender-agnostic first person.

You receive ONE JSON object (a page's content). Return the SAME JSON object — identical keys, nesting, and array lengths — with STRING VALUES rewritten per the rules. Output ONLY the JSON, no prose, no code fences.

REMOVE completely:
- The brand name "LawProactive" in every form.
- All middleman/intermediary framing: "connect(s)/connecting you with", "matches/pairs you with", "puts you in touch", "an independent attorney", "attorney in the/our network", "connection service", "we make the introduction", "we are not a law firm", "we don't practice law", "get connected with", and anything implying a third party stands between the reader and the sender.

REWRITE into neutral, sender-agnostic first-person voice:
- Use "we", "our team", "us"; use "our firm" sparingly (a solo attorney is not a "firm"). NEVER invent a firm/attorney name and NEVER use placeholders or brackets.
- The sender does the work directly: "we handle", "we review", "we can help", "contact us", "our team handles [practice] claims in [City/County]".
- Headings like "Why <City> Drivers Use LawProactive" -> "Why <City> Drivers Choose Us".
- CTAs like "Get connected with an attorney" -> "Get your free case review" / "Contact us today".
- Keep reassurance framing ("free consultation", "no fee unless you recover") — just remove the middleman.

PRESERVE EXACTLY (never alter, invent, or drop):
- Every number/statistic (collision counts, injuries, deaths, population, years, percentages).
- Every street, road, freeway, highway, landmark, neighborhood, city and county name.
- Dates and time references.
- The legal substance of FAQ/answers (California law, CACI, statutes of limitations / deadlines) — adjust voice only; keep every legal fact and time period identical.
- seo.metaTitle and seo.metaDescription: keep the keywords and roughly the same length; only remove the brand + middleman words; add no brand.
- JSON structure: same keys, same array lengths, same non-string values.

COMPLIANCE (must hold): no outcome guarantees or the word "guaranteed" as a promise; no settlement/verdict dollar amounts; no "#1/best/top-rated/most trusted" superlatives; no "most dangerous road" verdicts; no named attorneys/firms/bar numbers; no phone numbers; never literally write "we are a law firm".`;

function stripFence(s: string) {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}
// Deep-merge rewritten STRING leaves onto the original, preserving structure and
// any non-string values. Guards against the model dropping/adding keys.
function mergeStrings(orig: any, rw: any): any {
  if (typeof orig === 'string') return (typeof rw === 'string' && rw.trim()) ? rw : orig;
  if (Array.isArray(orig)) return orig.map((v, i) => mergeStrings(v, Array.isArray(rw) ? rw[i] : undefined));
  if (orig && typeof orig === 'object') {
    const o: any = {};
    for (const [k, v] of Object.entries(orig)) o[k] = k === '_meta' ? v : mergeStrings(v, rw?.[k]);
    return o;
  }
  return orig;
}
async function rewriteDoc(client: Anthropic, doc: any): Promise<any> {
  const body = JSON.stringify({ ...doc, _meta: undefined });
  const resp = await client.messages.create({
    model: MODEL, max_tokens: 8000,
    system: SYSTEM,
    messages: [{ role: 'user', content: body }],
  });
  const text = resp.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
  const rw = JSON.parse(stripFence(text));
  return mergeStrings(doc, rw);
}
function fileFor(rel: string) { return path.join(CA, rel.endsWith('.json') ? rel : rel + '.json'); }

async function proof() {
  const write = process.argv.includes('--write');
  const targets = process.argv.slice(3).filter((a) => !a.startsWith('--'));
  const client = makeClient();
  for (const t of targets) {
    const file = fileFor(t);
    const doc = JSON.parse((await fs.readFile(file, 'utf8')).replace(/^﻿/, ''));
    const out = await rewriteDoc(client, doc);
    console.log(`\n########## ${t} ##########`);
    for (const f of ['seo.metaTitle', 'seo.metaDescription', 'hero.subtitle', 'about.title', 'about.longDescription', 'whyChoose.title']) {
      const [a, b] = f.split('.');
      if (doc?.[a]?.[b] && doc[a][b] !== out[a][b]) console.log(`\n[${f}]\n  BEFORE: ${doc[a][b]}\n  AFTER : ${out[a][b]}`);
    }
    const leftover = JSON.stringify({ ...out, _meta: undefined }).match(/lawproactive|connect(s|ing)? you|independent attorney|not a law firm/gi);
    console.log(`\n  residual brand/middleman hits: ${leftover ? leftover.length + ' -> ' + [...new Set(leftover)].join(', ') : '0 ✓'}`);
    if (write) { const meta = doc._meta; out._meta = meta; await fs.writeFile(file, JSON.stringify(out, null, 2) + '\n'); console.log('  (written)'); }
  }
}

async function collectFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const e of await fs.readdir(CA)) {
    const f = path.join(CA, e); const st = await fs.stat(f);
    if (st.isFile() && e.endsWith('.json')) files.push(path.relative(CA, f));
    else if (st.isDirectory()) for (const g of await fs.readdir(f)) if (g.endsWith('.json')) files.push(path.relative(CA, path.join(f, g)));
  }
  return files;
}
async function submit() {
  const limit = argVal('--limit') ? parseInt(argVal('--limit')!) : undefined;
  const only = argVal('--only')?.split(',').map((s) => s.trim());
  let files = await collectFiles();
  if (only) files = files.filter((f) => only.some((o) => f.startsWith(o)));
  if (limit) files = files.slice(0, limit);
  const requests = [] as any[];
  for (const rel of files) {
    const doc = JSON.parse((await fs.readFile(fileFor(rel), 'utf8')).replace(/^﻿/, ''));
    requests.push({
      custom_id: Buffer.from(rel).toString('base64url').slice(0, 64),
      params: { model: MODEL, max_tokens: 8000, system: SYSTEM, messages: [{ role: 'user', content: JSON.stringify({ ...doc, _meta: undefined }) }] },
    });
  }
  const batch = await makeClient().messages.batches.create({ requests: requests as any });
  await fs.mkdir('/tmp/wl', { recursive: true });
  await fs.writeFile(`/tmp/wl/${batch.id}.json`, JSON.stringify(files));
  console.log(`Submitted ${requests.length} files. Batch: ${batch.id}\n  status: npx tsx scripts/whitelabel-llm.ts status ${batch.id}\n  fetch : npx tsx scripts/whitelabel-llm.ts fetch ${batch.id}`);
}
async function status() {
  const b = await makeClient().messages.batches.retrieve(process.argv[3]);
  console.log(b.processing_status, JSON.stringify(b.request_counts));
}
async function fetchBatch() {
  const id = process.argv[3];
  const client = makeClient();
  const files: string[] = JSON.parse(await fs.readFile(`/tmp/wl/${id}.json`, 'utf8').catch(() => '[]'));
  const byId = new Map(files.map((rel) => [Buffer.from(rel).toString('base64url').slice(0, 64), rel]));
  let ok = 0, fail = 0;
  for await (const entry of await client.messages.batches.results(id)) {
    const rel = byId.get(entry.custom_id); if (!rel) continue;
    if (entry.result.type !== 'succeeded') { fail++; console.error('FAIL', rel, entry.result.type); continue; }
    try {
      const text = entry.result.message.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
      const doc = JSON.parse((await fs.readFile(fileFor(rel), 'utf8')).replace(/^﻿/, ''));
      const out = mergeStrings(doc, JSON.parse(stripFence(text))); out._meta = doc._meta;
      await fs.writeFile(fileFor(rel), JSON.stringify(out, null, 2) + '\n'); ok++;
    } catch (e) { fail++; console.error('PARSE FAIL', rel, (e as Error).message); }
  }
  console.log(`fetched: ${ok} written, ${fail} failed`);
}

const cmd = process.argv[2];
({ proof, submit, status, fetch: fetchBatch } as any)[cmd]?.() ?? console.log('cmd: proof | submit | status | fetch');
