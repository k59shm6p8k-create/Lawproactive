import { promises as fs } from 'fs'
import path from 'path'

/**
 * A single verified local resource. Every populated resource was grounded in a
 * page fetched during verification and carries the source URL + the verbatim
 * snippet the value came from, so nothing here is guessed. `null` for a slot
 * means "not verified" and the UI omits that card rather than fabricating one.
 */
export interface VerifiedResource {
  name: string
  address?: string | null
  phone?: string | null
  source_url?: string | null
  snippet?: string | null
  confidence?: 'high' | 'review' | null
}

export interface VerifiedPolice extends VerifiedResource {
  /** Real serving agency type — never assume "<City> PD". */
  type?: 'city_pd' | 'sheriff' | 'contract_pd' | null
}

export interface VerifiedCourt extends VerifiedResource {
  court_name?: string | null
  branch?: string | null
  serves_note?: string | null
}

export interface LocalResourcesData {
  city_slug: string
  county?: string | null
  hospital?: VerifiedResource | null
  police?: VerifiedPolice | null
  court?: VerifiedCourt | null
  chp_or_dmv?: VerifiedResource | null
  /** Set by the verification script; not rendered. */
  _meta?: Record<string, unknown>
}

const DIR = path.join(process.cwd(), 'data', 'local-resources', 'california')

/**
 * Load verified local resources for a California city by slug. Returns null when
 * no verified file exists yet, so the page can fall back to a safe generic
 * section instead of showing fabricated institution names.
 */
export async function getLocalResources(citySlug: string): Promise<LocalResourcesData | null> {
  try {
    const file = path.join(DIR, `${citySlug}.json`)
    const raw = (await fs.readFile(file, 'utf8')).replace(/^﻿/, '')
    const data = JSON.parse(raw) as LocalResourcesData
    return data && typeof data === 'object' ? data : null
  } catch {
    return null
  }
}
