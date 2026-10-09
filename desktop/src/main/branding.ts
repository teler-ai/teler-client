import type { ColorMode, ThemeVariant } from '../shared/appearance'
import type { DesktopPreferences } from '../shared/desktop-api'
import type { Translate } from './i18n'

/** The user agent product that tells the web app it runs inside Teler Desktop. */
export const DESKTOP_USER_AGENT_PRODUCT = 'TelerDesktop'

/**
 * Chromium's user agent without the `Electron/…` and `<app>/…` tokens Electron
 * adds (some sign-in providers refuse embedded Electron browsers), marked as
 * Teler Desktop so the web app can offer desktop-only actions.
 */
export function desktopUserAgent(fallback: string, appName: string, version: string): string {
  const tokens = fallback
    .split(' ')
    .filter((token) => !token.startsWith('Electron/') && !token.startsWith(`${appName}/`))
  return [...tokens, `${DESKTOP_USER_AGENT_PRODUCT}/${version}`].join(' ')
}

export interface ThemeSurface {
  background: string
  foreground: string
}

/**
 * Each theme's background and text colour, for native surfaces that cannot
 * read CSS (window backgrounds, title bar controls). The local pages' theme
 * tokens use the same values.
 */
export const THEME_SURFACES: Record<ThemeVariant, Record<ColorMode, ThemeSurface>> = {
  default: {
    light: { background: '#faf8f5', foreground: '#222222' },
    dark: { background: '#0b0401', foreground: '#f4eee4' },
  },
  editorial: {
    light: { background: '#f8f8f8', foreground: '#0b0b0b' },
    dark: { background: '#030303', foreground: '#f5f5f5' },
  },
  modernisme: {
    light: { background: '#eaf8f9', foreground: '#0b1c2c' },
    dark: { background: '#000612', foreground: '#e4f2f2' },
  },
  dali: {
    light: { background: '#fbf1dc', foreground: '#050c13' },
    dark: { background: '#01030b', foreground: '#f6eedc' },
  },
  llobregat: {
    light: { background: '#f0eae1', foreground: '#15110c' },
    dark: { background: '#0a0704', foreground: '#d8d4cc' },
  },
}

export function themeSurface(
  preferences: Pick<DesktopPreferences, 'themeVariant' | 'colorMode'>
): ThemeSurface {
  return THEME_SURFACES[preferences.themeVariant][preferences.colorMode]
}

/** Replaces Electron's About panel details with Teler's. */
export function aboutPanelOptions(
  version: string,
  iconPath: string,
  t: Translate
): Electron.AboutPanelOptionsOptions {
  return {
    applicationName: 'Teler',
    applicationVersion: version,
    // macOS shows the bundle version in brackets; in development that is Electron's.
    version,
    copyright: 'Copyright © teler.ai',
    website: 'https://teler.ai',
    credits: t('system.appDescription'),
    iconPath,
  }
}

/**
 * The window icon to set, where the platform would otherwise show Electron's:
 * always on Linux, and in Windows development runs. Installed Windows builds
 * use the executable's icon and macOS uses the app bundle's.
 */
export function windowIcon(
  platform: NodeJS.Platform,
  isPackaged: boolean,
  iconPath: string
): string | undefined {
  if (platform === 'linux' || (platform === 'win32' && !isPackaged)) return iconPath
  return undefined
}
