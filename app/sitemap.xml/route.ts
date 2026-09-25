import { getSitemapCities, baseUrl, xmlResponse } from '@/lib/sitemap-utils'

export const revalidate = 86400 // Revalidate daily

/**
 * Sitemap index. Each child's <lastmod> reflects the newest content inside it
 * (derived from real per-city timestamps), not build time, so Google sees a
 * credible "this section changed" signal.
 */
export async function GET() {
  const base = baseUrl()

  const cities = await getSitemapCities().catch(() => [])
  const maxIso = (vals: (string | null | undefined)[]) => {
    const ms = vals.map((v) => (v ? new Date(v).getTime() : 0)).filter((n) => Number.isFinite(n) && n > 0)
    return new Date(ms.length ? Math.max(...ms) : Date.now()).toISOString()
  }

  const contentLastmod = maxIso(cities.map((c) => c.lastmod))
  const crashCities = cities.filter((c) => c.hasCrashData)
  const crashLastmod = crashCities.length ? maxIso(crashCities.map((c) => c.crashLastmod || c.lastmod)) : null

  const children: { loc: string; lastmod: string }[] = [
    { loc: `${base}/sitemap-main.xml`, lastmod: contentLastmod },
    { loc: `${base}/sitemap-locations.xml`, lastmod: contentLastmod },
    { loc: `${base}/sitemap-categories.xml`, lastmod: contentLastmod },
  ]
  // Only advertise the crash-data sitemap once at least one city has the module live.
  if (crashLastmod) children.push({ loc: `${base}/sitemap-crashdata.xml`, lastmod: crashLastmod })

  const body = children
    .map((c) => `  <sitemap>\n    <loc>${c.loc}</loc>\n    <lastmod>${c.lastmod}</lastmod>\n  </sitemap>`)
    .join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</sitemapindex>`

  return xmlResponse(xml)
}
