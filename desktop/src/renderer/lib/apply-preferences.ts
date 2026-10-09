import { THEME_VARIANTS, type ThemeVariant } from '../../shared/appearance'
import type { DesktopPreferences } from '../../shared/desktop-api'

/** The <html> class that selects a theme's tokens; the default theme has none. */
export function themeClass(variant: ThemeVariant): string | null {
  return variant === 'default' ? null : `theme-${variant}`
}

/**
 * Mirrors the user's Teler web appearance on the local pages through the
 * tokens in `theme.css`. This writes no cookies or storage: the main process
 * owns them.
 */
export function applyPreferences(
  preferences: DesktopPreferences,
  root: HTMLElement = document.documentElement
): void {
  for (const variant of THEME_VARIANTS) {
    const name = themeClass(variant)
    if (name) root.classList.toggle(name, variant === preferences.themeVariant)
  }
  const dark = preferences.colorMode === 'dark'
  root.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
  root.lang = preferences.language
}
