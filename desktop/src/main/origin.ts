export const DEFAULT_TELER_ORIGIN = 'https://app.teler.ai'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Resolves the Teler origin the app loads, with the same rules as the CLI's
 * `TELER_URL`: an origin only, HTTPS except for loopback development.
 */
export function resolveTelerOrigin(raw: string | undefined, name = 'TELER_URL'): string {
  const value = raw?.trim() || DEFAULT_TELER_ORIGIN
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must be a valid URL`)
  }
  if (
    url.username ||
    url.password ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} must be an origin without a path, credentials, query, or fragment`)
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)))
    throw new Error(`${name} must use HTTPS (HTTP is allowed only for loopback development)`)
  return url.origin
}

/**
 * The origin of Teler's sign-in and `/device` pages. Deployments serve them
 * from the app origin; `TELER_AUTH_URL` overrides it for development.
 */
export function resolveAuthOrigin(raw: string | undefined, origin: string): string {
  return raw?.trim() ? resolveTelerOrigin(raw, 'TELER_AUTH_URL') : origin
}

/** A persistent browser partition per origin keeps the sessions of different origins apart. */
export function sessionPartition(origin: string): string {
  if (origin === DEFAULT_TELER_ORIGIN) return 'persist:teler'
  return `persist:teler-${new URL(origin).host.replace(/[^a-z0-9.-]/gi, '_')}`
}
