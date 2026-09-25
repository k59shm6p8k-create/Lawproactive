import { getSitemapCities, baseUrl, xmlResponse, xmlLoc, STATE_SLUG } from '@/lib/sitemap-utils'
import { SEOPriority } from '@/lib/types/location.types'

export const revalidate = 86400 // Revalidate daily

export async function GET() {
  const base = baseUrl()

  try {
    const cities = await getSitemapCities()
    console.log(`🗺️ locations sitemap: ${cities.length} California city hub pages`)

    const urlEntries = cities.map((city) => {
      const loc = xmlLoc(`${base}/personal-injury-lawyer/${STATE_SLUG}/${city.slug}`)
      return `  <url>
    <loc>${loc}</loc>
    <lastmod>${city.lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${calculatePriority(city).toFixed(1)}</priority>
  </url>`
    }).join('\n')

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`

    return xmlResponse(xml)
  } catch (error) {
    console.error('Error generating locations sitemap:', error)
    return new Response('Error generating locations sitemap', { status: 500 })
  }
}

function calculatePriority(city: { slug: string; population: number | null; hasCrashData: boolean }): number {
  const majorCities = ['los-angeles', 'san-francisco', 'san-diego', 'sacramento', 'san-jose']
  // Cities with the genuine crash-data module get a small bump — they're the
  // most differentiated pages we want recrawled first.
  let p: number = SEOPriority.LOW
  if (majorCities.includes(city.slug)) p = SEOPriority.HIGH
  else if (city.population && city.population > 100000) p = SEOPriority.MEDIUM
  if (city.hasCrashData) p = Math.min(p + 0.1, SEOPriority.HIGH)
  return p
}
