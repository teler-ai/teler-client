import type { DesktopApi } from '../shared/desktop-api'
import type { TitleBarApi } from '../shared/title-bar-api'

declare global {
  interface Window {
    /** Exposed by the sandboxed preload; absent outside the Synced folders page. */
    telerDesktop?: DesktopApi
    /** Exposed by the top bar's preload; absent outside the app top bar. */
    telerTitleBar?: TitleBarApi
  }
}

export {}
