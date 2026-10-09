import type { DesktopState } from '../shared/desktop-api'
import { TITLE_BAR_HEIGHT, type TitleBarState } from '../shared/title-bar-api'
import type { ThemeSurface } from './branding'
import { APP_SCHEME } from './local-pages'
import { pendingFileCount } from './sync-state'

export const TITLE_BAR_URL = `${APP_SCHEME}://app/title-bar.html`

type Platform = DesktopState['platform']

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface NavigationState {
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
}

// macOS traffic lights are 14pt tall; centre them in the bar.
const TRAFFIC_LIGHTS = { x: 14, y: (TITLE_BAR_HEIGHT - 14) / 2 }
const TRAFFIC_LIGHTS_WIDTH = 80
/** Room for Electron's minimize, maximize and close buttons on Windows and Linux. */
const WINDOW_CONTROLS_WIDTH = 140

/** Hides the native title bar, keeping the platform's window controls on the app's bar. */
export function frameOptions(
  platform: Platform,
  surface: ThemeSurface
): Pick<
  Electron.BaseWindowConstructorOptions,
  'titleBarStyle' | 'trafficLightPosition' | 'titleBarOverlay'
> {
  if (platform === 'darwin')
    return { titleBarStyle: 'hiddenInset', trafficLightPosition: TRAFFIC_LIGHTS }
  return { titleBarStyle: 'hidden', titleBarOverlay: titleBarOverlay(surface) }
}

/** One pixel short of the bar, so its bottom border runs under the window controls. */
export function titleBarOverlay(surface: ThemeSurface): Electron.TitleBarOverlay {
  return {
    color: surface.background,
    symbolColor: surface.foreground,
    height: TITLE_BAR_HEIGHT - 1,
  }
}

export function titleBarInsets(platform: Platform, fullScreen: boolean) {
  if (platform === 'darwin') return { left: fullScreen ? 12 : TRAFFIC_LIGHTS_WIDTH, right: 12 }
  return { left: 8, right: WINDOW_CONTROLS_WIDTH }
}

export function viewBounds(width: number, height: number): { bar: Rect; content: Rect } {
  return {
    bar: { x: 0, y: 0, width, height: TITLE_BAR_HEIGHT },
    content: { x: 0, y: TITLE_BAR_HEIGHT, width, height: Math.max(0, height - TITLE_BAR_HEIGHT) },
  }
}

export function isTitleBarUrl(url: string | undefined): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}` === TITLE_BAR_URL
  } catch {
    return false
  }
}

export function titleBarState(
  desktop: Pick<DesktopState, 'platform' | 'health' | 'folders' | 'preferences'>,
  navigation: NavigationState,
  fullScreen: boolean,
  view: TitleBarState['view'] = 'teler'
): TitleBarState {
  return {
    platform: desktop.platform,
    view,
    insets: titleBarInsets(desktop.platform, fullScreen),
    showMenuButton: desktop.platform !== 'darwin',
    ...navigation,
    health: desktop.health,
    pendingFiles: pendingFileCount(desktop.folders),
    preferences: desktop.preferences,
  }
}
