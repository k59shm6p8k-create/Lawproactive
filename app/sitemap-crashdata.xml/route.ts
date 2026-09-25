import { getSitemapCities, baseUrl, xmlResponse, xmlLoc, STATE_SLUG } from '@/lib/sitemap-utils'

export const revalidate = 3600 // Revalidate hourly — this set changes as the module rolls out

/**
 * Isolated sitemap of ONLY the cities that have the genuine per-city CCRS
 * crash-data module live. Submit this one on its own in Search Console to focus
 * the recrawl signal on the pages that actually gained unique content.
 *
 * A city qualifies when it has real CCRS data in data/accident/california/<slug>.json
 * (the file get-accident-data.ts reads to render the AccidentDataHub), or its
 * content _meta.crashDataLive === true. Grows automatically as more cities gain
 * data — no code change needed to add cities.
 */
export async function GET() {
  const base = baseUrl()

  try {
    const cities = (await getSitemapCities()).filter((c) => c.hasCrashData)
    console.log(`🗺️ crash-data sitemap: ${cities.length} cities with the CCRS module live`)

    const urlEntries = cities.map((city) => {
      const loc = xmlLoc(`${base}/personal-injury-lawyer/${STATE_SLUG}/${city.slug}`)
      return `  <url>
    <loc>${loc}</loc>
    <lastmod>${city.crashLastmod || city.lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>`
    }).join('\n')

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`

    return xmlResponse(xml)
  } catch (error) {
    console.error('Error generating crash-data sitemap:', error)
    return new Response('Error generating crash-data sitemap', { status: 500 })
  }
}
