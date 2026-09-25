# SEO Sitemap + Recrawl Recovery — what changed & how to submit

Context: site-wide ranking drop / mass de-indexing after the May 2026 Google
core update, consistent with scaled-content-abuse flagging of templated city
pages. Fix = genuine per-city differentiation (real CCRS crash data) + sitemap
infrastructure that credibly signals the update to Google.

Commit: `c048a45` on `main` (and branch `claude/yo-1nkwcw`).

---

## What changed (and why)

### 1. `<lastmod>` is now real, not build time
Before, every sitemap set `lastmod = new Date()`, so it became "now" on every
daily rebuild. Google detects lastmod that always equals crawl time and stops
trusting it — useless exactly when we need a credible recrawl signal.

Now `lastmod` derives from real per-city content timestamps baked into the data
files (`content _meta.generatedAt`, `local-resources _meta.verifiedAt`, and the
accident data), via `lib/sitemap-utils.ts`. It only moves when a page's content
actually changes. To re-signal a single page later: update that file's data and
bump its date.

### 2. Scope narrowed to California (all 484 cities, incl. low-population)
The sitemap previously listed ~597 cities across 5 states, but only California
has real per-city content. The 113 non-CA cities (Arizona 83, Florida/New
York/Texas 10 each) render the generic empty template — textbook scaled content.
They are now excluded. All 484 California cities are included, low-pop kept by
decision (differentiation + time is expected to earn trust).

### 3. Isolated crash-data sitemap — `sitemap-crashdata.xml`
A separate sitemap listing **only** the cities with the genuine CCRS crash-data
module live (real data in `data/accident/california/<slug>.json`, source
data.ca.gov — rendered by the AccidentDataHub). Currently **479 cities**.
Submit this one on its own in Search Console to focus the recrawl signal on the
pages that actually gained unique content. It auto-registers in the sitemap
index once ≥1 city qualifies, and auto-grows as more cities gain data — no code
change needed.

### 4. Exclusions honored everywhere
- `data/seo/pruned-cities.json` → any slug listed there is dropped from all
  sitemaps (currently empty by decision).
- `_meta.noindex: true` in a city's content file → drops it from the sitemaps.
- Only pages that actually exist are advertised.

### 5. Structure kept: sitemap index
`sitemap.xml` remains a sitemap index → `sitemap-main`, `sitemap-locations`
(484), `sitemap-categories` (2,904 city×practice), `sitemap-crashdata` (479).
All well under Google's 50k-URL / 50MB per-file limits; the index makes future
splitting trivial as more states come online.

### Files
- `lib/sitemap-utils.ts` — single source of truth (city list, lastmod, exclusions, crash detection)
- `app/sitemap.xml/route.ts` — index (per-child real lastmod)
- `app/sitemap-locations.xml/route.ts` — 484 CA city hubs
- `app/sitemap-categories.xml/route.ts` — 2,904 city×practice
- `app/sitemap-crashdata.xml/route.ts` — 479 crash-data cities (isolated)
- `data/seo/pruned-cities.json` — exclusion list
- `next.config.mjs` — file tracing for the sitemap routes on Vercel

---

## Search Console submission steps

Do this once the Vercel deploy for `c048a45` shows **Ready**.

### 0. Verify live first (browser)
- `https://personalinjury.lawproactive.com/sitemap.xml` lists a
  `sitemap-crashdata.xml` entry.
- `https://personalinjury.lawproactive.com/sitemap-crashdata.xml` shows 479 URLs.

### 1. Submit sitemaps
GSC → **Indexing → Sitemaps → Add a new sitemap** (enter path only):
1. `sitemap.xml` (the index — covers everything)
2. `sitemap-crashdata.xml` (submit separately — the isolation lever)

Don't submit the other child sitemaps individually; the index carries them.

### 2. Seed the recrawl on flagships
**URL Inspection** (top bar) on ~5–10 strongest crash-data cities (Los Angeles,
San Diego, San Jose, Fresno, Sacramento + a few mid-size) → **Request
Indexing** each. The sitemap carries the long tail.

### 3. Monitor (~2×/week; do NOT spam-resubmit)
- Sitemaps → `sitemap-crashdata.xml` → Discovered → Crawled → Indexed.
- Indexing → Pages → watch "Crawled/Discovered – currently not indexed" shrink.
- Security & Manual Actions → if a manual action exists for thin/scaled content,
  file a **reconsideration request** only after differentiation is live.

### 4. Expectations
- Recrawl of 479 pages rolls out over ~1–4 weeks, not hours.
- Real `lastmod` says "these genuinely changed"; Google still decides the pace.
- Recovery is driven by the content differentiation (real CCRS data on 479
  pages), not the sitemap — the sitemap just makes Google see it fast.

### 5. Scaling later
Drop new data files → sitemaps auto-update. Re-submit the index in GSC only when
a meaningful batch (e.g., a new state) goes live.
