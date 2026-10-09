import { readFile } from 'node:fs/promises'
import { protocol, session } from 'electron'
import { APP_SCHEME, contentTypeFor, resolveAppAsset, SETTINGS_CSP } from './local-pages'

// An in-memory partition for the app's local pages (Synced folders, the top
// bar): they never share Teler's cookies.
export const SETTINGS_PARTITION = 'teler-settings'
const APP_PREFIX = `${APP_SCHEME}://app/`

/** Must run before `app.whenReady()`. */
export function registerAppScheme(): void {
  // `corsEnabled`: Vite marks module scripts and stylesheets `crossorigin`.
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ])
}

/** Serves the bundled settings renderer and denies every permission but copying. */
export function serveSettingsRenderer(rendererRoot: string): void {
  const settingsSession = session.fromPartition(SETTINGS_PARTITION)
  settingsSession.protocol.handle(APP_SCHEME, async (request) => {
    const file = resolveAppAsset(rendererRoot, request.url)
    if (!file) return new Response('Not found', { status: 404 })
    try {
      return new Response(await readFile(file), {
        headers: {
          'Content-Type': contentTypeFor(file),
          'Content-Security-Policy': SETTINGS_CSP,
          'X-Content-Type-Options': 'nosniff',
        },
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
  const allowed = (permission: string) => permission === 'clipboard-sanitized-write'
  settingsSession.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(allowed(permission))
  )
  settingsSession.setPermissionCheckHandler((_contents, permission) => allowed(permission))
}

export function isSettingsUrl(url: string | undefined): boolean {
  return url?.startsWith(APP_PREFIX) ?? false
}
