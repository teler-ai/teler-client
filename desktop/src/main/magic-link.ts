export const MAGIC_LINK_PATH = '/api/auth/magic-link/verify'

/**
 * Validates a copied Teler sign-in link. Magic-link emails open in the default
 * browser, so the app accepts the copied link instead. Only the configured
 * origin's (or local sign-in origin's) verification endpoint with a token is
 * accepted.
 */
export function parseMagicLink(text: string, origin: string, authOrigin = origin): string | null {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return null
  }
  if (
    (url.origin !== origin && url.origin !== authOrigin) ||
    url.pathname !== MAGIC_LINK_PATH ||
    url.username ||
    url.password
  )
    return null
  if (!url.searchParams.get('token')) return null
  url.hash = ''
  return url.toString()
}
