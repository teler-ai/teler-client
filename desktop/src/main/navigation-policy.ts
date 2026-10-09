/**
 * Pure policy for what remote Teler content may do inside the app. The remote
 * windows never get a preload script; these rules confine where they can go.
 */
import { DEFAULT_TELER_ORIGIN } from './origin'

export type NavigationDecision = 'allow' | 'external' | 'deny'
export type WindowOpenDecision = 'child' | 'external' | 'deny'

const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:'])
// An origin may sit behind Cloudflare Access, which can sign in with GitHub. The
// login completes in the window so the Access cookie lands in the app's session,
// where sync reuses it. Anyone can own an Access team or a GitHub page, so
// production never trusts these hosts.
const ACCESS_LOGIN_HOST = /(?:^|\.)cloudflareaccess\.com$|^github\.com$/

function isAccessLogin(url: URL, origin: string): boolean {
  return (
    origin !== DEFAULT_TELER_ORIGIN &&
    url.protocol === 'https:' &&
    ACCESS_LOGIN_HOST.test(url.hostname)
  )
}

function parse(target: string): URL | null {
  try {
    return new URL(target)
  } catch {
    return null
  }
}

/**
 * Top-level navigation of the main Teler window. `authOrigin` is the sign-in
 * origin, normally the app origin (`TELER_AUTH_URL` can override it in development).
 */
export function decideMainNavigation(
  target: string,
  origin: string,
  authOrigin = origin
): NavigationDecision {
  const url = parse(target)
  if (!url) return 'deny'
  if (url.origin === origin || url.origin === authOrigin || isAccessLogin(url, origin))
    return 'allow'
  return EXTERNAL_PROTOCOLS.has(url.protocol) ? 'external' : 'deny'
}

/**
 * `window.open` and `target=_blank` from Teler pages. Same-origin windows (the
 * connector OAuth popup, the upload upgrade page) stay in the app so their
 * opener and same-origin messaging keep working; other sites open in the
 * system browser. A top-level redirect away from Teler, such as a payment
 * page, follows `decideMainNavigation` and leaves the app.
 */
export function decideWindowOpen(
  target: string,
  origin: string,
  authOrigin = origin
): WindowOpenDecision {
  const url = parse(target)
  if (!url) return 'deny'
  if (url.origin === origin || url.origin === authOrigin) return 'child'
  return EXTERNAL_PROTOCOLS.has(url.protocol) ? 'external' : 'deny'
}

/** Child windows may follow HTTPS to OAuth providers or a checkout they started. */
export function decideChildNavigation(
  target: string,
  origin: string,
  authOrigin = origin
): NavigationDecision {
  const url = parse(target)
  if (!url) return 'deny'
  if (url.origin === origin || url.origin === authOrigin || url.protocol === 'https:')
    return 'allow'
  return url.protocol === 'mailto:' || url.protocol === 'http:' ? 'external' : 'deny'
}

/** Only these protocols are ever handed to the operating system. */
export function isExternalUrl(target: string): boolean {
  const url = parse(target)
  return url !== null && EXTERNAL_PROTOCOLS.has(url.protocol)
}

const ALLOWED_PERMISSIONS = new Set([
  'clipboard-sanitized-write',
  'fullscreen',
  'notifications',
  'media',
])

/**
 * Electron grants every permission by default. Teler pages get copy, full
 * screen dashboards, notifications and microphone-only voice input.
 */
export function isPermissionAllowed(
  permission: string,
  requestingUrl: string,
  origin: string,
  mediaTypes: readonly string[] = []
): boolean {
  if (parse(requestingUrl)?.origin !== origin || !ALLOWED_PERMISSIONS.has(permission)) return false
  if (permission !== 'media') return true
  return mediaTypes.length > 0 && mediaTypes.every((type) => type === 'audio')
}
