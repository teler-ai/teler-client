import { shell, type Session, type WebContents } from 'electron'
import {
  decideChildNavigation,
  decideWindowOpen,
  isExternalUrl,
  isPermissionAllowed,
  type NavigationDecision,
} from './navigation-policy'

/** Remote Teler content never gets Node, a preload script or webviews. */
export const REMOTE_WEB_PREFERENCES = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webviewTag: false,
  safeDialogs: true,
} as const

export function openExternal(url: string): void {
  if (isExternalUrl(url)) void shell.openExternal(url)
}

/** Restricts what any page in the Teler session may ask for. */
export function secureSession(session: Session, origin: string): void {
  session.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details ? (details.mediaTypes ?? []) : []
    callback(isPermissionAllowed(permission, details.requestingUrl, origin, mediaTypes))
  })
  session.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) =>
    isPermissionAllowed(
      permission,
      details.requestingUrl ?? requestingOrigin,
      origin,
      details.mediaType ? [details.mediaType] : []
    )
  )
}

/**
 * Applies the navigation policy to a window's contents and, recursively, to
 * every popup it opens. Popups share the session, so OAuth popups keep their
 * opener and same-origin messaging.
 */
export function applyNavigationPolicy(
  contents: WebContents,
  origin: string,
  decide: (url: string) => NavigationDecision,
  authOrigin = origin
): void {
  const guard = (event: { preventDefault(): void }, url: string) => {
    const decision = decide(url)
    if (decision === 'allow') return
    event.preventDefault()
    if (decision === 'external') openExternal(url)
  }
  contents.on('will-navigate', (event) => guard(event, event.url))
  // Subframes (for example a CAPTCHA iframe) keep normal web redirect rules.
  contents.on('will-redirect', (event) => {
    if (event.isMainFrame) guard(event, event.url)
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.setWindowOpenHandler(({ url }) => {
    const decision = decideWindowOpen(url, origin, authOrigin)
    if (decision === 'child')
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: { ...REMOTE_WEB_PREFERENCES },
        },
      }
    if (decision === 'external') openExternal(url)
    return { action: 'deny' }
  })
  contents.on('did-create-window', (child) =>
    applyNavigationPolicy(
      child.webContents,
      origin,
      (url) => decideChildNavigation(url, origin, authOrigin),
      authOrigin
    )
  )
}
