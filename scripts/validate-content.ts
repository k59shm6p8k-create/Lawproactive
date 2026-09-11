#!/usr/bin/env -S npx tsx
/**
 * Content compliance + structure validator.
 *
 * Scans every generated/hand-written content file under data/content/<state>/
 * and fails on SB-37 / brand-safety violations and schema problems, BEFORE the
 * copy reaches production. Run it after every pipeline fetch.
 *
 *   npx tsx scripts/validate-content.ts            # all states
 *   npx tsx scripts/validate-content.ts california # one state
 *
 * Exit code 1 if any ERROR is found (safe for CI).
 */
import { promises as fs } from 'fs';
import path from 'path';

const ROOT = process.cwd();
const CONTENT = path.join(ROOT, 'data', 'content');

type Sev = 'ERROR' | 'WARN';
interface Issue { file: string; sev: Sev; rule: string; detail: string }

const PRACTICES = ['car-accident','slip-and-fall','medical-malpractice','workplace-injury','product-liability','wrongful-death'];

// ── compliance rules: applied to every string value in the document ──
const BANNED: { rule: string; re: RegExp; sev: Sev; why: string }[] = [
  { rule: 'dollar-figure', re: /\$\s?\d/, sev: 'ERROR', why: 'no settlement/verdict amounts allowed' },
  { rule: 'guarantee', re: /\b(guarantee[ds]?|guaranteeing|we will win|promise you|assured outcome)\b/i, sev: 'ERROR', why: 'no outcome guarantees' },
  { rule: 'superlative', re: /\b(#\s?1|number one|best (lawyer|attorney|firm)|top[- ]rated|most trusted|leading firm)\b/i, sev: 'ERROR', why: 'no ranking/superlative claims' },
  { rule: 'danger-verdict', re: /\b(most dangerous|dangerous (road|street|intersection|highway|corridor)|deadliest|worst (road|street|intersection))\b/i, sev: 'ERROR', why: 'crash data must stay neutral public-record framing' },
  { rule: 'bar-number', re: /\bbar\s*(no\.?|number|#)/i, sev: 'ERROR', why: 'attorney identity is auto-populated, never in generated copy' },
  { rule: 'attorney-name', re: /\b(esq\.?|,\s*(LLP|PLLC)|\bAttorney\s+[A-Z][a-z]+\s+[A-Z][a-z]+)\b/, sev: 'ERROR', why: 'no named attorneys/firms' },
  { rule: 'phone-number', re: /(\(\d{3}\)\s*\d{3}[-.\s]?\d{4}|\b\d{3}[-.]\d{3}[-.]\d{4}\b)/, sev: 'ERROR', why: 'no hardcoded phone numbers' },
  { rule: 'claims-to-be-firm', re: /\bwe are a law firm\b/i, sev: 'ERROR', why: 'LawProactive is a connection service, not a law firm' },
  { rule: 'fake-review', re: /\b(5[- ]star|five[- ]star)\b/i, sev: 'WARN', why: 'reviews are renter-managed in the CMS' },
];

function walkStrings(node: any, cb: (s: string, p: string) => void, p = '') {
  if (typeof node === 'string') return cb(node, p);
  if (Array.isArray(node)) return node.forEach((v, i) => walkStrings(v, cb, `${p}[${i}]`));
  if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walkStrings(v, cb, p ? `${p}.${k}` : k);
}

function words(s: string) { return s.trim().split(/\s+/).filter(Boolean).length; }

function checkStructure(doc: any, isCity: boolean, add: (s: Sev, r: string, d: string) => void) {
  const need = (cond: any, rule: string, detail: string) => { if (!cond) add('ERROR', rule, detail); };

  need(doc?.seo?.metaTitle, 'missing', 'seo.metaTitle');
  need(doc?.seo?.metaDescription, 'missing', 'seo.metaDescription');
  need(doc?.hero?.subtitle, 'missing', 'hero.subtitle');
  need(doc?.about?.longDescription, 'missing', 'about.longDescription');
  need(Array.isArray(doc?.about?.commonInjuries), 'missing', 'about.commonInjuries');
  need(Array.isArray(doc?.whyChoose?.items), 'missing', 'whyChoose.items');
  need(Array.isArray(doc?.faq?.items), 'missing', 'faq.items');

  const t = doc?.seo?.metaTitle ?? '', d = doc?.seo?.metaDescription ?? '';
  if (t.length > 60) add('WARN', 'length', `metaTitle ${t.length} chars (>60)`);
  if (d.length > 155) add('WARN', 'length', `metaDescription ${d.length} chars (>155)`);

  const ci = doc?.about?.commonInjuries;
  if (Array.isArray(ci) && ci.length !== 6) add('WARN', 'count', `about.commonInjuries = ${ci.length} (want 6)`);

  const wc = doc?.whyChoose?.items, faq = doc?.faq?.items;
  const wantWc = isCity ? 4 : 3, wantFaq = isCity ? 5 : 3;
  if (Array.isArray(wc) && wc.length !== wantWc) add('WARN', 'count', `whyChoose.items = ${wc.length} (want ${wantWc})`);
  if (Array.isArray(faq) && faq.length !== wantFaq) add('WARN', 'count', `faq.items = ${faq.length} (want ${wantFaq})`);

  const ld = doc?.about?.longDescription ?? '';
  const w = words(ld);
  const [lo, hi] = isCity ? [140, 240] : [110, 200];
  if (ld && (w < lo || w > hi)) add('WARN', 'length', `about.longDescription ${w} words (want ${lo}-${hi})`);

  if (isCity) {
    need(Array.isArray(doc?.painPoints?.items), 'missing', 'painPoints.items');
    const pp = doc?.painPoints?.items;
    if (Array.isArray(pp) && pp.length !== 4) add('WARN', 'count', `painPoints.items = ${pp.length} (want 4)`);
  }

  // Every generated page must disclaim the firm relationship somewhere.
  if (isCity && ld && !/not a law firm/i.test(ld)) {
    add('WARN', 'disclaimer', 'city about.longDescription does not say "not a law firm"');
  }
}

async function validateFile(file: string, isCity: boolean): Promise<Issue[]> {
  const rel = path.relative(ROOT, file);
  const issues: Issue[] = [];
  const add = (sev: Sev, rule: string, detail: string) => issues.push({ file: rel, sev, rule, detail });

  let doc: any;
  try {
    doc = JSON.parse((await fs.readFile(file, 'utf-8')).replace(/^﻿/, ''));
  } catch (e) {
    add('ERROR', 'json', `unparseable: ${(e as Error).message}`);
    return issues;
  }

  checkStructure(doc, isCity, add);

  walkStrings(doc, (s, p) => {
    if (p.startsWith('_meta')) return; // internal notes aren't shipped copy
    for (const b of BANNED) {
      const m = s.match(b.re);
      if (m) add(b.sev, b.rule, `${p}: "${m[0]}" — ${b.why}`);
    }
  });

  return issues;
}

async function main() {
  const stateArg = process.argv[2];
  const states = stateArg ? [stateArg] : await fs.readdir(CONTENT).catch(() => []);
  const all: Issue[] = [];
  let nCity = 0, nSilo = 0;

  for (const state of states) {
    const dir = path.join(CONTENT, state);
    let entries: string[];
    try { entries = await fs.readdir(dir); } catch { continue; }

    for (const e of entries) {
      const full = path.join(dir, e);
      const st = await fs.stat(full);
      if (st.isFile() && e.endsWith('.json')) {
        nCity++; all.push(...(await validateFile(full, true)));
      } else if (st.isDirectory()) {
        for (const f of await fs.readdir(full)) {
          if (!f.endsWith('.json')) continue;
          const slug = f.slice(0, -5);
          if (!PRACTICES.includes(slug)) all.push({ file: path.relative(ROOT, path.join(full, f)), sev: 'WARN', rule: 'unknown-practice', detail: slug });
          nSilo++; all.push(...(await validateFile(path.join(full, f), false)));
        }
      }
    }
  }

  const errors = all.filter((i) => i.sev === 'ERROR');
  const warns = all.filter((i) => i.sev === 'WARN');

  const byFile = new Map<string, Issue[]>();
  for (const i of all) { if (!byFile.has(i.file)) byFile.set(i.file, []); byFile.get(i.file)!.push(i); }
  for (const [f, list] of [...byFile.entries()].sort()) {
    console.log(`\n${f}`);
    for (const i of list) console.log(`  ${i.sev === 'ERROR' ? '✗' : '!'} [${i.rule}] ${i.detail}`);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Scanned ${nCity} city pages + ${nSilo} silos`);
  console.log(`ERRORS: ${errors.length}   WARNINGS: ${warns.length}`);
  if (errors.length) { console.log('\nFAILED — fix errors before publishing.'); process.exit(1); }
  console.log('\nPASS — no compliance errors.');
}

main().catch((e) => { console.error(e); process.exit(1); });
