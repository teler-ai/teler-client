import { z } from 'zod'
import { CLIENT_ID } from './version'

/** Official CLI and Teler Desktop builds are GitHub releases of this repository. */
export const RELEASES_URL =
  'https://api.github.com/repos/teler-ai/teler-client/releases?per_page=100'
/** Every release download must come from here. */
export const DOWNLOAD_PREFIX = 'https://github.com/teler-ai/teler-client/releases/download/'

export type ReleaseProduct = 'cli' | 'desktop'
export type ReleaseFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface ReleaseAsset {
  name: string
  url: string
  size: number
}

export interface Release {
  version: string
  pageUrl: string
  assets: ReleaseAsset[]
}

const releasesSchema = z.array(
  z.object({
    tag_name: z.string(),
    html_url: z.string().url(),
    draft: z.boolean(),
    prerelease: z.boolean(),
    assets: z.array(
      z.object({ name: z.string(), browser_download_url: z.string().url(), size: z.number() })
    ),
  })
)

const VERSION = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-([0-9A-Za-z.-]{1,64}))?$/

export function isVersion(value: string): boolean {
  return VERSION.test(value)
}

function comparePrerelease(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0
  if (a === undefined) return 1
  if (b === undefined) return -1
  const left = a.split('.')
  const right = b.split('.')
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const x = left[index]
    const y = right[index]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const numeric = /^\d+$/.test(x) && /^\d+$/.test(y)
    const order = numeric ? Number(x) - Number(y) : x < y ? -1 : x > y ? 1 : 0
    if (order !== 0) return Math.sign(order)
  }
  return 0
}

/** Semantic version order; a prerelease sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const left = VERSION.exec(a)
  const right = VERSION.exec(b)
  if (!left || !right) throw new Error('Invalid version')
  for (const index of [1, 2, 3]) {
    const order = Number(left[index]) - Number(right[index])
    if (order !== 0) return Math.sign(order)
  }
  return comparePrerelease(left[4], right[4])
}

export function isNewer(candidate: string, current: string): boolean {
  return isVersion(candidate) && isVersion(current) && compareVersions(candidate, current) > 0
}

/** GitHub refused or failed the release listing. */
export class ReleaseCheckError extends Error {
  constructor(readonly status: number) {
    super(`Release check failed (HTTP ${status})`)
  }
}

const PAGE_SIZE = 100
const MAX_PAGES = 10
/** Release pages the clients may open; anything else is ignored. */
const PAGE_PREFIX = 'https://github.com/teler-ai/teler-client/releases/'

/**
 * The newest stable release of a product (tags `cli-v…` and `desktop-v…`), or
 * null when there is none. Drafts, prereleases and prerelease versions are
 * skipped. Pages are read newest first until one has a candidate. Throws when
 * GitHub cannot be read.
 */
export async function latestRelease(
  product: ReleaseProduct,
  options: { fetch?: ReleaseFetch; signal?: AbortSignal; userAgent?: string } = {}
): Promise<Release | null> {
  const prefix = `${product}-v`
  let latest: Release | null = null
  for (let page = 1; page <= MAX_PAGES && !latest; page += 1) {
    const response = await (options.fetch ?? fetch)(`${RELEASES_URL}&page=${page}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': options.userAgent ?? CLIENT_ID,
      },
      signal: options.signal,
    })
    if (!response.ok) throw new ReleaseCheckError(response.status)
    const releases = releasesSchema.parse(await response.json())
    for (const release of releases) {
      const version = release.tag_name.slice(prefix.length)
      if (!release.tag_name.startsWith(prefix) || release.draft || release.prerelease) continue
      if (!isVersion(version) || version.includes('-')) continue
      if (!release.html_url.startsWith(PAGE_PREFIX)) continue
      if (latest && compareVersions(version, latest.version) <= 0) continue
      latest = {
        version,
        pageUrl: release.html_url,
        assets: release.assets
          .filter((asset) => asset.browser_download_url.startsWith(DOWNLOAD_PREFIX))
          .map((asset) => ({
            name: asset.name,
            url: asset.browser_download_url,
            size: asset.size,
          })),
      }
    }
    if (releases.length < PAGE_SIZE) break
  }
  return latest
}
