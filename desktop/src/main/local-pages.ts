import { extname, normalize, resolve, sep } from 'node:path'
import type { Translate } from './i18n'

/** The Synced folders page is served from the app bundle through this scheme. */
export const APP_SCHEME = 'teler-desktop'
export const APP_ENTRY_URL = `${APP_SCHEME}://app/index.html`

export const SETTINGS_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
}

/** Maps `teler-desktop://app/<path>` to a file inside `root`, or null. */
export function resolveAppAsset(root: string, requestUrl: string): string | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== 'app') return null
  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return null
  }
  // Bundle assets never contain NUL or backslashes; Windows would treat the latter as separators.
  if (pathname.includes('\0') || pathname.includes('\\')) return null
  const base = resolve(root)
  const target = resolve(base, `.${normalize(pathname === '/' ? '/index.html' : pathname)}`)
  return target.startsWith(`${base}${sep}`) ? target : null
}

export function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`)
}

/** Shown in the main window when Teler cannot be loaded. */
export function offlinePageUrl(origin: string, t: Translate): string {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escapeHtml(t('offline.title'))}</title>
<style>:root{color-scheme:light dark}body{font:15px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:CanvasText;background:Canvas}
main{max-width:28rem;padding:2rem;text-align:center}a{display:inline-block;margin-top:1rem;padding:.6rem 1.2rem;border:1px solid ButtonBorder;border-radius:.5rem;color:ButtonText;background:ButtonFace;text-decoration:none}</style>
</head><body><main><h1>${escapeHtml(t('offline.title'))}</h1><p>${escapeHtml(t('offline.body'))}</p>
<a href="${escapeHtml(origin)}/">${escapeHtml(t('offline.retry'))}</a></main></body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}
