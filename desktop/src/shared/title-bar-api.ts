/**
 * Contract between the main process and the app's top bar: a bundled page
 * (`teler-desktop://app/title-bar.html`) shown above the remote Teler page in
 * the main window. Like the Synced folders page it is local and gets a narrow
 * bridge (`window.telerTitleBar`); the remote Teler page never does.
 */
import type { DesktopPreferences, SyncHealth } from './desktop-api'

export const TITLE_BAR_CHANNELS = {
  getState: 'title-bar:get-state',
  stateChanged: 'title-bar:state-changed',
  back: 'title-bar:back',
  forward: 'title-bar:forward',
  reload: 'title-bar:reload',
  openSettings: 'title-bar:open-settings',
  openMenu: 'title-bar:open-menu',
} as const

/** The bar's height in CSS pixels; the remote page starts below it. */
export const TITLE_BAR_HEIGHT = 40

export interface TitleBarState {
  platform: 'darwin' | 'win32' | 'linux'
  /** What the main window shows: the Teler page or the Synced folders page. */
  view: 'teler' | 'sync'
  /**
   * Space to keep clear for the window controls, in CSS pixels: the macOS
   * traffic lights on the left, the Windows and Linux buttons on the right.
   */
  insets: { left: number; right: number }
  /** Windows and Linux have no visible menu bar, so the bar offers one. */
  showMenuButton: boolean
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
  health: SyncHealth
  /** Files waiting to upload across all folders. */
  pendingFiles: number
  preferences: DesktopPreferences
}

export interface TitleBarApi {
  getState(): Promise<TitleBarState>
  /** Returns an unsubscribe function. */
  onStateChanged(listener: (state: TitleBarState) => void): () => void
  back(): Promise<void>
  forward(): Promise<void>
  reload(): Promise<void>
  /** Shows the Synced folders page, or the Teler page again when it is open. */
  openSettings(): Promise<void>
  /** Opens the application menu at a point in the bar, in CSS pixels. */
  openMenu(x: number, y: number): Promise<void>
}
