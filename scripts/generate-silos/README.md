# Silo content generation pipeline (Claude Fable 5.1 + Batch API)

Generates the **6 practice-area silo pages** for each California city as unique,
SB-37-compliant JSON at `data/content/california/<slug>/<practice>.json`.

City **pages** (`data/content/california/<slug>.json`) are hand-authored
separately — this pipeline covers the **silos** only. Everything it writes
merges *below* CMS/city overrides (see `lib/page-content.ts`), so a renter's
later edits always win.

## Prerequisites

1. **SDK** (already added as a devDependency): `@anthropic-ai/sdk`. If a fresh
   checkout is missing it: `npm install`.
2. **Auth** — either export `ANTHROPIC_API_KEY`, or run `ant auth login` (the SDK
   reads the stored profile automatically). Check with `ant auth status`.
3. **Data retention** — Fable 5.1 requires standard (30-day) data retention on
   your Anthropic org. Zero-data-retention orgs get a 400. If so, run with a
   different `--model` (e.g. `claude-sonnet-5`) or ask Anthropic to enable it.

> The console.anthropic.com account that owns the API key is separate from your
> claude.ai login.

## Commands

```bash
# See progress (no API calls)
npx tsx scripts/generate-silos/index.ts list

# Inspect the exact prompts for one city (no API calls, no spend)
npx tsx scripts/generate-silos/index.ts prompts downey car-accident

# Cost-check a run without submitting
npx tsx scripts/generate-silos/index.ts submit --limit 25 --dry-run

# Submit a batch (biggest cities first). Prints a batch id.
npx tsx scripts/generate-silos/index.ts submit --limit 25

# Watch it, then write the files when done
npx tsx scripts/generate-silos/index.ts status <batchId>
npx tsx scripts/generate-silos/index.ts fetch  <batchId>
```

### submit options

| flag | meaning |
|------|---------|
| `--limit N` | only the N largest cities (by population) |
| `--only a,b,c` | only these city slugs |
| `--practices x,y` | only these practices (default: all 6) |
| `--overwrite` | regenerate silos that already exist (default: skip) |
| `--model ID` | model override (default `claude-fable-5-1`; use `claude-sonnet-5` to test cheaply) |
| `--dry-run` | build + estimate cost, do not submit |

## Suggested first run

```bash
# 1. Replace the 4 placeholder cities' templated silos with real Fable copy
npx tsx scripts/generate-silos/index.ts submit \
  --only los-angeles,san-diego,san-jose,downey --overwrite
# ...fetch, eyeball a couple of files for voice/quality...

# 2. Then roll forward in waves, biggest first
npx tsx scripts/generate-silos/index.ts submit --limit 50
```

## Cost

Fable 5.1 is $10 / $50 per MTok; the **Batch API is 50% off**. A silo is roughly
700 input + 1,000 output tokens, so all ~3,270 silos land in the low-hundreds of
dollars at Fable rates (the `submit` command prints an estimate before you
commit). `--model claude-sonnet-5` is ~5× cheaper if you want to trial voice
first.

## Retries

`fetch` writes any refusals/errors to `.batches/<id>.failures.json` and prints a
ready-to-run `submit --only … --overwrite` for just those cities.

## How it works

- `facts.ts` — reads `data/accident/california/<slug>.json` and builds an
  accurate per-city fact block (population, county, latest final-year crash
  counts, peak day/window, cleaned top corridors).
- `prompts.ts` — the brand voice + SB-37 hard rules (system), a per-practice
  California-law anchor, and the structured-output schema (enforced, so every
  result is valid JSON in the exact shape the site renders).
- `index.ts` — selects targets, submits the Batch, and writes validated results.
