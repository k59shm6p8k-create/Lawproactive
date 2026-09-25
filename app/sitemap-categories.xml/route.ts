import { getSitemapCities, practiceLastmod, practiceExists, baseUrl, xmlResponse, xmlLoc, STATE_SLUG, PRACTICE_SLUGS } from '@/lib/sitemap-utils'
import { SEOPriority } from '@/lib/types/location.types'

export const revalidate = 86400 // Revalidate daily

export async function GET() {
  const base = baseUrl()

  try {
    const cities = await getSitemapCities()

    const entries: string[] = []
    for (const city of cities) {
      for (const practice of PRACTICE_SLUGS) {
        // Only advertise silo pages that actually exist.
        if (!(await practiceExists(city.slug, practice))) continue
        const lastmod = await practiceLastmod(city.slug, practice, city.lastmod)
        const loc = xmlLoc(`${base}/personal-injury-lawyer/${STATE_SLUG}/${city.slug}/${practice}`)
        entries.push(`  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${calculatePriority(city, practice).toFixed(1)}</priority>
  </url>`)
      }
    }

    console.log(`🗺️ categories sitemap: ${entries.length} California city×practice pages`)

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>`

    return xmlResponse(xml)
  } catch (error) {
    console.error('Error generating categories sitemap:', error)
    return new Response('Error generating categories sitemap', { status: 500 })
  }
}

function calculatePriority(city: { slug: string; population: number | null }, practice: string): number {
  const majorCities = ['los-angeles', 'san-francisco', 'san-diego', 'sacramento', 'san-jose']
  const highDemand = ['car-accident', 'slip-and-fall', 'medical-malpractice']
  let p: number = SEOPriority.LOW
  if (majorCities.includes(city.slug)) p = SEOPriority.MEDIUM
  if (majorCities.includes(city.slug) && highDemand.includes(practice)) p = SEOPriority.HIGH - 0.1
  if (city.population && city.population > 100000) p = Math.min(p + 0.1, SEOPriority.HIGH - 0.1)
  return p
}
