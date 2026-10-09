import { WebContentsView, type WebContents } from 'electron'
import { attachContextMenu } from './context-menu'
import type { Translate } from './i18n'
import { openExternal } from './main-window'
import { isSettingsUrl, SETTINGS_PARTITION } from './settings-window'

export interface LocalViewOptions {
  /** The narrow bridge this page gets. */
  preload: string
  background: string
  /** A fixed page (the top bar) never navigates, even within the bundle. */
  fixed: boolean
  /** Adds the right-click menu, for pages with text to copy or edit. */
  translate?: () => Translate
}

/**
 * A bundled local page in the main window (`teler-desktop://app/`), in the
 * in-memory local partition: it never shares Teler's cookies, and links open
 * in the browser.
 */
export function createLocalView(options: LocalViewOptions): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      partition: SETTINGS_PARTITION,
      preload: options.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
    },
  })
  view.setBackgroundColor(options.background)
  guardLocalPage(view.webContents, options.fixed)
  if (options.translate) attachContextMenu(view.webContents, options.translate)
  return view
}

function guardLocalPage(contents: WebContents, fixed: boolean): void {
  contents.on('will-navigate', (event) => {
    if (!fixed && isSettingsUrl(event.url)) return
    event.preventDefault()
    openExternal(event.url)
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
}
