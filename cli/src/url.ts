export const DEFAULT_TELER_URL = 'https://app.teler.ai'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export interface TelerUrlEnv {
  TELER_URL?: string
}

export function resolveTelerUrl(env: TelerUrlEnv | NodeJS.ProcessEnv = process.env): URL {
  const raw = env.TELER_URL?.trim() || DEFAULT_TELER_URL
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('TELER_URL must be a valid URL')
  }

  if (
    url.username !== '' ||
    url.password !== '' ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('TELER_URL must be an origin without a path, credentials, query, or fragment')
  }

  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))
  ) {
    throw new Error('TELER_URL must use HTTPS (HTTP is allowed only for loopback development)')
  }

  return new URL(url.origin)
}
